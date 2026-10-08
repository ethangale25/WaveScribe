import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import crypto from 'crypto'
import { app } from 'electron'
import { detectHardware, HardwareProfile } from './hardware'
import { isFaithfulCleanup } from './fidelity'

export interface ModelMetadata {
    id: string
    name: string
    parameters: string
    quant: string
    sizeText: string
    approxBytes: number
    ramNeededText: string
    minTotalRamGb: number
    filename: string
    url: string
    tier: 'lightweight' | 'mid' | 'frontier'
    description: string
}

export const OPEN_MODELS: ModelMetadata[] = [
    {
        id: 'llama-3.2-1b',
        name: 'Llama 3.2 1B Instruct',
        parameters: '1B',
        quant: 'Q4_K_M',
        sizeText: '~800 MB',
        approxBytes: 800 * 1024 * 1024,
        ramNeededText: '~1.5 GB RAM',
        minTotalRamGb: 4,
        filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
        tier: 'lightweight',
        description: 'Meta’s newest ultra-fast lightweight model. Lightning quick on all PCs.'
    },
    {
        id: 'qwen-2.5-1.5b',
        name: 'Qwen 2.5 1.5B Instruct',
        parameters: '1.5B',
        quant: 'Q4_K_M',
        sizeText: '~986 MB',
        approxBytes: 986 * 1024 * 1024,
        ramNeededText: '~1.8 GB RAM',
        minTotalRamGb: 4,
        filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
        url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
        tier: 'lightweight',
        description: 'Alibaba’s 1.5B model. Strong general chat, coding, and dictation cleanup.'
    },
    {
        id: 'deepseek-r1-1.5b',
        name: 'DeepSeek R1 Distill Qwen 1.5B',
        parameters: '1.5B',
        quant: 'Q4_K_M',
        sizeText: '~1.1 GB',
        approxBytes: 1100 * 1024 * 1024,
        ramNeededText: '~2.0 GB RAM',
        minTotalRamGb: 6,
        filename: 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf',
        tier: 'lightweight',
        description: 'DeepSeek’s breakthrough chain-of-thought reasoning distilled into 1.5B.'
    },
    {
        id: 'llama-3.2-3b',
        name: 'Llama 3.2 3B Instruct',
        parameters: '3B',
        quant: 'Q4_K_M',
        sizeText: '~2.0 GB',
        approxBytes: 2000 * 1024 * 1024,
        ramNeededText: '~2.8 GB RAM',
        minTotalRamGb: 8,
        filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
        tier: 'lightweight',
        description: 'Meta’s 3B model. Outstanding balance of speed and knowledge.'
    },
    {
        id: 'phi-4-mini',
        name: 'Phi-4 Mini 3.8B Instruct',
        parameters: '3.8B',
        quant: 'Q4_K_M',
        sizeText: '~2.5 GB',
        approxBytes: 2500 * 1024 * 1024,
        ramNeededText: '~3.5 GB RAM',
        minTotalRamGb: 8,
        filename: 'Phi-4-mini-instruct-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/Phi-4-mini-instruct-GGUF/resolve/main/Phi-4-mini-instruct-Q4_K_M.gguf',
        tier: 'lightweight',
        description: 'Microsoft’s high-density reasoning, math, and logic model.'
    },
    {
        id: 'gemma-4-e2b',
        name: 'Gemma 2 2B Instruct',
        parameters: '2B',
        quant: 'Q4_K_M',
        sizeText: '~1.5 GB',
        approxBytes: 1500 * 1024 * 1024,
        ramNeededText: '~2.2 GB RAM',
        minTotalRamGb: 4,
        filename: 'gemma-4-e2b-it-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
        tier: 'lightweight',
        description: 'Google’s efficient 2B Gemma 2 model for rapid local inference on any PC.'
    },
    {
        id: 'gemma-4-e4b',
        name: 'Gemma 2 2B Instruct (High Quality)',
        parameters: '2B',
        quant: 'Q8_0',
        sizeText: '~2.8 GB',
        approxBytes: 2780 * 1024 * 1024,
        ramNeededText: '~3.6 GB RAM',
        minTotalRamGb: 8,
        filename: 'gemma-4-e4b-it-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q8_0.gguf',
        tier: 'lightweight',
        description: 'The same Gemma 2 2B at 8-bit precision: closer to full quality, with a larger footprint.'
    },
    {
        id: 'gemma-2-9b',
        name: 'Gemma 2 9B Instruct',
        parameters: '9B',
        quant: 'Q4_K_M',
        sizeText: '~5.8 GB',
        approxBytes: 5800 * 1024 * 1024,
        ramNeededText: '~6.8 GB RAM',
        minTotalRamGb: 12,
        filename: 'gemma-2-9b-it-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/gemma-2-9b-it-GGUF/resolve/main/gemma-2-9b-it-Q4_K_M.gguf',
        tier: 'mid',
        description: 'Google’s high-performing 9B architecture with exceptional general knowledge and instruction following.'
    },
    {
        id: 'gemma-4-12b',
        name: 'Gemma 2 9B Instruct (High Quality)',
        parameters: '9B',
        quant: 'Q6_K',
        sizeText: '~7.6 GB',
        approxBytes: 7600 * 1024 * 1024,
        ramNeededText: '~8.8 GB RAM',
        minTotalRamGb: 15,
        filename: 'gemma-4-12b-it-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/gemma-2-9b-it-GGUF/resolve/main/gemma-2-9b-it-Q6_K.gguf',
        tier: 'frontier',
        description: 'Gemma 2 9B at 6-bit precision for the best quality this family offers on a 16 GB PC.'
    },
    {
        id: 'qwen-2.5-7b',
        name: 'Qwen 2.5 7B Instruct',
        parameters: '7B',
        quant: 'Q4_K_M',
        sizeText: '~4.7 GB',
        approxBytes: 4700 * 1024 * 1024,
        ramNeededText: '~5.5 GB RAM',
        minTotalRamGb: 12,
        filename: 'qwen2.5-7b-instruct-q4_k_m.gguf',
        url: 'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf',
        tier: 'mid',
        description: 'State-of-the-art 7B benchmark leader. Exceptional coding & reasoning.'
    },
    {
        id: 'llama-3.1-8b',
        name: 'Llama 3.1 8B Instruct',
        parameters: '8B',
        quant: 'Q4_K_M',
        sizeText: '~4.9 GB',
        approxBytes: 4900 * 1024 * 1024,
        ramNeededText: '~5.8 GB RAM',
        minTotalRamGb: 12,
        filename: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
        tier: 'mid',
        description: 'Meta’s standard-setting 8B instruction model with broad knowledge.'
    },
    {
        id: 'deepseek-r1-7b',
        name: 'DeepSeek R1 Distill Qwen 7B',
        parameters: '7B',
        quant: 'Q4_K_M',
        sizeText: '~4.7 GB',
        approxBytes: 4700 * 1024 * 1024,
        ramNeededText: '~5.5 GB RAM',
        minTotalRamGb: 12,
        filename: 'DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf',
        tier: 'mid',
        description: 'DeepSeek R1 reasoning distilled into Qwen 7B architecture.'
    },
    {
        id: 'qwen-2.5-14b',
        name: 'Qwen 2.5 14B Instruct',
        parameters: '14B',
        quant: 'Q4_K_M',
        sizeText: '~9.0 GB',
        approxBytes: 9000 * 1024 * 1024,
        ramNeededText: '~10.0 GB RAM',
        minTotalRamGb: 15,
        filename: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf',
        tier: 'frontier',
        description: 'Frontier-class 14B reasoning & coding. Fits comfortably on 16 GB PCs.'
    },
    {
        id: 'deepseek-r1-14b',
        name: 'DeepSeek R1 Distill Qwen 14B',
        parameters: '14B',
        quant: 'Q4_K_M',
        sizeText: '~9.0 GB',
        approxBytes: 9000 * 1024 * 1024,
        ramNeededText: '~10.0 GB RAM',
        minTotalRamGb: 15,
        filename: 'DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf',
        tier: 'frontier',
        description: 'Frontier reasoning model with deep chain-of-thought analysis for 16 GB machines.'
    },
    {
        id: 'phi-4-14b',
        name: 'Phi-4 14B Instruct',
        parameters: '14B',
        quant: 'Q4_K_M',
        sizeText: '~9.1 GB',
        approxBytes: 9100 * 1024 * 1024,
        ramNeededText: '~10.2 GB RAM',
        minTotalRamGb: 15,
        filename: 'Phi-4-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/phi-4-GGUF/resolve/main/phi-4-Q4_K_M.gguf',
        tier: 'frontier',
        description: 'Microsoft’s flagship 14B synthetic reasoning model. High density performance.'
    }
]

