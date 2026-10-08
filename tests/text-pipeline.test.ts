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
