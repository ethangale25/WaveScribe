# WaveScribe V1.0 — Software Audit & Action Plan

_Audit date: 2026-10-08. Scope: `electron/*`, `src/*`, build config, packaging, user flows._

Severity: **[C]** critical / user-visible breakage · **[H]** high · **[M]** medium · **[L]** low / polish

---

## Implementation status (updated after the first execution pass)

**Measured in the real app** (`tools/eval/drive-app.mjs`: fake microphone playing a 14 s clip, stopping right after the last word):

| Setup | Stop → text pasted |
|---|---|
| Original code (your settings), tail-drop bug patched in a test copy | 2.7–3.6 s (and one garbage result) |
| Original code, unpatched | ~1.2–1.4 s, but the **last sentence was missing** every time |
| Current code, your settings (whisper-tiny / WebGPU + AI cleanup) | ~1.5–1.6 s (2.7 s on a noisy run: WebGPU timing is bimodal) |
| Current code, Moonshine Base / CPU + AI cleanup | 0.8–1.35 s |
| Current code, Moonshine Base / CPU, no AI cleanup | ~0.35 s |

Speech-decode portion only, 14 s clip (all configs returned all 42 words): moonshine-tiny CPU 198 ms · moonshine-base CPU 349 ms ·
whisper-tiny CPU 1308 / WebGPU 959 ms · whisper-base CPU 2729 / WebGPU 1368 ms · moonshine-tiny WebGPU 733 ms · moonshine-base WebGPU 2330 ms.

**Done**
- §1 critical path: native `SendInput` paste (koffi), caret looked up at record start, paste before disk writes, settings read once, full-recording merge skipped when streaming, mic opened before the start sound, context capture in parallel
- §2.1 serialized inference · §2.3 inference in a Web Worker + `AudioWorklet` capture (this fixed **lost audio/words** on the CPU path) · §2.4 WASM no longer loaded from a CDN (offline first launch) · §2.6 forced cuts at the quietest point · §2.8 near-silence gate · §2.10 long-form Whisper options only for >30 s · §2.9 Moonshine token cap · §2.12 unified minimum lengths
- **New bug found and fixed:** `finalize()` set `isFinalized` before dispatching the trailing audio, so the **last phrase of every dictation was silently dropped**
- §3 "like" no longer treated as a filler · stitcher repairs seams and supplies missing full stops for punctuation-free models (Moonshine)
- §4 Download button downloads · truncation fixed · status no longer reset by downloads · real abort on timeout · persistent cleanup context · reasoning models skipped · strict prompt + word-level **fidelity gate** (a 1B model was rewriting 25–65% of long dictations) · selected model remembered · Gemma entries relabelled to what they really download · progress throttled
- §5 single-instance lock · close-to-tray · async cached GPU probe · installer 764 MB → 144 MB (transformers.js moved to devDependencies; arm64/CUDA natives excluded, Vulkan still accelerates NVIDIA/AMD/Intel)
- §6 hotkey/chat-dictation collision · record blocked until model loaded · XSS via `innerHTML` · model reload only when changed (old pipeline disposed) · safer hotkey presets
- Phase 0: git, `.gitignore`, stale Python-era files removed, README rewritten, timing logs, unit tests (`npm test`), evaluation tools in `tools/eval`
- New profiles default to Moonshine Base on CPU. **Existing profiles keep their settings** (yours is whisper-tiny on WebGPU; switching to Moonshine Base with GPU off is the largest remaining speed-up)

**Done in the second pass**
- AI cleanup runs phrase by phrase in the background while you talk (only the last phrase is cleaned at stop): Moonshine Base + AI 1.1-1.3 s -> 0.8-1.0 s, Moonshine Tiny + AI 0.93-1.13 s -> 0.6-0.77 s
- Push-to-talk (hold the hotkey; release to finish) · hotkey presses during processing are queued, not dropped · notice when the hotkey cannot be registered · clipboard restored with text, HTML, RTF and images
- Model downloads: resume from the partial file, Cancel button, backpressure, SHA-256 verification against Hugging Face's published checksum, visible error messages (verified against the real server: cancel -> resume from 69 MB -> checksum pass)
- Text post-processing and model tables extracted from `src/main.ts` into `src/postprocess.ts` and `src/models.ts`, with tests

