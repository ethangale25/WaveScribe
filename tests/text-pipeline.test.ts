import test from 'node:test';
import assert from 'node:assert/strict';
import { stitchSegments } from '../src/stitch';
import { isFaithfulCleanup, wordChangeRatio } from '../electron/fidelity';
import { findQuietestCut, countSpeechWindows, applyVAD } from '../src/dsp';
import { PhraseSegmenter } from '../src/segmenter';

const seg = (text: string, forcedCut = false) => ({ text, forcedCut });

test('stitch: keeps sentences that ended at real pauses', () => {
    assert.equal(
        stitchSegments([seg('I went to the store.'), seg('Then I came home.')]),
        'I went to the store. Then I came home.'
    );
});

test('stitch: forced cut drops the false period and lowercases a continuation word', () => {
    assert.equal(
        stitchSegments([seg('We talked about the plan.', true), seg('And then we left.')]),
        'We talked about the plan and then we left.'
    );
});

test('stitch: does not lowercase names or touch real question marks', () => {
    assert.equal(stitchSegments([seg('She flew to.', true), seg('London on Friday.')]), 'She flew to London on Friday.');
    assert.equal(stitchSegments([seg('Is it done?', true), seg('The answer is yes.')]), 'Is it done? The answer is yes.');
});

test('stitch: supplies missing full stops for unpunctuated models at pauses, not at the end', () => {
    assert.equal(
        stitchSegments([seg('I went to the store'), seg('When I got there it was closed'), seg('So I left')]),
        'I went to the store. When I got there it was closed. So I left'
    );
});

test('stitch: empty input and empty segments', () => {
    assert.equal(stitchSegments([]), '');
    assert.equal(stitchSegments([seg('Hello there.'), seg(''), seg('Bye.')]), 'Hello there. Bye.');
});

const LONG = 'So what I wanted to talk about today is how we can make the dictation faster because right now it feels slow when I stop talking and I have to wait for the text to show up and what I think we should do is send small pieces of audio while the person is still speaking and then clean everything up at the very end';

test('fidelity: accepts punctuation-only and single-word fixes', () => {
    assert.ok(isFaithfulCleanup(LONG, LONG.replace('today', 'today,') + '.'));
    assert.ok(isFaithfulCleanup(LONG, LONG.replace('feels', 'feel')));
    assert.ok(isFaithfulCleanup('i think there going home', 'I think they are going home.'));
});

test('fidelity: rejects rewrites, summaries and degenerate output observed from a 1B model', () => {
    assert.ok(!isFaithfulCleanup(LONG, 'So what you want to discuss today is how we can make the dictation process faster, specifically when you stop talking and wait for the text to appear. You think we should send small pieces of audio while you are still speaking and then clean up everything at the end.'));
    assert.ok(!isFaithfulCleanup(LONG, 'Make dictation faster by sending small audio pieces.'));
    assert.ok(!isFaithfulCleanup('so what i wanted', 's o, w h a t y o u w a n t'));
    assert.equal(wordChangeRatio('', ''), 0);
});

// --- audio segmentation ---

