// @ts-ignore
import { pipeline, env } from '@huggingface/transformers';

// Disable local models since we fetch from HF or cache
env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber: any = null;
let currentModelName = 'Xenova/whisper-tiny.en';
let currentDevice: 'cpu' | 'webgpu' = 'cpu';

export async function loadModel(
    modelName: string = 'Xenova/whisper-tiny.en',
    device: 'cpu' | 'webgpu' = 'cpu',
    dtype: string | undefined = undefined,
    onProgress?: (info: any) => void
) {
    // Check WebGPU availability before attempting to use it
    if (device === 'webgpu' && !(typeof navigator !== 'undefined' && 'gpu' in navigator)) {
        const err = new Error('WebGPU is not available on this system');
        (err as any).code = 'WEBGPU_UNAVAILABLE';
        throw err;
    }

    currentModelName = modelName;
    currentDevice = device;

    const pipelineOptions: any = {
        progress_callback: onProgress,
    };

    if (device === 'webgpu') {
        pipelineOptions.device = 'webgpu';
    }

    if (dtype !== undefined) {
        pipelineOptions.dtype = dtype;
    }

    transcriber = await pipeline('automatic-speech-recognition', modelName, pipelineOptions);
    return transcriber;
}

export function isModelLoaded(): boolean {
    return transcriber !== null;
}

export function getCurrentDevice(): 'cpu' | 'webgpu' {
    return currentDevice;
}

export function getCurrentModelName(): string {
    return currentModelName;
}

/**
 * Releases the current pipeline (and its WebGPU/WASM buffers).
 */
export async function disposeTranscriber(): Promise<void> {
    try {
        await transcriber?.dispose?.();
    } catch (err) {
        console.warn('[Transcribe] dispose failed:', err);
    }
    transcriber = null;
}

/**
 * Cleans Whisper/ASR artifacts, repetition loops, and video training set hallucinations.
 */