**Third pass: setups, GPU recommendation, model research**
- Hardware-based setups (Fast / Balanced / Precise) and per-model CPU-vs-GPU recommendation, with an in-app speed test (`src/setups.ts`, `src/speedtest.ts`); Processor now defaults to Auto. Settings redesigned: grouped cards, shorter wording, removed the Voice Activity and Chunk Size controls (no effect since streaming became the only mode)
- **transformers.js 3.8.1 -> 4.3.1**: GPU decoding is much faster (Moonshine Base GPU 2.3 s -> 0.4-0.5 s; distil-small GPU 3.3 s -> 1.5-1.8 s); CPU speed unchanged
- Cleanup model: Qwen3-4B-Instruct-2507 gave the best punctuation with 0% changed words at ~0.55-0.72 s (as fast as a 1B model); added to the catalog and used by Balanced/Precise
- Decoder loops on truncated audio ("milk and milk and milk...") are now collapsed; quotation marks a model wraps around a phrase are stripped
- Tested and **not adopted**: Parakeet CTC 0.6B (fast but unreliable through this runtime: empty output on one pass, dropped a sentence on another), Gemma 3 1B (rewrote 145-210% of words), Whisper large-v3-turbo (too heavy for dictation latency)

**Packaged build** (installer 138 MB): click mode 0.82-0.84 s, push-to-talk 0.95 s (Moonshine Base + AI cleanup, 14 s clip).

**Not done yet**
- Decoding the open phrase while speaking (tentative text), seam re-decode, optional "accurate final" pass
- WASM threads (needs cross-origin isolation via a custom protocol) · onnxruntime-node/DirectML
- Fully splitting `src/main.ts` (still ~2,750 lines, mostly UI templates and closures over shared state)
- Your own profile still uses whisper-tiny on WebGPU; switching to Moonshine Base with GPU off is the biggest remaining speed-up
- One unexplained intermittent: a single 3-round driver run showed a round that never pasted (right after a heavy `npm ci`); many later runs were clean

---

## 1. Where the time goes today (stop → text appears)

When the user presses the hotkey to stop, this runs **in series**:

| # | Step | Where | Cost |
|---|------|-------|------|
| 1 | Spawn PowerShell + **compile C# with `Add-Type`** to find the caret for the spinner | `electron/main.ts:396-550` | PowerShell cold start plus a C# compile, on every dictation. It competes with ASR for CPU at exactly the wrong moment |
| 2 | Merge + VAD + normalize the **entire** recording, even though streaming already chunked it | `src/audio.ts:476-478` | Wasted work. The result is unused when streaming is on |
| 3 | `getSettings()` IPC round trip (three separate times in this function) | `src/main.ts:957, 977, 1004` | Small, but avoidable |
| 4 | Wait for every phrase chunk, then transcribe the trailing chunk | `src/transcribe.ts:190-210` | Chunks all run **at the same time** on one thread (see 2.1). For Whisper, each chunk pays for a full 30 s encoder pass (see 2.2) |
| 5 | LLM reformat: **creates a new context**, re-evaluates the system prompt, generates up to 256 tokens | `electron/llm.ts:498-537` | Context allocation and prompt evaluation on every dictation |
| 6 | Two `setSetting` disk writes (metrics, then the **whole** history array) | `src/main.ts:1050, 1084` | Disk I/O **before** the paste |
| 7 | Spawn PowerShell + **compile C# with `Add-Type`** again to send Ctrl+V, plus a 50 ms sleep | `electron/main.ts:218-285` | The same cold start + compile, on the critical path |

