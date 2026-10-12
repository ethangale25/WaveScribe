// Plain-language verdicts for the local AI model pickers: will a model run well on this PC, does it
// fit on the graphics card, and which one we recommend for the job.

export type LlmPurpose = 'chat' | 'cleanup';
export type LlmFit = 'great' | 'slow' | 'too-big';

export interface LlmModelInfo {
  id: string;
  parameters: string; // e.g. "3.8B"
  approxBytes: number;
}

export interface LlmHardware {
  totalRamGb: number;
  gpuVramMb: number | null;
}

export interface LlmFitResult {
  fit: LlmFit;
  /** null when the graphics card's memory is unknown. */
  fitsOnGpu: boolean | null;
  memoryGb: number;
}

const GIB = 1024 * 1024 * 1024;

// Best first. Reasoning (DeepSeek R1) models are left out: they think out loud before answering,
// which is slow for chat and unusable for cleanup.
const CHAT_RANKING = [
  'qwen-2.5-14b', 'phi-4-14b', 'gemma-4-12b', 'gemma-2-9b', 'llama-3.1-8b', 'qwen-2.5-7b',
  'qwen3-4b-instruct', 'phi-4-mini', 'llama-3.2-3b', 'gemma-4-e4b', 'gemma-4-e2b', 'qwen-2.5-1.5b', 'llama-3.2-1b',
];
// Cleanup must keep every word and finish within a second or two, so bigger is not better here.
const CLEANUP_RANKING = ['qwen3-4b-instruct', 'qwen-2.5-1.5b', 'llama-3.2-1b'];

export function isReasoningModel(id: string): boolean {
  return id.startsWith('deepseek-r1');
}

export function assessLlmFit(model: LlmModelInfo, hw: LlmHardware): LlmFitResult {
  // Weights plus the 4K-token context and runtime overhead.
  const memoryGb = model.approxBytes / GIB + 0.8;
  const vramGb = hw.gpuVramMb ? hw.gpuVramMb / 1024 : null;
  // Leave headroom for the desktop and other apps using the graphics card.
  const fitsOnGpu = vramGb === null ? null : memoryGb <= vramGb * 0.85;

  let fit: LlmFit;
  if (fitsOnGpu) fit = 'great';
  else if (memoryGb > hw.totalRamGb * 0.7) fit = 'too-big';
  // On the processor alone, models up to ~4B still answer at a comfortable reading speed.
  else fit = parseFloat(model.parameters) <= 4 ? 'great' : 'slow';

  return { fit, fitsOnGpu, memoryGb };
}

export function rankFor(purpose: LlmPurpose, id: string): number {
  const list = purpose === 'chat' ? CHAT_RANKING : CLEANUP_RANKING;
  const i = list.indexOf(id);
  return i === -1 ? list.length : i;
}

/** The best model for the purpose that runs well here, falling back to the smallest that runs at all. */
export function recommendLlm(purpose: LlmPurpose, models: LlmModelInfo[], hw: LlmHardware): string | null {
  const ranking = purpose === 'chat' ? CHAT_RANKING : CLEANUP_RANKING;
  const byId = new Map(models.map(m => [m.id, m]));
  const fitOf = (id: string) => byId.has(id) ? assessLlmFit(byId.get(id)!, hw).fit : 'too-big';
  return ranking.find(id => fitOf(id) === 'great')
    ?? [...ranking].reverse().find(id => fitOf(id) !== 'too-big')
    ?? null;
}

export function fitLabel(fit: LlmFit): string {
  return fit === 'great' ? 'Runs great' : fit === 'slow' ? 'Slow on this PC' : 'Too big for this PC';
}
