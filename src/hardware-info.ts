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