export function cleanTranscribedText(rawString: string): string {
    if (!rawString || typeof rawString !== 'string') return '';

    let finalString = rawString.trim();

    // Strip Whisper special bracket tokens like [BLANK_AUDIO], [Music], <|endoftext|>, etc.
    finalString = finalString.replace(/\[.*?\]/g, '').replace(/<\|.*?\|>/g, '').trim();

    // Collapse runaway bracket/paren loops
    finalString = finalString.replace(/[\[\]{}()]{2,}/g, ' ').replace(/\s{2,}/g, ' ').trim();

    // Detect degenerate repetition loops ("the the the the the")
    const repWords = finalString.split(/\s+/).filter(w => w.length > 0);
    if (repWords.length >= 4 && new Set(repWords.map(w => w.toLowerCase())).size === 1) {
        return '';
    }

    // Filter known silence/noise hallucinations from video training sets
    const lower = finalString.toLowerCase().replace(/[.,!?'"]/g, '').trim();
    const SILENCE_HALLUCINATIONS = new Set([
        '', 'thank you for watching', 'thanks for watching',
        'amen', 'please subscribe', 'subscribe', 'subtitles by',
        'watching', 'you', 'the',
    ]);
    if (SILENCE_HALLUCINATIONS.has(lower) && repWords.length <= 4) {
        return '';
    }

    return finalString;
}

// All inference is funneled through one queue. Running several inferences against the same
// pipeline at once makes them fight for the thread (and may fail outright), which silently
// dropped words when phrases were dispatched during recording.
let inferenceQueue: Promise<unknown> = Promise.resolve();

function enqueueInference<T>(job: () => Promise<T>): Promise<T> {
    const run = inferenceQueue.then(job, job);
    inferenceQueue = run.catch(() => undefined);
    return run;
}

const WHISPER_WINDOW_SAMPLES = 16000 * 30;

/**
 * Transcribes a 16kHz Float32Array audio buffer.
 */
export function transcribeAudio(audioData: Float32Array, chunkSize: number = 30): Promise<string> {
    if (!transcriber) {
        return Promise.reject(new Error("Transcriber model not loaded"));
    }

    if (!audioData || audioData.length < 16000 * 0.15) {
        return Promise.resolve(''); // Skip audio shorter than 150ms to prevent hallucinations
    }

    return enqueueInference(async () => {
        // The model may have been disposed/reloaded while this job waited in the queue.
        if (!transcriber) throw new Error("Transcriber model not loaded");

        const isMoonshine = currentModelName.toLowerCase().includes('moonshine');
        const isEnglishOnly = currentModelName.endsWith('.en');

        let result: any;

        if (isMoonshine) {
            // Moonshine cost scales with audio length; cap decoding so noisy input can't loop.
            const seconds = audioData.length / 16000;
            result = await transcriber(audioData, { max_new_tokens: Math.ceil(seconds * 8) + 8 });
        } else {
            const options: any = {};

            // Chunking and timestamps only matter for audio longer than Whisper's 30s window.
            if (audioData.length > WHISPER_WINDOW_SAMPLES) {
                options.chunk_length_s = chunkSize;
                options.stride_length_s = Math.max(1, Math.floor(chunkSize / 6));
                options.return_timestamps = true;
            }

            if (!isEnglishOnly) {
                options.language = 'en';
                options.task = 'transcribe';
            }

            result = await transcriber(audioData, options);
        }

        let extractedText = '';
        if (result && typeof result.text === 'string') {
            extractedText = result.text.trim();
        } else if (Array.isArray(result)) {
            extractedText = result.map((r: any) => r.text ?? '').join(' ').trim();
        }

        return cleanTranscribedText(extractedText);
    });
}

/**
 * Manages streaming background transcription for phrase-chunked audio during active recording.
 */
export class StreamingTranscriptionSession {
    private chunkPromises: Array<{ id: number; promise: Promise<string>; text?: string }> = [];
    private nextId = 0;
    private isFinalized = false;
    private lastError: unknown = null;

    /**
     * Dispatches a completed phrase chunk to the background transcriber immediately.
     */
    public addPhraseChunk(pcmChunk: Float32Array): number {
        if (this.isFinalized) return -1;
        const chunkId = this.nextId++;

        const promise = (async () => {
            try {
                const text = await transcribeAudio(pcmChunk, 30);
                return text;
            } catch (err) {
                console.warn(`[StreamingSession] Error transcribing chunk #${chunkId}:`, err);
                this.lastError = err;
                return '';
            }
        })();

        const entry = { id: chunkId, promise, text: undefined as string | undefined };
        promise.then(t => { entry.text = t; });
        this.chunkPromises.push(entry);

        return chunkId;
    }

    /**
     * Checks if any chunks have finished and returns the joined partial text.
     */
    public getPartialText(): string {
        return this.chunkPromises
            .map(c => c.text ?? '')
            .filter(t => t.trim().length > 0)
            .join(' ')
            .trim();
    }

    /**
     * Finalizes the session by transcribing any trailing audio fragment and resolving all pending phrases.
     */
    public async finalize(trailingPcm?: Float32Array): Promise<string> {
        this.isFinalized = true;

        if (trailingPcm && trailingPcm.length >= 16000 * 0.2) {
            this.addPhraseChunk(trailingPcm);
        }

        if (this.chunkPromises.length === 0) {
            return '';
        }

        const results = await Promise.all(this.chunkPromises.map(c => c.promise));
        const assembled = results
            .map(r => r.trim())
            .filter(r => r.length > 0)
            .join(' ')
            .replace(/\s{2,}/g, ' ')
            .trim();

        // If every chunk failed, surface the error instead of reporting an empty dictation.
        if (!assembled && this.lastError) {
            throw this.lastError instanceof Error ? this.lastError : new Error(String(this.lastError));
        }

        return assembled;
    }
}
