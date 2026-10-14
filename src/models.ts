// Speech-recognition model metadata used by the UI (sizes, VRAM estimates, defaults).

// Default for new profiles. Measured in the real app (14s clip, CPU): Moonshine Base returns the
// final text ~350ms after stop with near-perfect accuracy vs 1.3-2.7s for the Whisper models.
export const DEFAULT_MODEL_ID = 'onnx-community/moonshine-base-ONNX';

// Estimated VRAM (MB) each model needs per precision on WebGPU.
// 'auto' on WebGPU defaults to fp32, so it shares the fp32 estimate.
export const MODEL_VRAM_MB: Record<string, Record<string, number>> = {
  'Xenova/whisper-tiny.en':               { auto: 150, fp32: 150, fp16: 75,   int8: 40,  q8: 40   },
  'Xenova/whisper-base.en':               { auto: 290, fp32: 290, fp16: 145,  int8: 75,  q8: 75   },
  'Xenova/whisper-small.en':              { auto: 990, fp32: 990, fp16: 495,  int8: 250, q8: 250  },
  'distil-whisper/distil-small.en':       { auto: 500, fp32: 500, fp16: 250,  int8: 125, q8: 125  },
  'distil-whisper/distil-medium.en':      { auto: 1200, fp32: 1200, fp16: 600, int8: 300, q8: 300 },
  'distil-whisper/distil-large-v3':       { auto: 2800, fp32: 2800, fp16: 1400, int8: 700, q8: 700 },
  'onnx-community/moonshine-tiny-ONNX':   { auto: 150, fp32: 150, fp16: 75,   int8: 40,  q8: 40   },
  'onnx-community/moonshine-base-ONNX':   { auto: 350, fp32: 350, fp16: 175,  int8: 90,  q8: 90   },
};

// params: parameter count as shown in the picker; released: first publication (ISO date), for sorting.
export const MODEL_DETAILS: Record<string, { name: string; shortName: string; sizeText: string; approxBytes: number; params: string; released: string }> = {
  'Xenova/whisper-tiny.en': { name: 'Whisper Tiny', shortName: 'WHISPER-TINY', sizeText: '40 MB', approxBytes: 40 * 1024 * 1024, params: '39M', released: '2022-09-21' },
  'Xenova/whisper-base.en': { name: 'Whisper Base', shortName: 'WHISPER-BASE', sizeText: '75 MB', approxBytes: 75 * 1024 * 1024, params: '74M', released: '2022-09-21' },
  'Xenova/whisper-small.en': { name: 'Whisper Small', shortName: 'WHISPER-SMALL', sizeText: '250 MB', approxBytes: 250 * 1024 * 1024, params: '244M', released: '2022-09-21' },
  'distil-whisper/distil-small.en': { name: 'Distil Small', shortName: 'DISTIL-SMALL', sizeText: '125 MB', approxBytes: 125 * 1024 * 1024, params: '166M', released: '2023-12-07' },
  'distil-whisper/distil-medium.en': { name: 'Distil Medium', shortName: 'DISTIL-MED', sizeText: '300 MB', approxBytes: 300 * 1024 * 1024, params: '394M', released: '2023-11-01' },
  'distil-whisper/distil-large-v3': { name: 'Distil Large', shortName: 'DISTIL-LARGE', sizeText: '750 MB', approxBytes: 750 * 1024 * 1024, params: '756M', released: '2024-03-21' },
  'onnx-community/moonshine-tiny-ONNX': { name: 'Moonshine Tiny', shortName: 'MOONSHINE-TINY', sizeText: '40 MB', approxBytes: 40 * 1024 * 1024, params: '27M', released: '2024-10-21' },
  'onnx-community/moonshine-base-ONNX': { name: 'Moonshine Base', shortName: 'MOONSHINE-BASE', sizeText: '90 MB', approxBytes: 90 * 1024 * 1024, params: '61M', released: '2024-10-21' },
};

export async function isHfModelDownloaded(modelId: string): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open('transformers-cache');
    const requests = await cache.keys();
    // A model is downloaded if cache contains an onnx file for this model
    return requests.some(req => req.url.includes(modelId) && req.url.includes('.onnx'));
  } catch (err) {
    return false;
  }
}
