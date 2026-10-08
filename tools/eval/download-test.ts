// Exercises the real model-download code (cancel -> resume -> checksum) against Hugging Face with
// Electron stubbed out. Downloads ~1 GB into a temp folder and deletes it afterwards.
//
//   npx esbuild tools/eval/download-test.ts --bundle --platform=node --format=esm \
//       --outfile=tools/eval/download-test.mjs --alias:electron=./tools/eval/electron-stub.ts \
//       --external:node-llama-cpp && node tools/eval/download-test.mjs

import fs from 'fs';
import path from 'path';
import os from 'os';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wavescribe-dl-'));
process.env.TEST_USERDATA = userData;

const { downloadModel, cancelDownload, getModelPath, isModelDownloaded, OPEN_MODELS } = await import('../../electron/llm');

const meta = OPEN_MODELS.find(m => m.id === 'qwen-2.5-1.5b')!;
const part = getModelPath(meta.filename) + '.part';
const mb = (n: number) => (n / 1048576).toFixed(0) + ' MB';

try {
    // 1) Start and cancel once ~60 MB has arrived.
    let cancelledAt = 0;
    try {
        await downloadModel(meta.id, (p) => {
            if (!cancelledAt && p.loadedBytes > 60 * 1048576) {
                cancelledAt = p.loadedBytes;
                cancelDownload();
            }
        });
        console.log('FAIL: download finished before it could be cancelled');
        process.exit(1);
    } catch (err: any) {
        console.log(`1) cancelled after ~${mb(cancelledAt)}: "${err.message}"`);
    }
    const partial = fs.statSync(part).size;
    console.log(`   partial file kept: ${mb(partial)} (${partial > 0 ? 'OK' : 'MISSING'})`);

    // 2) Resume and run to completion, which also verifies the checksum.
    let firstLoaded = -1;
    let sawVerifying = false;
    const t0 = Date.now();
    await downloadModel(meta.id, (p) => {
        if (firstLoaded < 0) firstLoaded = p.loadedBytes;
        if (p.phase === 'verifying') sawVerifying = true;
    });
    console.log(`2) resumed: first progress at ${mb(firstLoaded)} (partial was ${mb(partial)}) -> ${firstLoaded >= partial ? 'RESUMED, not restarted' : 'RESTARTED FROM ZERO'}`);
    console.log(`   checksum verification ran: ${sawVerifying}`);
    console.log(`   finished in ${((Date.now() - t0) / 1000).toFixed(0)}s, isModelDownloaded=${isModelDownloaded(meta.id)}, size=${mb(fs.statSync(getModelPath(meta.filename)).size)}`);
} finally {
    fs.rmSync(userData, { recursive: true, force: true });
}
process.exit(0);
