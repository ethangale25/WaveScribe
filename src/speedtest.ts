// Measures how fast a speech model decodes on this PC, on the CPU and on the GPU, so the app can
// recommend the faster one. Runs in throw-away workers, so the model used for dictation is never
// unloaded or disturbed.

import { AsrClient, Device } from './transcribe';
import type { SpeedSample } from './setups';
// @ts-ignore
import sampleUrl from '../sounds/speedtest.wav';

let samplePromise: Promise<Float32Array> | null = null;

/** The built-in ~3 s test sentence (about the length of a spoken phrase) as 16 kHz mono floats. */
function loadSample(): Promise<Float32Array> {
    if (!samplePromise) {
        samplePromise = (async () => {
            const buf = await (await fetch(sampleUrl)).arrayBuffer();
            const view = new DataView(buf);
            let pos = 12; // skip "RIFF....WAVE"
            while (pos + 8 <= buf.byteLength) {
                const id = String.fromCharCode(view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3));
                const size = view.getUint32(pos + 4, true);
                if (id === 'data') {
                    const n = Math.floor(Math.min(size, buf.byteLength - pos - 8) / 2);
                    const out = new Float32Array(n);
                    for (let i = 0; i < n; i++) out[i] = view.getInt16(pos + 8 + i * 2, true) / 32768;
                    return out;
                }
                pos += 8 + size + (size % 2);
            }
            throw new Error('Speed-test audio is not a valid WAV file');
        })();
    }
    return samplePromise;
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

async function measureDevice(modelId: string, device: Device, audio: Float32Array, onStatus: (text: string) => void): Promise<number> {
    const client = new AsrClient();
    try {
        onStatus(`Loading on ${device === 'webgpu' ? 'GPU' : 'CPU'}…`);
        await client.loadModel(modelId, device);
        await client.transcribe(audio); // warm-up: the first run includes one-time setup

        const times: number[] = [];
        for (let i = 0; i < 5; i++) {
            onStatus(`Testing ${device === 'webgpu' ? 'GPU' : 'CPU'} (${i + 1}/5)…`);
            const t0 = performance.now();
            await client.transcribe(audio);
            times.push(performance.now() - t0);
        }
        return median(times);
    } finally {
        client.terminate();
    }
}

/**
 * Decodes the built-in sample on each available device and returns the median time per device.
 * A device that fails to run (e.g. the GPU is out of memory) is reported as null, not as an error.
 */
export async function runSpeedTest(
    modelId: string,
    hasWebGpu: boolean,
    onStatus: (text: string) => void = () => { }
): Promise<SpeedSample> {
    const audio = await loadSample();

    const cpuMs = await measureDevice(modelId, 'cpu', audio, onStatus);
    let gpuMs: number | null = null;
    if (hasWebGpu) {
        try {
            gpuMs = await measureDevice(modelId, 'webgpu', audio, onStatus);
        } catch (err) {
            console.warn('[SpeedTest] GPU run failed:', err);
        }
    }
    return { modelId, cpuMs, gpuMs };
}