Steps 1, 2, 6 and 7 add latency without doing any transcription work. Fixing them is a quick win, separate from the streaming redesign.

**At the start of a recording (AI reformat on):** the start sound plays, **then** a PowerShell context capture runs (up to 2 s timeout), and only **then** does `getUserMedia` open the mic (`src/main.ts:1114-1151`). The user starts talking on the sound and **their first words are lost**.

---

## 2. Transcription pipeline: bugs & inefficiencies

### 2.1 [C] Phrase chunks are transcribed concurrently on one ONNX session
`StreamingTranscriptionSession.addPhraseChunk` (`src/transcribe.ts:155-174`) starts `transcribeAudio()` right away for every phrase, without waiting for the previous one. Several inferences then run against the same pipeline at once. At best they compete for the single renderer thread. At worst ORT-web refuses a concurrent run, and the error is **swallowed**: the chunk returns `''` and those **words silently disappear**.
→ Run chunks through a strict FIFO queue with one inference at a time.

### 2.2 [C] Whisper's cost does not shrink with chunk length
Whisper (and distil-whisper) pads every input to **30 s** before the encoder runs. A 2 s phrase therefore costs about the same encoder compute as 30 s of audio. Streaming in 10 small chunks costs roughly **10× the encoder work** of one 30 s pass. Moonshine was built to avoid this: its compute scales with audio length. → For the streaming path, default to **Moonshine Base**. Keep Whisper for an optional "accurate final pass" (§6).

### 2.3 [C] ASR runs on the renderer's main thread, and so does audio capture
transformers.js runs inside the renderer. The capture uses `ScriptProcessorNode` (`src/audio.ts:357`), which is deprecated and also runs on the main thread. While a chunk is being decoded, the main thread is blocked, so:
- `onaudioprocess` callbacks get delayed or dropped, and **audio gets lost during streaming**
- the waveform freezes and the UI stutters

→ Move ASR off the main thread (Electron `utilityProcess` or a Web Worker), and replace capture with an `AudioWorklet`.

### 2.4 [H] WASM runs single-threaded, and its binaries load from a CDN
- Nothing enables cross-origin isolation (no COOP/COEP headers, no `crossOriginIsolated`). That means ORT-web cannot use `SharedArrayBuffer` threads, so CPU inference runs on **one core**.
- transformers.js sets `wasmPaths` to `https://cdn.jsdelivr.net/...` by default (`node_modules/@huggingface/transformers/src/backends/onnx.js:211`). **On a first launch without internet, the app cannot load the model.**
- Better: run ASR in Node with **onnxruntime-node** (native, multi-threaded, and DirectML GPU on Windows). It is already in `node_modules` (208 MB) and is already shipped in the installer, but nothing uses it.

### 2.5 [H] Each chunk ends with a full stop, and context between chunks is lost
Each phrase is transcribed on its own, with no prompt and no prior text. Whisper treats each phrase as a complete utterance, so it capitalises the start and adds a period at the end: _"I went to the. Store and bought milk."_ `finalize()` just joins the pieces with spaces (`src/transcribe.ts:202-207`).
→ Needs a stitcher plus a prompt carried over from the previous chunk (§6).

### 2.6 [H] The max-length cap cuts mid-word
When `MAX_PHRASE_SAMPLES` (6.5 s) is reached, the phrase is cut at whatever sample it reached (`src/audio.ts:392-394`), which can split a word across two chunks so that both get misrecognised. → Cut at the quietest ~100 ms window in the last ~1.5 s, and overlap chunks by ~200 ms.

### 2.7 [H] VAD uses a fixed energy threshold
`ENERGY_THRESHOLD = 0.0025` (`src/audio.ts:230`) is a fixed value. With a noisy mic or fan, a "pause" never registers, so every chunk becomes a 6.5 s cap cut (see 2.6). With a quiet mic, phrases get trimmed too early.
→ Use an adaptive noise floor (track the 10th-percentile RMS), or **Silero VAD** (about 2 MB ONNX).

