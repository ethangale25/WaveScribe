import test from 'node:test';
import assert from 'node:assert/strict';
import { stitchSegments } from '../src/stitch';
import { isFaithfulCleanup, isFaithfulSmartCleanup, wordChangeRatio } from '../electron/fidelity';
import { findQuietestCut, countSpeechWindows, applyVAD } from '../src/dsp';
import { PhraseSegmenter } from '../src/segmenter';
import { assessLlmFit, isChatOnly, recommendLlm } from '../src/llm-fit';
import { commandUserMessage } from '../electron/cleanup-prompts';
import { parseModelSort, parseParamCount, sortModels, DEFAULT_MODEL_SORT } from '../src/model-sort';

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
    feed(s, concat(tone(2), silence(1.2), tone(1.5)));
    assert.equal(phrases.length, 1);
    assert.equal(phrases[0].forced, false);
    const { trailingAudio } = s.finish(false);
    assert.ok(trailingAudio.length > SR); // the second burst is still pending as the trailing fragment
});

test('segmenter: a pause inside a sentence does not split the phrase', () => {
    const phrases: number[] = [];
    const s = new PhraseSegmenter((pcm) => phrases.push(pcm.length));
    feed(s, concat(tone(2), silence(0.6), tone(2), silence(0.6), tone(1.5)));
    assert.equal(phrases.length, 0);
    const { trailingAudio } = s.finish(false);
    assert.ok(trailingAudio.length > 5 * SR); // all three bursts stay together in one phrase
});

