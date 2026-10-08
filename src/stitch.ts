// Joins independently transcribed audio segments into one cohesive text.
//
// Each segment is transcribed on its own, so the model treats every one as a complete utterance:
// it capitalizes the first word and ends with a period. That is right at a real pause, but wrong
// where the recorder had to cut a long stretch of continuous speech ("forced cut"). This module
// repairs those seams in well under a millisecond.

export interface TranscribedSegment {
    text: string;
    /** True if the audio was cut mid-speech (length cap), false if it ended at a natural pause. */
    forcedCut: boolean;
}

// Words that are essentially never proper nouns. A capitalized one at the start of a continued
// segment is the model's sentence-start capitalization, not a name, so it is safe to lowercase.
const SAFE_TO_LOWERCASE = new Set([
    'and', 'but', 'or', 'so', 'then', 'the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'for', 'with',
    'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these',
    'those', 'we', 'you', 'they', 'he', 'she', 'my', 'your', 'our', 'their', 'his', 'her', 'if', 'when',
    'while', 'because', 'which', 'who', 'what', 'where', 'how', 'not', 'no', 'do', 'does', 'did', 'have',
    'has', 'had', 'can', 'could', 'will', 'would', 'should', 'just', 'also', 'than', 'there', 'here',
    'about', 'into', 'out', 'up', 'down', 'over', 'after', 'before', 'all', 'some', 'any', 'more', 'most',
    'very', 'really', 'get', 'got', 'go', 'going', 'make', 'made', 'need', 'want', 'think', 'know', 'see',
    'say', 'said', 'take', 'let', 'us', 'me', 'him', 'them', 'one', 'two', 'three', 'too', 'now', 'only',
    'still', 'even', 'much', 'many', 'such', 'each', 'both', 'either', 'maybe', 'actually', 'basically',
]);

function lowercaseLeadingWord(text: string): string {
    const m = text.match(/^([A-Z][a-z]+)(?=[^A-Za-z']|$)/);
    if (m && SAFE_TO_LOWERCASE.has(m[1].toLowerCase())) {
        return m[1].toLowerCase() + text.slice(m[1].length);
    }
    return text;
}

/** Removes the single sentence-ending period the model adds to a cut-off segment. */
function dropFalseSentenceEnd(text: string): string {
    // Only a plain period: "?" / "!" are real intonation, and "..." is an intentional trail-off.
    return /[^.]\.$/.test(text) ? text.slice(0, -1) : text;
}

export function stitchSegments(segments: TranscribedSegment[]): string {
    const parts: string[] = [];
    let carryForcedCut = false;

    for (const seg of segments) {
        let text = seg.text.trim().replace(/\s{2,}/g, ' ');
        if (!text) continue; // an empty segment must not hide a cut: keep carrying the flag

        if (carryForcedCut && parts.length > 0) {
            const prev = dropFalseSentenceEnd(parts[parts.length - 1]);
            parts[parts.length - 1] = prev;
            // Real terminal punctuation ("?", "!", "...") means the next segment really does start
            // a sentence; only continue the sentence when the previous one is still open.
            if (!/[.!?]$/.test(prev)) text = lowercaseLeadingWord(text);
        }

        parts.push(text);
        carryForcedCut = seg.forcedCut;
    }

    return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}