### 2.8 [M] Normalisation amplifies noise into hallucinations
`normalizeAudio` scales every chunk to 0.9 peak (`src/audio.ts:270-286`), so a cough or keyboard click becomes a loud input. Whisper and Moonshine then hallucinate on it ("Thank you.", "you"). The blocklist in `cleanTranscribedText` only catches a few such cases.
→ Skip chunks whose speech-frame ratio is below a minimum. Cap the gain (for example max 4×).

### 2.9 [M] Moonshine has no output-length cap
Moonshine can loop on short or noisy input. Pass `max_new_tokens ≈ ceil(seconds × 6) + 4`.

### 2.10 [M] Short chunks get Whisper's long-form settings
`transcribeAudio` always passes `chunk_length_s: 30, stride, return_timestamps: true` (`src/transcribe.ts:120-124`). For audio under 30 s this adds pipeline overhead (timestamp tokens, chunk bookkeeping) and no benefit. → Only set these when the audio is longer than 30 s.

### 2.11 [M] `getPartialText()` exists but is never used
The live partial text is computed but never shown (`src/transcribe.ts:179`). The user sees no text until the end.

### 2.12 [M] Mismatched minimum lengths
Phrases shorter than 0.3 s are dropped at dispatch (`src/audio.ts:400`), but the trailing chunk only needs 0.2 s (`src/transcribe.ts:193`). A short final "yes." can be dropped mid-session but kept at the end. → Use one constant.

### 2.13 [M] The phrase minimum counts total samples, not speech
`totalPhraseSamples >= MIN_SPEECH_SAMPLES` (`src/audio.ts:390`) counts leading silence too. → Count speech frames instead.

### 2.14 [M] Mic and AudioContext are rebuilt on every recording
`getUserMedia` and `new AudioContext` run on every start (`src/audio.ts:309-344`), which adds start latency (device open, and Bluetooth headsets switching profile). → Keep a warm stream for N minutes after the last use, with a ~300 ms pre-roll ring buffer so the first syllable is never cut.

### 2.15 [L] `decodeAudioBuffer` misreads encoded audio as raw floats
Any buffer whose byte length is a multiple of 4 is treated as raw Float32 PCM (`src/audio.ts:512`), which also catches WAV and WebM files. Only matters if diagnostics feeds it encoded audio.

---

## 3. Text post-processing

| Sev | Issue | Location |
|---|---|---|
| **H** | The filler list includes **"like"**, so "I like pizza" becomes "I pizza". Only remove "like" when it sits between commas or pauses, or drop it from the list | `src/main.ts:979` |
| M | Dictionary replacements run before capitalisation, so "gooey"→"GUI" works, but a replacement at the start of a sentence can then be re-capitalised oddly. Run auto-cap first, then dictionary | `src/main.ts:987-999` |
| M | Auto-punctuation adds a final "." even when the LLM step will run afterwards. The LLM then has to undo it | `src/main.ts:999-1021` |
| M | Filler removal leaves broken punctuation ("So, , we") | `src/main.ts:984` |
| L | "Time saved" counts typing time but does not subtract the time spent speaking. The articulation score is a rough heuristic | `src/main.ts:1029-1046` |

---

## 4. LLM (AI cleanup & chat)

