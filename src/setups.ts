// Chooses speech-model / device / AI-cleanup setups that suit the detected hardware.
// Pure logic (no DOM, no Electron) so it can be unit tested.
//
// The rules encode measurements taken in the real app with transformers.js 4.3.1
// (14 s clip, stop -> text, RTX 4090 laptop / 32 cores):
//   Moonshine tiny / base : CPU 0.2 s / 0.4 s       GPU 0.2 s / 0.4-0.5 s -> equal; CPU is lower risk
//   Whisper tiny / base   : CPU 1.3 s / 2.7 s       GPU 0.9 s / 1.2 s     -> GPU helps
//   Distil-small          : CPU ~21 s               GPU 1.5-1.8 s         -> unusable without a GPU
// (CPU figures for the larger Whisper models were measured on transformers.js 3.8.1.)

import { MODEL_VRAM_MB } from './models';

export interface HardwareInfo {
    totalRamGb: number;
    cpuCores: number;
    /** Dedicated GPU memory if known. */
    gpuVramMb: number | null;
    hasWebGpu: boolean;
    gpuName?: string | null;
}

export type DeviceChoice = 'auto' | 'cpu' | 'webgpu';
export type ResolvedDevice = 'cpu' | 'webgpu';

/** Result of the in-app speed test for one model: median decode time of the sample on each device. */
export interface SpeedSample {
    modelId: string;
    cpuMs: number | null;
    gpuMs: number | null;
}

export type ModelFamily = 'moonshine' | 'whisper' | 'distil';

export function modelFamily(modelId: string): ModelFamily {
    const id = modelId.toLowerCase();
    if (id.includes('moonshine')) return 'moonshine';
    if (id.includes('distil')) return 'distil';
    return 'whisper';
}

export interface DeviceRecommendation {
    device: ResolvedDevice;
    /** Short, user-facing explanation. */
    reason: string;
    /** True if this came from a measurement on this PC rather than a rule of thumb. */
    measured: boolean;
}

/** A GPU must be at least this much faster before it is preferred (the CPU path is the lower-risk one). */
const GPU_MARGIN = 0.85;

export function recommendDevice(modelId: string, hw: HardwareInfo, sample?: SpeedSample | null): DeviceRecommendation {
    if (!hw.hasWebGpu) {
        return { device: 'cpu', reason: 'No compatible GPU found', measured: false };
    }

    if (sample && sample.modelId === modelId && sample.cpuMs && sample.gpuMs) {
        if (sample.gpuMs <= sample.cpuMs * GPU_MARGIN) {
            return { device: 'webgpu', reason: `GPU is ${(sample.cpuMs / sample.gpuMs).toFixed(1)}× faster on this PC`, measured: true };
        }
        const ratio = sample.gpuMs / sample.cpuMs;
        return {
            device: 'cpu',
            reason: ratio > 1.15 ? `CPU is ${ratio.toFixed(1)}× faster on this PC` : 'CPU and GPU are about equal here',
            measured: true,
        };
    }

    const family = modelFamily(modelId);
    if (family === 'moonshine') {
        return { device: 'cpu', reason: 'Moonshine is just as fast on the CPU', measured: false };
    }

    // Whisper-family models: the GPU helps, provided the model fits in its memory.
    const needed = MODEL_VRAM_MB[modelId]?.auto ?? 0;
    if (hw.gpuVramMb !== null && needed > hw.gpuVramMb * 0.8) {
        return { device: 'cpu', reason: 'Model is too large for this GPU’s memory', measured: false };
    }
    return { device: 'webgpu', reason: family === 'distil' ? 'This model needs a GPU to be usable' : 'GPU speeds up Whisper models', measured: false };
}

export type SetupId = 'fast' | 'balanced' | 'precise';
export type Fit = 'great' | 'ok' | 'unavailable';

export interface Setup {
    id: SetupId;
    name: string;
    tagline: string;
    speechModel: string;
    speechModelName: string;
    device: ResolvedDevice;
    deviceReason: string;
    aiCleanup: boolean;
    /** Catalog id of the cleanup model, or null when AI cleanup is off. */
    llmModelId: string | null;
    llmModelName: string | null;
    fit: Fit;
    /** Why this fits (or does not fit) this PC. */
    fitNote: string;
    /** Typical time from stopping to text appearing. */
    typicalDelay: string;
}

