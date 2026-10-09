import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

// ONNX Runtime's WebAssembly binary gets bundled automatically, but the app serves its own copy from
// public/ort (needed for multi-threading), so the bundled duplicate is dropped (25 MB smaller).
const dropBundledOrtWasm = {
  name: 'drop-bundled-ort-wasm',
  apply: 'build' as const,
  generateBundle(_options: unknown, bundle: Record<string, unknown>) {
    for (const file of Object.keys(bundle)) {
      if (/assets\/ort-wasm-simd-threaded.*\.wasm$/.test(file)) delete bundle[file]
    }
  },
}

export default defineConfig({
  plugins: [
    dropBundledOrtWasm,
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['node-llama-cpp', 'koffi']
            }
          }
        }
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers', 'onnxruntime-web']
  }
})
