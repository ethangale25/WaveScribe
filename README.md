# WaveScribe

Local, private voice dictation for Windows. Press a hotkey, talk, press it again, and the text is
pasted into whatever app you were using. Speech recognition and the optional AI cleanup both run
on your machine; no audio leaves it.

## Features

- **Global hotkey** (default `Ctrl+Shift+Space`) works in any app; optional **push-to-talk** (hold to dictate)
- **Streaming transcription**: speech is decoded phrase by phrase while you talk, so text appears
  almost immediately after you stop
- **Live preview** of the decoded text in the status line / island while recording
- **Local speech models**: Moonshine and (distil-)Whisper via transformers.js, on a multi-threaded CPU or WebGPU
- **Three ready-made setups** (Fast, Balanced, Precise) picked for your PC's RAM, cores and GPU, and a **Test my PC** speed test that recommends CPU or GPU for the selected model (Processor: Auto)
- **Optional AI cleanup**: a local LLM fixes punctuation and speech-to-text slips
- **Local AI chat** with downloadable open models, sized to your hardware
- Filler-word removal, dictionary replacements, auto-capitalization and punctuation
- Dictation history, usage stats, mini "island" mode, system tray (closing the window keeps the hotkey alive)

## Develop

Double-click `run.bat` (installs on first run, then starts the app), or:

```
npm install
npm run dev        # Vite + Electron
npx tsc --noEmit   # typecheck
```

## Build the installer

```
npm run build      # vite build + electron-builder (NSIS installer in release/)
```

## Releasing

Push a version tag and GitHub Actions builds the installer and publishes it to GitHub Releases:

```
# bump "version" in package.json first
git tag v1.0.1 && git push origin v1.0.1
```

Installed copies check Releases every few hours, download updates in the background and install
them when the app quits (`electron/updater.ts`; skipped in dev).

## How dictation works

1. `src/audio.ts` captures 16 kHz mono audio and feeds `src/segmenter.ts`, which splits it into
   phrases at natural pauses. If someone talks for 6.5 s without a pause, it cuts at the quietest
   point instead of mid-word.
2. Each phrase goes to `StreamingTranscriptionSession` (`src/transcribe.ts`), which decodes one
   phrase at a time while recording continues.
3. When you stop, only the final fragment is left to decode. `src/stitch.ts` then joins the phrases:
   at a forced cut it removes the false full stop the model added and lowercases the continuation.
4. Filler removal, dictionary, capitalization and (optionally) the local LLM run, then the text is
   pasted with a native `SendInput` call (`electron/win32.ts`).

## Tests and measuring changes

`npm test` runs the unit tests (stitcher, AI-cleanup fidelity gate, segmenter, post-processing).

`tools/eval` runs synthetic speech through the real pipeline and reports stop-to-text latency and
word error rate against decoding the whole clip in one pass, and can drive the whole app (fake
microphone, real key presses, throw-away profile). See `tools/eval/README.md`.

## Project notes

- `AUDIT.md` lists known issues and the remaining roadmap.
- Settings and history are stored with `electron-store` in your user profile.
- Licensed under the terms in `LICENSE.txt`.