export type LlmStatus = 'not-downloaded' | 'downloading' | 'loading' | 'ready' | 'error'

export interface ModelCatalogItem extends ModelMetadata {
    isDownloaded: boolean
    downloadProgress: number
    isActive: boolean
    isCompatible: boolean
    compatibilityReason: string
}

let activeModelId: string = 'qwen-2.5-1.5b'
let status: LlmStatus = 'not-downloaded'
let activeDownloadModelId: string | null = null
let downloadProgress = 0
let downloadLoadedBytes = 0
let downloadTotalBytes = 0
let errorMessage = ''

let llama: any = null
let model: any = null
let ctx: any = null
let activeChatSession: any = null

// Dedicated context + sequence for dictation cleanup, created once per loaded model. Creating a
// context for every dictation cost 100-200ms each time.
let cleanupCtx: any = null
let cleanupSeq: any = null
let cleanupQueue: Promise<unknown> = Promise.resolve()

/** Selects which model initLlm() should prefer (e.g. the user's last choice from a previous run). */
export function setPreferredModel(modelId: string): void {
    if (OPEN_MODELS.some(m => m.id === modelId)) activeModelId = modelId
}

export function getModelDir(): string {
    const dir = path.join(app.getPath('userData'), 'models')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
}

export function getModelPath(filename: string): string {
    return path.join(getModelDir(), filename)
}

