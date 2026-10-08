// Main-thread facade over the speech-recognition engine. The engine itself (asr-engine.ts) runs in
// a Web Worker so that decoding a phrase can never starve microphone capture or freeze the UI.

import { stitchSegments, TranscribedSegment } from './stitch';
import { MIN_PHRASE_SAMPLES } from './dsp';
import type { PhraseMeta } from './segmenter';

export { cleanTranscribedText } from './asr-engine';

export type Device = 'cpu' | 'webgpu';

interface Pending {
    resolve: (value: any) => void;
    reject: (err: Error) => void;
    onProgress?: (info: any) => void;
}

function toError(msg: { name?: string; message: string; code?: string }): Error {
    // RangeError is how the out-of-memory case is recognised by callers.
    const err = msg.name === 'RangeError' ? new RangeError(msg.message) : new Error(msg.message);
    if (msg.code) (err as any).code = msg.code;
    return err;
}

/**
 * One speech engine running in its own Web Worker. The app uses a single shared instance (the
 * exported functions below); the speed test creates throw-away instances so it never disturbs
 * the model that is being used for dictation.
 */
export class AsrClient {
    private worker: Worker | null = null;
    private nextRequestId = 1;
    private pending = new Map<number, Pending>();

    // State mirrored from the worker so callers can query it synchronously.
    private loaded = false;
    private modelName = 'Xenova/whisper-tiny.en';
    private device: Device = 'cpu';

    private failAll(err: Error): void {
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
    }

    private getWorker(): Worker {
        if (this.worker) return this.worker;

        const w = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (event: MessageEvent) => {
            const msg = event.data;
            const entry = this.pending.get(msg.id);
            if (!entry) return;
            if (msg.type === 'progress') {
                entry.onProgress?.(msg.info);
                return;
            }
            this.pending.delete(msg.id);
            if (msg.type === 'result') entry.resolve(msg.value);
            else entry.reject(toError(msg));
        };
        w.onerror = (event) => {
            // A crashed worker (e.g. out of memory) takes its model with it; start fresh next time.
            console.error('[Transcribe] Worker crashed:', event.message);
            this.loaded = false;
            this.worker = null;
            this.failAll(new Error(`Speech engine crashed: ${event.message}`));
        };
        this.worker = w;
        return w;
    }

    private request<T>(message: Record<string, unknown>, onProgress?: (info: any) => void, transfer?: Transferable[]): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const id = this.nextRequestId++;
            this.pending.set(id, { resolve, reject, onProgress });
            this.getWorker().postMessage({ ...message, id }, transfer ?? []);
        });
    }

    async loadModel(
        modelName: string = 'Xenova/whisper-tiny.en',
        device: Device = 'cpu',
        dtype: string | undefined = undefined,
        onProgress?: (info: any) => void
    ): Promise<void> {
        // Check WebGPU availability before attempting to use it
        if (device === 'webgpu' && !(typeof navigator !== 'undefined' && 'gpu' in navigator)) {
            const err = new Error('WebGPU is not available on this system');
            (err as any).code = 'WEBGPU_UNAVAILABLE';
            throw err;
        }

        // The engine releases any previous pipeline itself; until the new one is ready nothing is loaded.
        this.loaded = false;
        this.modelName = modelName;
        this.device = device;

        await this.request<void>({ type: 'load', model: modelName, device, dtype }, onProgress);
        this.loaded = true;
    }

    isModelLoaded(): boolean { return this.loaded; }
    getCurrentDevice(): Device { return this.device; }
    getCurrentModelName(): string { return this.modelName; }

    /** Releases the current pipeline (and its WebGPU/WASM buffers). */
    async dispose(): Promise<void> {
        this.loaded = false;
        if (!this.worker) return;
        try {
            await this.request<void>({ type: 'dispose' });
        } catch (err) {
            console.warn('[Transcribe] dispose failed:', err);
        }
    }

    /** Stops the worker entirely, freeing everything it holds. */
    terminate(): void {
        this.loaded = false;
        this.worker?.terminate();
        this.worker = null;
        this.failAll(new Error('Speech engine stopped'));
    }

    /** Transcribes a 16kHz Float32Array audio buffer (decoded in the worker, one job at a time). */
    transcribe(audioData: Float32Array, chunkSize: number = 30): Promise<string> {
        if (!this.loaded) {
            return Promise.reject(new Error("Transcriber model not loaded"));
        }

        if (!audioData || audioData.length < 16000 * 0.15) {
            return Promise.resolve(''); // Skip audio shorter than 150ms to prevent hallucinations
        }

        // Send a copy: the buffer is transferred (not cloned) to the worker, and callers such as the
        // diagnostics harness reuse the same recording for many runs.
        const pcm = audioData.slice();
        return this.request<string>({ type: 'transcribe', pcm, chunkSize }, undefined, [pcm.buffer]);
    }
}

