// Compares cleanup prompt variants on small models: does the output keep the dictated words while
// adding punctuation/capitalization?
//
//   node tools/eval/llm-prompts.mjs <path-to.gguf>

import { getLlama, LlamaChatSession } from 'node-llama-cpp';

const modelPath = process.argv[2];
const SYSTEMS = {
    current: `You are a text cleanup assistant for a voice dictation app. Your ONLY job is to fix the formatting and minor errors in dictated text. Rules:
- Fix capitalization, punctuation, and spacing
- Fix obvious speech-to-text errors (homophones, missing words)
- Do NOT add new content or change the meaning
- Do NOT add greetings, explanations, or commentary
- Output ONLY the corrected text, nothing else
- If the text looks fine, return it unchanged
- Keep the same tone and style as the input`,

    strict: `You add punctuation and capitalization to dictated speech. Keep every word exactly as spoken, in the same order. Never summarize, rephrase, shorten, or drop words. Never change "I" to "you". Reply with the corrected text only.`,

    oneShot: `You add punctuation and capitalization to dictated speech. Keep every word exactly as spoken, in the same order. Never summarize, rephrase, shorten, or drop words. Reply with the corrected text only.

Example input: hey are you free tomorrow i was thinking we could grab lunch and then go see that movie we talked about
Example output: Hey, are you free tomorrow? I was thinking we could grab lunch and then go see that movie we talked about.`,
};

const INPUTS = {
    'punctuated': 'I went to the store this morning to buy some milk and bread. When I got there the shelves were almost empty. So I drove to another store across town. It took me about 20 minutes to find everything on my list.',
    'long run-on': 'So what I wanted to talk about today is how we can make the dictation faster because right now it feels slow when I stop talking and I have to wait for the text to show up and what I think we should do is send small pieces of audio while the person is still speaking and then clean everything up at the very end.',
    'unpunctuated': 'i went to the store this morning to buy some milk and bread when i got there the shelves were almost empty so i drove to another store across town it took me about twenty minutes to find everything on my list',
    'unpunctuated run-on': 'so what i wanted to talk about today is how we can make the dictation faster because right now it feels slow when i stop talking and i have to wait for the text to show up and what i think we should do is send small pieces of audio while the person is still speaking and then clean everything up at the very end',
};

const words = (t) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
function wordChange(a, b) {
    const r = words(a), h = words(b);
    const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...new Array(h.length).fill(0)]);
    for (let j = 1; j <= h.length; j++) d[0][j] = j;
    for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    return r.length ? d[r.length][h.length] / r.length : 0;
}

const llama = await getLlama();
const model = await llama.loadModel({ modelPath });
const ctx = await model.createContext({ contextSize: 4096 });
const seq = ctx.getSequence();
console.log('model:', modelPath.split(/[\\/]/).pop());

for (const [sname, system] of Object.entries(SYSTEMS)) {
    console.log(`\n##### prompt: ${sname}`);
    for (const [iname, text] of Object.entries(INPUTS)) {
        const t0 = performance.now();
        const session = new LlamaChatSession({ contextSequence: seq, systemPrompt: system });
        const out = (await session.prompt(text, { maxTokens: Math.min(2048, Math.ceil(text.length / 2.5) + 48), temperature: 0.1 })).trim();
        session.dispose({ disposeSequence: false });
        await seq.clearHistory();
        const ms = (performance.now() - t0).toFixed(0);
        console.log(`[${iname}] ${ms}ms, words changed ${(wordChange(text, out) * 100).toFixed(0)}%\n    ${out}`);
    }
}
process.exit(0);
