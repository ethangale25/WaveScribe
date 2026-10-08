// Detects what this PC can do, combining the main process (RAM, cores, GPU memory/name) with what
// the renderer can see (whether a WebGPU adapter is actually available).

import type { HardwareInfo } from './setups';

let cached: Promise<HardwareInfo> | null = null;

async function hasUsableWebGpu(): Promise<boolean> {
    try {
        const gpu = (navigator as any).gpu;
        if (!gpu) return false;
        return (await gpu.requestAdapter()) !== null;
    } catch {
        return false;
    }
}

export function getHardwareInfo(): Promise<HardwareInfo> {
    if (!cached) {
        cached = (async () => {
            const hw = await window.electronAPI?.getHardwareProfile?.();
            return {
                totalRamGb: hw?.totalRamGb ?? 8,
                cpuCores: hw?.cpuCores ?? 4,
                gpuVramMb: hw?.gpuVramMb ?? null,
                gpuName: hw?.gpuName ?? null,
                hasWebGpu: await hasUsableWebGpu(),
            };
        })();
    }
    return cached;
}

/** One line for the Settings screen, e.g. "32 GB RAM · 16 cores · NVIDIA GeForce RTX 4090 (16 GB)". */
export function describeHardware(hw: HardwareInfo): string {
    const parts = [`${Math.round(hw.totalRamGb)} GB RAM`, `${hw.cpuCores} cores`];
    if (hw.hasWebGpu) {
        const mem = hw.gpuVramMb ? ` (${Math.round(hw.gpuVramMb / 1024)} GB)` : '';
        parts.push(`${hw.gpuName || 'GPU'}${mem}`);
    } else {
        parts.push('No GPU acceleration');
    }
    return parts.join(' · ');
}