const SR = 16000;
function tone(seconds: number, amplitude = 0.2): Float32Array {
    const out = new Float32Array(Math.round(seconds * SR));
    for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / SR);
    return out;
}
const silence = (seconds: number) => new Float32Array(Math.round(seconds * SR));
function feed(segmenter: PhraseSegmenter, audio: Float32Array) {
    const FRAME = 2048;
    for (let i = 0; i < audio.length; i += FRAME) segmenter.push(audio.slice(i, Math.min(i + FRAME, audio.length)));
}
function concat(...parts: Float32Array[]): Float32Array {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

test('segmenter: splits at a natural pause and reports it as not forced', () => {
    const phrases: Array<{ len: number; forced: boolean }> = [];
    const s = new PhraseSegmenter((pcm, meta) => phrases.push({ len: pcm.length, forced: meta.forcedCut }));
    feed(s, concat(tone(2), silence(0.6), tone(1.5)));
    assert.equal(phrases.length, 1);
    assert.equal(phrases[0].forced, false);
    const { trailingAudio } = s.finish(false);
    assert.ok(trailingAudio.length > SR); // the second burst is still pending as the trailing fragment
});

test('segmenter: a long unbroken stretch is cut at the quiet spot, not mid-burst', () => {
    const phrases: Array<{ forced: boolean }> = [];
    const s = new PhraseSegmenter((_, meta) => phrases.push({ forced: meta.forcedCut }));
    // 8s of speech with a 150ms dip (shorter than a pause) around 5.6s, inside the final 1.5s search window.
    feed(s, concat(tone(5.6), silence(0.15), tone(2.5)));
    assert.ok(phrases.length >= 1);
    assert.equal(phrases[0].forced, true);
});

test('segmenter: near-silent noise is never dispatched', () => {
    let dispatched = 0;
    const s = new PhraseSegmenter(() => { dispatched++; });
    feed(s, concat(tone(0.05, 0.3), silence(1.5)));
    const { trailingAudio } = s.finish(false);
    assert.equal(dispatched, 0);
    assert.equal(trailingAudio.length, 0);
});

test('segmenter: without streaming-includeFull, no full merge but speech duration is still known', () => {
    const s = new PhraseSegmenter(null, false);
    feed(s, concat(silence(0.5), tone(2), silence(0.5)));
    const r = s.finish(false);
    assert.equal(r.hadAudio, true);
    assert.equal(r.fullAudio.length, 0);
    assert.ok(Math.abs(r.durationSec - 2.12) < 0.2, `duration ${r.durationSec}`);
});

test('dsp: findQuietestCut lands in the silent gap', () => {
    const audio = concat(tone(1), silence(0.1), tone(0.4));
    const cut = findQuietestCut(audio, Math.round(1.5 * SR));
    assert.ok(cut > SR && cut < SR + 0.1 * SR + 320, `cut at ${cut}`);
    assert.ok(countSpeechWindows(applyVAD(tone(1), SR, 20, 0.0025)) > 40);
});

// --- post-processing ---
import { removeFillers, applyDictionary, applyAutoFormatting, escapeHtml } from '../src/postprocess';

test('postprocess: removes fillers without leaving stray punctuation, keeps "like"', () => {
    assert.equal(removeFillers('So, um, we should go'), 'So, we should go');
    assert.equal(removeFillers('Uh, I like pizza'), 'I like pizza');
    assert.equal(removeFillers('well hmm okay'), 'well okay');
});

test('postprocess: dictionary replaces whole words, case-insensitively, literally', () => {
    assert.equal(applyDictionary('the gooey is nice, gooeys too', [{ sound: 'gooey', replace: 'GUI' }]), 'the GUI is nice, gooeys too');
    assert.equal(applyDictionary('cost is x', [{ sound: 'x', replace: '$& dollars' }]), 'cost is $& dollars');
});

test('postprocess: auto formatting capitalizes sentences and ends with punctuation', () => {
    assert.equal(applyAutoFormatting('hello there. how are you', true, true), 'Hello there. How are you.');
    assert.equal(applyAutoFormatting('hello', false, false), 'hello');
});

test('postprocess: escapeHtml neutralizes markup', () => {
    assert.equal(escapeHtml('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
});

import { cleanTranscribedText, collapseRepetitionLoops } from '../src/asr-text';
import { stripAddedQuotes } from '../electron/fidelity';

test('asr-text: collapses multi-word decoder loops seen from truncated audio', () => {
    const looped = 'I went to the store this morning to buy some milk and milk and milk and milk and milk and milk and milk.';
    const cleaned = cleanTranscribedText(looped);
    assert.ok(cleaned.startsWith('I went to the store this morning to buy some milk'));
    assert.ok(!/milk and milk and milk/.test(cleaned), cleaned);
    assert.ok(cleaned.length < looped.length / 1.5);
    assert.equal(collapseRepetitionLoops('When I got there, when I got there, when I got there, we left'), 'When I got there, we left');
});

test('asr-text: leaves normal repetition alone', () => {
    assert.equal(collapseRepetitionLoops('it was very very good and very nice'), 'it was very very good and very nice');
    assert.equal(cleanTranscribedText('[BLANK_AUDIO]'), '');
    assert.equal(cleanTranscribedText('the the the the'), '');
});

test('fidelity: strips quotes the model added but keeps ones the speaker dictated', () => {
    assert.equal(stripAddedQuotes('when I got there it was empty', '"When I got there it was empty."'), 'When I got there it was empty.');
    assert.equal(stripAddedQuotes('"hello" he said', '"Hello" he said.'), '"Hello" he said.');
    assert.equal(stripAddedQuotes('plain text', 'Plain text.'), 'Plain text.');
});

// --- hardware-based recommendations ---
import { buildSetups, recommendDevice, modelFamily, HardwareInfo } from '../src/setups';

const STRONG: HardwareInfo = { totalRamGb: 32, cpuCores: 16, gpuVramMb: 16000, hasWebGpu: true, gpuName: 'RTX 4090' };
const MID: HardwareInfo = { totalRamGb: 16, cpuCores: 8, gpuVramMb: null, hasWebGpu: true };
const WEAK: HardwareInfo = { totalRamGb: 4, cpuCores: 2, gpuVramMb: null, hasWebGpu: false };

test('setups: always offers fast, balanced and precise', () => {
    for (const hw of [STRONG, MID, WEAK]) {
        assert.deepEqual(buildSetups(hw).setups.map(s => s.id), ['fast', 'balanced', 'precise']);
    }
});

test('setups: weak PC is steered to Fast, with no AI model and Precise unavailable', () => {
    const plan = buildSetups(WEAK);
    assert.equal(plan.recommendedId, 'fast');
    const byId = Object.fromEntries(plan.setups.map(s => [s.id, s]));
    assert.equal(byId.precise.fit, 'unavailable');
    assert.equal(byId.fast.aiCleanup, false);
    assert.equal(byId.balanced.aiCleanup, false); // < 6 GB RAM
});

test('setups: capable PC gets Balanced recommended and every setup usable', () => {
    for (const hw of [STRONG, MID]) {
        const plan = buildSetups(hw);
        assert.equal(plan.recommendedId, 'balanced');
        assert.ok(plan.setups.every(s => s.fit !== 'unavailable'));
    }
    const strong = buildSetups(STRONG).setups.find(s => s.id === 'precise')!;
    assert.equal(strong.device, 'webgpu');
    assert.equal(strong.llmModelId, 'qwen3-4b-instruct');
});

test('device: moonshine prefers CPU, whisper prefers GPU when it fits, no GPU means CPU', () => {
    assert.equal(recommendDevice('onnx-community/moonshine-base-ONNX', STRONG).device, 'cpu');
    assert.equal(recommendDevice('Xenova/whisper-base.en', STRONG).device, 'cpu'); // threaded CPU matches the GPU
    assert.equal(recommendDevice('Xenova/whisper-small.en', STRONG).device, 'webgpu');
    assert.equal(recommendDevice('distil-whisper/distil-small.en', STRONG).device, 'webgpu');
    assert.equal(recommendDevice('Xenova/whisper-base.en', WEAK).device, 'cpu');
    assert.equal(recommendDevice('distil-whisper/distil-large-v3', { ...STRONG, gpuVramMb: 2000 }).device, 'cpu'); // too big for 2 GB
    assert.equal(modelFamily('distil-whisper/distil-small.en'), 'distil');
});

test('device: a measurement on this PC overrides the rule of thumb, with a margin before choosing GPU', () => {
    const id = 'onnx-community/moonshine-base-ONNX';
    assert.equal(recommendDevice(id, STRONG, { modelId: id, cpuMs: 1000, gpuMs: 400 }).device, 'webgpu');
    assert.equal(recommendDevice(id, STRONG, { modelId: id, cpuMs: 400, gpuMs: 380 }).device, 'cpu'); // not enough faster
    const r = recommendDevice('Xenova/whisper-base.en', STRONG, { modelId: 'Xenova/whisper-base.en', cpuMs: 300, gpuMs: 900 });
    assert.equal(r.device, 'cpu');
    assert.ok(r.measured && /3\.0/.test(r.reason), r.reason);
});

// --- CPU thread counts ---
import { defaultCpuThreads, cpuThreadCandidates } from '../src/setups';

test('threads: default is modest and never exceeds half the logical cores or 4', () => {
    assert.equal(defaultCpuThreads(32), 4);
    assert.equal(defaultCpuThreads(16), 4);
    assert.equal(defaultCpuThreads(8), 4);
    assert.equal(defaultCpuThreads(4), 2);
    assert.equal(defaultCpuThreads(2), 1);
    assert.equal(defaultCpuThreads(1), 1);
});

test('threads: speed-test candidates are ascending, unique, capped at 6 and half the cores', () => {
    assert.deepEqual(cpuThreadCandidates(32), [2, 4, 6]);
    assert.deepEqual(cpuThreadCandidates(8), [2, 4]);
    assert.deepEqual(cpuThreadCandidates(4), [2]);
    assert.deepEqual(cpuThreadCandidates(2), [1]);
});
