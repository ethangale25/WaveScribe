let activeDeviceId: string | null = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let microphoneSource: MediaStreamAudioSourceNode | null = null;
let scriptProcessor: ScriptProcessorNode | null = null;
let activeStream: MediaStream | null = null;

// Buffers for real-time PCM capture
let fullRecordingChunks: Float32Array[] = [];
let currentPhraseChunks: Float32Array[] = [];
let totalFullSamples = 0;
let totalPhraseSamples = 0;

// VAD State Machine for Pause Chunking
let isStreamingActive = false;
let onPhraseCallback: ((chunk: Float32Array) => void) | null = null;

// Speech detection thresholds (20ms window at 16kHz is 320 samples)
const ENERGY_THRESHOLD = 0.0025; // RMS threshold for voice activity
const MIN_SPEECH_SAMPLES = 16000 * 0.45; // Minimum ~450ms speech before considering a pause
const PAUSE_SILENCE_SAMPLES = 16000 * 0.38; // ~380ms silence constitutes a sentence break
const MAX_PHRASE_SAMPLES = 16000 * 6.5; // Max 6.5s per chunk to prevent buffer buildup

let consecutiveSilenceSamples = 0;
let phraseHasSpeech = false;

// Speech span within the full recording (in samples), so the speech duration is known without
// merging and VAD-trimming the whole recording again at stop time.
let firstSpeechSample = -1;
let lastSpeechEndSample = 0;

export function setAudioDevice(deviceId: string | null) {
    activeDeviceId = deviceId;
}

/**
 * Downsample arbitrary sample rate (e.g. 44.1k/48k) to 16kHz mono Float32Array.
 */
function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
    if (inputSampleRate === 16000) return input;
    const ratio = inputSampleRate / 16000;
    const newLength = Math.round(input.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetInput = 0;
    while (offsetResult < result.length) {
        const nextOffsetInput = Math.round((offsetResult + 1) * ratio);
        let accum = 0;
        let count = 0;
        for (let i = offsetInput; i < nextOffsetInput && i < input.length; i++) {
            accum += input[i];
            count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetInput = nextOffsetInput;
    }
    return result;
}

/**
 * Normalizes peak amplitude of a 16kHz Float32Array to 0.9 for optimal ASR.
 */
export function normalizeAudio(floatData: Float32Array): Float32Array {
    if (!floatData || floatData.length === 0) return floatData;
    let maxAmp = 0;
    for (let i = 0; i < floatData.length; i++) {
        const abs = Math.abs(floatData[i]);
        if (abs > maxAmp) maxAmp = abs;
    }
    if (maxAmp > 0.0001 && maxAmp < 0.9) {
        const scale = 0.9 / maxAmp;
        const normalized = new Float32Array(floatData.length);
        for (let i = 0; i < floatData.length; i++) {
            normalized[i] = floatData[i] * scale;
        }
        return normalized;
    }
    return floatData;
}

/**
 * Concatenates an array of Float32Array chunks into a single Float32Array.
 */
function mergeChunks(chunks: Float32Array[], totalLength: number): Float32Array {
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }
    return merged;
}

export interface StartRecordingOptions {
    onPhraseCompleted?: (chunk: Float32Array) => void;
    enableStreaming?: boolean;
}

/**
 * Starts direct 16kHz PCM audio stream recording with real-time VAD pause detection.
 */
