// Drives the real Electron app end to end with a fake microphone that plays a WAV file.
//
//   node tools/eval/drive-app.mjs <clip.wav> <clip-seconds> [--model=ID] [--device=cpu|webgpu] [--ai=1]
//
// The app always runs in a throw-away profile, so your real history, stats and settings are never
// touched. With --model/--device it uses those settings (AI cleanup off, models downloaded into the
// temp profile). Without them it clones your real settings (minus history/metrics) and links your
// downloaded LLM models folder, i.e. it measures exactly what you would experience.
//   --repeat=N  runs N dictations in one session (steady-state timing)
//
// Launches the app with WAVESCRIBE_NO_PASTE=1 (nothing is pasted or put on the clipboard), waits for
// the speech model, clicks Record, stops right after the clip's last word, and prints the
// "[Timing]" lines the app logs, i.e. the real stop-to-text latency on this machine's WebGPU/WASM.

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { testDisplayEnv } from './display.mjs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flag = (name) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
const [clip, secondsArg] = positional;
if (!clip || !secondsArg) {
    console.error('usage: drive-app.mjs <clip.wav> <clip-seconds> [--model=ID] [--device=cpu|webgpu]');
    process.exit(1);
}
const modelFlag = flag('model');
const repeat = parseInt(flag('repeat') || '1', 10);
const threadsFlag = flag('threads') ? parseInt(flag('threads'), 10) : undefined; // CPU decoding threads
const ptt = process.argv.includes('--ptt'); // hold Ctrl+Shift+Space with real key events instead of clicking
const deviceFlag = flag('device') || 'cpu';
// One fixed throw-away profile, reused between runs so downloaded speech models stay cached
// (a fresh folder every time meant re-downloading the model on every run). Settings are rewritten
// each run, and your real profile is never touched.
const tempProfile = path.join(os.tmpdir(), 'wavescribe-eval-profile');
fs.mkdirSync(tempProfile, { recursive: true });
try { fs.unlinkSync(path.join(tempProfile, 'models')); } catch { }
if (modelFlag) {
    fs.writeFileSync(path.join(tempProfile, 'config.json'), JSON.stringify({
        model: modelFlag, computeDevice: deviceFlag, aiReformat: flag('ai') === '1', vadEnabled: true, playSounds: false, showNotify: false, pushToTalk: ptt, cpuThreads: threadsFlag,
    }));
    if (flag('ai') === '1') {
        // --ai=1 also links the real LLM models folder so the cleanup step runs.
        const realModels = path.join(process.env.APPDATA || '', 'wavescribe', 'models');
        if (fs.existsSync(realModels)) fs.symlinkSync(realModels, path.join(tempProfile, 'models'), 'junction');
    }
} else {
    const realProfile = path.join(process.env.APPDATA || '', 'wavescribe');
    const config = JSON.parse(fs.readFileSync(path.join(realProfile, 'config.json'), 'utf-8'));
    delete config.dictationHistory;
    delete config.metrics;
    config.playSounds = false;
    config.showNotify = false;
    if (ptt) config.pushToTalk = true;
    if (threadsFlag) config.cpuThreads = threadsFlag;
    fs.writeFileSync(path.join(tempProfile, 'config.json'), JSON.stringify(config));
    if (fs.existsSync(path.join(realProfile, 'models'))) {
        fs.symlinkSync(path.join(realProfile, 'models'), path.join(tempProfile, 'models'), 'junction');
    }
}
const appDir = path.resolve(flag('app-dir') || '.'); // run a different checkout, e.g. the original code
const clipSeconds = parseFloat(secondsArg);