test('segmenter: a long unbroken stretch is cut at the quiet spot, not mid-burst', () => {
    const phrases: Array<{ forced: boolean }> = [];
    const s = new PhraseSegmenter((_, meta) => phrases.push({ forced: meta.forcedCut }));
    // 22s of speech with a 150ms dip (shorter than a pause) around 19s, inside the final 3s search window.
    feed(s, concat(tone(19), silence(0.15), tone(3)));
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
import { removeFillers, applyDictionary, applyAutoFormatting, escapeHtml, applySpokenCommands } from '../src/postprocess';

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

const GB = 1024 * 1024 * 1024;
const llm = (id: string, parameters: string, gb: number) => ({ id, parameters, approxBytes: gb * GB });
const LLMS = [
    llm('llama-3.2-1b', '1B', 0.8), llm('qwen-2.5-1.5b', '1.5B', 1), llm('qwen3-4b-instruct', '4B', 2.4),
    llm('llama-3.1-8b', '8B', 4.9), llm('qwen-2.5-14b', '14B', 9), llm('deepseek-r1-14b', '14B', 9),
];
const free = (freeRamGb: number, freeVramGb: number | null, loaded: any[] = []) => ({ freeRamGb, freeVramGb, loaded });

test('llm fit: a model that fits in free graphics memory runs great', () => {
    const fit = assessLlmFit(llm('llama-3.1-8b', '8B', 4.9), 'chat', free(20, 14));
    assert.equal(fit.fit, 'great');
    assert.equal(fit.fitsOnGpu, true);
});

test('llm fit: judged on memory that is free now, not the totals', () => {
    // A 16 GB card with only 3 GB free cannot hold an 8B model; it falls back to the slower CPU.
    assert.equal(assessLlmFit(llm('llama-3.1-8b', '8B', 4.9), 'chat', free(20, 3)).fit, 'slow');
    // With little RAM free as well, it does not fit at all.
    assert.equal(assessLlmFit(llm('qwen-2.5-14b', '14B', 9), 'chat', free(6, null)).fit, 'too-big');
    assert.equal(assessLlmFit(llm('qwen3-4b-instruct', '4B', 2.4), 'chat', free(8, null)).fitsOnGpu, null);
});

test('llm fit: switching counts the memory the current model would free', () => {
    const loaded = [{ slot: 'chat', id: 'qwen-2.5-7b', gb: 5.5, onGpu: true }];
    // 3 GB free plus the 5.5 GB the current chat model releases is enough for the 8B model.
    assert.equal(assessLlmFit(llm('llama-3.1-8b', '8B', 4.9), 'chat', free(20, 3, loaded)).fit, 'great');
    // The cleanup slot gets nothing back from the chat model.
    assert.equal(assessLlmFit(llm('llama-3.1-8b', '8B', 4.9), 'cleanup', free(20, 3, loaded)).fit, 'slow');
});

test('llm fit: a model already loaded for the other job is shared, so it needs nothing extra', () => {
    const loaded = [{ slot: 'cleanup', id: 'qwen3-4b-instruct', gb: 3.2, onGpu: true }];
    assert.equal(assessLlmFit(llm('qwen3-4b-instruct', '4B', 2.4), 'chat', free(1, 0.1, loaded)).fit, 'great');
});

test('llm recommend: chat gets the biggest model that runs great, never a reasoning model', () => {
    assert.equal(recommendLlm('chat', LLMS, free(40, 22)), 'qwen-2.5-14b');
    assert.equal(recommendLlm('chat', LLMS, free(12, null)), 'qwen3-4b-instruct');
});

test('llm recommend: cleanup sticks to the tested small model even on a big GPU', () => {
    assert.equal(recommendLlm('cleanup', LLMS, free(40, 22)), 'qwen3-4b-instruct');
});

test('llm fit: speed on the processor follows the parameters working per token', () => {
    // Gemma 4 26B A4B: 26B in total, ~4B per token, so it answers quickly once it fits in memory.
    const moe = { ...llm('gemma-4-26b-a4b', '26B', 15.8), activeParameters: '3.8B' };
    assert.equal(assessLlmFit(moe, 'chat', free(32, null)).fit, 'great');
    assert.equal(assessLlmFit(moe, 'chat', free(12, null)).fit, 'too-big');
});

test('llm recommend: newer models stay out of cleanup until they pass the cleanup eval', () => {
    for (const id of ['qwen3.5-4b', 'qwen3.5-9b', 'gemma-4-e2b', 'gemma-4-e4b', 'gemma-4-26b-a4b', 'deepseek-r1-7b']) {
        assert.equal(isChatOnly(id), true, id);
    }
    assert.equal(isChatOnly('qwen3-4b-instruct'), false);
    const withNew = [...LLMS, llm('qwen3.5-9b', '9B', 5.3), llm('qwen3.5-4b', '4B', 2.6)];
    assert.equal(recommendLlm('chat', withNew, free(40, 22)), 'qwen3.5-9b');
    assert.equal(recommendLlm('cleanup', withNew, free(40, 22)), 'qwen3-4b-instruct');
});

const sortRow = (id: string, over: Partial<{ name: string; params: number; bytes: number; released: string; fit: 'great' | 'slow' | 'too-big'; rank: number }> = {}) =>
    ({ id, name: id, params: 0, bytes: 0, released: '2024-01-01', fit: 'great' as const, rank: 0, ...over });
const ids = (rows: { id: string }[]) => rows.map(r => r.id);

test('model sort: reads parameter counts', () => {
    assert.equal(parseParamCount('1.5B'), 1.5e9);
    assert.equal(parseParamCount('394M'), 3.94e8);
    assert.equal(parseParamCount(''), 0);
});

test('model sort: recommended first, then by fit, then curated rank', () => {
    const rows = [sortRow('slow', { fit: 'slow', rank: 0 }), sortRow('b', { rank: 2 }), sortRow('rec', { rank: 5 }), sortRow('a', { rank: 1 })];
    assert.deepEqual(ids(sortModels(rows, DEFAULT_MODEL_SORT, 'rec')), ['rec', 'a', 'b', 'slow']);
});

test('model sort: by parameters, size, release date and name in either direction', () => {
    const rows = () => [
        sortRow('Qwen 14B', { params: 14e9, bytes: 9, released: '2024-09-19' }),
        sortRow('Llama 1B', { params: 1e9, bytes: 1, released: '2024-09-25' }),
        sortRow('Qwen 7B', { params: 7e9, bytes: 5, released: '2025-01-20' }),
    ];
    assert.deepEqual(ids(sortModels(rows(), { key: 'params', dir: 'asc' }, null)), ['Llama 1B', 'Qwen 7B', 'Qwen 14B']);
    assert.deepEqual(ids(sortModels(rows(), { key: 'size', dir: 'desc' }, null)), ['Qwen 14B', 'Qwen 7B', 'Llama 1B']);
    assert.deepEqual(ids(sortModels(rows(), { key: 'released', dir: 'desc' }, null)), ['Qwen 7B', 'Llama 1B', 'Qwen 14B']);
    // Numbers inside names sort naturally: 7B before 14B.
    assert.deepEqual(ids(sortModels(rows(), { key: 'name', dir: 'asc' }, null)), ['Llama 1B', 'Qwen 7B', 'Qwen 14B']);
});

test('model sort: ties fall back to name', () => {
    const rows = [sortRow('b', { params: 2 }), sortRow('a', { params: 2 })];
    assert.deepEqual(ids(sortModels(rows, { key: 'params', dir: 'desc' }, null)), ['a', 'b']);
});

test('model sort: ignores a missing or unknown saved setting', () => {
    assert.deepEqual(parseModelSort(undefined), DEFAULT_MODEL_SORT);
    assert.deepEqual(parseModelSort({ key: 'bogus', dir: 'desc' }), DEFAULT_MODEL_SORT);
    assert.deepEqual(parseModelSort({ key: 'released', dir: 'desc' }), { key: 'released', dir: 'desc' });
});

test('spoken commands: new paragraph and new line at phrase boundaries', () => {
    assert.equal(applySpokenCommands('Dear team. New paragraph. The launch is on Friday.'), 'Dear team.\n\nThe launch is on Friday.');
    assert.equal(applySpokenCommands('Buy milk, new line, buy eggs.'), 'Buy milk.\nBuy eggs.');
});

test('spoken commands: ordinary speech that contains the words is left alone', () => {
    assert.equal(applySpokenCommands('We need a new line of products.'), 'We need a new line of products.');
    assert.equal(applySpokenCommands('We should scratch that itch soon.'), 'We should scratch that itch soon.');
});

test('spoken commands: scratch that removes the sentence before it', () => {
    assert.equal(applySpokenCommands('I will be late. Actually I am sick. Scratch that. See you at nine.'), 'I will be late. See you at nine.');
    assert.equal(applySpokenCommands('Send it now, scratch that.'), '');
});

test('smart cleanup check: accepts dropped corrections, false starts and list formatting', () => {
    assert.ok(isFaithfulSmartCleanup('lets meet on tuesday no wait wednesday at three', "Let's meet on Wednesday at three."));
    assert.ok(isFaithfulSmartCleanup('send the report to john i mean to sarah by five', 'Send the report to Sarah by five.'));
    assert.ok(isFaithfulSmartCleanup('so i i think we we should um we should ship it next week', 'I think we should ship it next week.'));
    assert.ok(isFaithfulSmartCleanup('for the trip we need tickets a hotel and a rental car', 'For the trip we need:\n- tickets\n- a hotel\n- a rental car'));
    assert.ok(isFaithfulSmartCleanup('the steps are one wash two rinse three dry', 'The steps are:\n1. wash\n2. rinse\n3. dry'));
});

test('smart cleanup check: rejects rewording, summaries and answers', () => {
    const raw = 'i went to the store this morning to buy some milk and bread and then i drove home because it started to rain';
    assert.equal(isFaithfulSmartCleanup(raw, 'I bought groceries this morning and went home when it rained.'), false);
    assert.equal(isFaithfulSmartCleanup(raw, 'Went shopping.'), false);
    assert.equal(isFaithfulSmartCleanup('what time does the meeting start tomorrow', 'The meeting starts at 10 a.m. tomorrow.'), false);
    assert.equal(isFaithfulSmartCleanup('write a poem about the ocean', 'Waves roll in upon the shore, the ocean sings forevermore.'), false);
    assert.equal(isFaithfulSmartCleanup('hello there', ''), false);
});

test('voice command: the selection is sent fenced off from the instruction, and left out when empty', () => {
    assert.equal(commandUserMessage('make this shorter', 'Some text.'), 'Instruction: make this shorter\n\nText:\n"""\nSome text.\n"""');
    assert.equal(commandUserMessage('write a haiku', '  '), 'Instruction: write a haiku');
});

// --- whole-recording final pass ---
import { StreamingTranscriptionSession } from '../src/transcribe';

const pcm = (seconds: number) => new Float32Array(Math.round(seconds * SR)).fill(0.1);

test('final pass: the whole-recording text replaces the choppy phrase draft', async () => {
    const decode = async (p: Float32Array) =>
        p.length > 8 * SR ? 'I want to move the invoice export to the new billing service.' : 'To the new building service.';
    const s = new StreamingTranscriptionSession(decode);
    s.addPhraseChunk(pcm(3), { forcedCut: false });
    const r = await s.finalizeWithFullPass(undefined, pcm(10));
    assert.equal(r.usedFullPass, true);
    assert.equal(r.text, 'I want to move the invoice export to the new billing service.');
});

test('final pass: a recording too long for one window keeps the stitched phrases', async () => {
    const s = new StreamingTranscriptionSession(async () => 'one two three four five');
    s.addPhraseChunk(pcm(3), { forcedCut: false });
    const r = await s.finalizeWithFullPass(undefined, pcm(45));
    assert.equal(r.usedFullPass, false);
    assert.equal(r.text, 'one two three four five');
});

test('final pass: a truncated or failed full decode falls back to the draft', async () => {
    const draftText = 'send me the schedule by Thursday please';
    const truncating = new StreamingTranscriptionSession(async (p) => (p.length > 8 * SR ? 'send me' : draftText));
    truncating.addPhraseChunk(pcm(3), { forcedCut: false });
    assert.deepEqual(await truncating.finalizeWithFullPass(undefined, pcm(10)), { text: draftText, usedFullPass: false });

    const failing = new StreamingTranscriptionSession(async (p) => { if (p.length > 8 * SR) throw new Error('boom'); return draftText; });
    failing.addPhraseChunk(pcm(3), { forcedCut: false });
    assert.deepEqual(await failing.finalizeWithFullPass(undefined, pcm(10)), { text: draftText, usedFullPass: false });
});

test('final pass: when nothing was dispatched while talking, the recording is decoded only once', async () => {
    let calls = 0;
    const s = new StreamingTranscriptionSession(async () => { calls++; return 'a single short dictation here'; });
    const r = await s.finalizeWithFullPass(pcm(8), pcm(8));
    assert.equal(calls, 1);
    assert.equal(r.usedFullPass, false);
});