export interface SetupPlan {
    setups: Setup[];
    recommendedId: SetupId;
}

export function buildSetups(hw: HardwareInfo, samples: SpeedSample[] = []): SetupPlan {
    const sampleFor = (id: string) => samples.find(s => s.modelId === id) ?? null;
    const weak = hw.totalRamGb < 8 || hw.cpuCores <= 4;

    // --- Fast: smallest speech model, no AI cleanup ---
    const fastModel = 'onnx-community/moonshine-tiny-ONNX';
    const fast: Setup = {
        id: 'fast',
        name: 'Fast',
        tagline: 'Text appears almost instantly. Basic cleanup only.',
        speechModel: fastModel,
        speechModelName: 'Moonshine Tiny',
        ...pickDevice(fastModel, hw, sampleFor(fastModel)),
        aiCleanup: false,
        llmModelId: null,
        llmModelName: null,
        fit: 'great',
        fitNote: 'Runs well on any PC',
        typicalDelay: '≈ 0.3 s',
    };

    // --- Balanced: accurate Moonshine plus AI cleanup ---
    const balancedModel = 'onnx-community/moonshine-base-ONNX';
    const balancedAi = hw.totalRamGb >= 6;
    const bigLlm = hw.totalRamGb >= 8; // Qwen3 4B needs ~3.5 GB; smaller PCs use the 1B model
    const balanced: Setup = {
        id: 'balanced',
        name: 'Balanced',
        tagline: balancedAi ? 'Fast and accurate, with AI punctuation cleanup.' : 'Fast and accurate.',
        speechModel: balancedModel,
        speechModelName: 'Moonshine Base',
        ...pickDevice(balancedModel, hw, sampleFor(balancedModel)),
        aiCleanup: balancedAi,
        llmModelId: balancedAi ? (bigLlm ? 'qwen3-4b-instruct' : 'llama-3.2-1b') : null,
        llmModelName: balancedAi ? (bigLlm ? 'Qwen3 4B' : 'Llama 3.2 1B') : null,
        fit: weak ? 'ok' : 'great',
        fitNote: weak ? 'Works, but may feel slower on this PC' : 'A good fit for this PC',
        typicalDelay: balancedAi ? '≈ 1 s' : '≈ 0.5 s',
    };

    // --- Precise: larger Whisper-family model on the GPU, bigger AI model when memory allows ---
    const preciseModel = 'distil-whisper/distil-small.en';
    const gpuOk = hw.hasWebGpu && (hw.gpuVramMb === null || hw.gpuVramMb >= 1500) && hw.totalRamGb >= 8;
    const preciseAi = hw.totalRamGb >= 8;
    const precise: Setup = {
        id: 'precise',
        name: 'Precise',
        tagline: 'Highest accuracy for tricky audio. A little slower.',
        speechModel: preciseModel,
        speechModelName: 'Distil Whisper Small',
        device: 'webgpu',
        deviceReason: 'This model needs a GPU to be usable',
        aiCleanup: preciseAi,
        llmModelId: preciseAi ? 'qwen3-4b-instruct' : null,
        llmModelName: preciseAi ? 'Qwen3 4B' : null,
        fit: gpuOk ? (hw.totalRamGb >= 16 ? 'great' : 'ok') : 'unavailable',
        fitNote: gpuOk ? 'Your GPU can run this' : (hw.hasWebGpu ? 'Needs more GPU or system memory' : 'Needs a compatible GPU'),
        typicalDelay: '≈ 2–3 s',
    };

    const recommendedId: SetupId = weak ? 'fast' : 'balanced';
    return { setups: [fast, balanced, precise], recommendedId };
}

function pickDevice(modelId: string, hw: HardwareInfo, sample: SpeedSample | null): Pick<Setup, 'device' | 'deviceReason'> {
    const rec = recommendDevice(modelId, hw, sample);
    return { device: rec.device, deviceReason: rec.reason };
}