export async function startRecording(options?: StartRecordingOptions): Promise<void> {
    let stream: MediaStream;

    if (activeDeviceId) {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: activeDeviceId } }
            });
        } catch (err) {
            console.warn(`[Audio] Saved mic unavailable (${(err as Error).name}); falling back to default.`);
            activeDeviceId = null;
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
    } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    activeStream = stream;

    // Reset recording buffers & state
    fullRecordingChunks = [];
    currentPhraseChunks = [];
    totalFullSamples = 0;
    totalPhraseSamples = 0;
    consecutiveSilenceSamples = 0;
    phraseHasSpeech = false;
    firstSpeechSample = -1;
    lastSpeechEndSample = 0;

    isStreamingActive = options?.enableStreaming ?? true;
    onPhraseCallback = options?.onPhraseCompleted ?? null;

    // Initialize AudioContext at 16kHz (or fallback native sample rate)
    try {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    } catch {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const contextSampleRate = audioContext.sampleRate;

    // Analyser node for real-time waveform visualization
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    microphoneSource = audioContext.createMediaStreamSource(stream);
    microphoneSource.connect(analyser);

    // Direct 16kHz PCM stream capture node (4096 samples buffer = ~85ms at 48kHz, ~256ms at 16kHz)
    const bufferSize = 4096;
    scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);

    scriptProcessor.onaudioprocess = (event) => {
        const rawInput = event.inputBuffer.getChannelData(0);
        if (!rawInput || rawInput.length === 0) return;

        // Downsample to 16kHz if needed
        const pcm16k = contextSampleRate === 16000 ? new Float32Array(rawInput) : downsampleTo16k(rawInput, contextSampleRate);
        if (pcm16k.length === 0) return;

        // Save to full recording history
        const frameStartSample = totalFullSamples;
        fullRecordingChunks.push(pcm16k);
        totalFullSamples += pcm16k.length;

        // Save to current active phrase buffer
        currentPhraseChunks.push(pcm16k);
        totalPhraseSamples += pcm16k.length;

        // Calculate RMS of this frame for real-time VAD
        let sumSq = 0;
        for (let i = 0; i < pcm16k.length; i++) {
            sumSq += pcm16k[i] * pcm16k[i];
        }
        const frameRms = Math.sqrt(sumSq / pcm16k.length);

        if (frameRms >= ENERGY_THRESHOLD) {
            if (firstSpeechSample < 0) firstSpeechSample = frameStartSample;
            lastSpeechEndSample = frameStartSample + pcm16k.length;
            phraseHasSpeech = true;
            consecutiveSilenceSamples = 0;
        } else {
            consecutiveSilenceSamples += pcm16k.length;
        }

        // Check if a phrase completed during streaming (natural pause or max length cap)
        if (isStreamingActive && onPhraseCallback && phraseHasSpeech && totalPhraseSamples >= MIN_SPEECH_SAMPLES) {
            const isPauseBoundary = consecutiveSilenceSamples >= PAUSE_SILENCE_SAMPLES;
            const isMaxCapReached = totalPhraseSamples >= MAX_PHRASE_SAMPLES;

            if (isPauseBoundary || isMaxCapReached) {
                // Cut and dispatch this phrase
                const phraseData = mergeChunks(currentPhraseChunks, totalPhraseSamples);
                const trimmedPhrase = applyVAD(phraseData, 16000, 20, ENERGY_THRESHOLD);
                const normalizedPhrase = normalizeAudio(trimmedPhrase);

                if (normalizedPhrase.length >= 16000 * 0.3) {
                    console.log(`[Audio Streaming] Dispatched phrase chunk: ${(normalizedPhrase.length / 16000).toFixed(2)}s`);
                    try {
                        onPhraseCallback(normalizedPhrase);
                    } catch (cbErr) {
                        console.warn('[Audio Streaming] Phrase callback error:', cbErr);
                    }
                }

                // Reset phrase accumulation
                currentPhraseChunks = [];
                totalPhraseSamples = 0;
                consecutiveSilenceSamples = 0;
                phraseHasSpeech = false;
            }
        }
    };

    microphoneSource.connect(scriptProcessor);
    // Connect to destination to ensure scriptProcessor events fire in Chromium
    scriptProcessor.connect(audioContext.destination);
}

/**
 * Returns the current time-domain byte data from the microphone.
 * Returns null if not recording.
 */
export function getVisualizerData(): Uint8Array | null {
    if (!analyser) return null;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);
    return dataArray;
}

export interface StopRecordingResult {
    /** Normalized, VAD-trimmed full recording. Empty unless `includeFull` was requested. */
    fullAudio: Float32Array;
    trailingAudio: Float32Array;
    /** Speech duration in seconds (first to last speech frame). */
    durationSec: number;
    /** True if any audio at all was captured. */
    hadAudio: boolean;
}

export interface StopRecordingOptions {
    /** Merge + VAD + normalize the full recording. Only needed when not using streaming transcription. */
    includeFull?: boolean;
}

/**
 * Stops recording, tears down audio nodes, and returns both the uncommitted trailing phrase and the full recording Float32 PCM.
 */