export function isModelDownloaded(modelIdOrFilename: string): boolean {
    const found = OPEN_MODELS.find(m => m.id === modelIdOrFilename || m.filename === modelIdOrFilename)
    const filename = found ? found.filename : modelIdOrFilename
    const p = getModelPath(filename)
    if (!fs.existsSync(p)) return false
    try {
        const stat = fs.statSync(p)
        const expected = found ? found.approxBytes * 0.7 : 400 * 1024 * 1024
        return stat.size > expected
    } catch {
        return false
    }
}

export function getModelCatalog(hardware?: HardwareProfile): ModelCatalogItem[] {
    const hw = hardware || detectHardware()
    return OPEN_MODELS.map(m => {
        const downloaded = isModelDownloaded(m.id)
        const isCompatible = hw.totalRamGb >= m.minTotalRamGb
        let compatibilityReason = `Requires ~${m.minTotalRamGb} GB RAM (Your PC: ${hw.totalRamGb} GB)`
        if (isCompatible) {
            compatibilityReason = `Optimal for your ${hw.totalRamGb} GB system`
        }

        return {
            ...m,
            isDownloaded: downloaded,
            downloadProgress: activeDownloadModelId === m.id ? downloadProgress : (downloaded ? 100 : 0),
            isActive: activeModelId === m.id && status === 'ready',
            isCompatible,
            compatibilityReason
        }
    })
}

