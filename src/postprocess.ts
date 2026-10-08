// Pure text post-processing applied to transcribed dictation (no DOM / Electron access).

export interface DictionaryPair {
    sound: string;
    replace: string;
}

export function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "like" is deliberately not here: it is a real word far more often than a filler.
const FILLER_PATTERN = /\b(?:um|uh|hmm|uhm)\b,?/gi;

export function removeFillers(text: string): string {
    return text
        .replace(FILLER_PATTERN, '')
        .replace(/\s+([,.!?;:])/g, '$1') // "So , we" -> "So, we"
        .replace(/,\s*,/g, ',')
        .replace(/^[\s,]+/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

export function applyDictionary(text: string, pairs: DictionaryPair[]): string {
    let result = text;
    for (const pair of pairs) {
        const sound = pair.sound ? pair.sound.trim() : '';
        if (!sound) continue;
        const escaped = escapeRegex(sound);
        const isWord = /^\w+$/.test(sound);
        const regex = isWord ? new RegExp(`\\b${escaped}\\b`, 'gi') : new RegExp(escaped, 'gi');
        // A function replacer keeps "$&"-style sequences in the replacement literal.
        result = result.replace(regex, () => pair.replace);
    }
    return result;
}

export function applyAutoFormatting(text: string, autoCap: boolean, autoPunct: boolean): string {
    let result = text.trim();
    if (!result) return result;

    if (autoCap) {
        // Capitalize first character and any character following sentence-ending punctuation
        result = result.replace(/(^\s*|[.!?]\s+)([a-z])/g, (_, p1, p2) => p1 + p2.toUpperCase());
    }

    if (autoPunct) {
        // If no terminal punctuation, append a period
        if (!/[.!?]$/.test(result)) {
            result += '.';
        }
    }
    return result;
}

export function countWords(text: string): number {
    return text.split(/\s+/).filter(w => w.length > 0).length;
}
