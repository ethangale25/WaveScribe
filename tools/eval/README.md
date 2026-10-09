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

## Driving the whole app

```
node tools/eval/drive-app.mjs <clip.wav> <clip-seconds> [--model=ID] [--device=cpu|webgpu] [--ai=1] [--repeat=N] [--ptt] [--queue-test] [--exe=path]
```

Launches the app with a fake microphone playing the clip, in a throw-away profile (your real settings,
history and stats are never touched) and with `WAVESCRIBE_NO_PASTE=1` (nothing is pasted). `--ptt` holds
the real global hotkey; `--queue-test` presses it while a dictation is still processing; `--exe` runs a
packaged build. Other tools: `llm-bench.mjs` / `llm-prompts.mjs` (AI cleanup speed and fidelity),
`download-test.ts` (cancel, resume and checksum against Hugging Face).

## Test windows only open on screen #1

Every tool that launches the app (`drive-app`, `screenshot-settings`, `probe`) passes
`WAVESCRIBE_TEST_DISPLAY_POINT` (see `display.mjs`). In that mode the app opens centred on
`\.\DISPLAY1` without taking focus, never shows the caret spinner or notifications, and the tool refuses
to launch if the display cannot be found or is the primary monitor. Override the monitor with
`WAVESCRIBE_TEST_DISPLAY`.
