// Benchmarks the AI-cleanup step in isolation: latency (fresh context per call vs a persistent
// one) and output fidelity (does the model keep the dictated words?).
//
//   node tools/eval/llm-bench.mjs <path-to.gguf>

import { getLlama, LlamaChatSession } from 'node-llama-cpp';

const modelPath = process.argv[2];
if (!modelPath) {
    console.error('usage: llm-bench.mjs <path-to.gguf>');
    process.exit(1);
}

const SYSTEM = `You are a text cleanup assistant for a voice dictation app. Your ONLY job is to fix the formatting and minor errors in dictated text. Rules:
- Fix capitalization, punctuation, and spacing
- Fix obvious speech-to-text errors (homophones, missing words)
- Do NOT add new content or change the meaning
- Do NOT add greetings, explanations, or commentary
- Output ONLY the corrected text, nothing else
- If the text looks fine, return it unchanged
- Keep the same tone and style as the input`;

const INPUTS = {
    'short, punctuated': 'I went to the store this morning to buy some milk and bread. When I got there the shelves were almost empty. So I drove to another store across town. It took me about 20 minutes to find everything on my list.',
    'long run-on': 'So what I wanted to talk about today is how we can make the dictation faster because right now it feels slow when I stop talking and I have to wait for the text to show up and what I think we should do is send small pieces of audio while the person is still speaking and then clean everything up at the very end.',
    'unpunctuated (Moonshine style)': 'i went to the store this morning to buy some milk and bread when i got there the shelves were almost empty so i drove to another store across town it took me about twenty minutes to find everything on my list',
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
console.log('model:', modelPath.split(/[\\/]/).pop(), '\n');

async function fresh(text) {
    const t0 = performance.now();
    const ctx = await model.createContext({ contextSize: 4096 });
    const tCtx = performance.now() - t0;
    const session = new LlamaChatSession({ contextSequence: ctx.getSequence(), systemPrompt: SYSTEM });
    const out = await session.prompt(text, { maxTokens: Math.min(2048, Math.ceil(text.length / 2.5) + 48), temperature: 0.1 });
    session.dispose();
    ctx.dispose();
    return { out: out.trim(), total: performance.now() - t0, ctx: tCtx };
}

const persistentCtx = await model.createContext({ contextSize: 4096 });
const persistentSeq = persistentCtx.getSequence();
async function persistent(text) {
    const t0 = performance.now();
    const session = new LlamaChatSession({ contextSequence: persistentSeq, systemPrompt: SYSTEM });
    const out = await session.prompt(text, { maxTokens: Math.min(2048, Math.ceil(text.length / 2.5) + 48), temperature: 0.1 });
    session.dispose({ disposeSequence: false });
    await persistentSeq.clearHistory();
    return { out: out.trim(), total: performance.now() - t0, ctx: 0 };
}

await fresh('warm up the model please'); // exclude one-time kernel/model warm-up from the numbers

for (const [name, text] of Object.entries(INPUTS)) {
    console.log(`--- ${name}`);
    for (const [label, fn] of [['fresh context ', fresh], ['persistent ctx', persistent]]) {
        const r = await fn(text);
        const change = (wordChange(text, r.out) * 100).toFixed(0);
        console.log(`${label}: ${r.total.toFixed(0)}ms (ctx setup ${r.ctx.toFixed(0)}ms)  words changed ${change}%`);
        console.log(`    ${r.out}`);
    }
}
process.exit(0);
