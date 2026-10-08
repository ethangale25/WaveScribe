import os from 'os'
import { execSync } from 'child_process'

export interface HardwareProfile {
    totalRamGb: number
    freeRamGb: number
    totalRamBytes: number
    freeRamBytes: number
    cpuCores: number
    cpuModel: string
    gpuVramMb: number | null
    recommendedTier: 'lightweight' | 'mid' | 'frontier'
}

export function detectHardware(): HardwareProfile {
    const totalBytes = os.totalmem()
    const freeBytes = os.freemem()
    const totalRamGb = Math.round((totalBytes / (1024 * 1024 * 1024)) * 10) / 10
    const freeRamGb = Math.round((freeBytes / (1024 * 1024 * 1024)) * 10) / 10
    const cpus = os.cpus()
    const cpuCores = cpus?.length || 4
    const cpuModel = cpus?.[0]?.model || 'Processor'

    let gpuVramMb: number | null = null
    try {
        const out = execSync(
            'nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits',
            { timeout: 1500 }
        ).toString().trim()
        const mb = parseInt(out.split('\n')[0], 10)
        if (!isNaN(mb) && mb > 0) gpuVramMb = mb
    } catch {
        // Fallback or non-NVIDIA
    }

    // Determine recommended tier based on total system RAM
    let recommendedTier: 'lightweight' | 'mid' | 'frontier' = 'lightweight'
    if (totalRamGb >= 15) {
        recommendedTier = 'frontier' // 16GB+ comfortably runs up to 14B Q4
    } else if (totalRamGb >= 10) {
        recommendedTier = 'mid' // 12GB runs 7B-8B Q4
    } else {
        recommendedTier = 'lightweight' // 8GB runs 1B-4B Q4
    }

    return {
        totalRamGb,
        freeRamGb,
        totalRamBytes: totalBytes,
        freeRamBytes: freeBytes,
        cpuCores,
        cpuModel,
        gpuVramMb,
        recommendedTier
    }
}