export function getLlmStatus(): {
    status: LlmStatus
    activeModelId: string
    activeDownloadModelId: string | null
    progress: number
    loadedBytes: number
    totalBytes: number
    error: string
} {
    return {
        status,
        activeModelId,
        activeDownloadModelId,
        progress: downloadProgress,
        loadedBytes: downloadLoadedBytes,
        totalBytes: downloadTotalBytes,
        error: errorMessage
    }
}

export interface DownloadProgress {
    modelId: string
    percent: number
    loadedBytes: number
    totalBytes: number
    /** 'verifying' while the finished file's checksum is being checked. */
    phase?: 'downloading' | 'verifying'
}

interface DownloadState {
    req: http.ClientRequest | null
    cancelled: boolean
}

let activeDownload: DownloadState | null = null

/** Stops the running download. The partial file is kept so a later attempt resumes where it left off. */
export function cancelDownload(): boolean {
    if (!activeDownload) return false
    activeDownload.cancelled = true
    try { activeDownload.req?.destroy() } catch { }
    return true
}

/** GET that follows redirects, remembering the SHA-256 Hugging Face advertises for LFS files. */
function getFollowingRedirects(
    url: string,
    headers: Record<string, string>,
    state: DownloadState,
    seen: { sha256?: string } = {},
    redirects = 0
): Promise<{ res: http.IncomingMessage; sha256?: string }> {
    return new Promise((resolve, reject) => {
        if (state.cancelled) return reject(new Error('Download cancelled'))
        if (redirects > 8) return reject(new Error('Too many redirects'))

        const mod = url.startsWith('https') ? https : http
        const req = mod.get(url, { headers }, (res) => {
            const etag = String(res.headers['x-linked-etag'] || '').replace(/"/g, '')
            if (/^[0-9a-f]{64}$/i.test(etag)) seen.sha256 = etag.toLowerCase()

            if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                res.resume()
                const next = new URL(res.headers.location, url).toString()
                getFollowingRedirects(next, headers, state, seen, redirects + 1).then(resolve, reject)
                return
            }
            resolve({ res, sha256: seen.sha256 })
        })
        state.req = req
        req.on('error', (err) => reject(state.cancelled ? new Error('Download cancelled') : err))
    })
}

function sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256')
        const stream = fs.createReadStream(filePath)
        stream.on('data', (chunk) => hash.update(chunk))
        stream.on('error', reject)
        stream.on('end', () => resolve(hash.digest('hex')))
    })
}

