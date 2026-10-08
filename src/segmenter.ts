import {
    SAMPLE_RATE, ENERGY_THRESHOLD, MIN_PHRASE_SAMPLES, MIN_SPEECH_WINDOWS,
    applyVAD, normalizeAudio, mergeChunks, findQuietestCut, countSpeechWindows,
} from './dsp';

export interface PhraseMeta {
    /** True if the phrase was cut mid-speech because it hit the length cap, not at a pause. */
    forcedCut: boolean;
}

export type PhraseCallback = (chunk: Float32Array, meta: PhraseMeta) => void;

const MIN_SPEECH_SAMPLES = SAMPLE_RATE * 0.45; // Minimum ~450ms before considering a pause
const PAUSE_SILENCE_SAMPLES = SAMPLE_RATE * 0.38; // ~380ms silence constitutes a sentence break
const MAX_PHRASE_SAMPLES = SAMPLE_RATE * 6.5; // Max 6.5s per chunk to prevent buffer buildup
const CUT_SEARCH_SAMPLES = SAMPLE_RATE * 1.5; // On a forced cut, look for the quietest spot in the last 1.5s

export interface FinishResult {
    /** Normalized, VAD-trimmed full recording. Empty unless `includeFull` was requested. */
    fullAudio: Float32Array;
    /** Normalized audio after the last dispatched phrase (empty if it held no speech). */
    trailingAudio: Float32Array;
    /** Speech duration in seconds (first to last speech frame). */
    durationSec: number;
    /** True if any audio at all was captured. */
    hadAudio: boolean;
}

/**
 * Splits a live 16kHz PCM stream into phrases at natural pauses, with a length cap that cuts at
 * the quietest point instead of mid-word. Feed it frames with push(); completed phrases are
 * delivered through the callback while the user is still talking.
 */
export class PhraseSegmenter {
    private fullChunks: Float32Array[] = [];
    private phraseChunks: Float32Array[] = [];
    private totalFull = 0;
    private totalPhrase = 0;
    private silenceSamples = 0;
    private phraseHasSpeech = false;
    // Speech span within the full recording (samples), so speech duration needs no extra pass.
    private firstSpeech = -1;
    private lastSpeechEnd = 0;

    constructor(private onPhrase: PhraseCallback | null, private streaming = true) { }

    push(frame: Float32Array): void {
        if (frame.length === 0) return;

        const frameStart = this.totalFull;
        this.fullChunks.push(frame);
        this.totalFull += frame.length;
        this.phraseChunks.push(frame);
        this.totalPhrase += frame.length;

        let sumSq = 0;
        for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i];
        const rms = Math.sqrt(sumSq / frame.length);

        if (rms >= ENERGY_THRESHOLD) {
            if (this.firstSpeech < 0) this.firstSpeech = frameStart;
            this.lastSpeechEnd = frameStart + frame.length;
            this.phraseHasSpeech = true;
            this.silenceSamples = 0;
        } else {
            this.silenceSamples += frame.length;
        }

        if (!(this.streaming && this.onPhrase && this.phraseHasSpeech && this.totalPhrase >= MIN_SPEECH_SAMPLES)) {
            return;
        }

        const isPauseBoundary = this.silenceSamples >= PAUSE_SILENCE_SAMPLES;
        const isMaxCapReached = this.totalPhrase >= MAX_PHRASE_SAMPLES;
        if (!isPauseBoundary && !isMaxCapReached) return;

        const forcedCut = !isPauseBoundary;
        let phrase = mergeChunks(this.phraseChunks, this.totalPhrase);
        let carryOver: Float32Array | null = null;

        if (forcedCut) {
            // Split at the quietest point rather than wherever the cap landed, and carry the
            // remainder into the next phrase so no word is cut in half.
            const cut = findQuietestCut(phrase, CUT_SEARCH_SAMPLES);
            if (cut < phrase.length) {
                carryOver = phrase.slice(cut);
                phrase = phrase.slice(0, cut);
            }
        }

        const prepared = this.prepare(phrase);
        if (prepared) {
            try {
                this.onPhrase(prepared, { forcedCut });
            } catch (err) {
                console.warn('[Segmenter] Phrase callback error:', err);
            }
        }

        this.phraseChunks = carryOver ? [carryOver] : [];
        this.totalPhrase = carryOver ? carryOver.length : 0;
        this.silenceSamples = 0;
        this.phraseHasSpeech = carryOver !== null;
    }

    /** Trim, reject near-silence (which makes the model hallucinate), normalize. */
    private prepare(phrase: Float32Array): Float32Array | null {
        const trimmed = applyVAD(phrase, SAMPLE_RATE, 20, ENERGY_THRESHOLD);
        if (countSpeechWindows(trimmed) < MIN_SPEECH_WINDOWS) return null;
        const normalized = normalizeAudio(trimmed);
        return normalized.length >= MIN_PHRASE_SAMPLES ? normalized : null;
    }

    finish(includeFull: boolean): FinishResult {
        const hadAudio = this.totalFull > 0;

        const trailingAudio = this.totalPhrase > 0
            ? (this.prepare(mergeChunks(this.phraseChunks, this.totalPhrase)) ?? new Float32Array(0))
            : new Float32Array(0);

        let fullAudio: Float32Array = new Float32Array(0);
        let durationSec: number;
        if (includeFull && hadAudio) {
            fullAudio = normalizeAudio(applyVAD(mergeChunks(this.fullChunks, this.totalFull), SAMPLE_RATE, 20, ENERGY_THRESHOLD));
            durationSec = fullAudio.length / SAMPLE_RATE;
        } else {
            // Same quantity VAD trimming would leave (speech span plus its 60ms padding each side).
            durationSec = this.firstSpeech >= 0
                ? (this.lastSpeechEnd - this.firstSpeech) / SAMPLE_RATE + 0.12
                : 0;
        }

        this.fullChunks = [];
        this.phraseChunks = [];
        this.totalFull = 0;
        this.totalPhrase = 0;

        return { fullAudio, trailingAudio, durationSec, hadAudio };
    }
}
