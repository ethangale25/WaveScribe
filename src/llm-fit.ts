// Plain-language verdicts for the model pickers: will a model run well with the memory that is free
// right now, does it fit in the graphics card's free memory, and which one we recommend for the job.

export type LlmPurpose = 'chat' | 'cleanup';
export type LlmFit = 'great' | 'slow' | 'too-big';

export interface LlmModelInfo {
  id: string;
  parameters: string; // e.g. "3.8B"
  /** Set when fewer parameters work per token than the total; that is what sets the speed. */
  activeParameters?: string;
  approxBytes: number;
}

export interface LoadedLlm {
  slot: LlmPurpose;
  id: string;
  gb: number;
  onGpu: boolean;
}

/** Memory free right now (not the machine's totals) and the models already holding some of it. */
export interface MemorySnapshot {
  freeRamGb: number;
  /** null when the AI engine runs without a GPU. */
  freeVramGb: number | null;
  loaded: LoadedLlm[];
}

export interface LlmFitResult {
  fit: LlmFit;
  /** null when there is no usable graphics card. */
  fitsOnGpu: boolean | null;
  memoryGb: number;
}

const GIB = 1024 * 1024 * 1024;
// Keep headroom: other apps and the desktop grow into free memory too.
const VRAM_HEADROOM = 0.9;
const RAM_HEADROOM = 0.85;

// Best first. Reasoning (DeepSeek R1) models are left out: they think out loud before answering,
// which is slow for chat and unusable for cleanup.
const CHAT_RANKING = [
  'gemma-4-26b-a4b', 'qwen3.5-9b', 'qwen-2.5-14b', 'phi-4-14b', 'gemma-4-e4b', 'gemma-2-9b-q6', 'gemma-2-9b',
  'llama-3.1-8b', 'qwen-2.5-7b', 'qwen3.5-4b', 'qwen3-4b-instruct', 'gemma-4-e2b', 'phi-4-mini', 'llama-3.2-3b',
  'gemma-2-2b-q8', 'gemma-2-2b', 'qwen-2.5-1.5b', 'llama-3.2-1b',
];
// Cleanup must keep every word and finish within a second or two, so bigger is not better here.
const CLEANUP_RANKING = ['qwen3-4b-instruct', 'qwen-2.5-1.5b', 'llama-3.2-1b'];

// Newer models not yet through the dictation-cleanup eval (tools/eval). Small models often reword
// dictations, so each one is offered for chat only until it has shown it keeps every word.
const UNTESTED_FOR_CLEANUP = new Set(['qwen3.5-4b', 'qwen3.5-9b', 'gemma-4-e2b', 'gemma-4-e4b', 'gemma-4-26b-a4b']);

export function isReasoningModel(id: string): boolean {
  return id.startsWith('deepseek-r1');
}

/** Models offered for chat but not for dictation cleanup. */
export function isChatOnly(id: string): boolean {
  return isReasoningModel(id) || UNTESTED_FOR_CLEANUP.has(id);
}

/** On the processor alone, models up to ~4B (working per token) answer at a comfortable reading speed. */
function runsFastOnCpu(model: LlmModelInfo): boolean {
  return parseFloat(model.activeParameters ?? model.parameters) <= 4;
}

/** Memory a model needs: its weights plus the 4K-token context and runtime overhead. */
export function llmMemoryGb(model: LlmModelInfo): number {
  return model.approxBytes / GIB + 0.8;
}

export function assessLlmFit(model: LlmModelInfo, purpose: LlmPurpose, mem: MemorySnapshot): LlmFitResult {
  const memoryGb = llmMemoryGb(model);

  // Already loaded (for this job or the other one): it is shared, so nothing more is needed.
  const already = mem.loaded.find(l => l.id === model.id);
  if (already) {
    const fit = already.onGpu || runsFastOnCpu(model) ? 'great' : 'slow';
    return { fit, fitsOnGpu: mem.freeVramGb === null ? null : already.onGpu, memoryGb };
  }

  // Switching this job's model frees whatever it holds now.
  const current = mem.loaded.find(l => l.slot === purpose);
  const vram = mem.freeVramGb === null ? null : mem.freeVramGb + (current?.onGpu ? current.gb : 0);
  const ram = mem.freeRamGb + (current && !current.onGpu ? current.gb : 0);

  const fitsOnGpu = vram === null ? null : memoryGb <= vram * VRAM_HEADROOM;
  let fit: LlmFit;
  if (fitsOnGpu) fit = 'great';
  else if (memoryGb > ram * RAM_HEADROOM) fit = 'too-big';
  else fit = runsFastOnCpu(model) ? 'great' : 'slow';

  return { fit, fitsOnGpu, memoryGb };
}

export function rankFor(purpose: LlmPurpose, id: string): number {
  const list = purpose === 'chat' ? CHAT_RANKING : CLEANUP_RANKING;
  const i = list.indexOf(id);
  return i === -1 ? list.length : i;
}

/** The best model for the job that runs well right now, falling back to the smallest that runs at all. */
export function recommendLlm(purpose: LlmPurpose, models: LlmModelInfo[], mem: MemorySnapshot): string | null {
  const ranking = purpose === 'chat' ? CHAT_RANKING : CLEANUP_RANKING;
  const byId = new Map(models.map(m => [m.id, m]));
  const fitOf = (id: string) => byId.has(id) ? assessLlmFit(byId.get(id)!, purpose, mem).fit : 'too-big';
  return ranking.find(id => fitOf(id) === 'great')
    ?? [...ranking].reverse().find(id => fitOf(id) !== 'too-big')
    ?? null;
}

export function fitLabel(fit: LlmFit): string {
  return fit === 'great' ? 'Runs great' : fit === 'slow' ? 'Slow right now' : 'Not enough free memory';
}

/** Verdict for a speech-to-text model on the device it would run on. */
export function assessSpeechFit(
  device: 'cpu' | 'webgpu',
  needsGpu: boolean,
  vramMb: number,
  hw: { hasWebGpu: boolean; freeVramGb: number | null },
): { fit: LlmFit; onGpu: boolean } {
  if (device === 'cpu') {
    // Models that need a GPU to be usable crawl on the CPU.
    return { fit: needsGpu ? 'slow' : 'great', onGpu: false };
  }
  if (!hw.hasWebGpu) return { fit: 'slow', onGpu: false };
  if (hw.freeVramGb !== null && vramMb / 1024 > hw.freeVramGb * VRAM_HEADROOM) return { fit: 'slow', onGpu: false };
  return { fit: 'great', onGpu: true };
}