export async function downloadModel(
    modelId: string,
    onProgress: (progress: DownloadProgress) => void
): Promise<void> {
    const meta = OPEN_MODELS.find(m => m.id === modelId)
    if (!meta) throw new Error(`Unknown model ID: ${modelId}`)

    const modelPath = getModelPath(meta.filename)
    if (isModelDownloaded(modelId)) return
    if (activeDownload) throw new Error('Another download is already in progress')

    // Downloading a second model must not knock an already-loaded model out of 'ready'.
    const wasReady = status === 'ready'
    if (!wasReady) status = 'downloading'
    activeDownloadModelId = modelId
    downloadProgress = 0
    downloadLoadedBytes = 0
    downloadTotalBytes = meta.approxBytes
    errorMessage = ''

    const state: DownloadState = { req: null, cancelled: false }
    activeDownload = state
    const tempPath = modelPath + '.part'

    try {
        // Resume from a previous partial download when there is one.
        let existing = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0
        let { res, sha256 } = await getFollowingRedirects(meta.url, existing > 0 ? { Range: `bytes=${existing}-` } : {}, state)

        if (res.statusCode === 416) {
            // The partial file is not usable (already complete or corrupt): start over.
            res.resume()
            try { fs.unlinkSync(tempPath) } catch { }
            existing = 0
            ;({ res, sha256 } = await getFollowingRedirects(meta.url, {}, state))
        }

        let append = false
        if (res.statusCode === 206 && existing > 0) {
            append = true
        } else if (res.statusCode === 200) {
            existing = 0 // the server ignored the range request: rewrite from scratch
        } else {
            res.resume()
            throw new Error(`HTTP ${res.statusCode}`)
        }

        const remaining = parseInt(res.headers['content-length'] || '0', 10)
        const totalBytes = remaining > 0 ? existing + remaining : meta.approxBytes
        downloadTotalBytes = totalBytes
        let received = existing
        downloadLoadedBytes = received

        await new Promise<void>((resolve, reject) => {
            const fileStream = fs.createWriteStream(tempPath, { flags: append ? 'a' : 'w' })

            res.on('data', (chunk: Buffer) => {
                received += chunk.length
                downloadLoadedBytes = received
                const pct = Math.min(100, Math.round((received / totalBytes) * 100))
                // Emit once per percent, not once per network chunk.
                if (pct !== downloadProgress) {
                    downloadProgress = pct
                    onProgress({ modelId, percent: pct, loadedBytes: received, totalBytes, phase: 'downloading' })
                }
            })
            res.on('error', (err) => reject(state.cancelled ? new Error('Download cancelled') : err))
            // The connection closing before the response completed means cancel or a dropped link.
            res.on('close', () => {
                if (!res.complete) {
                    fileStream.destroy()
                    reject(new Error(state.cancelled ? 'Download cancelled' : 'Connection lost during download (it will resume next time)'))
                }
            })
            fileStream.on('error', reject)
            fileStream.on('finish', () => resolve())
            // pipe() applies backpressure, so a slow disk cannot balloon memory.
            res.pipe(fileStream)
        })

        // Check integrity against the checksum Hugging Face publishes for the file.
        if (sha256) {
            onProgress({ modelId, percent: 100, loadedBytes: received, totalBytes, phase: 'verifying' })
            const actual = await sha256File(tempPath)
            if (actual !== sha256) {
                try { fs.unlinkSync(tempPath) } catch { }
                throw new Error('Downloaded file failed its checksum. It was discarded; please try again.')
            }
        }

        if (fs.existsSync(modelPath)) fs.unlinkSync(modelPath)
        fs.renameSync(tempPath, modelPath)

        status = wasReady ? 'ready' : 'not-downloaded'
        downloadProgress = 100
        downloadLoadedBytes = received
        onProgress({ modelId, percent: 100, loadedBytes: received, totalBytes, phase: 'downloading' })
    } catch (err: any) {
        const cancelled = state.cancelled
        if (!wasReady) status = cancelled ? 'not-downloaded' : 'error'
        errorMessage = cancelled ? '' : (err?.message || String(err))
        downloadProgress = 0
        throw err
    } finally {
        activeDownload = null
        activeDownloadModelId = null
    }
}

export function deleteModel(modelId: string): boolean {
    const meta = OPEN_MODELS.find(m => m.id === modelId)
    if (!meta) return false
    if (activeModelId === modelId) {
        disposeLlm()
    }
    const modelPath = getModelPath(meta.filename)
    try {
        if (fs.existsSync(modelPath)) fs.unlinkSync(modelPath)
        const partPath = modelPath + '.part'
        if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
        return true
    } catch (e) {
        console.error('Failed to delete model:', e)
        return false
    }
}

export async function loadModel(modelId: string): Promise<void> {
    const meta = OPEN_MODELS.find(m => m.id === modelId)
    if (!meta) throw new Error(`Model not found: ${modelId}`)

    if (!isModelDownloaded(modelId)) {
        throw new Error(`Model ${meta.name} is not downloaded yet.`)
    }

    try {
        disposeLlm()
        status = 'loading'
        errorMessage = ''
        activeModelId = modelId

        const { getLlama } = await import('node-llama-cpp')
        llama = await getLlama()
        model = await llama.loadModel({ modelPath: getModelPath(meta.filename) })
        ctx = await model.createContext({ contextSize: 4096, sequences: 4 })

        status = 'ready'
        // Pay the one-time context/kernel setup now (in the background) instead of during the
        // user's first dictation.
        void warmUpCleanup()
    } catch (err: any) {
        status = 'error'
        errorMessage = err.message || 'Failed to load LLM'
        throw err
    }
}

