// Checks voice commands on a model: an instruction applied to selected text, or writing with
// nothing selected. Uses the app's own prompts.
//
//   npm run eval:commands -- <path-to.gguf>
//
// A case passes when the reply is not empty, has no chatty preamble ("Sure, here is..."), and
// meets the case's own check.

import { getLlama, LlamaChatSession, resolveChatWrapper } from 'node-llama-cpp';
import { COMMAND_EDIT_PROMPT, COMMAND_WRITE_PROMPT, commandUserMessage } from '../../electron/cleanup-prompts';
import { stripAddedQuotes } from '../../electron/fidelity';

const EMAIL = 'hey so i cant make the meeting tomorrow because something came up, can we do thursday instead? let me know';
const PARAGRAPH = 'Our team shipped the new onboarding flow last week. Early numbers show that more people finish setup, and support tickets about account creation are down by about a third. We still need to fix a layout bug on small screens, which is planned for next sprint.';

interface Case { name: string; instruction: string; selection: string; check: (out: string) => string | null }

const CASES: Case[] = [
    { name: 'more formal', instruction: 'make this more formal', selection: EMAIL,
        check: o => /\bhey\b/i.test(o) ? 'still says "hey"' : /thursday/i.test(o) ? null : 'lost "Thursday"' },
    { name: 'shorter', instruction: 'make this shorter', selection: PARAGRAPH,
        check: o => o.length < PARAGRAPH.length * 0.8 ? null : 'not shorter' },
    { name: 'bullet points', instruction: 'turn this into bullet points', selection: PARAGRAPH,
        check: o => (o.match(/^\s*[-*•]\s/gm) ?? []).length >= 2 ? null : 'no bullet list' },
    { name: 'translate', instruction: 'translate this to spanish', selection: 'Thank you for your help, see you on Monday.',
        check: o => /gracias/i.test(o) && /lunes/i.test(o) ? null : 'not Spanish' },
    { name: 'fix spelling', instruction: 'fix the spelling', selection: 'I recieved the pakage yesterday and it was definately worth the wait.',
        check: o => /received/i.test(o) && /package/i.test(o) && /definitely/i.test(o) ? null : 'spelling not fixed' },
    { name: 'write (nothing selected)', instruction: 'write a short polite message declining an invitation to dinner on friday', selection: '',
        check: o => /friday/i.test(o) && o.length > 40 ? null : 'not the message asked for' },
];

const PREAMBLE = /^(sure|certainly|of course|here(?:'s| is| are)|okay|ok)\b/i;

const modelPath = process.argv[2];
if (!modelPath) {
    console.error('usage: npm run eval:commands -- <path-to.gguf>');
    process.exit(1);
}

const llama = await getLlama();
const model = await llama.loadModel({ modelPath });
const ctx = await model.createContext({ contextSize: 4096 });
const seq = ctx.getSequence();
const chatWrapper = resolveChatWrapper(model, {
    customWrapperSettings: { qwen: { thoughts: 'discourage' }, gemma4: { reasoning: false }, jinjaTemplate: { additionalRenderParameters: { enable_thinking: false } } },
});
console.log('model:', modelPath.split(/[\\/]/).pop(), '\n');

let passed = 0;
for (const c of CASES) {
    const t0 = performance.now();
    const session = new LlamaChatSession({ contextSequence: seq, chatWrapper, systemPrompt: c.selection ? COMMAND_EDIT_PROMPT : COMMAND_WRITE_PROMPT });
    const raw = await session.prompt(commandUserMessage(c.instruction, c.selection), { maxTokens: Math.min(2048, Math.ceil(c.selection.length / 2) + 512), temperature: 0.3 });
    session.dispose({ disposeSequence: false });
    await seq.clearHistory();
    const out = stripAddedQuotes(c.selection, raw).trim();
    const problems = [!out && 'empty', PREAMBLE.test(out) && 'chatty preamble', out && c.check(out)].filter(Boolean);
    if (problems.length === 0) passed++;
    console.log(`${problems.length ? 'FAIL' : 'pass'}  ${c.name}  (${(performance.now() - t0).toFixed(0)} ms)${problems.length ? '  ' + problems.join(', ') : ''}`);
    console.log(`      ${out.replace(/\n/g, '\n      ')}`);
}
console.log(`\n${passed}/${CASES.length} passed`);
process.exit(0);
