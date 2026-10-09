// The speech-recognition engine: owns the transformers.js pipeline. It runs inside a Web Worker
// (see asr.worker.ts) so decoding never blocks the UI thread or microphone capture, and directly
// in Node for the evaluation harness. App code should use the facade in transcribe.ts instead.

// @ts-ignore
import { pipeline, env } from '@huggingface/transformers';
import { cleanTranscribedText } from './asr-text';

export { cleanTranscribedText };

// Disable local models since we fetch from HF or cache
env.allowLocalModels = false;
env.useBrowserCache = true;

// transformers.js points ONNX Runtime at a CDN by default, which breaks the first launch when
// offline. Instead the WebAssembly loader and binary are shipped with the app (public/ort) and
// served from the same origin. Using ONNX Runtime's own loader file (rather than a copy bundled
// into this worker) is also what lets it start helper threads for multi-core CPU decoding.
try {
    const wasm = env.backends?.onnx?.wasm as any;
    if (wasm && typeof self !== 'undefined' && (self as any).location) {
        const base = new URL('/ort/', (self as any).location.href).href;
        wasm.wasmPaths = {
            mjs: base + 'ort-wasm-simd-threaded.asyncify.mjs',
            wasm: base + 'ort-wasm-simd-threaded.asyncify.wasm',
        };
    }
} catch (err) {
    console.warn('[Transcribe] Could not set ONNX wasmPaths:', err);
}

let transcriber: any = null;
let currentModelName = 'Xenova/whisper-tiny.en';
let currentDevice: 'cpu' | 'webgpu' = 'cpu';

export async function loadModel(
    modelName: string = 'Xenova/whisper-tiny.en',
    device: 'cpu' | 'webgpu' = 'cpu',
    dtype: string | undefined = undefined,
    onProgress?: (info: any) => void,
    threads?: number
) {
    // Check WebGPU availability before attempting to use it
    if (device === 'webgpu' && !(typeof navigator !== 'undefined' && 'gpu' in navigator)) {
        const err = new Error('WebGPU is not available on this system');
        (err as any).code = 'WEBGPU_UNAVAILABLE';
        throw err;
    }

    // Release the previous pipeline first; otherwise every reload leaks WASM/WebGPU memory.
    if (transcriber) {
        await disposeTranscriber();
    }

    currentModelName = modelName;
    currentDevice = device;

    // CPU decoding runs on WebAssembly; more threads make it faster, but only if the page can use
    // SharedArrayBuffer (otherwise ONNX Runtime silently falls back to one thread).
    const wasm = env.backends?.onnx?.wasm;
    if (wasm && threads && threads > 0) wasm.numThreads = threads;
    console.log(`[ASR] ${modelName} on ${device}; wasm threads=${wasm?.numThreads}; SharedArrayBuffer=${typeof SharedArrayBuffer}; isolated=${(globalThis as any).crossOriginIsolated}`);

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
