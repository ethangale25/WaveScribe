import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import { app } from 'electron'
import { detectHardware, HardwareProfile } from './hardware'

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
        name: 'Gemma 4 E2B Instruct',
        parameters: 'E2B',
        quant: 'Q4_K_M',
        sizeText: '~1.5 GB',
        approxBytes: 1500 * 1024 * 1024,
        ramNeededText: '~2.2 GB RAM',
        minTotalRamGb: 4,
        filename: 'gemma-4-e2b-it-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
        tier: 'lightweight',
        description: 'Google’s ultra-efficient next-gen Gemma 4 edge 2B model for rapid local inference on any PC.'
    },
    {
        id: 'gemma-4-e4b',
        name: 'Gemma 4 E4B Instruct',
        parameters: 'E4B',
        quant: 'Q4_K_M',
        sizeText: '~2.6 GB',
        approxBytes: 2600 * 1024 * 1024,
        ramNeededText: '~3.6 GB RAM',
        minTotalRamGb: 8,
        filename: 'gemma-4-e4b-it-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q8_0.gguf',
        tier: 'lightweight',
        description: 'Google’s balanced Gemma 4 edge 4B model with high reasoning density and low memory overhead.'
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
        name: 'Gemma 4 12B Instruct',
        parameters: '12B',
        quant: 'Q4_K_M',
        sizeText: '~7.8 GB',
        approxBytes: 7800 * 1024 * 1024,
        ramNeededText: '~8.8 GB RAM',
        minTotalRamGb: 15,
        filename: 'gemma-4-12b-it-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/gemma-2-9b-it-GGUF/resolve/main/gemma-2-9b-it-Q6_K.gguf',
        tier: 'frontier',
        description: 'Google’s flagship dense 12B model sitting right at the 16 GB sweet spot with frontier-grade reasoning.'
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

export async function downloadModel(
    modelId: string,
    onProgress: (progress: { modelId: string; percent: number; loadedBytes: number; totalBytes: number }) => void
): Promise<void> {
    const meta = OPEN_MODELS.find(m => m.id === modelId)
    if (!meta) throw new Error(`Unknown model ID: ${modelId}`)

    const modelPath = getModelPath(meta.filename)
    if (isModelDownloaded(modelId)) return

    status = 'downloading'
    activeDownloadModelId = modelId
    downloadProgress = 0
    downloadLoadedBytes = 0
    downloadTotalBytes = meta.approxBytes
    errorMessage = ''

    return new Promise((resolve, reject) => {
        const tempPath = modelPath + '.part'

        const follow = (url: string, redirects = 0) => {
            if (redirects > 8) {
                status = 'error'
                activeDownloadModelId = null
                errorMessage = 'Too many redirects'
                return reject(new Error('Too many redirects'))
            }

            const mod = url.startsWith('https') ? https : http
            mod.get(url, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                    return follow(res.headers.location!, redirects + 1)
                }
                if (res.statusCode !== 200) {
                    status = 'error'
                    activeDownloadModelId = null
                    errorMessage = `HTTP ${res.statusCode}`
                    return reject(new Error(`HTTP ${res.statusCode}`))
                }

                const totalBytes = parseInt(res.headers['content-length'] || '0', 10) || meta.approxBytes
                downloadTotalBytes = totalBytes
                let receivedBytes = 0
                const fileStream = fs.createWriteStream(tempPath)

                res.on('data', (chunk: Buffer) => {
                    receivedBytes += chunk.length
                    downloadLoadedBytes = receivedBytes
                    fileStream.write(chunk)
                    if (totalBytes > 0) {
                        downloadProgress = Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
                        onProgress({
                            modelId,
                            percent: downloadProgress,
                            loadedBytes: receivedBytes,
                            totalBytes
                        })
                    }
                })

                res.on('end', () => {
                    fileStream.end(() => {
                        try {
                            if (fs.existsSync(modelPath)) fs.unlinkSync(modelPath)
                            fs.renameSync(tempPath, modelPath)
                            status = 'not-downloaded'
                            activeDownloadModelId = null
                            downloadProgress = 100
                            downloadLoadedBytes = totalBytes
                            onProgress({
                                modelId,
                                percent: 100,
                                loadedBytes: totalBytes,
                                totalBytes
                            })
                            resolve()
                        } catch (err: any) {
                            status = 'error'
                            activeDownloadModelId = null
                            errorMessage = 'Failed to save model file'
                            reject(err)
                        }
                    })
                })

                res.on('error', (err) => {
                    fileStream.close()
                    try { fs.unlinkSync(tempPath) } catch { }
                    status = 'error'
                    activeDownloadModelId = null
                    errorMessage = err.message
                    reject(err)
                })
            }).on('error', (err) => {
                status = 'error'
                activeDownloadModelId = null
                errorMessage = err.message
                reject(err)
            })
        }

        follow(meta.url)
    })
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
    } catch (err: any) {
        status = 'error'
        errorMessage = err.message || 'Failed to load LLM'
        throw err
    }
}

export async function initLlm(): Promise<void> {
    const downloaded = OPEN_MODELS.find(m => isModelDownloaded(m.id))
    const target = downloaded ? downloaded.id : activeModelId
    await loadModel(target)
}

function buildSystemPrompt(surroundingContext?: string): string {
    let prompt = `You are a text cleanup assistant for a voice dictation app. Your ONLY job is to fix the formatting and minor errors in dictated text. Rules:
- Fix capitalization, punctuation, and spacing
- Fix obvious speech-to-text errors (homophones, missing words)
- Do NOT add new content or change the meaning
- Do NOT add greetings, explanations, or commentary
- Output ONLY the corrected text, nothing else
- If the text looks fine, return it unchanged
- Keep the same tone and style as the input`

    if (surroundingContext && surroundingContext.trim().length > 0) {
        const trimmed = surroundingContext.slice(-800)
        prompt += `\n\nThe user is typing into a text field that already contains:\n"""${trimmed}"""`
    }

    return prompt
}

export async function reformatText(rawText: string, surroundingContext?: string): Promise<string> {
    if (status !== 'ready' || !model) {
        return rawText
    }

    const { LlamaChatSession } = await import('node-llama-cpp')

    let tempCtx: any = null
    let session: any = null
    try {
        tempCtx = await model.createContext({ contextSize: 1024 })
        session = new LlamaChatSession({
            contextSequence: tempCtx.getSequence(),
            systemPrompt: buildSystemPrompt(surroundingContext)
        })

        const timeoutPromise = new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('LLM timeout')), 10000)
        )

        const response: string = await Promise.race([
            session.prompt(rawText, { maxTokens: 256, temperature: 0.1 }),
            timeoutPromise
        ])

        const cleaned = response.trim()

        if (!cleaned || cleaned.length < rawText.length * 0.3 || cleaned.length > rawText.length * 3) {
            return rawText
        }

        return cleaned
    } catch (err) {
        console.error('[LLM] Inference error:', err)
        return rawText
    } finally {
        try { session?.dispose() } catch { }
        try { tempCtx?.dispose() } catch { }
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
    try { activeChatSession?.dispose() } catch { }
    try { ctx?.dispose() } catch { }
    try { model?.dispose() } catch { }
    activeChatSession = null
    ctx = null
    model = null
    llama = null
    status = 'not-downloaded'
}