export async function stopRecordingDirect(options?: StopRecordingOptions): Promise<StopRecordingResult> {
    const includeFull = options?.includeFull ?? true;
    // Teardown audio graph
    if (scriptProcessor) {
        try { scriptProcessor.disconnect(); } catch (_) { }
        scriptProcessor.onaudioprocess = null;
        scriptProcessor = null;
    }
    if (microphoneSource) {
        try { microphoneSource.disconnect(); } catch (_) { }
        microphoneSource = null;
    }
    if (audioContext) {
        try { await audioContext.close(); } catch (_) { }
        audioContext = null;
    }
    analyser = null;

    if (activeStream) {
        try {
            activeStream.getTracks().forEach(t => t.stop());
        } catch (_) { }
        activeStream = null;
    }

    onPhraseCallback = null;
    isStreamingActive = false;

    // Merge trailing phrase chunk
    const trailingAudio = totalPhraseSamples > 0
        ? normalizeAudio(applyVAD(mergeChunks(currentPhraseChunks, totalPhraseSamples), 16000, 20, ENERGY_THRESHOLD))
        : new Float32Array(0);

    const hadAudio = totalFullSamples > 0;

    // Merging, VAD-trimming and normalizing the whole recording is wasted work when streaming
    // already transcribed it phrase by phrase, so it is opt-in.
    let fullAudio: Float32Array = new Float32Array(0);
    let durationSec: number;
    if (includeFull && hadAudio) {
        fullAudio = normalizeAudio(applyVAD(mergeChunks(fullRecordingChunks, totalFullSamples), 16000, 20, ENERGY_THRESHOLD));
        durationSec = fullAudio.length / 16000;
    } else {
        // Same quantity VAD trimming would leave (speech span plus its 60ms padding each side).
        durationSec = firstSpeechSample >= 0
            ? (lastSpeechEndSample - firstSpeechSample) / 16000 + 0.12
            : 0;
    }

    // Clear buffer arrays
    fullRecordingChunks = [];
    currentPhraseChunks = [];
    totalFullSamples = 0;
    totalPhraseSamples = 0;

    return {
        fullAudio,
        trailingAudio,
        durationSec,
        hadAudio
    };
}

/**
 * Legacy stopRecording adapter that returns ArrayBuffer for backwards compatibility.
 */
export async function stopRecording(): Promise<ArrayBuffer> {
    const result = await stopRecordingDirect();
    return result.fullAudio.buffer as ArrayBuffer;
}

/**
 * Helper to turn an ArrayBuffer (from WebM/WAV/PCM) into a Float32Array at 16000Hz.
 */
export async function decodeAudioBuffer(buffer: ArrayBuffer): Promise<Float32Array> {
    if (!buffer || buffer.byteLength === 0) {
        return new Float32Array(0);
    }

    // If already raw Float32Array buffer
    if (buffer.byteLength % 4 === 0) {
        const view = new Float32Array(buffer);
        if (view.length > 0) {
            return normalizeAudio(view);
        }
    }

    let ctx: AudioContext | null = null;
    try {
        ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const audioBuffer = await ctx.decodeAudioData(buffer);
        const floatData = audioBuffer.getChannelData(0);
        return normalizeAudio(floatData);
    } catch (err) {
        console.warn('[Audio] Could not decode audio data:', err);
        return new Float32Array(0);
    } finally {
        if (ctx) {
            try { await ctx.close(); } catch (_) { }
        }
    }
}

/**
 * Energy-based Voice Activity Detection (VAD).
 * Trims leading and trailing silence from a 16kHz normalized Float32Array.
 */
export function applyVAD(
    float32: Float32Array,
    sampleRate: number = 16000,
    windowMs: number = 20,
    energyThreshold: number = 0.002
): Float32Array {
    if (!float32 || float32.length === 0) return float32;

    const windowSize = Math.round(sampleRate * windowMs / 1000);
    const padSamples = Math.round(sampleRate * 0.06); // 60ms safety padding
    let firstSpeech = -1;
    let lastSpeech = -1;

    for (let i = 0; i + windowSize <= float32.length; i += windowSize) {
        let sumSq = 0;
        for (let j = i; j < i + windowSize; j++) {
            sumSq += float32[j] * float32[j];
        }
        const rms = Math.sqrt(sumSq / windowSize);
        if (rms >= energyThreshold) {
            if (firstSpeech === -1) firstSpeech = i;
            lastSpeech = i + windowSize;
        }
    }

    if (firstSpeech === -1) return float32;

    const start = Math.max(0, firstSpeech - padSamples);
    const end = Math.min(float32.length, lastSpeech + padSamples);
    return float32.slice(start, end);
}
