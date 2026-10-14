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

// Spoken editing commands, used by the "Smart edit" cleanup style. A command only counts at a
// phrase boundary (start or end of the text, or next to punctuation), so ordinary speech such as
// "a new line of products" or "scratch that itch" is left alone.
const COMMAND = /(^|[.!?,;:]\s*|\s)(new paragraph|next paragraph|new line|next line|scratch that|delete that)\b[.!?,;:]?(?=\s|$)/gi;
const BREAKS: Record<string, string> = {
    'new paragraph': '\n\n', 'next paragraph': '\n\n', 'new line': '\n', 'next line': '\n',
};

/** Applies "new paragraph", "new line" and "scratch that" (removes the sentence before it). */
export function applySpokenCommands(text: string, autoCap = true, autoPunct = true): string {
    let out = '';
    let last = 0;
    let changed = false;
    for (const m of text.matchAll(COMMAND)) {
        const start = m.index! + m[1].length;
        const end = m.index! + m[0].length;
        const afterBoundary = m.index === 0 || /[.!?,;:]/.test(m[1]);
        const beforeBoundary = /[.!?,;:]$/.test(m[0]) || end === text.length;
        if (!afterBoundary && !beforeBoundary) continue;
        changed = true;
        out += text.slice(last, start);
        const cmd = m[2].toLowerCase();
        if (cmd === 'scratch that' || cmd === 'delete that') {
            // Drop the sentence (or clause) just spoken: back to the previous sentence end or break.
            const body = out.replace(/[\s,;:]+$/, '');
            const cut = Math.max(body.search(/[.!?\n][^.!?\n]*[.!?]?$/) + 1, 0);
            out = body.slice(0, cut);
        } else {
            out = out.replace(/[\s,;:]+$/, '');
            if (autoPunct && out && !/[.!?\n]$/.test(out)) out += '.';
            out += BREAKS[cmd];
        }
        last = end;
    }
    if (!changed) return text;
    out += text.slice(last);

    // Tidy the seams: no stray spaces or commas around breaks, and each new line starts a sentence.
    out = out.replace(/[ \t]*\n[ \t,;:.]*/g, '\n').replace(/^[\s,;:.]+/, '').replace(/ {2,}/g, ' ').trim();
    if (autoCap) out = out.replace(/(^|\n|[.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());
    if (autoPunct && out && !/[.!?]$/.test(out)) out += '.';
    return out;
}
