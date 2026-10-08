// End-to-end evaluation of the streaming dictation pipeline against recorded speech.
//
//   node tools/eval/run.mjs <model-id> <clip.wav> "<reference text>"
//
// Feeds the clip through the real PhraseSegmenter at real-time pace (like a live microphone) into
// the real StreamingTranscriptionSession, then compares against decoding the whole clip in one
// pass after "stop" (the old behaviour). Reports stop->text latency and word error rate.

import fs from 'fs';
// @ts-ignore
import { env } from '@huggingface/transformers';
import { loadModel, transcribeAudio } from '../../src/asr-engine';
import { StreamingTranscriptionSession } from '../../src/transcribe';
import { PhraseSegmenter } from '../../src/segmenter';
import { normalizeAudio, applyVAD, ENERGY_THRESHOLD } from '../../src/dsp';

function readWav16kMono(path: string): Float32Array {
    const buf = fs.readFileSync(path);
    let pos = 12;
    while (pos < buf.length - 8) {
        const id = buf.toString('ascii', pos, pos + 4);
        const size = buf.readUInt32LE(pos + 4);
        if (id === 'data') {
            const n = Math.floor(Math.min(size, buf.length - pos - 8) / 2);
            const out = new Float32Array(n);
            for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(pos + 8 + i * 2) / 32768;
            return out;
        }
        pos += 8 + size + (size % 2);
    }
    throw new Error('No data chunk in WAV');
}

const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);

function wer(ref: string, hyp: string): number {
    const r = words(ref), h = words(hyp);
    const d: number[][] = Array.from({ length: r.length + 1 }, (_, i) => [i, ...new Array(h.length).fill(0)]);
    for (let j = 1; j <= h.length; j++) d[0][j] = j;
    for (let i = 1; i <= r.length; i++) {
        for (let j = 1; j <= h.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
        }
    }
    return r.length ? d[r.length][h.length] / r.length : 0;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
    const [modelId, clip, reference] = process.argv.slice(2);
    if (!modelId || !clip || !reference) {
        console.error('usage: run.mjs <model-id> <clip.wav> "<reference text>"');
        process.exit(1);
    }

    // The app uses the browser cache; in Node use the filesystem cache instead.
    env.useBrowserCache = false;
    env.useFSCache = true;

    // Worst case for latency: the user stops right after the last word (no trailing silence).
    const audio = applyVAD(readWav16kMono(clip), 16000, 20, ENERGY_THRESHOLD);
    console.log(`clip: ${clip} (${(audio.length / 16000).toFixed(1)}s)  model: ${modelId}`);

    const tLoad = Date.now();
    await loadModel(modelId, 'cpu', process.env.DTYPE || undefined);
    console.log(`model loaded in ${Date.now() - tLoad}ms`);

    // Warm-up so first-inference setup cost does not skew either measurement.
    await transcribeAudio(normalizeAudio(audio.slice(0, 16000 * 2)), 30);

    // --- Baseline: record everything, decode in one pass after stop ---
    const tBase = Date.now();
    const baseText = await transcribeAudio(normalizeAudio(applyVAD(audio, 16000, 20, ENERGY_THRESHOLD)), 30);
    const baseMs = Date.now() - tBase;

    // --- Streaming: decode phrases while "speaking" ---
    // Decode in-process (the app decodes in a Web Worker, which Node does not have).
    const session = new StreamingTranscriptionSession((pcm) => transcribeAudio(pcm, 30));
    const phrases: string[] = [];
    const segmenter = new PhraseSegmenter((pcm, meta) => {
        phrases.push(`${(pcm.length / 16000).toFixed(1)}s${meta.forcedCut ? ' forced' : ''}`);
        session.addPhraseChunk(pcm, meta);
    });

    const FRAME = 4096;
    for (let i = 0; i < audio.length; i += FRAME) {
        segmenter.push(new Float32Array(audio.subarray(i, Math.min(i + FRAME, audio.length))));
        await sleep((FRAME / 16000) * 1000); // real-time pacing
    }

    const tStop = Date.now();
    const { trailingAudio } = segmenter.finish(false);
    const streamText = await session.finalize(trailingAudio);
    const streamMs = Date.now() - tStop;

    console.log('\nphrases dispatched while talking:', phrases.length ? phrases.join(', ') : '(none)');
    console.log(`reference : ${reference}`);
    console.log(`\nSINGLE-PASS (old)   stop->text ${String(baseMs).padStart(6)}ms   WER ${(wer(reference, baseText) * 100).toFixed(1)}%\n  ${baseText}`);
    console.log(`\nSTREAMING (new)     stop->text ${String(streamMs).padStart(6)}ms   WER ${(wer(reference, streamText) * 100).toFixed(1)}%\n  ${streamText}`);
    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
