// Guards the AI cleanup step: it may add punctuation and fix a slip or two, but must never rewrite
// what the user said. Small local models do rewrite long dictations; this keeps those out.

const toWords = (text: string): string[] =>
    text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean)

/** Word-level edit distance between two texts, as a fraction of the original's word count. */
export function wordChangeRatio(original: string, revised: string): number {
    const a = toWords(original)
    const b = toWords(revised)
    if (a.length === 0) return b.length === 0 ? 0 : 1

    // Single-row dynamic programming keeps memory flat for long dictations.
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
        const row = [i]
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(
                prev[j] + 1,
                row[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            )
        }
        prev = row
    }
    return prev[b.length] / a.length
}

/**
 * True if `cleaned` is an acceptable cleanup of `raw`: at most ~15% of the words differ (homophone
 * fixes and the like). Very short utterances may change up to two words ("there going" ->
 * "they are going"); a longer one is allowed a single word beyond that percentage.
 */
export function isFaithfulCleanup(raw: string, cleaned: string): boolean {
    const ratio = wordChangeRatio(raw, cleaned)
    const wordCount = toWords(raw).length
    const maxEdits = wordCount <= 12 ? 2 : 1
    return ratio <= 0.15 || ratio * wordCount <= maxEdits
}

const QUOTE_PAIRS: Array<[string, string]> = [['"', '"'], ['“', '”'], ["'", "'"], ['‘', '’'], ['`', '`']]

/** Removes quotation marks the model wrapped around its reply when the dictation had none. */
export function stripAddedQuotes(raw: string, cleaned: string): string {
    const text = cleaned.trim()
    for (const [open, close] of QUOTE_PAIRS) {
        if (text.length > 2 && text.startsWith(open) && text.endsWith(close)
            && !raw.trim().startsWith(open) && !text.slice(1, -1).includes(open)) {
            return text.slice(1, -1).trim()
        }
    }
    return text
}
