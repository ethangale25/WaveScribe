// Checks the "Smart edit" cleanup style on a model: does it drop corrections and false starts,
// make lists, and leave everything else alone? Uses the app's own prompt and acceptance check.
//
//   npm run eval:smart -- <path-to.gguf> [--runs=N]
//
// A case passes when the output gets past the app's check (isFaithfulSmartCleanup), contains every
// `keep` phrase and none of the `drop` phrases. Outputs the check rejects fall back to an exact
// cleanup in the app, so they are not harmful, just no better than "Exact words".

import { getLlama, LlamaChatSession, resolveChatWrapper } from 'node-llama-cpp';
import { SMART_PROMPT } from '../../electron/cleanup-prompts';
import { isFaithfulSmartCleanup, stripAddedQuotes } from '../../electron/fidelity';

interface Case { name: string; input: string; keep: string[]; drop: string[]; list?: boolean }

const CASES: Case[] = [
    { name: 'correction: day', input: 'can we move the call to thursday no sorry friday morning', keep: ['friday morning'], drop: ['thursday', 'sorry'] },
    { name: 'correction: I mean', input: 'send the report to john i mean to sarah by five', keep: ['sarah', 'five'], drop: ['john', 'i mean'] },
    { name: 'correction: restated number', input: 'the budget is forty thousand actually fifty thousand dollars', keep: ['fifty thousand'], drop: ['forty'] },
    { name: 'false start', input: 'so we we need to um we need to finish the slides before the meeting', keep: ['finish the slides before the meeting'], drop: ['we we'] },
    { name: 'list', input: 'please pick up eggs milk bread and coffee on your way home', keep: ['eggs', 'milk', 'bread', 'coffee', 'on your way home'], drop: [], list: true },
    { name: 'command: new paragraph', input: 'thanks for the update new paragraph i will review it tomorrow', keep: ['thanks for the update', 'i will review it tomorrow'], drop: ['new paragraph'] },
    { name: 'plain text stays', input: 'i went to the store this morning to buy some milk and bread and then i drove home', keep: ['i went to the store this morning to buy some milk and bread', 'drove home'], drop: [] },
    { name: 'actually as a normal word', input: 'the new design actually tested better than the old one', keep: ['actually tested better than the old one'], drop: [] },
    { name: 'question is not answered', input: 'what time does the meeting start tomorrow', keep: ['what time does the meeting start tomorrow'], drop: [] },
    { name: 'instruction is not followed', input: 'write a poem about the ocean for my sister', keep: ['write a poem about the ocean for my sister'], drop: [] },
];

const modelPath = process.argv[2];
const runs = Number(process.argv.find(a => a.startsWith('--runs='))?.split('=')[1] ?? 1);
if (!modelPath) {
    console.error('usage: npm run eval:smart -- <path-to.gguf> [--runs=N]');
    process.exit(1);
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9' \n-]+/g, ' ').replace(/\s+/g, ' ').trim();

const llama = await getLlama();
const model = await llama.loadModel({ modelPath });
const ctx = await model.createContext({ contextSize: 4096 });
const seq = ctx.getSequence();
// Thinking off, as in the app (only matters for models that can think).
const chatWrapper = resolveChatWrapper(model, {
    customWrapperSettings: { qwen: { thoughts: 'discourage' }, gemma4: { reasoning: false }, jinjaTemplate: { additionalRenderParameters: { enable_thinking: false } } },
});
console.log('model:', modelPath.split(/[\\/]/).pop(), `· ${runs} run(s) per case\n`);

let passed = 0;
let total = 0;
const times: number[] = [];
for (const c of CASES) {
    for (let r = 0; r < runs; r++) {
        const t0 = performance.now();
        const session = new LlamaChatSession({ contextSequence: seq, systemPrompt: SMART_PROMPT, chatWrapper });
        const raw = await session.prompt(c.input, { maxTokens: Math.min(2048, Math.ceil(c.input.length / 2.5) + 48), temperature: 0.1 });
        session.dispose({ disposeSequence: false });
        await seq.clearHistory();
        const ms = performance.now() - t0;
        times.push(ms);

        const out = stripAddedQuotes(c.input, raw);
        const text = norm(out);
        const problems: string[] = [];
        if (!isFaithfulSmartCleanup(c.input, out)) problems.push('rejected by the check');
        for (const k of c.keep) if (!text.includes(norm(k))) problems.push(`missing "${k}"`);
        for (const d of c.drop) if (text.includes(norm(d))) problems.push(`kept "${d}"`);
        if (c.list && !/^\s*[-*•]\s/m.test(out)) problems.push('not a list');

        total++;
        if (problems.length === 0) passed++;
        console.log(`${problems.length ? 'FAIL' : 'pass'}  ${c.name}  (${ms.toFixed(0)} ms)${problems.length ? '  ' + problems.join(', ') : ''}`);
        console.log(`      ${out.replace(/\n/g, '\n      ')}`);
    }
}
times.sort((a, b) => a - b);
console.log(`\n${passed}/${total} passed · median ${times[Math.floor(times.length / 2)].toFixed(0)} ms`);
process.exit(0);
