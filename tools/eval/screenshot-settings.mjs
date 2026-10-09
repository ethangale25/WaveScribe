// Screenshots the Settings screen (every scroll position) so UI changes can be reviewed visually.
//
//   node tools/eval/screenshot-settings.mjs <output-dir> [--light] [--click=<css selector>]
//
// Runs the app in a throw-away profile cloned from your settings (history and stats are not copied).

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { testDisplayEnv } from './display.mjs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const outDir = process.argv[2];
if (!outDir) { console.error('usage: screenshot-settings.mjs <output-dir> [--light]'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const light = process.argv.includes('--light');
const clickArg = (process.argv.find(a => a.startsWith('--click=')) || '').slice(8);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// One fixed throw-away profile, reused between runs so downloaded speech models stay cached
// (a fresh folder every time meant re-downloading the model on every run). Settings are rewritten
// each run, and your real profile is never touched.
const tempProfile = path.join(os.tmpdir(), 'wavescribe-eval-profile');
fs.mkdirSync(tempProfile, { recursive: true });
try { fs.rmdirSync(path.join(tempProfile, 'models')); } catch { }
const realProfile = path.join(process.env.APPDATA || '', 'wavescribe');
const config = JSON.parse(fs.readFileSync(path.join(realProfile, 'config.json'), 'utf-8'));
delete config.dictationHistory;
fs.writeFileSync(path.join(tempProfile, 'config.json'), JSON.stringify(config));
if (fs.existsSync(path.join(realProfile, 'models'))) fs.symlinkSync(path.join(realProfile, 'models'), path.join(tempProfile, 'models'), 'junction');

const PORT = 9335;
const proc = spawn(electronPath, ['.', `--user-data-dir=${tempProfile}`, `--remote-debugging-port=${PORT}`], { stdio: 'ignore', env: { ...process.env, ...testDisplayEnv() } });
function done(code) {
    try { proc.kill(); } catch { }
    setTimeout(() => {
        try { fs.rmdirSync(path.join(tempProfile, 'models')); } catch { }
        // (the profile is kept on purpose: it holds the cached speech models)
        process.exit(code);
    }, 1500);
}

let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
        const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        wsUrl = pages.find(p => p.type === 'page' && !p.url.startsWith('data:'))?.webSocketDebuggerUrl;
    } catch { }
    if (!wsUrl) await sleep(500);
}
if (!wsUrl) { console.error('no DevTools page'); done(1); }

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

// Wait for the speech model so the status area is settled.
for (let i = 0; i < 300; i++) { if ((await evaluate(`document.getElementById('status-message')?.textContent`)) === 'Ready') break; await sleep(500); }
await sleep(800);

if (light) await evaluate(`document.getElementById('theme-btn').click()`);
await evaluate(`document.getElementById('settings-btn').click()`);
await sleep(2500); // cards render after hardware + catalog queries

const waitMs = parseInt((process.argv.find(a => a.startsWith('--wait=')) || '--wait=600').slice(7), 10);
if (clickArg) {
    await evaluate(`window.confirm = () => true`); // auto-accept confirmation prompts
    await evaluate(`document.querySelector(${JSON.stringify(clickArg)})?.click()`);
    await sleep(waitMs);
    console.log('settings now:', await evaluate(`window.electronAPI.getSettings().then(s => JSON.stringify({ model: s.model, computeDevice: s.computeDevice, aiReformat: s.aiReformat, llmModelId: s.llmModelId }))`));
    console.log('speed test note:', await evaluate(`document.getElementById('speed-test-result')?.textContent`));
    console.log('processor hint:', await evaluate(`document.getElementById('device-hint')?.textContent`));
    console.log('status line:', await evaluate(`document.getElementById('status-message')?.textContent`));
    console.log('active setup card:', await evaluate(`document.querySelector('.setup-card.is-active .setup-name')?.textContent || '(none)'`));
}

console.log('active modals:', await evaluate(`Array.from(document.querySelectorAll('.modal-overlay.active')).map(m => m.id).join(', ') || '(none)'`));
const total = await evaluate(`(() => { const b = document.querySelector('#settings-modal .modal-body'); return [b.scrollHeight, b.clientHeight]; })()`);
const [scrollHeight, clientHeight] = total;
console.log(`modal body: ${scrollHeight}px tall, ${clientHeight}px visible`);

let index = 0;
for (let top = 0; top < scrollHeight; top += Math.max(120, clientHeight - 60)) {
    await evaluate(`document.querySelector('#settings-modal .modal-body').scrollTop = ${top}`);
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(outDir, `settings-${light ? 'light' : 'dark'}-${index++}.png`);
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log('saved', file);
    if (top + clientHeight >= scrollHeight) break;
}
done(0);
