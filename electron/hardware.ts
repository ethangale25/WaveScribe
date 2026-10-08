import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface HardwareProfile {
    totalRamGb: number
    freeRamGb: number
    totalRamBytes: number
    freeRamBytes: number
    cpuCores: number
    cpuModel: string
    gpuVramMb: number | null
    gpuName: string | null
    recommendedTier: 'lightweight' | 'mid' | 'frontier'
}

// The GPU is probed once, asynchronously (nvidia-smi can take seconds on some machines and must
// never block the main process or the hotkey).
let cachedVramMb: number | null = null
let cachedGpuName: string | null = null
let vramProbe: Promise<number | null> | null = null

export function probeGpuVram(): Promise<number | null> {
    if (vramProbe) return vramProbe
    vramProbe = (async () => {
        // NVIDIA: accurate dedicated VRAM
        try {
            const { stdout } = await execAsync(
                'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
                { timeout: 3000 }
            )
            const [name, mem] = stdout.trim().split('\n')[0].split(',').map(p => p.trim())
            const mb = parseInt(mem, 10)
            if (!isNaN(mb) && mb > 0) {
                cachedGpuName = name || null
                return (cachedVramMb = mb)
            }
        } catch { /* not NVIDIA or nvidia-smi not in PATH */ }

        // Others via WMI. AdapterRAM is a 32-bit DWORD, so it saturates near 4 GB.
        try {
            const { stdout } = await execAsync(
                'powershell -NoProfile -Command "$g = Get-CimInstance Win32_VideoController | ' +
                'Where-Object {$_.AdapterRAM -gt 0} | Sort-Object AdapterRAM -Descending | ' +
                'Select-Object -First 1; Write-Output ($g.Name + \'|\' + $g.AdapterRAM)"',
                { timeout: 5000 }
            )
            const [name, ram] = stdout.trim().split('|')
            const bytes = parseInt(ram, 10)
            if (!isNaN(bytes) && bytes > 0) {
                cachedGpuName = name?.trim() || null
                return (cachedVramMb = Math.round(bytes / (1024 * 1024)))
            }
        } catch { /* WMI unavailable */ }

        return null
    })()
    return vramProbe
}

export function detectHardware(): HardwareProfile {
    const totalBytes = os.totalmem()
    const freeBytes = os.freemem()
    const totalRamGb = Math.round((totalBytes / (1024 * 1024 * 1024)) * 10) / 10
    const freeRamGb = Math.round((freeBytes / (1024 * 1024 * 1024)) * 10) / 10
    const cpus = os.cpus()
    const cpuCores = cpus?.length || 4
    const cpuModel = cpus?.[0]?.model || 'Processor'

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
        gpuVramMb: cachedVramMb,
        gpuName: cachedGpuName,
        recommendedTier
    }
}