| Sev | Issue | Location |
|---|---|---|
| **C** | **The "Download Model (~1 GB)" button never downloads.** It calls `llmInit()`, which only loads an already-downloaded model and throws "not downloaded yet" otherwise | `src/main.ts:1265-1282` → `electron/llm.ts:474-478` |
| **C** | **Long dictations get cut off.** `maxTokens: 256` stops output after ~190 words. The sanity check accepts any output ≥ 30% of the input length, so a truncated result gets **pasted in place of the full text** | `electron/llm.ts:519, 525` |
| **H** | After any download finishes, `status` is set to `'not-downloaded'`, even if another model is loaded and `'ready'`. **AI cleanup silently turns off** until restart | `electron/llm.ts:389` |
| **H** | The model catalog is mislabeled. "Gemma 4 E2B", "E4B" and "12B" download **Gemma 2** files (2B Q4, 2B Q8, 9B Q6_K) under Gemma 4 filenames | `electron/llm.ts:95-149` |
| **H** | A new context is created on every reformat, and the system prompt (with the field contents mixed in) is re-evaluated each time, so nothing in the KV cache gets reused | `electron/llm.ts:508-512` |
| **H** | The timeout does not stop generation. `Promise.race` returns after 10 s, but generation keeps running, and then `finally` disposes the context **during** generation | `electron/llm.ts:514-536` |
| H | The model the user picked is not remembered. On startup `initLlm()` loads the **first downloaded model in catalog order** | `electron/llm.ts:474-478`, `electron/main.ts:193-202` |
| M | DeepSeek-R1 distills write `<think>…</think>` text. If one is used for cleanup, its reasoning gets pasted into the user's document. Block reasoning models from cleanup, or strip the tags | `electron/llm.ts:52-65` |
| M | The text of the focused field goes into the **system prompt**. Text in a document (an email being replied to, for example) can steer the model, and the output is typed into the user's app. Put it in a delimited user-turn block marked "reference only" | `electron/llm.ts:490-493` |
| M | Download: no backpressure (the return value of `fileStream.write` is ignored), a progress IPC message for **every chunk** (thousands per second), no resume of `.part` files, no cancel, no checksum. Starting a second download overwrites the global progress state | `electron/llm.ts:341-426` |
| M | Chat: pressing Stop clears `isGeneratingChat` immediately, before generation finishes. Sending again right away calls `prompt()` on the same session while it is still busy | `src/main.ts:2431-2439` |
| L | Chat: the renderer sends the whole history, but only the last user message is used. The two histories drift apart after an abort | `electron/llm.ts:574` |

---

## 5. Electron main process, OS integration & packaging

| Sev | Issue | Location |
|---|---|---|
| **C** | **Text insertion compiles C# via PowerShell `Add-Type` on every paste.** Replace with a direct `SendInput` call through **koffi** (FFI, about 1 ms), or one persistent helper process that compiles once | `electron/main.ts:218-285` |
| **H** | The caret spinner does the same: a PowerShell spawn plus an `Add-Type` compile plus UI Automation on every stop, and it competes with ASR for CPU. Use the same persistent helper or koffi with `GetGUIThreadInfo`. Show the spinner at the mouse position immediately, then move it | `electron/main.ts:396-550` |
| **H** | Context capture writes a `.ps1` file and spawns PowerShell before the mic opens, which loses the first words (§1). Run it **in parallel** with mic start, using the persistent helper | `src/main.ts:1130-1139`, `electron/context-capture.ts` |
| **H** | **The installer is 764 MB (app.asar 845 MB).** `@node-llama-cpp` ships every GPU variant (712 MB: cuda, cuda-ext, vulkan, arm64). `onnxruntime-node` (208 MB) is shipped but unused. `@huggingface/transformers` is listed in `dependencies` although Vite bundles it. Exclude unused binaries through `files` globs, or download the right one on first run | `package.json` |
| H | No `app.requestSingleInstanceLock()`. A second instance fails to register the hotkey, and the user gets two tray icons | `electron/main.ts` |
| H | `execSync` **blocks the main process** for up to 6 s (`nvidia-smi` + WMI). It runs in `get-vram-mb` and in `detectHardware()`, which is called on **every** catalog request. The UI and hotkeys freeze. Use async `exec` and cache the result | `electron/main.ts:561-590`, `electron/hardware.ts:24-33`, `electron/llm.ts:284` |
| M | The clipboard restore only saves and restores **text**. A copied image or rich text is lost after a dictation. The 350 ms restore delay can also fire before slow apps (Office, RDP) have finished pasting | `electron/main.ts:222, 266-270` |
| M | Closing the window **quits the app** (`window-all-closed` → quit), although a tray icon exists. Users expect closing to send it to the tray so the hotkey keeps working | `electron/main.ts:209-211` |
| M | If the hotkey fails to register at startup, that is only logged to the console. The user sees "Ready", but the hotkey does nothing | `electron/main.ts:153-160` |
| M | `set-setting` calls `unregisterAll()`, which would also remove any other shortcut added later | `electron/main.ts:296` |
| M | IPC handlers accept arbitrary input (`set-window-bounds`, `set-setting` with any key). Low risk while the renderer is trusted, but should be validated | `electron/main.ts:292, 349` |
| L | Every renderer `console.log` is copied to main-process stdout | `electron/main.ts:136-138` |
| L | Google Fonts is loaded from the network, so the font falls back when offline. Bundle Inter locally | `index.html:9-11` |

