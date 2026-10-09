// Copies ONNX Runtime's WebAssembly loader and binary into public/ort so the app can serve them as
// real files. ONNX Runtime needs its own loader script to start helper threads for multi-core CPU
// decoding; when it is bundled into our worker the threads cannot start. Runs before dev/build.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const to = path.join(root, 'public', 'ort');
const files = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

fs.mkdirSync(to, { recursive: true });
for (const f of files) {
    const src = path.join(from, f);
    const dst = path.join(to, f);
    if (!fs.existsSync(src)) throw new Error(`Missing ${src}; run npm install first`);
    if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
}
console.log('[copy-ort] ONNX Runtime files ready in public/ort');
