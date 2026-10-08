// Cleans raw speech-recognition output (pure: no model, DOM or Electron access).

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

/**
 * Collapses decoder repetition loops such as "milk and milk and milk and milk" or
 * "when I got, when I got, when I got": a phrase of 1-6 words repeated 3+ times in a row is
 * reduced to a single occurrence. Models fall into these loops on truncated or noisy audio.
 */
export function collapseRepetitionLoops(text: string): string {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 6) return text;
    const keys = words.map(norm);

    const out: string[] = [];
    let i = 0;
    while (i < words.length) {
        let collapsed = false;
        for (let n = 1; n <= 6 && !collapsed; n++) {
            if (i + n * 3 > words.length) break;
            // Count how many times the n-word phrase starting at i repeats back to back.
            let reps = 1;
            while (i + (reps + 1) * n <= words.length) {
                let same = true;
                for (let k = 0; k < n; k++) {
                    if (!keys[i + k] || keys[i + k] !== keys[i + reps * n + k]) { same = false; break; }
                }
                if (!same) break;
                reps++;
            }
            if (reps >= 3) {
                out.push(...words.slice(i, i + n));
                i += reps * n;
                collapsed = true;
            }
        }
        if (!collapsed) { out.push(words[i]); i++; }
    }
    return out.join(' ');
}

/**
 * Cleans Whisper/ASR artifacts, repetition loops, and video training set hallucinations.
 */
export function cleanTranscribedText(rawString: string): string {
    if (!rawString || typeof rawString !== 'string') return '';

    let finalString = rawString.trim();

    // Strip Whisper special bracket tokens like [BLANK_AUDIO], [Music], <|endoftext|>, etc.
    finalString = finalString.replace(/\[.*?\]/g, '').replace(/<\|.*?\|>/g, '').trim();

    // Collapse runaway bracket/paren loops
    finalString = finalString.replace(/[\[\]{}()]{2,}/g, ' ').replace(/\s{2,}/g, ' ').trim();

    // Detect degenerate repetition loops ("the the the the the")
    const repWords = finalString.split(/\s+/).filter(w => w.length > 0);
    if (repWords.length >= 4 && new Set(repWords.map(w => w.toLowerCase())).size === 1) {
        return '';
    }

    // Reduce multi-word loops to one occurrence, tidying the punctuation they leave behind.
    const collapsed = collapseRepetitionLoops(finalString);
    if (collapsed !== finalString) {
        finalString = collapsed.replace(/[,\s]+$/, '').trim();
    }

    // Filter known silence/noise hallucinations from video training sets
    const lower = finalString.toLowerCase().replace(/[.,!?'"]/g, '').trim();
    const SILENCE_HALLUCINATIONS = new Set([
        '', 'thank you for watching', 'thanks for watching',
        'amen', 'please subscribe', 'subscribe', 'subtitles by',
        'watching', 'you', 'the',
    ]);
    if (SILENCE_HALLUCINATIONS.has(lower) && repWords.length <= 4) {
        return '';
    }

    return finalString;
}