---

## 6. User interaction & state bugs

| Sev | Issue | Location |
|---|---|---|
| **H** | Chat dictation and hotkey dictation **share the audio module's globals**. Pressing the global hotkey while chat-dictating starts a second capture over the first, leaks the first stream, and mixes the two sessions | `src/main.ts:2606-2677` vs `899-1180` |
| **H** | Hotkey presses during "Processing…" are **silently dropped** (`if (isProcessing) return`), so a quick stop→start loses the new dictation. Queue it, or show a "busy" state | `src/main.ts:904` |
| **H** | The hotkey **silently does nothing** while the Settings modal is open | `src/main.ts:901-902` |
| H | **Save & Apply always reloads the ASR model**, even when nothing changed, and never disposes the old pipeline. WebGPU and WASM memory leak on every save | `src/main.ts:1701`, `src/transcribe.ts:40` |
| H | Recording can start before the model has loaded. Every chunk then throws "Transcriber model not loaded", the error is swallowed, and the result is **an empty dictation with no message** | `src/main.ts:899`, `src/transcribe.ts:163-165` |
| M | **XSS / HTML injection:** history items and dictionary entries are inserted with `innerHTML` (`${item.text}`, `${pair.sound}`). If someone dictates or types `<img src=x onerror=…>`, the markup runs in the renderer, and the renderer has `electronAPI` (which includes `insertText`). Use `textContent` | `src/main.ts:684, 1395-1396` |
| M | The history list is fully re-rendered, and the **entire** history array is written to disk on every dictation (30 days of entries) | `src/main.ts:661-731, 1084` |
| M | Settings save makes about 14 sequential `setSetting` IPC calls, each a full JSON rewrite. Use a single batch call | `src/main.ts:1666-1704` |
| M | Preset hotkeys include **`Shift+Space`** (people type this constantly) and **`Ctrl+Space`** (Windows IME switching) | `src/main.ts:321-324` |
| M | No push-to-talk (hold to talk). `globalShortcut` has no key-up event, so this needs `uiohook-napi` | feature |
| M | No live text is shown while speaking. Show tentative text in the island and the record button (§7) | feature |
| L | The theme choice is not saved | `src/main.ts:733-741` |
| L | The chunk-size slider has no effect when streaming is on, which is always | `src/main.ts:959` |

---

## 7. Proposed algorithm: streaming dictation with a fast cohesion pass

### Goal
Text keeps up with the speaker while they talk. When they stop, the final text is pasted within **~300 ms** on typical hardware. Before pasting, a short pass fixes seams, casing and punctuation so the output reads as one piece instead of joined fragments.

### Architecture