async function warmUpCleanup(): Promise<void> {
    if (isReasoningModel()) return
    try {
        await reformatText('okay thanks')
    } catch {
        // Warm-up is best effort only.
    }
}

export async function initLlm(onDownloadProgress?: (progress: { modelId: string; percent: number; loadedBytes: number; totalBytes: number }) => void): Promise<void> {
    // Prefer the model already selected, then any downloaded model, then the default.
    const downloaded = isModelDownloaded(activeModelId)
        ? OPEN_MODELS.find(m => m.id === activeModelId)
        : OPEN_MODELS.find(m => isModelDownloaded(m.id))
    const target = downloaded ? downloaded.id : activeModelId

    // Only download when the caller asked for it (the explicit Download button).
    if (!isModelDownloaded(target) && onDownloadProgress) {
        await downloadModel(target, onDownloadProgress)
    }
    await loadModel(target)
}

// Tuned against small (1B) models: this wording kept every dictated word (0% changed) on all test
// inputs, whereas a looser "fix errors" prompt rewrote 25-65% of a long dictation.
function buildSystemPrompt(surroundingContext?: string): string {
    let prompt = `You add punctuation and capitalization to dictated speech. Keep every word exactly as spoken, in the same order. Never summarize, rephrase, shorten, or drop words. Never change "I" to "you". Reply with the corrected text only.`

    if (surroundingContext && surroundingContext.trim().length > 0) {
        const trimmed = surroundingContext.slice(-400)
        prompt += `\n\nFor reference only, the text field already contains (do not repeat or answer it):\n"""${trimmed}"""`
    }

    return prompt
}

const REFORMAT_TIMEOUT_MS = 10000
const REFORMAT_MAX_INPUT_CHARS = 5000

/** Reasoning models write chain-of-thought into their output; unusable for in-place cleanup. */
function isReasoningModel(): boolean {
    return activeModelId.startsWith('deepseek-r1')
}

async function ensureCleanupSequence(): Promise<any> {
    if (!cleanupCtx || cleanupCtx.disposed) {
        cleanupCtx = await model.createContext({ contextSize: 4096 })
        cleanupSeq = cleanupCtx.getSequence()
    }
    return cleanupSeq
}

function resetCleanupContext(): void {
    try { cleanupCtx?.dispose() } catch { }
    cleanupCtx = null
    cleanupSeq = null
}

export function reformatText(rawText: string, surroundingContext?: string): Promise<string> {
    // One cleanup at a time: they share a single sequence.
    const run = cleanupQueue.then(() => reformatTextNow(rawText, surroundingContext), () => reformatTextNow(rawText, surroundingContext))
    cleanupQueue = run.catch(() => undefined)
    return run
}

