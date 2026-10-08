import { PhraseSegmenter, PhraseMeta, FinishResult } from './segmenter';
import { normalizeAudio } from './dsp';

// Re-exported so existing callers keep importing audio helpers from one place.
export { applyVAD, normalizeAudio, MIN_PHRASE_SAMPLES } from './dsp';
export type { PhraseMeta } from './segmenter';

let activeDeviceId: string | null = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let microphoneSource: MediaStreamAudioSourceNode | null = null;
let captureNode: AudioWorkletNode | null = null;
let flushWaiter: (() => void) | null = null;
let activeStream: MediaStream | null = null;
let segmenter: PhraseSegmenter | null = null;

// Runs on the audio rendering thread. Unlike the deprecated ScriptProcessorNode (main thread), a
// busy main thread (e.g. while a phrase is being decoded) only delays when the queued messages
// are handled; it can never cause audio to be dropped.
const CAPTURE_FRAME_SAMPLES = 2048;
const CAPTURE_WORKLET_SOURCE = `
class WaveScribeCapture extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buf = new Float32Array(${CAPTURE_FRAME_SAMPLES});
        this.n = 0;
        this.port.onmessage = (e) => {
            if (e.data && e.data.type === 'flush') {
                if (this.n > 0) {
                    this.port.postMessage(this.buf.slice(0, this.n));
                    this.n = 0;
                }
                this.port.postMessage({ type: 'flushed' });
            }
        };
    }
    process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch) {
            for (let i = 0; i < ch.length; i++) {
                this.buf[this.n++] = ch[i];
                if (this.n === this.buf.length) {
                    this.port.postMessage(this.buf, [this.buf.buffer]);
                    this.buf = new Float32Array(${CAPTURE_FRAME_SAMPLES});
                    this.n = 0;
                }
            }
        }
        return true;
    }
}
registerProcessor('wavescribe-capture', WaveScribeCapture);
`;

export function setAudioDevice(deviceId: string | null) {
    activeDeviceId = deviceId;
}

/**
 * Downsample arbitrary sample rate (e.g. 44.1k/48k) to 16kHz mono Float32Array.
 */
function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
    if (inputSampleRate === 16000) return input;
    const ratio = inputSampleRate / 16000;
    const newLength = Math.round(input.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetInput = 0;
    while (offsetResult < result.length) {
        const nextOffsetInput = Math.round((offsetResult + 1) * ratio);
        let accum = 0;
        let count = 0;
        for (let i = offsetInput; i < nextOffsetInput && i < input.length; i++) {
            accum += input[i];
            count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetInput = nextOffsetInput;
    }
    return result;
}

export interface StartRecordingOptions {
    onPhraseCompleted?: (chunk: Float32Array, meta: PhraseMeta) => void;
    enableStreaming?: boolean;
}

/**
 * Starts direct 16kHz PCM audio stream recording with real-time VAD pause detection.
 */
export async function startRecording(options?: StartRecordingOptions): Promise<void> {
    let stream: MediaStream;

    if (activeDeviceId) {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: activeDeviceId } }
            });
        } catch (err) {
            console.warn(`[Audio] Saved mic unavailable (${(err as Error).name}); falling back to default.`);
            activeDeviceId = null;
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
    } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    activeStream = stream;

    const seg = new PhraseSegmenter(options?.onPhraseCompleted ?? null, options?.enableStreaming ?? true);
    segmenter = seg;

    // Initialize AudioContext at 16kHz (or fallback native sample rate)
    try {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    } catch {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const contextSampleRate = audioContext.sampleRate;

    // Analyser node for real-time waveform visualization
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    microphoneSource = audioContext.createMediaStreamSource(stream);
    microphoneSource.connect(analyser);

    // Direct PCM capture on the audio thread (see CAPTURE_WORKLET_SOURCE).
    const moduleUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' }));
    try {
        await audioContext.audioWorklet.addModule(moduleUrl);
    } finally {
        URL.revokeObjectURL(moduleUrl);
    }
    const node = new AudioWorkletNode(audioContext, 'wavescribe-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    captureNode = node;

    node.port.onmessage = (event: MessageEvent) => {
        const data = event.data;
        if (data instanceof Float32Array) {
            if (data.length === 0) return;
            // Frames arrive in order even if the main thread was busy; resample if the context
            // could not run at 16 kHz.
            seg.push(contextSampleRate === 16000 ? data : downsampleTo16k(data, contextSampleRate));
        } else if (data && data.type === 'flushed') {
            flushWaiter?.();
        }
    };

    microphoneSource.connect(node);
    // The node writes silence; connecting it to the destination makes the browser keep it running.
    node.connect(audioContext.destination);
}

/**
 * Returns the current time-domain byte data from the microphone.
 * Returns null if not recording.
 */
export function getVisualizerData(): Uint8Array | null {
    if (!analyser) return null;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);
    return dataArray;
}

