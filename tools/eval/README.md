# Streaming dictation evaluation

Runs synthetic speech through the real phrase segmenter + streaming session and compares it
with decoding the whole clip after stop (the old behaviour): stop-to-text latency and word error rate.

```
npm run eval:build
powershell -File tools/eval/make-wav.ps1 -Text "your sentence here" -Out tools/eval/data/clip.wav
node tools/eval/run.mjs Xenova/whisper-base.en tools/eval/data/clip.wav "your sentence here"
```

Numbers are CPU/Node (onnxruntime-node); the app runs the same code on WASM/WebGPU in the renderer,
so absolute times differ but the single-pass vs streaming gap is what matters.