```
 Mic ──► AudioWorklet (20 ms frames, 16 kHz) ──► Ring buffer + pre-roll (300 ms)
                                   │
                                   ▼
                         VAD (Silero or adaptive RMS)
                                   │  segment boundaries
                                   ▼
 ┌──────────────────── ASR worker (utilityProcess, onnxruntime-node / DirectML) ────────────────┐
 │  FIFO queue — exactly one inference at a time                                                  │
 │   • COMMIT jobs: closed segment → final text for that segment (with prev-text prompt)          │
 │   • TENTATIVE jobs: open segment, every ~700 ms when queue idle (lowest priority, droppable)    │
 └────────────────────────────────────────────────────────────────────────────────────────────────┘
                                   │ committed segments
                                   ▼
                    Stitcher (deterministic, <1 ms) ──► Live preview (island / button)
                                   │ complete sentences
                                   ▼
                    Background LLM polish (warm sequence) — optional
```

### Phase A — while the user is speaking
1. **Segmenting.** Close a segment after a pause of ≥ 300 ms. If a segment reaches 8 s, cut at the **quietest 100 ms window in its last 1.5 s**. Keep **200 ms of overlap** between neighbouring segments.
2. **Commit decoding.** Send each closed segment to the queue right away. For Whisper, pass the last ~200 characters of committed text as `prompt_ids`, so casing and continuity carry over. Moonshine does not take prompts; the stitcher covers it.
3. **Tentative decoding** (for the live preview). When the queue is idle, decode the open segment and show the result in grey. Cache the result together with the sample count it covered.
4. **Rolling polish.** Each committed segment goes through the stitcher. Whenever a sentence is complete (ends in `.?!` and the next segment has started), send it to the warm LLM sequence in the background. By the time the user stops, most sentences are already polished.

### Phase B — when the user stops (target ≤ 300 ms)
1. **Flush.** Close the open segment. If the cached tentative result covered exactly these samples, reuse it and skip decoding. Otherwise decode it. Because segments close on every pause, this tail is usually under 2 s, which is a small decode for Moonshine.
2. **Stitch** (deterministic):
   - **Overlap dedupe:** find the longest word-level suffix/prefix match within the overlap and drop the duplicate.
   - **Seam repair:** if the pause before a seam was under ~600 ms, drop the period ASR added at the end of the earlier segment and lowercase the first word of the next one (unless it is "I", or in the dictionary or proper-noun list).
   - Then filler removal, dictionary replacements, auto-capitalisation and punctuation, in that order.
3. **Verification at the seams** (the quick check you described):
   - Only for seams that were **forced cuts** (max length, not a pause): re-decode a ~3 s window centred on the seam and swap in its words for that region. This costs one short decode per forced cut, and usually there are none.
   - Only for the **unpolished tail** (the last sentence plus one sentence of context): one LLM call. The system prompt is fixed and its KV cache stays warm; `maxTokens = ceil(inputTokens × 1.3) + 16`; it can be aborted; the deadline is 600 ms. If the deadline passes, paste the stitched text.
4. **Paste right away** (koffi `SendInput`). Then **update history and metrics on disk afterwards, in the background.**

### Optional "Accurate final" mode (off by default)
When the user stops, decode the full recording with a larger model (distil-large-v3 or whisper-large-v3-turbo) **while the fast result is pasted**. If the accurate result differs, offer "Replace with refined version" from the island. Users who want maximum accuracy pay the wait; everyone else does not.

### Model guidance for streaming
- **Default:** Moonshine Base. Its compute scales with audio length, and it was designed for live transcription.
- **Whisper family:** only for the optional accurate pass, because each chunk pays for 30 s of encoder work (§2.2).
- **Worth evaluating later:** NVIDIA Parakeet-TDT 0.6B through `sherpa-onnx`, which is very fast on CPU, accurate in English, and gives word timestamps (for cleaner overlap dedupe).

---

## 8. Action plan

