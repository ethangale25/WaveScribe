// Web Worker hosting the speech-recognition engine, so model inference never blocks the UI thread
// or the microphone capture callbacks. Protocol: see transcribe.ts.

import * as engine from './asr-engine';

interface WorkerScope {
    postMessage(message: unknown): void;
    onmessage: ((event: MessageEvent) => void) | null;
}
const ctx = self as unknown as WorkerScope;

// A model too big for the GPU/array-buffer limits can fail inside ONNX Runtime as an unhandled
// rejection, leaving the load promise pending forever (the UI sat at "Compiling" with no error).
// Report it against the load in flight so the caller's out-of-memory fallback can run.
let loadInFlight: number | null = null;
self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    if (loadInFlight === null) return;
    const err: any = event.reason;
    event.preventDefault();
    const id = loadInFlight;
    loadInFlight = null;
    ctx.postMessage({ type: 'error', id, name: err?.name, message: err?.message ?? String(err), code: err?.code });
});

ctx.onmessage = async (event: MessageEvent) => {
    const msg = event.data;
    try {
        switch (msg.type) {
            case 'load':
                loadInFlight = msg.id;
                try {
                    await engine.loadModel(msg.model, msg.device, msg.dtype, (info: unknown) => {
                        if (loadInFlight === msg.id) ctx.postMessage({ type: 'progress', id: msg.id, info });
                    }, msg.threads);
                } finally {
                    if (loadInFlight === msg.id) loadInFlight = null;
                }
                ctx.postMessage({ type: 'result', id: msg.id, value: undefined });
                break;
            case 'transcribe': {
                const text = await engine.transcribeAudio(msg.pcm, msg.chunkSize);
                ctx.postMessage({ type: 'result', id: msg.id, value: text });
                break;
            }
            case 'dispose':
                await engine.disposeTranscriber();
                ctx.postMessage({ type: 'result', id: msg.id, value: undefined });
                break;
        }
    } catch (err: any) {
        ctx.postMessage({
            type: 'error',
            id: msg.id,
            name: err?.name,
            message: err?.message ?? String(err),
            code: err?.code,
        });
    }
};