async function reformatTextNow(rawText: string, surroundingContext?: string): Promise<string> {
    if (status !== 'ready' || !model || isReasoningModel()) {
        return rawText
    }
    // Very long dictations would not fit the cleanup context; paste them as dictated.
    if (rawText.length > REFORMAT_MAX_INPUT_CHARS) {
        return rawText
    }

    const { LlamaChatSession } = await import('node-llama-cpp')

    let session: any = null
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), REFORMAT_TIMEOUT_MS)
    try {
        const seq = await ensureCleanupSequence()
        session = new LlamaChatSession({
            contextSequence: seq,
            systemPrompt: buildSystemPrompt(surroundingContext)
        })

        // Output is roughly the same length as the input, so size the budget from the input
        // (the old fixed 256 tokens truncated anything past ~190 words).
        const maxTokens = Math.min(2048, Math.ceil(rawText.length / 2.5) + 48)

        // The signal really stops generation, unlike racing a timer against a running prompt.
        const response: string = await session.prompt(rawText, {
            maxTokens,
            temperature: 0.1,
            signal: abort.signal
        })

        const cleaned = response.trim()

        // Reject empty, runaway or visibly truncated output and keep the dictated text.
        if (!cleaned || cleaned.length < rawText.length * 0.6 || cleaned.length > rawText.length * 3) {
            return rawText
        }

        // Cleanup may punctuate and fix a slip, but must not rewrite what was said.
        if (!isFaithfulCleanup(rawText, cleaned)) {
            console.warn('[LLM] Cleanup changed too many words; keeping the original text')
            return rawText
        }

        return cleaned
    } catch (err) {
        if (abort.signal.aborted) {
            console.warn('[LLM] Reformat timed out, using original text')
        } else {
            console.error('[LLM] Inference error:', err)
        }
        // The sequence may be in an undefined state after an abort/error; start clean next time.
        resetCleanupContext()
        return rawText
    } finally {
        clearTimeout(timer)
        try { session?.dispose({ disposeSequence: false }) } catch { }
        try { await cleanupSeq?.clearHistory() } catch { resetCleanupContext() }
    }
}

let activeChatAbortController: AbortController | null = null

export async function chatStream(
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
    onToken: (token: string) => void,
    signal?: { aborted: boolean }
): Promise<string> {
    if (status !== 'ready' || !model) {
        throw new Error('No LLM model is currently loaded.')
    }

    const { LlamaChatSession } = await import('node-llama-cpp')

    // Ensure context exists and has available sequences
    if (!ctx || ctx.disposed) {
        ctx = await model.createContext({ contextSize: 4096, sequences: 4 })
    }

    if (!activeChatSession) {
        let seq: any = null
        try {
            seq = ctx.getSequence()
        } catch (seqErr) {
            try { ctx?.dispose() } catch { }
            ctx = await model.createContext({ contextSize: 4096, sequences: 4 })
            seq = ctx.getSequence()
        }

        activeChatSession = new LlamaChatSession({
            contextSequence: seq,
            systemPrompt: 'You are WaveScribe AI, a helpful, precise, and friendly assistant powered by an open-source model running 100% locally on this device.'
        })
    }

    activeChatAbortController = new AbortController()
    const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || ''

    let fullResponse = ''
    try {
        await activeChatSession.prompt(lastUserMsg, {
            maxTokens: 2048,
            temperature: 0.7,
            signal: activeChatAbortController.signal,
            stopGenerationTrigger: () => {
                return !!(signal?.aborted || activeChatAbortController?.signal.aborted)
            },
            onTextChunk: (chunk: string) => {
                if (signal?.aborted || activeChatAbortController?.signal.aborted) return
                fullResponse += chunk
                onToken(chunk)
            }
        })
    } catch (err: any) {
        // If aborted, do not throw - return whatever tokens were produced so far
        if (err?.name === 'AbortError' || activeChatAbortController?.signal.aborted || signal?.aborted) {
            console.log('[LLM] Chat generation aborted by user.')
            return fullResponse
        }
        throw err
    } finally {
        activeChatAbortController = null
    }

    return fullResponse
}

export function clearChat(): void {
    if (activeChatAbortController) {
        try { activeChatAbortController.abort() } catch { }
        activeChatAbortController = null
    }
    if (activeChatSession) {
        try { activeChatSession.dispose() } catch { }
        activeChatSession = null
    }
}

export function abortChat(): void {
    if (activeChatAbortController) {
        try { activeChatAbortController.abort() } catch { }
        activeChatAbortController = null
    }
}

export function disposeLlm(): void {
    resetCleanupContext()
    try { activeChatSession?.dispose() } catch { }
    try { ctx?.dispose() } catch { }
    try { model?.dispose() } catch { }
    activeChatSession = null
    ctx = null
    model = null
    llama = null
    status = 'not-downloaded'
}
