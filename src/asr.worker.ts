// Web Worker hosting the speech-recognition engine, so model inference never blocks the UI thread
// or the microphone capture callbacks. Protocol: see transcribe.ts.

import * as engine from './asr-engine';

interface WorkerScope {
    postMessage(message: unknown): void;
    onmessage: ((event: MessageEvent) => void) | null;
}
const ctx = self as unknown as WorkerScope;

ctx.onmessage = async (event: MessageEvent) => {
    const msg = event.data;
    try {
        switch (msg.type) {
            case 'load':
                await engine.loadModel(msg.model, msg.device, msg.dtype, (info: unknown) => {
                    ctx.postMessage({ type: 'progress', id: msg.id, info });
                });
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