// The engine used for dictation.
const defaultClient = new AsrClient();

export const loadModel = (
    modelName?: string,
    device?: Device,
    dtype?: string,
    onProgress?: (info: any) => void
): Promise<void> => defaultClient.loadModel(modelName, device, dtype, onProgress);
export const isModelLoaded = (): boolean => defaultClient.isModelLoaded();
export const getCurrentDevice = (): Device => defaultClient.getCurrentDevice();
export const getCurrentModelName = (): string => defaultClient.getCurrentModelName();
export const disposeTranscriber = (): Promise<void> => defaultClient.dispose();
export const transcribeAudio = (audioData: Float32Array, chunkSize: number = 30): Promise<string> =>
    defaultClient.transcribe(audioData, chunkSize);

/**
 * Manages streaming background transcription for phrase-chunked audio during active recording.
 * Phrases are transcribed (one at a time) while the user is still talking; when recording stops
 * only the final fragment is left to decode, and the pieces are stitched into one coherent text.
 */
export class StreamingTranscriptionSession {
    private chunks: Array<{ id: number; promise: Promise<TranscribedSegment>; segment?: TranscribedSegment }> = [];
    private nextId = 0;
    private isFinalized = false;
    private lastError: unknown = null;
    private onUpdate: ((partialText: string) => void) | null = null;
    private rawWordCount = 0;

    /**
     * `transcribe` is injectable so tests can decode in-process instead of through the worker.
     * `processSegment` cleans each phrase (fillers, dictionary, AI cleanup) in the background as
     * soon as it is decoded, so by the time recording stops only the last phrase is left to clean.
     */
    constructor(
        private transcribe: (pcm: Float32Array) => Promise<string> = (pcm) => transcribeAudio(pcm, 30),
        private processSegment: ((text: string) => Promise<string>) | null = null
    ) { }

    /** Words in the raw transcription, before any cleanup (for the filler-word statistic). */
    public getRawWordCount(): number {
        return this.rawWordCount;
    }

    /** Called with the text so far each time another phrase finishes decoding. */
    public setOnUpdate(cb: ((partialText: string) => void) | null): void {
        this.onUpdate = cb;
    }

    /**
     * Dispatches a completed phrase to the background transcriber immediately.
     */
    public addPhraseChunk(pcmChunk: Float32Array, meta: PhraseMeta = { forcedCut: false }): number {
        if (this.isFinalized) return -1;
        const chunkId = this.nextId++;

        const promise: Promise<TranscribedSegment> = (async () => {
            try {
                let text = await this.transcribe(pcmChunk);
                this.rawWordCount += text.split(/\s+/).filter(Boolean).length;
                if (this.processSegment && text.trim()) {
                    try {
                        text = await this.processSegment(text);
                    } catch (err) {
                        console.warn(`[StreamingSession] Cleanup failed for chunk #${chunkId}, keeping raw text:`, err);
                    }
                }
                return { text, forcedCut: meta.forcedCut };
            } catch (err) {
                console.warn(`[StreamingSession] Error transcribing chunk #${chunkId}:`, err);
                this.lastError = err;
                return { text: '', forcedCut: meta.forcedCut };
            }
        })();

        const entry: { id: number; promise: Promise<TranscribedSegment>; segment?: TranscribedSegment } = { id: chunkId, promise };
        promise.then(seg => {
            entry.segment = seg;
            if (this.onUpdate && !this.isFinalized) {
                try { this.onUpdate(this.getPartialText()); } catch { /* UI callback must not break decoding */ }
            }
        });
        this.chunks.push(entry);

        return chunkId;
    }

    /**
     * Stitched text of every phrase decoded so far (in order, stopping at the first one still pending).
     */
    public getPartialText(): string {
        const done: TranscribedSegment[] = [];
        for (const c of this.chunks) {
            if (!c.segment) break;
            done.push(c.segment);
        }
        return stitchSegments(done);
    }

    /**
     * Finalizes the session by transcribing any trailing audio fragment and stitching all phrases.
     */
    public async finalize(trailingPcm?: Float32Array): Promise<string> {
        // Dispatch the tail BEFORE marking the session finalized so addPhraseChunk accepts it.
        if (trailingPcm && trailingPcm.length >= MIN_PHRASE_SAMPLES) {
            this.addPhraseChunk(trailingPcm, { forcedCut: false });
        }
        this.isFinalized = true;

        if (this.chunks.length === 0) {
            return '';
        }

        const segments = await Promise.all(this.chunks.map(c => c.promise));
        const assembled = stitchSegments(segments);

        // If every chunk failed, surface the error instead of reporting an empty dictation.
        if (!assembled && this.lastError) {
            throw this.lastError instanceof Error ? this.lastError : new Error(String(this.lastError));
        }

        return assembled;
    }
}