### Phase 0 — Prep (½ day)
- [ ] `git init` and commit the current state. The project is **not under version control**, and the next phases change a lot of code.
- [ ] Add `.gitignore` for `release/`, `dist/`, `dist-electron/`, `node_modules/`, logs.
- [ ] Delete stale artifacts: `build.log`, `builder_out.txt`, `out.txt`, `error.txt`, `test_hf.js`, `test_models.js`, `gui-preview.jsx`, `mnt/`, `scratch/`, and the 764 MB installer in `release/`. Replace `README.md`, which describes the old Python app.
- [ ] Add timing logs at each stage (stop → audio ready → ASR done → LLM done → paste) so the gains can be measured.

### Phase 1 — Quick wins, no algorithm change (1–2 days) — the biggest drop in latency per hour spent
1. Replace PowerShell paste with **koffi `SendInput`**. Replace caret lookup and context capture with koffi calls, or one persistent PowerShell helper that compiles once (§5).
2. Move `insertText` **before** the history and metrics writes; write those in the background.
3. Run context capture **in parallel** with mic start. Play the start sound only **after** the mic is open.
4. Skip the full-audio merge/VAD in `stopRecordingDirect` when streaming is on.
5. Make chunk transcription a **serial FIFO queue** (fixes lost words, §2.1).
6. Read settings once per dictation (cache them in the renderer and update on save).
7. Only use `return_timestamps` / `chunk_length_s` for audio longer than 30 s. Cap Moonshine's `max_new_tokens`.
8. Fix the critical bugs: the Download button (§4), LLM truncation (§4), status reset after download (§4), the "like" filler, XSS through `innerHTML`, and chat/hotkey sharing the audio state.

### Phase 2 — Engine relocation (2–4 days)
1. Move ASR into an Electron **utilityProcess** running transformers.js on **onnxruntime-node** (CPU multi-thread, DirectML on Windows). The renderer sends PCM frames and receives text events.
2. Replace `ScriptProcessorNode` with an **AudioWorklet**. Keep the mic warm, with a 300 ms pre-roll.
3. Bundle the ORT wasm locally, or drop it entirely once on onnxruntime-node, so the app works offline.
4. LLM: one persistent context with a dedicated cleanup sequence and a fixed system prompt (field context goes in the user turn), a real `AbortSignal` timeout, and output length scaled to the input.

### Phase 3 — Streaming + cohesion pass (3–5 days)
1. Adaptive or Silero VAD; smart cut points; 200 ms overlap.
2. Commit and tentative job types in the worker; live preview in the island and record button.
3. Stitcher: overlap dedupe, seam repair, then the existing post-processing in the correct order.
4. Seam re-decode for forced cuts; rolling LLM polish; LLM pass on the tail with a deadline.
5. Optional "Accurate final" mode.
6. Add a small **regression harness**: 10–20 recorded WAVs with reference transcripts. Report WER and stop→paste latency for each config (extend `src/diagnostics.ts`).

### Phase 4 — UX & hardening (2–3 days)
- Push-to-talk (`uiohook-napi`); queue or report hotkey presses made during processing; allow the hotkey while Settings is open; block recording until the model is ready, with a clear message.
- Single-instance lock; close to tray; warn on hotkey registration failure; remove `Shift+Space` and `Ctrl+Space` from the presets.
- Only reload the ASR model when the model or device changed, and dispose the old one first.
- Save rich clipboard formats and restore them; make the restore delay adaptive.
- Fix the LLM catalog (correct Gemma entries; mark R1 models as chat-only); downloads with backpressure, throttled progress, resume, cancel and SHA-256 checks; remember the selected model.
- Async hardware detection, cached.
- Packaging: drop unused native variants and `onnxruntime-node` duplicates, and move `@huggingface/transformers` to devDependencies. The target is an installer **well under 200 MB**.
- Split the 2,680-line `src/main.ts` into modules: `dictation.ts`, `settings-ui.ts`, `chat-ui.ts`, `history.ts`, `island.ts`.

### Expected outcome
- **Phase 1:** removes the PowerShell compiles and disk writes from the critical path and stops words from being lost.
- **Phases 2–3:** final text in about one short decode after the user stops, plus live text while they speak.
