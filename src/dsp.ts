// Pure signal-processing helpers (no DOM/Electron access) so they can run in tests and workers.

export const SAMPLE_RATE = 16000;

// Speech detection thresholds (20ms window at 16kHz is 320 samples)
export const ENERGY_THRESHOLD = 0.0025; // RMS threshold for voice activity
export const MIN_PHRASE_SAMPLES = SAMPLE_RATE * 0.25; // Shortest phrase worth transcribing
export const MIN_SPEECH_WINDOWS = 6; // A phrase needs >=120ms of 20ms windows above threshold, else it is noise

const WINDOW_SAMPLES = 320; // 20ms at 16kHz

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
export function mergeChunks(chunks: Float32Array[], totalLength: number): Float32Array {
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }
    return merged;
}

/**
 * Energy-based Voice Activity Detection (VAD).
 * Trims leading and trailing silence from a 16kHz normalized Float32Array.
 */
export function applyVAD(
    float32: Float32Array,
    sampleRate: number = SAMPLE_RATE,
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

/**
 * Index of the quietest ~80ms stretch within the last `searchSamples` of the buffer. Cutting
 * there avoids slicing a word in half when the length cap forces a split.
 */
export function findQuietestCut(audio: Float32Array, searchSamples: number): number {
    const span = 4; // smooth over 4 windows (~80ms)
    const start = Math.max(0, audio.length - searchSamples);
    const count = Math.floor((audio.length - start) / WINDOW_SAMPLES);
    if (count <= span) return audio.length;

    const energies = new Float32Array(count);
    for (let w = 0; w < count; w++) {
        let sum = 0;
        const base = start + w * WINDOW_SAMPLES;
        for (let i = 0; i < WINDOW_SAMPLES; i++) sum += audio[base + i] * audio[base + i];
        energies[w] = sum;
    }

    let bestStart = 0;
    let bestEnergy = Infinity;
    for (let w = 0; w + span <= count; w++) {
        let e = 0;
        for (let k = 0; k < span; k++) e += energies[w + k];
        if (e < bestEnergy) { bestEnergy = e; bestStart = w; }
    }
    return start + (bestStart + span / 2) * WINDOW_SAMPLES;
}

/** Number of 20ms windows whose RMS is at or above the speech threshold. */
export function countSpeechWindows(audio: Float32Array): number {
    let n = 0;
    for (let i = 0; i + WINDOW_SAMPLES <= audio.length; i += WINDOW_SAMPLES) {
        let sum = 0;
        for (let j = i; j < i + WINDOW_SAMPLES; j++) sum += audio[j] * audio[j];
        if (Math.sqrt(sum / WINDOW_SAMPLES) >= ENERGY_THRESHOLD) n++;
    }
    return n;
}
