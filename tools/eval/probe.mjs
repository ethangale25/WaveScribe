// Launches the app (throw-away profile, nothing pasted) and prints the result of JavaScript
// expressions evaluated in the renderer page.
//
//   node tools/eval/probe.mjs "crossOriginIsolated" "typeof SharedArrayBuffer" [--electron-flag=--some-switch]

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { testDisplayEnv } from './display.mjs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const expressions = process.argv.slice(2).filter(a => !a.startsWith('--'));
const extraFlags = process.argv.filter(a => a.startsWith('--electron-flag=')).map(a => a.slice('--electron-flag='.length));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = path.join(os.tmpdir(), 'wavescribe-eval-profile');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ model: 'onnx-community/moonshine-tiny-ONNX', computeDevice: 'cpu', aiReformat: false }));

const PORT = 9336;
const proc = spawn(electronPath, ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, ...extraFlags], { stdio: 'ignore', env: { ...process.env, WAVESCRIBE_NO_PASTE: '1', ...testDisplayEnv() } });
const finish = (code) => { try { proc.kill(); } catch { } setTimeout(() => process.exit(code), 800); };

let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
        const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        wsUrl = pages.find(p => p.type === 'page' && !p.url.startsWith('data:'))?.webSocketDebuggerUrl;
    } catch { }
    if (!wsUrl) await sleep(500);
}
if (!wsUrl) { console.error('no DevTools page'); finish(1); }

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const evaluate = (expression) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, (msg) => resolve(msg.result?.exceptionDetails ? 'ERROR: ' + msg.result.exceptionDetails.text : msg.result?.result?.value));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

for (let i = 0; i < 300; i++) { if ((await evaluate(`document.getElementById('status-message')?.textContent`)) === 'Ready') break; await sleep(500); }
for (const e of expressions) console.log(`${e}  =>  ${JSON.stringify(await evaluate(e))}`);
finish(0);