// Real keyboard input via SendInput (same path a physical keyboard takes).
function makeKeyboard() {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const KB = koffi.struct('KEYBDINPUT', { wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t' });
    const MI = koffi.struct('MOUSEINPUT', { dx: 'int32', dy: 'int32', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t' });
    const INPUT = koffi.struct('INPUT', { type: 'uint32', u: koffi.union('INPUT_U', { ki: KB, mi: MI }) });
    const SendInput = user32.func('uint32 SendInput(uint32 c, INPUT *p, int cb)');
    return (vk, up) => SendInput(1, [{ type: 1, u: { ki: { wVk: vk, wScan: 0, dwFlags: up ? 2 : 0, time: 0, dwExtraInfo: 0 } } }], koffi.sizeof(INPUT));
}
const queueTest = process.argv.includes('--queue-test'); // press the hotkey while the last dictation is still processing
const key = (ptt || queueTest) ? makeKeyboard() : null;
const VK = { ctrl: 0x11, shift: 0x10, space: 0x20 };
const PORT = 9333;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const logs = [];
// --exe=<path> launches a packaged build (e.g. release/win-unpacked/WaveScribe.exe) instead of the source tree.
const exe = flag('exe');
const proc = spawn(exe ? path.resolve(exe) : electronPath, [
    ...(exe ? [] : ['.']),
    `--user-data-dir=${tempProfile}`,
    `--remote-debugging-port=${PORT}`,
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${path.resolve(clip)}%noloop`,
], { cwd: appDir, env: { ...process.env, WAVESCRIBE_NO_PASTE: '1', ...testDisplayEnv() }, stdio: ['ignore', 'pipe', 'pipe'] });

const onData = (d) => d.toString().split('\n').forEach(l => { if (l.trim()) logs.push(l); });
proc.stdout.on('data', onData);
proc.stderr.on('data', onData);

function done(code) {
    try { proc.kill(); } catch { }
    setTimeout(() => {
        // Remove the junction first so deleting the temp profile can never touch the real models.
        try { fs.unlinkSync(path.join(tempProfile, 'models')); } catch { }
        // (the profile is kept on purpose: it holds the cached speech models)
        process.exit(code);
    }, 1500);
}

async function connect() {
    for (let i = 0; i < 60; i++) {
        try {
            const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
            const page = pages.find(p => p.type === 'page' && p.webSocketDebuggerUrl && !p.url.startsWith('data:'));
            if (page) return page.webSocketDebuggerUrl;
        } catch { }
        await sleep(500);
    }
    throw new Error('DevTools endpoint never came up');
}

const wsUrl = await connect();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 1;
const pending = new Map();
ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const evaluate = (expression) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, (msg) => resolve(msg.result?.result?.value));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
});

// Wait for the speech model to finish loading (status line reads "Ready").
let ready = false;
for (let i = 0; i < 600; i++) {
    const status = await evaluate(`document.getElementById('status-message')?.textContent`);
    if (status === 'Ready') { ready = true; break; }
    await sleep(500);
}
if (!ready) { console.error('Model never became ready'); console.error(logs.slice(-10).join('\n')); done(1); }
logs.filter(l => l.includes('[ASR]')).forEach(l => console.log(l.replace('[Renderer]: ', '')));
console.log('model ready; starting recording');
await sleep(1500);

for (let round = 1; round <= repeat; round++) {
    logs.length = 0;
    if (repeat > 1) console.log(`
===== round ${round} of ${repeat} =====`);
    if (ptt) { key(VK.ctrl, false); key(VK.shift, false); key(VK.space, false); }
    else await evaluate(`document.getElementById('record-btn').click()`);

    // Wait until recording has actually started, then talk for the clip length.
    for (let i = 0; i < 40; i++) {
        const status = await evaluate(`document.getElementById('status-message')?.textContent`);
        if (status && status !== 'Starting...' && status !== 'Ready') break;
        await sleep(100);
    }
    await sleep(Math.max(0, clipSeconds * 1000 - 300)); // stop right after the last word

    const tStop = Date.now();
    if (ptt) { key(VK.space, true); key(VK.shift, true); key(VK.ctrl, true); }
    else await evaluate(`document.getElementById('record-btn').click()`);
    console.log('stop clicked');
    if (queueTest) {
        await sleep(250); // the dictation is now being processed
        key(VK.ctrl, false); key(VK.shift, false); key(VK.space, false);
        key(VK.space, true); key(VK.shift, true); key(VK.ctrl, true);
        console.log('hotkey pressed while processing');
    }

    for (let i = 0; i < 120; i++) {
        if (logs.some(l => l.includes('[PasteDone]'))) break;
        await sleep(250);
    }
    await sleep(500);
    logs.filter(l => l.includes('[Hotkey]') || l.includes('[PasteDone]')).forEach(l => console.log('  ' + l));
    console.log('  (stop requested at ' + tStop + ')');
    if (queueTest) {
        let started = false;
        for (let i = 0; i < 40 && !started; i++) {
            started = (await evaluate(`document.getElementById('status-message')?.textContent`)) === 'Recording...' ||
                      (await evaluate(`document.getElementById('record-btn')?.classList.contains('recording')`)) === true;
            if (!started) await sleep(250);
        }
        console.log('QUEUED PRESS STARTED A NEW RECORDING: ' + started);
        if (started) await evaluate(`document.getElementById('record-btn').click()`); // stop it again
        await sleep(3000);
    }
    const pasteLine = logs.find(l => l.includes('[PasteDone]'));
    console.log('STOP->PASTE: ' + (pasteLine ? (Number(pasteLine.split('[PasteDone] ')[1]) - tStop) + 'ms' : 'never pasted'));
    if (!pasteLine) {
        console.log('UI status: ' + await evaluate(`document.getElementById('status-message')?.textContent`));
        console.log('--- last log lines ---');
        logs.slice(-25).forEach(l => console.log('  ' + l.replace('[Renderer]: ', '').slice(0, 200)));
    }

    const resultText = await evaluate(`document.querySelector('.history-item .content')?.textContent`);
    console.log('RESULT: ' + resultText);
    console.log('\n--- app timing (ms since the stop click) ---');
    logs.filter(l => l.includes('[Timing]')).forEach(l => console.log(l.replace('[Renderer]: ', '')));
    console.log('\n--- phrases dispatched during recording ---');
    logs.filter(l => l.includes('Dispatched phrase #')).forEach(l => console.log(l.replace('[Renderer]: ', '')));

    await sleep(1500);
}
done(0);