export type StopRecordingResult = FinishResult;

export interface StopRecordingOptions {
    /** Merge + VAD + normalize the full recording. Only needed when not using streaming transcription. */
    includeFull?: boolean;
}

/**
 * Stops recording, tears down audio nodes, and returns both the uncommitted trailing phrase and the full recording Float32 PCM.
 */
export async function stopRecordingDirect(options?: StopRecordingOptions): Promise<StopRecordingResult> {
    const includeFull = options?.includeFull ?? true;

    // Ask the capture node for the samples it is still holding (up to one frame) so the end of
    // the last word is not lost, then wait briefly for its acknowledgement.
    if (captureNode) {
        const node = captureNode;
        await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 250);
            flushWaiter = () => { clearTimeout(timer); resolve(); };
            node.port.postMessage({ type: 'flush' });
        });
        flushWaiter = null;
        try { node.disconnect(); } catch (_) { }
        node.port.onmessage = null;
        captureNode = null;
    }
    if (microphoneSource) {
        try { microphoneSource.disconnect(); } catch (_) { }
        microphoneSource = null;
    }
    if (audioContext) {
        try { await audioContext.close(); } catch (_) { }
        audioContext = null;
    }
    analyser = null;

    if (activeStream) {
        try {
            activeStream.getTracks().forEach(t => t.stop());
        } catch (_) { }
        activeStream = null;
    }

    const finished = segmenter
        ? segmenter.finish(includeFull)
        : { fullAudio: new Float32Array(0), trailingAudio: new Float32Array(0), durationSec: 0, hadAudio: false };
    segmenter = null;
    return finished;
}

/**
 * Legacy stopRecording adapter that returns ArrayBuffer for backwards compatibility.
 */
export async function stopRecording(): Promise<ArrayBuffer> {
    const result = await stopRecordingDirect();
    return result.fullAudio.buffer as ArrayBuffer;
}

/**
 * Helper to turn an ArrayBuffer (from WebM/WAV/PCM) into a Float32Array at 16000Hz.
 */
export async function decodeAudioBuffer(buffer: ArrayBuffer): Promise<Float32Array> {
    if (!buffer || buffer.byteLength === 0) {
        return new Float32Array(0);
    }

    // If already raw Float32Array buffer
    if (buffer.byteLength % 4 === 0) {
        const view = new Float32Array(buffer);
        if (view.length > 0) {
            return normalizeAudio(view);
        }
    }

    let ctx: AudioContext | null = null;
    try {
        ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const audioBuffer = await ctx.decodeAudioData(buffer);
        const floatData = audioBuffer.getChannelData(0);
        return normalizeAudio(floatData);
    } catch (err) {
        console.warn('[Audio] Could not decode audio data:', err);
        return new Float32Array(0);
    } finally {
        if (ctx) {
            try { await ctx.close(); } catch (_) { }
        }
    }
}
