import './style.css'
import { startRecording, stopRecordingDirect, decodeAudioBuffer, setAudioDevice, getVisualizerData, applyVAD } from './audio';
import { DEFAULT_MODEL_ID, MODEL_VRAM_MB, MODEL_DETAILS, isHfModelDownloaded } from './models';
import { escapeHtml, removeFillers, applyDictionary, applyAutoFormatting, countWords } from './postprocess';
import { loadModel, transcribeAudio, isModelLoaded, getCurrentDevice, StreamingTranscriptionSession } from './transcribe';
import { initDiagnostics } from './diagnostics';
// @ts-ignore
import micIcon from '../assets/mic.svg'
// @ts-ignore
import minimodeIcon from '../assets/minimode.svg'
// @ts-ignore
import settingsIcon from '../assets/settings.svg'
// @ts-ignore
import waveIcon from '../assets/wave.svg'
// @ts-ignore
import chatIcon from '../assets/chat.svg'
// @ts-ignore
import downloadIcon from '../assets/download.svg'
// @ts-ignore
import boltIcon from '../assets/bolt.svg'
// @ts-ignore
import infoIcon from '../assets/information.svg'
// @ts-ignore
import stopIcon from '../assets/stop.svg'
// @ts-ignore
import startSoundFile from '../sounds/start.wav'
// @ts-ignore
import stopSoundFile from '../sounds/stop.wav'

export const checkmarkSvg = `<svg class="check-icon-svg" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--green, #238636); vertical-align: -1px; display: inline-block; flex-shrink: 0;"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5"/></svg>`;

declare global {
  interface Window {
    electronAPI: {
      insertText: (text: string) => Promise<{ success: boolean; error?: string }>
      getSettings: () => Promise<any>
      setSetting: (key: string, value: any) => Promise<any>
      checkHotkey: (hotkey: string) => Promise<{ registered: boolean }>
      onDictationHotkey: (callback: (action: 'toggle' | 'start' | 'stop') => void) => () => void
      windowControl: (action: 'minimize' | 'maximize' | 'close') => void
      copyText: (text: string) => Promise<{ success: boolean }>
      toggleMiniMode: (isMini: boolean) => Promise<{ success: boolean }>
      onWindowMaximized: (callback: (isMax: boolean) => void) => () => void
      setWindowBounds: (bounds: any) => Promise<{ success: boolean }>
      showCursorSpinner: () => Promise<{ success: boolean }>
      primeCaret: () => Promise<{ success: boolean }>
      hideCursorSpinner: () => Promise<{ success: boolean }>
      getVramMb: () => Promise<number | null>
      getHardwareProfile: () => Promise<{
        totalRamGb: number
        freeRamGb: number
        totalRamBytes: number
        freeRamBytes: number
        cpuCores: number
        cpuModel: string
        gpuVramMb: number | null
        recommendedTier: 'lightweight' | 'mid' | 'frontier'
      }>
      llmInit: (download?: boolean) => Promise<{ success: boolean; error?: string }>
      llmStatus: () => Promise<{
        status: string
        activeModelId: string
        activeDownloadModelId: string | null
        progress: number
        loadedBytes: number
        totalBytes: number
        error: string
      }>
      llmGetCatalog: () => Promise<Array<{
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
        isDownloaded: boolean
        downloadProgress: number
        isActive: boolean
        isCompatible: boolean
        compatibilityReason: string
      }>>
      llmDownloadModel: (modelId: string) => Promise<{ success: boolean; error?: string }>
      llmDeleteModel: (modelId: string) => Promise<{ success: boolean }>
      llmCancelDownload: () => Promise<{ success: boolean }>
      llmLoadModel: (modelId: string) => Promise<{ success: boolean; error?: string }>
      llmReformat: (text: string, context?: string) => Promise<{ success: boolean; text: string; error?: string }>
      llmChatSend: (messages: { role: 'user' | 'assistant' | 'system'; content: string }[]) => Promise<{ success: boolean; text?: string; error?: string }>
      llmChatAbort: () => Promise<{ success: boolean }>
      llmChatClear: () => Promise<{ success: boolean }>
      captureContext: () => Promise<{ success: boolean; text: string }>
      showNotification: (title: string, body: string) => Promise<{ success: boolean }>
      onLlmDownloadProgress: (callback: (progress: { modelId: string; percent: number; loadedBytes: number; totalBytes: number }) => void) => () => void
      onLlmChatToken: (callback: (token: string) => void) => () => void
    }
  }
}

// Check if electron API is injected
if (!window.electronAPI) {
  console.warn("Electron API not found - running in browser mode.");
}

const appElement = document.getElementById('app')

if (appElement) {
  appElement.innerHTML = `
    <div class="container theme-dark" id="theme-provider">
      <div class="titlebar">
        <div class="left-controls">
          <button class="win-btn island" id="win-island" title="Toggle Island Mode">
            <img src="${minimodeIcon}" width="17" height="17" />
          </button>
        </div>
        <div class="drag-region"></div>
        <div class="window-controls">
          <button class="win-btn minimize" id="win-minimize" title="Minimize Window">
            <svg viewBox="0 0 10 10" width="10" height="10"><path d="M0,5 L10,5" stroke="currentColor" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>
          </button>
          <button class="win-btn maximize" id="win-maximize" title="Maximize Window">
            <svg viewBox="0 0 10 10" width="10" height="10"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>
          </button>
          <button class="win-btn close" id="win-close" title="Close Window">
            <svg viewBox="0 0 10 10" width="10" height="10"><path d="M1,1 L9,9 M9,1 L1,9" stroke="currentColor" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>
          </button>
        </div>
      </div>

      <!-- Mini Island Widget -->
      <div id="mini-island" class="mini-island hidden">
        <div class="island-content">
          <div class="status-indicator" id="island-dot"></div>
          <div class="island-text" id="island-text">Ready</div>
        </div>
      </div>
      <!-- Dictation View (Speech to Text) -->
      <div id="dictation-view" class="app-view">
        <div class="header" style="margin-top: 15px;">
          <h1 id="wave-title" style="font-size: 34px; letter-spacing: -1px; margin-bottom: 0px; display: flex; align-items: center; justify-content: center; gap: 0px;">
            <img src="${waveIcon}" id="wave-title-icon" class="wave-char" style="height: 50px; width: auto; display: inline-block; vertical-align: middle; --i: 0;" />
            <span class="wave-char" style="--i: 1;">W</span><span class="wave-char" style="--i: 2;">a</span><span class="wave-char" style="--i: 3;">v</span><span class="wave-char" style="--i: 4;">e</span><span class="wave-char" style="--i: 5;">S</span><span class="wave-char" style="--i: 6;">c</span><span class="wave-char" style="--i: 7;">r</span><span class="wave-char" style="--i: 8;">i</span><span class="wave-char" style="--i: 9;">b</span><span class="wave-char" style="--i: 10;">e</span>
          </h1>
          <p style="font-size: 15px; color: var(--text-secondary); max-width: 80%; margin: 0 auto;">Make Waves. Not Keystrokes.</p>
        </div>
        
        <div class="status-panel">
          <div style="display: flex; justify-content: space-between; align-items: flex-end; margin: 0 0 6px 4px;">
            <h2 class="panel-title" style="margin: 0;">Status</h2>
            <h2 class="panel-title" style="margin: 0;">Model</h2>
          </div>
          <div class="status-row">
            <div class="status-indicator" id="status-dot"></div>
            <div class="status-text" id="status-message">Initializing...</div>
            <div id="current-model-display" style="font-size: 10px; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.5px; background: rgba(128, 128, 128, 0.1); padding: 3px 6px; border-radius: 4px; text-transform: uppercase;">TINY MODEL</div>
          </div>
          <!-- Model Download / Loading Progress Bar -->
          <div id="main-model-progress" style="display: none; margin: -4px 0 14px 0; padding: 0 4px;">
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); margin-bottom: 5px;">
              <span id="main-model-progress-label">Downloading model...</span>
              <span id="main-model-progress-pct" style="font-weight: 600; color: var(--text-primary);">0%</span>
            </div>
            <div class="progress-bar-track">
              <div id="main-model-progress-fill" class="progress-bar-fill" style="width: 0%;"></div>
            </div>
          </div>
          <div class="controls">
             <button class="btn btn-primary" id="record-btn">
               <span class="icon"><img src="${micIcon}" width="18" height="18" /></span>
               <span class="text" id="record-btn-text">Click to Record</span>
               <canvas id="waveform-canvas"></canvas>
             </button>
             <div class="shortcut-tip">shortcut:  [<span id="hotkey-display">Ctrl+Shift+Space</span>]</div>
          </div>
          <div id="model-error-actions" style="display:none; margin-top: 10px; display: none; gap: 8px; flex-direction: row; justify-content: center;">
            <button class="btn btn-secondary btn-small" id="model-retry-btn">Retry</button>
            <button class="btn btn-secondary btn-small" id="model-tiny-btn">Try Tiny Model</button>
          </div>
        </div>
        
        <div class="history-panel">
          <h2 class="panel-title">Recent Dictations</h2>
          <div class="history-list" id="history-container">
            <div class="history-empty">No dictations yet</div>
          </div>
        </div>

        <div class="footer-bar">
          <button class="btn-icon" id="settings-btn" title="Settings">
            <img src="${settingsIcon}" width="18" height="18" class="footer-icon" /> Settings
          </button>
          <button class="btn-chat-toggle" id="btn-open-chat" title="Chat with Open Source LLMs">
            <img src="${chatIcon}" width="16" height="16" class="chat-toggle-icon" /> AI Chat
          </button>
          <button class="btn-icon" id="theme-btn" title="Toggle Theme">Theme</button>
        </div>
      </div>

      <!-- AI Chat View (Text to Text with Open Models) -->
      <div id="chat-view" class="app-view hidden">
        <div class="chat-topbar">
          <div class="chat-topbar-left">
            <button class="btn-chat-back" id="btn-chat-back" title="Back to Dictation">
              <span>←</span> Dictation
            </button>
            <button class="chat-model-pill" id="btn-chat-model-picker" title="Switch or Download Open Models">
              <span class="status-indicator green" id="chat-active-model-dot"></span>
              <span id="chat-active-model-name">Loading...</span>
              <span style="font-size: 9px; opacity: 0.6; margin-left: 2px;">▼</span>
            </button>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div class="chat-hw-tag" id="chat-hw-badge" title="Hardware Profile">Checking specs...</div>
            <button class="btn-chat-action" id="btn-chat-clear" title="Clear Conversation">Clear</button>
          </div>
        </div>

        <!-- Chat Messages Container -->
        <div class="chat-messages" id="chat-messages">
          <div class="chat-welcome" id="chat-welcome">
            <div class="chat-welcome-icon"><img src="${chatIcon}" width="32" height="32" class="welcome-chat-icon" /></div>
            <h3>WaveScribe AI Chat</h3>
            <p>Chat locally with open-source models running 100% on your device with zero cloud latency.</p>
            <div class="chat-suggestions">
              <button class="chat-suggestion-chip" data-prompt="Summarize the main ideas and give actionable steps.">Structure and summarize ideas</button>
              <button class="chat-suggestion-chip" data-prompt="Draft a polite and professional message.">Draft a professional message</button>
              <button class="chat-suggestion-chip" data-prompt="Explain this concept with a clear step-by-step example.">Explain a concept with an example</button>
            </div>
          </div>
        </div>

        <!-- Chat Input Bar -->
        <div class="chat-input-bar">
          <div class="chat-input-container">
            <canvas id="chat-waveform-canvas"></canvas>
            <textarea id="chat-input-textarea" class="chat-input-textarea" rows="1" placeholder="Type or click WaveScribe to dictate prompt..."></textarea>
            <button class="chat-btn-circle btn-chat-mic" id="btn-chat-dictate" title="Dictate prompt via voice"><img src="${waveIcon}" width="22.5" height="22.5" class="chat-wave-icon" /></button>
            <button class="chat-btn-circle btn-chat-send" id="btn-chat-send" title="Send message (Enter)">↑</button>
          </div>
        </div>
      </div>

      <!-- Resizer Handles -->
      <div class="resizer resizer-n"></div>
      <div class="resizer resizer-s"></div>
      <div class="resizer resizer-e"></div>
      <div class="resizer resizer-w"></div>
      <div class="resizer resizer-ne"></div>
      <div class="resizer resizer-nw"></div>
      <div class="resizer resizer-se"></div>
      <div class="resizer resizer-sw"></div>

    <!-- Settings Modal Overlay -->
    <div class="modal-overlay" id="settings-modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Settings</h2>
          <button class="btn-close" id="settings-close">×</button>
        </div>
        
        <div class="modal-body">
          <div class="metrics-dashboard" style="display: flex; gap: 8px; margin-bottom: 20px; text-align: center;">
            <div class="metric-card" style="flex: 1; background: var(--bg-color); padding: 12px 4px; border-radius: 8px; border: 1px solid var(--border-color);">
              <div style="font-size: 20px; font-weight: 700; color: var(--text-primary);" id="metric-dictations">0</div>
              <div style="font-size: 10px; color: var(--text-secondary); text-transform: uppercase; margin-top: 4px; letter-spacing: 0.5px; line-height: 1.4;">Total<br>Dictations</div>
            </div>
            <div class="metric-card" style="flex: 1; background: var(--bg-color); padding: 12px 4px; border-radius: 8px; border: 1px solid var(--border-color);">
              <div style="font-size: 20px; font-weight: 700; color: var(--text-primary);" id="metric-words">0</div>
              <div style="font-size: 10px; color: var(--text-secondary); text-transform: uppercase; margin-top: 4px; letter-spacing: 0.5px; line-height: 1.4;">Total<br>Words</div>
            </div>
            <div class="metric-card" style="flex: 1; background: var(--bg-color); padding: 12px 4px; border-radius: 8px; border: 1px solid var(--border-color);">
              <div style="font-size: 20px; font-weight: 700; color: var(--text-primary);" id="metric-time">0m</div>
              <div style="font-size: 10px; color: var(--text-secondary); text-transform: uppercase; margin-top: 4px; letter-spacing: 0.5px; line-height: 1.4;">Time<br>Saved</div>
            </div>
            <div class="metric-card" style="flex: 1; background: var(--bg-color); padding: 12px 4px; border-radius: 8px; border: 1px solid var(--border-color);">
              <div style="font-size: 20px; font-weight: 700; color: var(--text-primary);" id="metric-score">--</div>
              <div style="font-size: 10px; color: var(--text-secondary); text-transform: uppercase; margin-top: 4px; letter-spacing: 0.5px; line-height: 1.4;">Articulation<br>Score</div>
            </div>
          </div>
          <div class="settings-section">
            <h3>Keyboard Shortcuts</h3>
            <div class="form-group">
              <label>Preset Shortcuts</label>
              <select id="setting-hotkey-preset" style="width: 100%;">
                <option value="CommandOrControl+Shift+Space">Ctrl/Cmd + Shift + Space</option>
                <option value="Alt+Space">Alt + Space</option>
                <option value="CommandOrControl+Alt+Space">Ctrl/Cmd + Alt + Space</option>
                <option value="CommandOrControl+Shift+D">Ctrl/Cmd + Shift + D</option>
                <option value="custom">Custom...</option>
              </select>
            </div>
            <div class="form-group switch-group" style="margin-top: 12px;">
              <label>Push-to-talk (hold the shortcut, release to finish)</label>
              <label class="switch">
                <input type="checkbox" id="setting-push-to-talk">
                <span class="slider round"></span>
              </label>
            </div>
            <div class="form-group" id="custom-hotkey-group" style="display: none; border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 12px;">
              <label>Custom Shortcut</label>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="setting-hotkey" value="CommandOrControl+Shift+Space" readonly class="hotkey-input" style="flex: 1;">
                <button class="btn btn-secondary btn-small" id="setting-hotkey-record" style="flex-shrink: 0;">Record</button>
              </div>
              <small id="hotkey-warning" style="display: none; color: var(--red); margin-top: 5px;">Warning: This hotkey is used by another program (or invalid) and could not be registered.</small>
              <small id="hotkey-help" style="display: block; margin-top: 5px;">Click 'Record' and press your desired shortcut combo.</small>
            </div>
          </div>

          <div class="settings-section">
            <h3>Transcription Model</h3>
            <div class="form-group">
              <label>Model Size (Accuracy vs Speed)</label>
              <select id="setting-model">
                <option value="onnx-community/moonshine-tiny-ONNX">Moonshine Tiny (⚡ Ultra Fast)</option>
                <option value="onnx-community/moonshine-base-ONNX">Moonshine Base (⚡ Fast • Accurate)</option>
                <option value="Xenova/whisper-tiny.en">Whisper Tiny (Fast)</option>
                <option value="Xenova/whisper-base.en">Whisper Base (Balanced)</option>
                <option value="Xenova/whisper-small.en">Whisper Small (Detailed)</option>
                <option value="distil-whisper/distil-small.en">Distil Small (Fast Whisper)</option>
                <option value="distil-whisper/distil-medium.en">Distil Medium (Balanced Whisper)</option>
                <option value="distil-whisper/distil-large-v3">Distil Large (Accurate Whisper)</option>
              </select>
            </div>
            <div id="model-status-card" style="margin-top: 10px; padding: 10px 12px; background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; font-size: 13px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <div class="status-indicator" id="model-status-badge" style="width: 8px; height: 8px; margin-right: 0;"></div>
                  <span id="model-status-text" style="font-weight: 500;">Checking cache...</span>
                </div>
                <span id="model-size-badge" style="color: var(--text-secondary); font-size: 11px; font-weight: 600;"></span>
              </div>
              <div id="settings-model-progress" style="display: none; margin-top: 8px;">
                <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">
                  <span id="settings-model-progress-text">Downloading...</span>
                  <span id="settings-model-progress-pct" style="font-weight: 600; color: var(--text-primary);">0%</span>
                </div>
                <div class="progress-bar-track">
                  <div id="settings-model-progress-fill" class="progress-bar-fill" style="width: 0%;"></div>
                </div>
              </div>
              <button class="btn btn-secondary btn-small" id="btn-preload-model" style="display: none; width: 100%; margin-top: 8px;">Download Model for Offline Use</button>
            </div>
          </div>

          <div class="settings-section">
            <h3>Performance</h3>
            <div class="form-group switch-group">
              <label>GPU Acceleration (WebGPU)</label>
              <label class="switch">
                <input type="checkbox" id="setting-compute-device">
                <span class="slider round"></span>
              </label>
            </div>
            <small style="display:block; color:var(--text-secondary); margin: -6px 0 10px 0;">Tip: Moonshine models are usually faster on CPU than on the GPU.</small>
            <small id="webgpu-warning" style="display:none; color:var(--red); margin-top:-6px; margin-bottom:10px;">WebGPU is not available on this system. Falling back to CPU.</small>
            <div class="form-group switch-group">
              <label>Voice Activity Detection (trim silence)</label>
              <label class="switch">
                <input type="checkbox" id="setting-vad">
                <span class="slider round"></span>
              </label>
            </div>
            <div class="form-group">
              <label>Processing Chunk Size: <span id="chunk-size-label">30s</span></label>
              <input type="range" id="setting-chunk-size" min="10" max="30" step="5" value="30" style="width:100%; margin-top:6px;">
              <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-secondary); margin-top:3px;">
                <span>10s (faster)</span><span>30s (default)</span>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h3>Audio Input</h3>
            <div class="form-group">
              <label>Microphone</label>
              <select id="setting-microphone">
                <option value="default">Default Microphone</option>
              </select>
            </div>
          </div>

          <div class="settings-section">
            <h3>Processing</h3>
            <div class="form-group switch-group">
              <label>Remove Filler Words (um, uh, like)</label>
              <label class="switch">
                <input type="checkbox" id="setting-filler-words" checked>
                <span class="slider round"></span>
              </label>
            </div>
            <div class="form-group switch-group">
              <label>Auto-Capitalize First Letter</label>
              <label class="switch">
                <input type="checkbox" id="setting-capitalize" checked>
                <span class="slider round"></span>
              </label>
            </div>
            <div class="form-group switch-group">
              <label>Auto-Punctuate</label>
              <label class="switch">
                <input type="checkbox" id="setting-punctuate" checked>
                <span class="slider round"></span>
              </label>
            </div>
          </div>

          <div class="settings-section">
            <h3>AI Text Cleanup</h3>
            <p style="font-size: 13px; color: var(--text-secondary); margin-top: 0; margin-bottom: 12px;">Use a local AI model to fix grammar, punctuation, and speech-to-text errors. Runs entirely on your machine.</p>
            <div class="form-group switch-group">
              <label>Enable AI Reformatting</label>
              <label class="switch">
                <input type="checkbox" id="setting-ai-reformat">
                <span class="slider round"></span>
              </label>
            </div>
            <div id="ai-model-status" style="margin-top: 10px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div class="status-indicator" id="ai-status-dot"></div>
                <span id="ai-status-text" style="font-size: 13px; color: var(--text-secondary);">Model not downloaded</span>
              </div>
              <div id="ai-progress-bar" style="display: none; margin-top: 8px; height: 6px; border-radius: 3px; background: rgba(128,128,128,0.2); overflow: hidden;">
                <div id="ai-progress-fill" style="height: 100%; width: 0%; background: var(--btn-bg); border-radius: 3px; transition: width 0.3s ease;"></div>
              </div>
              <button class="btn btn-secondary btn-small" id="ai-download-btn" style="margin-top: 8px; display: none; width: 100%;">Download Model (~1 GB)</button>
            </div>
          </div>

          <div class="settings-section">
            <h3>Dictionary (Word Replacements)</h3>
            <p style="font-size: 13px; color: var(--text-secondary); margin-top: 0; margin-bottom: 12px;">Replace misheard words automatically.</p>
            <button class="btn btn-secondary" id="dict-manage-btn" style="width: 100%;">Manage Dictionary...</button>
          </div>

          <div class="settings-section">
            <h3>App Behavior</h3>
            <div class="form-group switch-group">
              <label>Play Sounds on Record/Stop</label>
              <label class="switch">
                <input type="checkbox" id="setting-sounds" checked>
                <span class="slider round"></span>
              </label>
            </div>
            <div class="form-group switch-group">
              <label>Show System Notifications</label>
              <label class="switch">
                <input type="checkbox" id="setting-notifications" checked>
                <span class="slider round"></span>
              </label>
            </div>
          </div>

          <div class="settings-section">
            <h3>Diagnostics</h3>
            <p style="font-size: 13px; color: var(--text-secondary); margin-top: 0; margin-bottom: 12px;">Test every model / device / precision combination against one recording to find configs that fail or produce garbage.</p>
            <button class="btn btn-secondary" id="diag-run-btn" style="width: 100%;">Run Configuration Test...</button>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-primary" id="settings-save">Save & Apply</button>
        </div>
        </div>
      </div>

    <!-- Dictionary Modal Overlay -->
    <div class="modal-overlay" id="dictionary-modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Manage Dictionary</h2>
          <button class="btn-close" id="dictionary-close">×</button>
        </div>
        
        <div class="modal-body">
          <div class="settings-section">
            <h3>Word Replacements</h3>
            <p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 14px 0; line-height: 1.5;">Map misheard words to their correct replacements. E.g. "gooey" → "GUI".</p>
            
            <div style="display: flex; gap: 8px; margin-bottom: 16px;">
              <input type="text" id="dict-sound" placeholder="Sounds like..." class="hotkey-input" style="flex: 1; color: var(--text-primary); background-color: var(--bg-color);">
              <div style="color: var(--text-secondary); display: flex; align-items: center; font-size: 18px; font-weight: bold; padding: 0 2px;">&rarr;</div>
              <input type="text" id="dict-replace" placeholder="Replace with..." class="hotkey-input" style="flex: 1; color: var(--text-primary); background-color: var(--bg-color);">
              <button class="btn btn-secondary btn-small" id="dict-add-btn" style="flex-shrink: 0; white-space: nowrap;">Add</button>
            </div>

            <div style="display: flex; padding: 0 4px 6px 4px; font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border-color); margin-bottom: 8px;">
              <div style="flex: 1;">Sounds Like</div>
              <div style="flex: 1;">Replace With</div>
              <div style="width: 32px;"></div>
            </div>
            <div id="dictionary-list" style="display: flex; flex-direction: column; gap: 6px; min-height: 40px;"></div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" id="dictionary-close-footer" style="margin-right: 8px;">Exit</button>
          <button class="btn btn-primary" id="dictionary-done">Save &amp; Apply</button>
        </div>
      </div>
    </div>

    <!-- Open Models Management Modal -->
    <div class="modal-overlay" id="chat-models-modal">
      <div class="modal-content chat-models-modal-content">
        <div class="modal-header modal-header-stacked">
          <div class="modal-header-top">
            <div>
              <h2 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary);">Open Source LLM Models</h2>
              <p style="font-size: 12px; color: var(--text-secondary); margin: 3px 0 0 0;">Filtered for your PC's hardware capacity</p>
            </div>
            <button class="btn-close" id="chat-models-close">×</button>
          </div>
          <div class="hw-header-bar" id="hw-profile-card">
            <div class="hw-header-info">
              <div class="hw-header-specs" id="hw-specs-title">System Specs: Detecting...</div>
              <div class="hw-header-sub" id="hw-specs-subtitle">Checking RAM and GPU...</div>
            </div>
            <div class="model-card-badge green" id="hw-tier-badge">COMPATIBLE</div>
          </div>
        </div>

        <div class="modal-body chat-models-modal-body">
          <!-- Model Download Progress Banner (if active) -->
          <div id="llm-download-banner" style="display: none; background: var(--panel-bg); border: 1px solid var(--btn-bg); border-radius: 10px; padding: 14px; margin-bottom: 18px;">
            <div style="display: flex; justify-content: space-between; font-size: 12.5px; font-weight: 600; margin-bottom: 8px;">
              <span id="llm-download-title">Downloading model...</span>
              <span style="display: inline-flex; align-items: center; gap: 10px;">
                <span id="llm-download-pct" style="color: var(--btn-bg);">0%</span>
                <button class="btn btn-secondary btn-small" id="llm-download-cancel" style="padding: 2px 8px;">Cancel</button>
              </span>
            </div>
            <div class="progress-bar-track" style="height: 6px; border-radius: 3px;">
              <div id="llm-download-fill" class="progress-bar-fill" style="width: 0%;"></div>
            </div>
            <div style="font-size: 11.5px; color: var(--text-secondary); margin-top: 6px;" id="llm-download-bytes">0 MB / 0 MB</div>
          </div>

          <div id="model-catalog-container">
            <!-- Dynamically populated model cards -->
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="chat-models-done">Done</button>
        </div>
      </div>
    </div>
    </div>
  `
  
  const triggerWaveAnimation = () => {
    const waveTitle = document.getElementById('wave-title');
    if (waveTitle) {
      waveTitle.classList.remove('waving');
      void waveTitle.offsetWidth; // trigger reflow to restart animation
      waveTitle.classList.add('waving');
    }
  };

  // Trigger wave animation on initial load with 1s delay
  setTimeout(triggerWaveAnimation, 1000);

  // Basic Logic
  const recordBtn = document.getElementById('record-btn');
  const statusDot = document.getElementById('status-dot');
  const statusMessage = document.getElementById('status-message');
  const themeBtn = document.getElementById('theme-btn');
  const themeProvider = document.getElementById('theme-provider');
  const historyContainer = document.getElementById('history-container');

  let isRecording = false;
  let isProcessing = false;
  let capturedContextPromise: Promise<string> = Promise.resolve('');
  let historyItems: { text: string, timestamp: number }[] = [];
  let dictionaryPairs: { sound: string, replace: string }[] = [];
  let playSoundsEnabled = true;
  let showNotifyEnabled = true;

  let metricDictations = 0;
  let metricWords = 0;
  let metricTimeSavedSec = 0;
  let scoreHistory: number[] = [];

  const updateDashboardUI = () => {
    const elDict = document.getElementById('metric-dictations');
    const elWords = document.getElementById('metric-words');
    const elTime = document.getElementById('metric-time');
    const elScore = document.getElementById('metric-score');

    if (elDict) elDict.textContent = metricDictations.toString();
    if (elWords) elWords.textContent = metricWords.toString();
    if (elTime) {
      const hrs = Math.floor(metricTimeSavedSec / 3600);
      const mins = Math.floor((metricTimeSavedSec % 3600) / 60);
      elTime.textContent = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
      if (hrs === 0 && mins === 0 && metricTimeSavedSec > 0) {
        elTime.textContent = `<1m`;
      }
    }
    if (elScore) {
      if (scoreHistory.length === 0) {
        elScore.textContent = '--';
        elScore.style.color = 'var(--text-secondary)';
      } else {
        const avg = scoreHistory.reduce((a, b) => a + b, 0) / scoreHistory.length;
        elScore.textContent = Math.round(avg) + '';
        if (avg >= 90) elScore.style.color = 'var(--green)';
        else if (avg >= 70) elScore.style.color = 'var(--yellow)';
        else elScore.style.color = 'var(--red)';
      }
    }
  };

  const renderHistory = (animateTimestamp?: number) => {
    if (historyItems.length === 0) {
      historyContainer!.innerHTML = '<div class="history-empty">No dictations yet</div>';
      return;
    }

    historyContainer!.innerHTML = '';

    // Sort descending by timestamp (newest first)
    const sorted = [...historyItems].sort((a, b) => b.timestamp - a.timestamp);

    sorted.forEach(item => {
      const entry = document.createElement('div');
      entry.className = 'history-item' + (animateTimestamp === item.timestamp ? ' slide-in' : '');
      const date = new Date(item.timestamp);

      // Calculate day difference for the label
      const isToday = new Date().toDateString() === date.toDateString();
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dayStr = isToday ? '' : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} `;

      entry.innerHTML = `
        <div class="time">[${dayStr}${timeStr}]</div>
        <div class="content">${escapeHtml(item.text)}</div>
        <button class="history-delete" title="Delete dictation">×</button>
      `;

      // Copy logic
      entry.title = "Click to copy";
      entry.addEventListener('click', async () => {
        if (window.electronAPI) {
          try {
            await window.electronAPI.copyText(item.text);
            const contentDiv = entry.querySelector('.content');
            if (contentDiv) {
              const originalContent = contentDiv.innerHTML;
              contentDiv.innerHTML = `<span style="color: #4ade80; text-align: center; width: 100%; font-weight: 500;">Copied to clipboard!</span>`;
              setTimeout(() => {
                contentDiv.innerHTML = originalContent;
              }, 1500);
            }
          } catch (err) {
            console.error('Failed to copy text: ', err);
          }
        }
      });

      // Delete logic
      const delBtn = entry.querySelector('.history-delete');
      delBtn?.addEventListener('click', async (e) => {
        e.stopPropagation(); // prevent copying
        entry.classList.add('slide-out');
        
        // Remove from state
        historyItems = historyItems.filter(h => h.timestamp !== item.timestamp);
        if (window.electronAPI) {
          await window.electronAPI.setSetting('dictationHistory', historyItems);
        }

        // Wait for animation, then resync DOM if empty
        setTimeout(() => {
          entry.remove();
          if (historyItems.length === 0) {
            renderHistory();
          }
        }, 400); // Wait for the 0.4s CSS animation to complete
      });

      historyContainer!.appendChild(entry);
    });
  };

  themeBtn?.addEventListener('click', () => {
    if (themeProvider?.classList.contains('theme-dark')) {
      themeProvider.classList.remove('theme-dark');
      themeProvider.classList.add('theme-light');
    } else {
      themeProvider?.classList.remove('theme-light');
      themeProvider?.classList.add('theme-dark');
    }
  });

  // Window Controls
  document.getElementById('win-close')?.addEventListener('click', () => {
    window.electronAPI?.windowControl('close');
  });
  document.getElementById('win-minimize')?.addEventListener('click', () => {
    window.electronAPI?.windowControl('minimize');
  });
  document.getElementById('win-maximize')?.addEventListener('click', () => {
    window.electronAPI?.windowControl('maximize');
  });

  document.getElementById('win-island')?.addEventListener('click', async () => {
    if (window.electronAPI) {
      // Start fade out of main UI
      document.body.classList.add('transitioning-to-mini');

      // Wait for fade out to complete
      await new Promise(r => setTimeout(r, 300));

      await window.electronAPI.toggleMiniMode(true);

      // Swap to mini-mode
      document.body.classList.remove('transitioning-to-mini');
      document.body.classList.add('mini-mode');

      // Sync current status text and dot color before showing
      const statusDot = document.getElementById('status-dot');
      const statusMessage = document.getElementById('status-message');
      const islandDot = document.getElementById('island-dot');
      const islandText = document.getElementById('island-text');
      if (islandDot && statusDot) islandDot.className = statusDot.className;
      if (islandText && statusMessage) islandText.textContent = statusMessage.textContent;

      // Move canvas to island
      const canvas = document.getElementById('waveform-canvas');
      const islandContent = document.querySelector('.island-content');
      if (canvas && islandContent) {
        islandContent.appendChild(canvas);
      }
    }
  });

  document.getElementById('mini-island')?.addEventListener('click', async () => {
    if (window.electronAPI) {
      // Start fade out of the mini island
      document.body.classList.add('transitioning-from-mini');

      // Wait for fade out to complete
      await new Promise(r => setTimeout(r, 300));

      // Prep main UI to fade in (set it to opacity zero BEFORE window expands)
      document.body.classList.remove('mini-mode', 'transitioning-from-mini');
      document.body.classList.add('transitioning-to-main');

      // Expand window
      await window.electronAPI.toggleMiniMode(false);

      // Move canvas back to button
      const canvas = document.getElementById('waveform-canvas');
      const recordBtn = document.getElementById('record-btn');
      if (canvas && recordBtn) {
        recordBtn.appendChild(canvas);
      }

      // Small delay to let window snap happen, then remove the hold class to trigger fade-in
      requestAnimationFrame(() => {
        document.body.classList.remove('transitioning-to-main');
        
        // Trigger wave animation when main UI fades back in
        setTimeout(triggerWaveAnimation, 150);
      });
    }
  });

  let animationFrameId: number;
  let volumeHistory: number[] = new Array(120).fill(0);
  let lastDrawTime = 0;
  let smoothedAmplitude = 0;

  // Cache elements and styles for performance
  const waveformCanvas = document.getElementById('waveform-canvas') as HTMLCanvasElement;
  const waveformCtx = waveformCanvas?.getContext('2d', { alpha: true });

  // Set initial canvas size once (unless resized)
  if (waveformCanvas) {
    waveformCanvas.width = 360;
    waveformCanvas.height = 40;
  }

  const drawWaveform = (timestamp: number) => {
    if (!waveformCanvas || !waveformCtx) return;

    // Throttle to ~60fps
    if (timestamp - lastDrawTime < 16) {
      if (isRecording) {
        animationFrameId = requestAnimationFrame(drawWaveform);
      }
      return;
    }
    lastDrawTime = timestamp;

    const dataArray = getVisualizerData();
    let currentAmplitude = 0;

    if (dataArray && dataArray.length > 0) {
      for (let i = 0; i < dataArray.length; i++) {
        const val = Math.abs(dataArray[i] - 128);
        if (val > currentAmplitude) currentAmplitude = val;
      }
    }

    if (currentAmplitude > smoothedAmplitude) {
      smoothedAmplitude += (currentAmplitude - smoothedAmplitude) * 0.25;
    } else {
      smoothedAmplitude += (currentAmplitude - smoothedAmplitude) * 0.18;
    }

    volumeHistory.push(smoothedAmplitude);
    if (volumeHistory.length > 120) {
      volumeHistory.shift();
    }

    waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);

    // Cache the color lookup
    const themeProvider = document.getElementById('theme-provider');
    const primaryBlue = themeProvider ? getComputedStyle(themeProvider).getPropertyValue('--btn-bg') : '#1f6feb';

    const barWidth = 2;
    const barGap = 1;

    // Drawing basic bars (No Glow = Fast)
    waveformCtx.fillStyle = primaryBlue;

    for (let i = 0; i < volumeHistory.length; i++) {
      const val = volumeHistory[i];
      const minHeight = 2;
      let height = (val / 128) * waveformCanvas.height * 3.5;
      if (height < minHeight) height = minHeight;
      if (height > waveformCanvas.height) height = waveformCanvas.height;

      const x = i * (barWidth + barGap);
      const y = (waveformCanvas.height - height) / 2;

      waveformCtx.beginPath();
      waveformCtx.roundRect(x, y, barWidth, height, 2);
      waveformCtx.fill();
    }

    if (isRecording) {
      animationFrameId = requestAnimationFrame(drawWaveform);
    }
  };

  let activeStreamingSession: StreamingTranscriptionSession | null = null;
  let runPendingAction: () => void = () => { };
  // True when the AI cleanup runs phrase by phrase during recording (so it is skipped at stop).
  let sessionPolishesWithLlm = false;

  const toggleRecording = async () => {
    // Don't record while settings modal is open
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal?.classList.contains('active')) return;

    if (isProcessing) return;

    // The chat dictation button owns the microphone while it is recording.
    if (isChatDictating) return;

    if (isRecording) {
      const tStop = performance.now();
      const lap = (label: string) => console.log(`[Timing] ${label}: ${Math.round(performance.now() - tStop)}ms since stop`);
      isProcessing = true;
      isRecording = false;

      if (playSoundsEnabled) {
        const stopSound = new Audio(stopSoundFile);
        stopSound.play().catch(e => console.warn("Could not play stop sound:", e));
      }

      // Stop animation, hide canvas, remove recording state
      cancelAnimationFrame(animationFrameId);

      // Reset waveform to zero immediately so the canvas clears at stop
      volumeHistory.fill(0);
      smoothedAmplitude = 0;
      const canvas = document.getElementById('waveform-canvas') as HTMLCanvasElement;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      canvas?.classList.remove('active');
      recordBtn?.classList.remove('recording');

      statusDot!.className = 'status-indicator loading';
      statusMessage!.textContent = 'Processing...';
      const btnText = document.getElementById('record-btn-text');
      if (btnText) btnText.textContent = 'Processing...';

      const islandDot = document.getElementById('island-dot');
      const islandText = document.getElementById('island-text');
      if (islandDot) islandDot.className = 'status-indicator loading';
      if (islandText) islandText.textContent = 'Processing...';

      // Show cursor spinner at caret position
      if (window.electronAPI) {
        window.electronAPI.showCursorSpinner().catch(() => { });
      }

      try {
        // With streaming, the phrases were already transcribed while recording, so skip
        // merging/VAD/normalizing the whole recording again.
        const { fullAudio, trailingAudio, durationSec, hadAudio } = await stopRecordingDirect({
          includeFull: activeStreamingSession === null
        });

        lap('audio stopped');

        if (!hadAudio) {
          statusDot!.className = 'status-indicator green flash';
          statusMessage!.textContent = 'Ready';
          if (btnText) btnText.textContent = 'Click to Record';
          if (islandDot) islandDot.className = 'status-indicator green flash';
          if (islandText) islandText.textContent = 'Ready';
          return;
        }

        // Apply performance settings at transcription time
        const settings = window.electronAPI ? await window.electronAPI.getSettings() : null;
        const vadEnabled = settings?.vadEnabled ?? false;
        const chunkSize = settings?.chunkSize ?? 30;
        let metricsDirty = false;

        let text = '';
        const sessionForRun = activeStreamingSession;
        const polishedBySession = sessionPolishesWithLlm;
        if (activeStreamingSession) {
          text = await activeStreamingSession.finalize(trailingAudio);
        } else {
          let audioForTranscription = fullAudio;
          if (vadEnabled) {
            audioForTranscription = applyVAD(fullAudio);
            console.log(`[VAD] Trimmed: ${fullAudio.length} -> ${audioForTranscription.length} samples`);
          }
          text = await transcribeAudio(audioForTranscription, chunkSize);
        }

        lap(`transcribed (${text.trim().split(/\s+/).filter(Boolean).length} words)`);

        if (text && text.trim().length > 0) {
          const originalWordsCount = polishedBySession
            ? Math.max(sessionForRun?.getRawWordCount() ?? 0, countWords(text))
            : countWords(text);
          let processedText = text.trim();

          // Phrases were already cleaned while recording; this pass catches anything that spans
          // phrase boundaries and (when no session cleaned them) does the whole job.
          if (settings && settings.removeFiller !== false) processedText = removeFillers(processedText);
          processedText = applyDictionary(processedText, dictionaryPairs);

          // Apply Auto-Capitalization & Auto-Punctuation
          const autoCapEnabled = settings ? (settings.autoCap !== false) : true;
          const autoPunctEnabled = settings ? (settings.autoPunct !== false) : true;
          processedText = applyAutoFormatting(processedText, autoCapEnabled, autoPunctEnabled);

          text = processedText;

          // AI cleanup of the whole text, only if it was not already done phrase by phrase.
          if (settings?.aiReformat && window.electronAPI && !polishedBySession) {
            const llmStatus = await window.electronAPI.llmStatus();
            if (llmStatus.status === 'ready') {
              statusMessage!.textContent = 'Reformatting...';
              const islandText2 = document.getElementById('island-text');
              if (islandText2) islandText2.textContent = 'Reformatting...';

              try {
                const result = await window.electronAPI.llmReformat(text, await capturedContextPromise);
                if (result.success && result.text) {
                  text = result.text;
                }
              } catch (err) {
                console.warn('[AI Reformat] Failed, using original text:', err);
              }
            }
          }

          lap('post-processing + AI cleanup done');

          const finalWordsCount = text.split(/\s+/).filter((w: string) => w.length > 0).length;
          const fillersRemoved = Math.max(0, originalWordsCount - finalWordsCount);

          if (finalWordsCount > 0) {
            metricDictations += 1;
            metricWords += finalWordsCount;
            metricTimeSavedSec += (finalWordsCount / 0.66); // 40 wpm

            const audioDurationSec = durationSec > 0 ? durationSec : (fullAudio.length / 16000);
            if (audioDurationSec > 0.1 && isFinite(audioDurationSec)) {
              const wordsPerSec = finalWordsCount / audioDurationSec;
              let clarity = (wordsPerSec / 2.5) * 100;
              if (finalWordsCount < 3) {
                clarity = 100;
              } else {
                if (clarity > 100) clarity = 100;
                clarity -= (fillersRemoved * 5); // 5 points penalty per filler word
                if (clarity < 10) clarity = 10;
              }

              if (isFinite(clarity) && !isNaN(clarity)) {
                scoreHistory.push(clarity);
                if (scoreHistory.length > 50) scoreHistory.shift();
              }
            }

            metricsDirty = true;
            updateDashboardUI();
          }
        }

        statusDot!.className = 'status-indicator green flash';
        statusMessage!.textContent = 'Ready';
        if (btnText) btnText.textContent = 'Click to Record';

        if (islandDot) islandDot.className = 'status-indicator green flash';
        if (islandText) islandText.textContent = 'Ready';

        triggerWaveAnimation();

        if (text && text.trim().length > 0) {
          const now = Date.now();
          const finalText = text.trim();

          // Paste first: this is the moment the user is waiting for. Everything else (history,
          // metrics, notification, disk writes) happens after the text is already in their app.
          const insertPromise = window.electronAPI
            ? window.electronAPI.insertText(finalText)
            : Promise.resolve({ success: false });

          // Add to history state
          historyItems.push({ text: finalText, timestamp: now });

          // Prune history older than 30 days
          const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
          historyItems = historyItems.filter(item => now - item.timestamp <= thirtyDaysMs);

          await insertPromise;
          lap('pasted');

          renderHistory(now);

          if (window.electronAPI) {
            window.electronAPI.setSetting('dictationHistory', historyItems).catch(() => { });
            if (metricsDirty) {
              window.electronAPI.setSetting('metrics', {
                dictations: metricDictations,
                words: metricWords,
                timeSavedSec: metricTimeSavedSec,
                scoreHistory: scoreHistory
              }).catch(() => { });
            }
          }

          if (showNotifyEnabled && window.electronAPI) {
            const preview = finalText.length > 60 ? finalText.slice(0, 57) + '...' : finalText;
            window.electronAPI.showNotification('WaveScribe Dictation', preview).catch(() => { });
          }
        } else if (metricsDirty && window.electronAPI) {
          window.electronAPI.setSetting('metrics', {
            dictations: metricDictations,
            words: metricWords,
            timeSavedSec: metricTimeSavedSec,
            scoreHistory: scoreHistory
          }).catch(() => { });
        }
      } catch (err) {
        console.error(err);
        statusDot!.className = 'status-indicator red';
        statusMessage!.textContent = 'Error';
        if (btnText) btnText.textContent = 'Click to Record';
        const islandDot = document.getElementById('island-dot');
        const islandText = document.getElementById('island-text');
        if (islandDot) islandDot.className = 'status-indicator red';
        if (islandText) islandText.textContent = 'Error';
      } finally {
        isProcessing = false;
        activeStreamingSession = null;
        // Always hide the cursor spinner
        if (window.electronAPI) {
          window.electronAPI.hideCursorSpinner().catch(() => { });
        }
        runPendingAction();
      }
    } else {
      // Without a loaded model every phrase would fail; the status line already shows why.
      if (!isModelLoaded()) {
        console.warn('[Record] Ignored: transcription model is not loaded yet');
        return;
      }

      isProcessing = true;

      statusDot!.className = 'status-indicator red flash';
      statusMessage!.textContent = 'Starting...';
      const btnText = document.getElementById('record-btn-text');
      if (btnText) btnText.textContent = 'Connecting...';

      const islandDot = document.getElementById('island-dot');
      const islandText = document.getElementById('island-text');
      if (islandDot) islandDot.className = 'status-indicator red flash';
      if (islandText) islandText.textContent = 'Starting...';

      // Capture context from the focused app IN PARALLEL with opening the microphone. It is only
      // awaited when the AI cleanup step needs it, so it never delays the first spoken words.
      capturedContextPromise = Promise.resolve('');
      if (window.electronAPI) {
        try {
          const aiSettings = await window.electronAPI.getSettings();
          if (aiSettings?.aiReformat) {
            capturedContextPromise = window.electronAPI.captureContext()
              .then(ctx => (ctx.success ? ctx.text : ''))
              .catch(() => '');
          }
        } catch {}
      }

      try {
        // Clean each phrase in the background as soon as it is decoded: fillers, dictionary and,
        // when enabled and ready, the AI cleanup. This hides most of the AI step behind speaking.
        const runSettings = window.electronAPI ? await window.electronAPI.getSettings() : null;
        const removeFillerWords = runSettings?.removeFiller !== false;
        let llmReady = false;
        if (runSettings?.aiReformat && window.electronAPI) {
          try { llmReady = (await window.electronAPI.llmStatus()).status === 'ready'; } catch { }
        }
        sessionPolishesWithLlm = llmReady;

        const processSegment = async (rawText: string): Promise<string> => {
          let t = rawText.trim();
          if (removeFillerWords) t = removeFillers(t);
          t = applyDictionary(t, dictionaryPairs);
          // Very short fragments give a small model nothing to work with and invite rewrites.
          if (llmReady && countWords(t) >= 3 && window.electronAPI) {
            try {
              const result = await window.electronAPI.llmReformat(t, await capturedContextPromise);
              if (result.success && result.text) t = result.text;
            } catch (err) {
              console.warn('[AI Reformat] Phrase cleanup failed, keeping text:', err);
            }
          }
          return t;
        };

        const session = new StreamingTranscriptionSession(undefined, processSegment);
        activeStreamingSession = session;

        // Live preview: show the tail of what has been transcribed so far while the user talks.
        session.setOnUpdate((partial) => {
          if (!isRecording || !partial) return;
          const tail = partial.length > 26 ? '…' + partial.slice(-25) : partial;
          if (statusMessage) statusMessage.textContent = tail;
          const islandTextLive = document.getElementById('island-text');
          if (islandTextLive) islandTextLive.textContent = tail;
        });

        await startRecording({
          enableStreaming: true,
          onPhraseCompleted: (pcmChunk, meta) => {
            const chunkId = session.addPhraseChunk(pcmChunk, meta);
            console.log(`[Audio Streaming] Dispatched phrase #${chunkId} during speech`);
          }
        });
        isRecording = true;

        // Cue the user only once the microphone is actually open, so nobody starts talking early.
        if (playSoundsEnabled) {
          const startSound = new Audio(startSoundFile);
          startSound.play().catch(e => console.warn("Could not play start sound:", e));
        }

        // Look up the caret position now, while the CPU is idle, so the spinner can appear
        // instantly when recording stops.
        window.electronAPI?.primeCaret().catch(() => { });

        // Reset volume history on new recording
        volumeHistory.fill(0);
        smoothedAmplitude = 0;

        // Show and start animation, hide button text
        recordBtn?.classList.add('recording');
        const canvas = document.getElementById('waveform-canvas');
        canvas?.classList.add('active');
        drawWaveform(performance.now());

        statusDot!.className = 'status-indicator red';
        statusMessage!.textContent = 'Recording...';
        if (islandDot) islandDot.className = 'status-indicator red';
        if (islandText) islandText.textContent = 'Recording...';
      } catch (err) {
        console.error("Microphone failed to start:", err);
        activeStreamingSession = null;
        statusDot!.className = 'status-indicator red';
        statusMessage!.textContent = 'Error';
        if (btnText) btnText.textContent = 'Click to Record';

        if (islandDot) islandDot.className = 'status-indicator red';
        if (islandText) islandText.textContent = 'Error';
      } finally {
        isProcessing = false;
        runPendingAction();
      }
    }
  };

  // A hotkey press that arrives while a dictation is starting or being processed used to be
  // dropped. Remember the latest one and run it as soon as the app is free.
  let pendingAction: 'toggle' | 'start' | 'stop' | null = null;

  const handleHotkeyAction = (action: 'toggle' | 'start' | 'stop') => {
    if (isProcessing) {
      pendingAction = action;
      return;
    }
    // Push-to-talk sends explicit start/stop; ignore ones that no longer make sense.
    if (action === 'start' && isRecording) return;
    if (action === 'stop' && !isRecording) return;
    toggleRecording();
  };

  runPendingAction = () => {
    const next = pendingAction;
    pendingAction = null;
    if (next) setTimeout(() => handleHotkeyAction(next), 0);
  };

  recordBtn?.addEventListener('click', toggleRecording);

  // Settings Modal Elements
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsClose = document.getElementById('settings-close');
  const settingsSave = document.getElementById('settings-save');

  // Input Elements
  const inputHotkeyPreset = document.getElementById('setting-hotkey-preset') as HTMLSelectElement;
  const inputHotkey = document.getElementById('setting-hotkey') as HTMLInputElement;
  const btnHotkeyRecord = document.getElementById('setting-hotkey-record');
  const hotkeyWarning = document.getElementById('hotkey-warning');
  const hotkeyHelp = document.getElementById('hotkey-help');
  const inputMicrophone = document.getElementById('setting-microphone') as HTMLSelectElement;
  const inputModel = document.getElementById('setting-model') as HTMLSelectElement;
  const inputFiller = document.getElementById('setting-filler-words') as HTMLInputElement;
  const inputCap = document.getElementById('setting-capitalize') as HTMLInputElement;
  const inputPunct = document.getElementById('setting-punctuate') as HTMLInputElement;
  const inputSounds = document.getElementById('setting-sounds') as HTMLInputElement;
  const inputNotify = document.getElementById('setting-notifications') as HTMLInputElement;
  const inputPushToTalk = document.getElementById('setting-push-to-talk') as HTMLInputElement;

  // Performance Input Elements
  const inputComputeDevice = document.getElementById('setting-compute-device') as HTMLInputElement;
  const inputVAD = document.getElementById('setting-vad') as HTMLInputElement;
  const inputChunkSize = document.getElementById('setting-chunk-size') as HTMLInputElement;
  const chunkSizeLabel = document.getElementById('chunk-size-label');
  const webGPUWarning = document.getElementById('webgpu-warning');

  // AI Reformatting UI Elements
  const inputAiReformat = document.getElementById('setting-ai-reformat') as HTMLInputElement;
  const aiStatusDot = document.getElementById('ai-status-dot');
  const aiStatusText = document.getElementById('ai-status-text');
  const aiProgressBar = document.getElementById('ai-progress-bar');
  const aiProgressFill = document.getElementById('ai-progress-fill');
  const aiDownloadBtn = document.getElementById('ai-download-btn');

  const updateAiStatusUI = async () => {
    if (!window.electronAPI) return;
    const s = await window.electronAPI.llmStatus();

    if (s.status === 'ready') {
      if (aiStatusDot) aiStatusDot.className = 'status-indicator green';
      if (aiStatusText) aiStatusText.textContent = 'Model ready';
      if (aiDownloadBtn) aiDownloadBtn.style.display = 'none';
      if (aiProgressBar) aiProgressBar.style.display = 'none';
    } else if (s.status === 'downloading') {
      if (aiStatusDot) aiStatusDot.className = 'status-indicator loading';
      if (aiStatusText) aiStatusText.textContent = `Downloading... ${s.progress}%`;
      if (aiProgressBar) aiProgressBar.style.display = 'block';
      if (aiProgressFill) aiProgressFill.style.width = s.progress + '%';
      if (aiDownloadBtn) aiDownloadBtn.style.display = 'none';
    } else if (s.status === 'loading') {
      if (aiStatusDot) aiStatusDot.className = 'status-indicator loading';
      if (aiStatusText) aiStatusText.textContent = 'Loading model...';
      if (aiDownloadBtn) aiDownloadBtn.style.display = 'none';
      if (aiProgressBar) aiProgressBar.style.display = 'none';
    } else if (s.status === 'error') {
      if (aiStatusDot) aiStatusDot.className = 'status-indicator red';
      if (aiStatusText) aiStatusText.textContent = 'Error: ' + s.error;
      if (aiDownloadBtn) {
        aiDownloadBtn.style.display = 'block';
        aiDownloadBtn.textContent = 'Retry';
      }
      if (aiProgressBar) aiProgressBar.style.display = 'none';
    } else {
      // not-downloaded
      if (s.progress >= 100) {
        if (aiStatusDot) aiStatusDot.className = 'status-indicator';
        if (aiStatusText) aiStatusText.textContent = 'Model downloaded (not active)';
        if (aiDownloadBtn) aiDownloadBtn.style.display = 'none';
      } else {
        if (aiStatusDot) aiStatusDot.className = 'status-indicator';
        if (aiStatusText) aiStatusText.textContent = 'Model not downloaded';
        if (aiDownloadBtn) {
          aiDownloadBtn.style.display = 'block';
          aiDownloadBtn.textContent = 'Download Model (~1 GB)';
        }
      }
      if (aiProgressBar) aiProgressBar.style.display = 'none';
    }
  };

  aiDownloadBtn?.addEventListener('click', async () => {
    if (aiDownloadBtn) aiDownloadBtn.style.display = 'none';
    if (aiProgressBar) aiProgressBar.style.display = 'block';
    if (aiStatusDot) aiStatusDot.className = 'status-indicator loading';
    if (aiStatusText) aiStatusText.textContent = 'Starting download...';
    const result = await window.electronAPI.llmInit(true);
    if (result.success) {
      await updateAiStatusUI();
    } else {
      if (aiStatusDot) aiStatusDot.className = 'status-indicator red';
      if (aiStatusText) aiStatusText.textContent = 'Error: ' + (result.error || 'Unknown');
      if (aiDownloadBtn) {
        aiDownloadBtn.style.display = 'block';
        aiDownloadBtn.textContent = 'Retry';
      }
      if (aiProgressBar) aiProgressBar.style.display = 'none';
    }
  });

  if (window.electronAPI) {
    window.electronAPI.onLlmDownloadProgress((progress: any) => {
      const pct = typeof progress === 'number' ? progress : (progress?.percent ?? 0);
      if (aiProgressFill) aiProgressFill.style.width = pct + '%';
      if (aiStatusText) {
        if (pct >= 100) {
          aiStatusText.textContent = 'Loading model...';
        } else {
          aiStatusText.textContent = `Downloading... ${pct}%`;
        }
      }
      if (aiStatusDot) aiStatusDot.className = 'status-indicator loading';
    });
  }

  // Live chunk size label update
  inputChunkSize?.addEventListener('input', () => {
    if (chunkSizeLabel) chunkSizeLabel.textContent = inputChunkSize.value + 's';
  });

  const refreshSettingsModelStatus = async () => {
    const selectedModel = inputModel?.value || DEFAULT_MODEL_ID;
    const details = MODEL_DETAILS[selectedModel] || { name: selectedModel, shortName: selectedModel, sizeText: '~100 MB', approxBytes: 100 * 1024 * 1024 };

    const modelStatusBadge = document.getElementById('model-status-badge');
    const modelStatusText = document.getElementById('model-status-text');
    const modelSizeBadge = document.getElementById('model-size-badge');
    const btnPreloadModel = document.getElementById('btn-preload-model') as HTMLButtonElement;

    if (modelSizeBadge) modelSizeBadge.textContent = details.sizeText;

    // Check download status for all options in select
    if (inputModel) {
      for (const opt of Array.from(inputModel.options)) {
        const optDetails = MODEL_DETAILS[opt.value];
        const optBaseName = optDetails?.name || opt.value;
        const optDownloaded = await isHfModelDownloaded(opt.value);
        if (optDownloaded) {
          opt.text = `${optBaseName} (Downloaded)`;
        } else {
          const size = optDetails?.sizeText ? `~${optDetails.sizeText}` : 'Needs download';
          opt.text = `${optBaseName} (${size})`;
        }
      }
    }

    const isDownloaded = await isHfModelDownloaded(selectedModel);
    if (isDownloaded) {
      if (modelStatusBadge) {
        modelStatusBadge.className = 'status-indicator green';
        modelStatusBadge.style.display = 'none';
      }
      if (modelStatusText) {
        modelStatusText.innerHTML = `${checkmarkSvg} <span style="color: var(--green); font-weight: 600; margin-left: 4px;">Downloaded & Cached (Instant Switch)</span>`;
      }
      if (btnPreloadModel) btnPreloadModel.style.display = 'none';
    } else {
      if (modelStatusBadge) {
        modelStatusBadge.className = 'status-indicator';
        modelStatusBadge.style.display = 'inline-block';
      }
      if (modelStatusText) {
        modelStatusText.textContent = `Not Downloaded (${details.sizeText})`;
        modelStatusText.style.color = 'var(--text-secondary)';
      }
      if (btnPreloadModel) {
        btnPreloadModel.style.display = 'block';
        btnPreloadModel.textContent = `Pre-download ${details.name} (${details.sizeText})`;
      }
    }
  };

  const btnPreloadModel = document.getElementById('btn-preload-model');
  btnPreloadModel?.addEventListener('click', async () => {
    const selectedModel = inputModel?.value || DEFAULT_MODEL_ID;
    if (btnPreloadModel) btnPreloadModel.style.display = 'none';
    const settingsProgress = document.getElementById('settings-model-progress');
    if (settingsProgress) settingsProgress.style.display = 'block';
    await attemptLoadModel(selectedModel);
    await refreshSettingsModelStatus();
  });

  // Refresh model status on device/model change
  inputComputeDevice?.addEventListener('change', () => {
    refreshSettingsModelStatus();
  });
  inputModel?.addEventListener('change', () => {
    refreshSettingsModelStatus();
  });

  // Dictionary UI Elements
  const dictModal = document.getElementById('dictionary-modal');
  const dictManageBtn = document.getElementById('dict-manage-btn');
  const dictCloseBtn = document.getElementById('dictionary-close');
  const dictCloseFooterBtn = document.getElementById('dictionary-close-footer');
  const dictDoneBtn = document.getElementById('dictionary-done');
  const dictList = document.getElementById('dictionary-list');
  const dictSoundInput = document.getElementById('dict-sound') as HTMLInputElement;
  const dictReplaceInput = document.getElementById('dict-replace') as HTMLInputElement;
  const dictAddBtn = document.getElementById('dict-add-btn');

  const renderDictionary = () => {
    if (!dictList) return;
    dictList.innerHTML = '';
    dictionaryPairs.forEach((pair, index) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'center';

      row.innerHTML = `
        <div style="flex: 1; color: var(--text-primary); font-weight: 500;">${escapeHtml(pair.sound)}</div>
        <div style="flex: 1; color: var(--green); font-weight: 600;">${escapeHtml(pair.replace)}</div>
        <button class="btn btn-secondary btn-small disable-enter" style="padding: 4px 8px; color: var(--red); background: transparent; border: none; font-size: 16px;">×</button>
      `;

      row.querySelector('button')?.addEventListener('click', (e) => {
        e.preventDefault();
        dictionaryPairs.splice(index, 1);
        renderDictionary();
      });
      dictList.appendChild(row);
    });
  };

  dictAddBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const sound = dictSoundInput.value.trim();
    const replace = dictReplaceInput.value.trim();
    if (sound && replace) {
      const existingIdx = dictionaryPairs.findIndex(p => p.sound.toLowerCase() === sound.toLowerCase());
      if (existingIdx >= 0) {
        dictionaryPairs[existingIdx].replace = replace;
      } else {
        dictionaryPairs.push({ sound, replace });
      }
      dictSoundInput.value = '';
      dictReplaceInput.value = '';
      renderDictionary();
    }
  });

  const hideDictModal = () => {
    if (dictModal) {
      dictModal.classList.remove('active');
      setTimeout(() => {
        dictModal.style.display = 'none';
        // Restore Settings Modal Visibility
        if (settingsModal) {
          settingsModal.classList.add('active');
        }
      }, 300); // match css transition speed
    }
  };

  dictManageBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    renderDictionary();
    if (dictModal) {
      dictModal.style.display = 'flex';
      // Hide Settings Modal instantly so transparencies don't stack
      if (settingsModal) {
        settingsModal.classList.remove('active');
      }
      // slight delay to allow display block to render before opacity jump
      setTimeout(() => {
        dictModal.classList.add('active');
      }, 10);
    }
  });

  dictCloseBtn?.addEventListener('click', hideDictModal);
  dictCloseFooterBtn?.addEventListener('click', hideDictModal);

  // Save & Apply specifically for Dictionary
  dictDoneBtn?.addEventListener('click', async () => {
    if (window.electronAPI) {
      await window.electronAPI.setSetting('dictionaryPairs', dictionaryPairs);
    }
    hideDictModal();
  });

  let recordingHotkey = false;

  const populateMics = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }); // Request permission
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputDevices = devices.filter(device => device.kind === 'audioinput');

      inputMicrophone.innerHTML = '<option value="default">System Default</option>';

      audioInputDevices.forEach(device => {
        if (device.deviceId !== 'default' && device.deviceId !== 'communications') {
          const option = document.createElement('option');
          option.value = device.deviceId;
          option.textContent = device.label || `Microphone (${device.deviceId.slice(0, 5)}...)`;
          inputMicrophone.appendChild(option);
        }
      });
    } catch (err) {
      console.warn('Could not enumerate audio devices:', err);
    }
  };

  const loadSettingsAndShow = async () => {
    await populateMics();
    if (window.electronAPI) {
      const settings = await window.electronAPI.getSettings();
      if (settings) {
        if (settings.hotkey) {
          inputHotkey.value = settings.hotkey;
          const presetOptions = Array.from(inputHotkeyPreset.options).map(o => o.value);
          if (presetOptions.includes(settings.hotkey)) {
            inputHotkeyPreset.value = settings.hotkey;
            const group = document.getElementById('custom-hotkey-group');
            if (group) group.style.display = 'none';
          } else {
            inputHotkeyPreset.value = 'custom';
            const group = document.getElementById('custom-hotkey-group');
            if (group) group.style.display = 'block';
          }

          const hotkeyCheck = await window.electronAPI.checkHotkey(settings.hotkey);
          if (!hotkeyCheck.registered) {
            inputHotkey.style.borderColor = 'var(--red)';
            inputHotkey.style.color = 'var(--red)';
            inputHotkeyPreset.style.borderColor = 'var(--red)';
            inputHotkeyPreset.style.color = 'var(--red)';
            hotkeyWarning!.style.display = 'block';
          } else {
            inputHotkey.style.borderColor = 'var(--border-color)';
            inputHotkey.style.color = 'var(--text-primary)';
            inputHotkeyPreset.style.borderColor = 'var(--border-color)';
            inputHotkeyPreset.style.color = 'var(--text-primary)';
            hotkeyWarning!.style.display = 'none';
          }
        }
        if (settings.microphone) inputMicrophone.value = settings.microphone;
        if (settings.model) inputModel.value = settings.model;

        // Performance settings
        if (settings.computeDevice) inputComputeDevice.checked = settings.computeDevice === 'webgpu';
        if (settings.vadEnabled !== undefined) inputVAD.checked = settings.vadEnabled;
        if (settings.chunkSize !== undefined) {
          inputChunkSize.value = String(settings.chunkSize);
          if (chunkSizeLabel) chunkSizeLabel.textContent = settings.chunkSize + 's';
        }

        // Checkboxes
        if (settings.removeFiller !== undefined) inputFiller.checked = settings.removeFiller;
        if (settings.autoCap !== undefined) inputCap.checked = settings.autoCap;
        if (settings.autoPunct !== undefined) inputPunct.checked = settings.autoPunct;
        if (settings.playSounds !== undefined) inputSounds.checked = settings.playSounds;
        if (settings.showNotify !== undefined) inputNotify.checked = settings.showNotify;
        if (settings.pushToTalk !== undefined) inputPushToTalk.checked = settings.pushToTalk;
        if (settings.dictionaryPairs && Array.isArray(settings.dictionaryPairs)) {
          dictionaryPairs = settings.dictionaryPairs;
          renderDictionary();
        }
        if (settings.metrics) {
          metricDictations = settings.metrics.dictations || 0;
          metricWords = settings.metrics.words || 0;
          metricTimeSavedSec = settings.metrics.timeSavedSec || 0;
          scoreHistory = settings.metrics.scoreHistory || [];
        }
        if (settings.aiReformat !== undefined) inputAiReformat.checked = settings.aiReformat;
      }
    }
    updateDashboardUI();
    await updateAiStatusUI();
    await refreshSettingsModelStatus();
    settingsModal?.classList.add('active');
  };

  settingsBtn?.addEventListener('click', loadSettingsAndShow);

  let activeKeydownListener: ((e: KeyboardEvent) => void) | null = null;
  let previousValidHotkey = 'CommandOrControl+Shift+Space';

  const stopHotkeyRecording = (revertToPrevious = false) => {
    if (recordingHotkey) {
      recordingHotkey = false;
      if (btnHotkeyRecord) btnHotkeyRecord.textContent = 'Record';
      if (activeKeydownListener) {
        document.removeEventListener('keydown', activeKeydownListener);
        activeKeydownListener = null;
      }
      if (revertToPrevious && inputHotkey.value === 'Press key combination...') {
        inputHotkey.value = previousValidHotkey;
      }
    }
  };

  settingsClose?.addEventListener('click', () => {
    settingsModal?.classList.remove('active');
    stopHotkeyRecording(true);
  });

  inputHotkeyPreset?.addEventListener('change', () => {
    if (inputHotkeyPreset.value === 'custom') {
      const group = document.getElementById('custom-hotkey-group');
      if (group) group.style.display = 'block';
    } else {
      const group = document.getElementById('custom-hotkey-group');
      if (group) group.style.display = 'none';
      inputHotkey.value = inputHotkeyPreset.value;
      previousValidHotkey = inputHotkeyPreset.value;
    }
    inputHotkey.style.borderColor = 'var(--border-color)';
    inputHotkey.style.color = 'var(--text-primary)';
    inputHotkeyPreset.style.borderColor = 'var(--border-color)';
    inputHotkeyPreset.style.color = 'var(--text-primary)';
    hotkeyWarning!.style.display = 'none';
  });

  // Hotkey recorder with modifier key validation
  btnHotkeyRecord?.addEventListener('click', () => {
    if (!recordingHotkey) {
      recordingHotkey = true;
      previousValidHotkey = inputHotkey.value;
      btnHotkeyRecord.textContent = 'Listening...';
      inputHotkey.value = 'Press key combination...';
      if (hotkeyHelp) hotkeyHelp.textContent = 'Press combination (e.g. Ctrl+Shift+Space, Alt+Space). Esc to cancel.';
      if (hotkeyHelp) hotkeyHelp.style.color = 'var(--text-secondary)';

      activeKeydownListener = (e: KeyboardEvent) => {
        e.preventDefault();

        // Handle Escape to cancel
        if (e.key === 'Escape') {
          inputHotkey.value = previousValidHotkey;
          stopHotkeyRecording();
          if (hotkeyHelp) hotkeyHelp.textContent = "Click 'Record' and press your desired shortcut combo.";
          return;
        }

        let modifiers = [];
        if (e.ctrlKey || e.metaKey) modifiers.push('CommandOrControl');
        if (e.shiftKey) modifiers.push('Shift');
        if (e.altKey) modifiers.push('Alt');

        let key = e.key;
        // Ignore standalone modifier presses
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return;

        // Ensure at least one modifier is included so standard typing is never hijacked
        if (modifiers.length === 0) {
          if (hotkeyHelp) {
            hotkeyHelp.textContent = 'Must include at least one modifier key (Ctrl, Alt, or Shift).';
            hotkeyHelp.style.color = 'var(--red)';
          }
          return;
        }

        if (key === ' ') key = 'Space';
        else if (key.length === 1) key = key.toUpperCase();

        const hotkeyStr = [...modifiers, key].join('+');
        inputHotkey.value = hotkeyStr;
        previousValidHotkey = hotkeyStr;

        stopHotkeyRecording();
        if (hotkeyHelp) {
          hotkeyHelp.textContent = "Click 'Record' and press your desired shortcut combo.";
          hotkeyHelp.style.color = 'var(--text-secondary)';
        }
      };

      document.addEventListener('keydown', activeKeydownListener);
    } else {
      stopHotkeyRecording(true);
    }
  });

  // Save changes
  settingsSave?.addEventListener('click', async () => {
    // Reset hotkey if user failed to provide one before saving
    if (recordingHotkey) {
      stopHotkeyRecording(true);
    }

    if (window.electronAPI) {
      const hotkeyResult = await window.electronAPI.setSetting('hotkey', inputHotkey.value);
      if (hotkeyResult && hotkeyResult.success === false) {
        inputHotkey.style.borderColor = 'var(--red)';
        inputHotkey.style.color = 'var(--red)';
        inputHotkeyPreset.style.borderColor = 'var(--red)';
        inputHotkeyPreset.style.color = 'var(--red)';
        hotkeyWarning!.style.display = 'block';
        // Stop here so user can see what failed instead of closing modal or saving other incomplete state
        return;
      }

      const hotkeyDisplay = document.getElementById('hotkey-display');
      if (hotkeyDisplay) hotkeyDisplay.textContent = inputHotkey.value;

      await window.electronAPI.setSetting('microphone', inputMicrophone.value);

      const selectedMic = inputMicrophone.value === 'default' ? null : inputMicrophone.value;
      setAudioDevice(selectedMic);

      await window.electronAPI.setSetting('model', inputModel.value);
      await window.electronAPI.setSetting('removeFiller', inputFiller.checked);
      await window.electronAPI.setSetting('autoCap', inputCap.checked);
      await window.electronAPI.setSetting('autoPunct', inputPunct.checked);
      await window.electronAPI.setSetting('playSounds', inputSounds.checked);
      playSoundsEnabled = inputSounds.checked;
      await window.electronAPI.setSetting('showNotify', inputNotify.checked);
      await window.electronAPI.setSetting('pushToTalk', inputPushToTalk.checked);
      showNotifyEnabled = inputNotify.checked;
      await window.electronAPI.setSetting('dictionaryPairs', dictionaryPairs);

      // Performance settings
      await window.electronAPI.setSetting('computeDevice', inputComputeDevice.checked ? 'webgpu' : 'cpu');
      await window.electronAPI.setSetting('vadEnabled', inputVAD.checked);
      await window.electronAPI.setSetting('chunkSize', parseInt(inputChunkSize.value) || 30);

      // Reload the speech model only if something that affects it changed (or it never loaded).
      const newDevice = inputComputeDevice.checked ? 'webgpu' : 'cpu';
      if (!isModelLoaded() || inputModel.value !== currentModelId || newDevice !== getCurrentDevice()) {
        attemptLoadModel(inputModel.value);
      }

      // AI Reformatting
      await window.electronAPI.setSetting('aiReformat', inputAiReformat.checked);
      if (inputAiReformat.checked) {
        const s = await window.electronAPI.llmStatus();
        if (s.status !== 'ready' && s.status !== 'downloading' && s.status !== 'loading') {
          window.electronAPI.llmInit();
        }
      }
    }

    settingsModal?.classList.remove('active');
  });

  if (window.electronAPI) {
    window.electronAPI.onDictationHotkey((action) => {
      handleHotkeyAction(action);
    });

    window.electronAPI.onWindowMaximized((isMax: boolean) => {
      document.body.classList.toggle('maximized', isMax);
    });

    // Read settings & history
    window.electronAPI.getSettings().then((settings) => {
      if (settings) {
        if (settings.hotkey) {
          document.getElementById('hotkey-display')!.textContent = settings.hotkey;
        }
        if (settings.microphone && settings.microphone !== 'default') {
          setAudioDevice(settings.microphone);
        }
        if (settings.dictationHistory && Array.isArray(settings.dictationHistory)) {
          // Prune older than 30 days initially too
          const now = Date.now();
          const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
          historyItems = settings.dictationHistory.filter((item: any) => now - item.timestamp <= thirtyDaysMs);
          renderHistory();
        }
        if (settings.dictionaryPairs && Array.isArray(settings.dictionaryPairs)) {
          dictionaryPairs = settings.dictionaryPairs;
        }
        if (settings.metrics) {
          metricDictations = settings.metrics.dictations || 0;
          metricWords = settings.metrics.words || 0;
          metricTimeSavedSec = settings.metrics.timeSavedSec || 0;
          scoreHistory = settings.metrics.scoreHistory || [];
        }
        if (settings.playSounds !== undefined) {
          playSoundsEnabled = settings.playSounds;
        }
        if (settings.showNotify !== undefined) {
          showNotifyEnabled = settings.showNotify;
        }
      }
    });
  }

  // ── Model loading ──────────────────────────────────────────────────────────
  let currentModelId = DEFAULT_MODEL_ID;

  const modelErrorActions = document.getElementById('model-error-actions');
  const modelRetryBtn = document.getElementById('model-retry-btn');
  const modelTinyBtn = document.getElementById('model-tiny-btn');

  const attemptLoadModel = async (modelId: string) => {
    currentModelId = modelId;
    // Hide error buttons while loading
    if (modelErrorActions) modelErrorActions.style.display = 'none';

    const details = MODEL_DETAILS[modelId] || { name: modelId, shortName: modelId, sizeText: '', approxBytes: 0 };

    const el = document.getElementById('current-model-display');
    if (el) {
      el.textContent = details.shortName || modelId;
    }

    statusMessage!.textContent = `Loading Model...`;
    statusDot!.className = 'status-indicator loading';

    const mainProgress = document.getElementById('main-model-progress');
    const mainProgressLabel = document.getElementById('main-model-progress-label');
    const mainProgressPct = document.getElementById('main-model-progress-pct');
    const mainProgressFill = document.getElementById('main-model-progress-fill');

    const settingsProgress = document.getElementById('settings-model-progress');
    const settingsProgressText = document.getElementById('settings-model-progress-text');
    const settingsProgressPct = document.getElementById('settings-model-progress-pct');
    const settingsProgressFill = document.getElementById('settings-model-progress-fill');

    const updateProgressUI = (percent: number, message: string, isCompiling = false) => {
      const pctClamped = Math.min(100, Math.max(0, percent));
      const pctStr = `${pctClamped}%`;

      if (mainProgress) mainProgress.style.display = 'block';
      if (mainProgressLabel) mainProgressLabel.textContent = message;
      if (mainProgressPct) mainProgressPct.textContent = pctStr;
      if (mainProgressFill) {
        mainProgressFill.style.width = pctStr;
        if (isCompiling) mainProgressFill.classList.add('indeterminate');
        else mainProgressFill.classList.remove('indeterminate');
      }

      if (settingsProgress) settingsProgress.style.display = 'block';
      if (settingsProgressText) settingsProgressText.textContent = message;
      if (settingsProgressPct) settingsProgressPct.textContent = pctStr;
      if (settingsProgressFill) {
        settingsProgressFill.style.width = pctStr;
        if (isCompiling) settingsProgressFill.classList.add('indeterminate');
        else settingsProgressFill.classList.remove('indeterminate');
      }

      statusMessage!.textContent = isCompiling ? 'Compiling model...' : `Downloading... ${pctStr}`;
      statusDot!.className = 'status-indicator loading';

      const islandDot = document.getElementById('island-dot');
      const islandText = document.getElementById('island-text');
      if (islandDot) islandDot.className = 'status-indicator loading';
      if (islandText) islandText.textContent = isCompiling ? 'Compiling...' : `Downloading ${pctStr}`;
    };

    // Read performance settings
    let device: 'cpu' | 'webgpu' = 'cpu';
    let dtype: string | undefined = undefined;
    if (window.electronAPI) {
      const s = await window.electronAPI.getSettings();
      device = s?.computeDevice ?? 'cpu';
      // Automatically assign the optimal precision behind the scenes:
      // - WebGPU: 'auto' (fp32) for fast & accurate speech recognition
      // - CPU: undefined (pre-quantized q8 weights) for highest CPU performance
      dtype = undefined;
    }

    const fileMap = new Map<string, { loaded: number; total: number; progress: number; done: boolean }>();

    const setModelReadyUI = () => {
      if (mainProgress) mainProgress.style.display = 'none';
      if (settingsProgress) settingsProgress.style.display = 'none';
      statusDot!.className = 'status-indicator green flash';
      statusMessage!.textContent = 'Ready';
      const islandDot = document.getElementById('island-dot');
      const islandText = document.getElementById('island-text');
      if (islandDot) islandDot.className = 'status-indicator green flash';
      if (islandText) islandText.textContent = 'Ready';
      const recordBtnText = document.getElementById('record-btn-text');
      if (recordBtnText && (recordBtnText.textContent === 'Processing...' || recordBtnText.textContent === 'Connecting...')) {
        recordBtnText.textContent = 'Click to Record';
      }
      if (modelErrorActions) modelErrorActions.style.display = 'none';
      fileMap.clear();
      refreshSettingsModelStatus().catch(() => {});
    };

    const progressCallback = (info: any) => {
      if (info.status === 'initiate' || info.status === 'download') {
        if (!fileMap.has(info.file)) {
          fileMap.set(info.file, { loaded: 0, total: 0, progress: 0, done: false });
        }
      } else if (info.status === 'progress') {
        fileMap.set(info.file, {
          loaded: info.loaded || 0,
          total: info.total || 0,
          progress: info.progress || 0,
          done: false
        });
      } else if (info.status === 'done') {
        const existing = fileMap.get(info.file);
        const total = existing?.total || info.total || 1;
        fileMap.set(info.file, {
          loaded: total,
          total: total,
          progress: 100,
          done: true
        });
      }

      if (info.status === 'ready') {
        setModelReadyUI();
        return;
      }

      if (fileMap.size > 0) {
        let totalLoaded = 0;
        let totalTotal = 0;
        let progressSum = 0;
        let allDone = true;

        for (const p of fileMap.values()) {
          totalLoaded += p.loaded;
          totalTotal += p.total;
          progressSum += p.progress;
          if (!p.done) allDone = false;
        }

        let percent = 0;
        if (totalTotal > 0) {
          percent = Math.min(100, Math.round((totalLoaded / totalTotal) * 100));
        } else {
          percent = Math.min(100, Math.round(progressSum / fileMap.size));
        }

        if (allDone || (totalTotal > 0 && totalLoaded >= totalTotal)) {
          updateProgressUI(100, `Compiling ${details.name} into memory...`, true);
        } else {
          let label = `Downloading ${details.name}...`;
          if (totalTotal > 0) {
            const loadedMB = (totalLoaded / (1024 * 1024)).toFixed(1);
            const totalMB = (totalTotal / (1024 * 1024)).toFixed(1);
            label = `Downloading ${details.name} (${loadedMB} / ${totalMB} MB)`;
          }
          updateProgressUI(percent, label, false);
        }
      }
    };

    const handleLoadError = (err: any) => {
      console.error('Failed to load model', err);
      if (mainProgress) mainProgress.style.display = 'none';
      if (settingsProgress) settingsProgress.style.display = 'none';
      statusDot!.className = 'status-indicator red';
      statusMessage!.textContent = 'Model error';
      const islandDot = document.getElementById('island-dot');
      const islandText = document.getElementById('island-text');
      if (islandDot) islandDot.className = 'status-indicator red';
      if (islandText) islandText.textContent = 'Error';
      if (modelErrorActions) {
        modelErrorActions.style.cssText = 'display: flex; margin-top: 10px; gap: 8px; flex-direction: row; justify-content: center;';
      }
      refreshSettingsModelStatus().catch(() => {});
    };

    const isOOM = (err: any) =>
      err instanceof RangeError ||
      err?.message?.toLowerCase().includes('array buffer allocation failed') ||
      err?.message?.toLowerCase().includes('out of memory');

    try {
      await loadModel(modelId, device, dtype, progressCallback);
      setModelReadyUI();
    } catch (err: any) {
      if (err?.code === 'WEBGPU_UNAVAILABLE') {
        console.warn('[Model] WebGPU not available, falling back to CPU');
        if (webGPUWarning) webGPUWarning.style.display = 'block';
        if (window.electronAPI) await window.electronAPI.setSetting('computeDevice', 'cpu');
        if (inputComputeDevice) inputComputeDevice.checked = false;
        try {
          await loadModel(modelId, 'cpu', undefined, progressCallback);
          setModelReadyUI();
        } catch (cpuErr) {
          handleLoadError(cpuErr);
        }
      } else if (isOOM(err) && device === 'webgpu') {
        console.warn('[Model] WebGPU OOM — falling back to CPU');
        statusMessage!.textContent = 'GPU out of memory — falling back to CPU';
        if (window.electronAPI) await window.electronAPI.setSetting('computeDevice', 'cpu');
        if (inputComputeDevice) inputComputeDevice.checked = false;
        try {
          await loadModel(modelId, 'cpu', undefined, progressCallback);
          setModelReadyUI();
        } catch (cpuErr) {
          handleLoadError(cpuErr);
        }
      } else {
        handleLoadError(err);
      }
    }
  };

  modelRetryBtn?.addEventListener('click', () => attemptLoadModel(currentModelId));
  modelTinyBtn?.addEventListener('click', () => attemptLoadModel('Xenova/whisper-tiny.en'));

  // Diagnostics harness — after a run it reloads the user's real model so the
  // main UI returns to a working state.
  initDiagnostics(() => attemptLoadModel(currentModelId));

  if (window.electronAPI) {
    window.electronAPI.getSettings().then(async (settings) => {
      const modelId = settings?.model ?? DEFAULT_MODEL_ID;

      // Pre-flight VRAM check: if WebGPU is stored, verify the model+precision
      // actually fits before calling loadModel — the OOM RangeError from ONNX
      // is thrown in a GPU worker and cannot be caught by a Promise .catch().
      if (settings?.computeDevice === 'webgpu') {
        const vramMb = await window.electronAPI.getVramMb();
        const needed = MODEL_VRAM_MB[modelId]?.['auto'] ?? 0;

        if (vramMb !== null && needed > vramMb) {
          console.warn(`[VRAM] ${needed}MB needed, ${vramMb}MB available — falling back to CPU`);
          await window.electronAPI.setSetting('computeDevice', 'cpu');
        }
      }

      attemptLoadModel(modelId);
    });
  } else {
    attemptLoadModel(DEFAULT_MODEL_ID);
  }

  // --- Resizer Logic ---
  const resizers = document.querySelectorAll('.resizer');
  let currentResizer: HTMLElement | null = null;

  resizers.forEach(resizer => {
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      currentResizer = resizer as HTMLElement;

      const startX = (e as MouseEvent).screenX;
      const startY = (e as MouseEvent).screenY;

      // Get initial window bounds
      const startW = window.outerWidth;
      const startH = window.outerHeight;
      const startX_win = window.screenX;
      const startY_win = window.screenY;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!currentResizer) return;

        const deltaX = moveEvent.screenX - startX;
        const deltaY = moveEvent.screenY - startY;

        let newX = startX_win;
        let newY = startY_win;
        let newW = startW;
        let newH = startH;

        if (currentResizer.classList.contains('resizer-e')) {
          newW = startW + deltaX;
        } else if (currentResizer.classList.contains('resizer-w')) {
          newW = startW - deltaX;
          newX = startX_win + deltaX;
        } else if (currentResizer.classList.contains('resizer-s')) {
          newH = startH + deltaY;
        } else if (currentResizer.classList.contains('resizer-n')) {
          newH = startH - deltaY;
          newY = startY_win + deltaY;
        } else if (currentResizer.classList.contains('resizer-se')) {
          newW = startW + deltaX;
          newH = startH + deltaY;
        } else if (currentResizer.classList.contains('resizer-sw')) {
          newW = startW - deltaX;
          newX = startX_win + deltaX;
          newH = startH + deltaY;
        } else if (currentResizer.classList.contains('resizer-ne')) {
          newW = startW + deltaX;
          newH = startH - deltaY;
          newY = startY_win + deltaY;
        } else if (currentResizer.classList.contains('resizer-nw')) {
          newW = startW - deltaX;
          newX = startX_win + deltaX;
          newH = startH - deltaY;
          newY = startY_win + deltaY;
        }

        // Set minimum size constraints
        if (newW < 450) {
          newX = startX_win + (startW - 450);
          newW = 450;
        }
        if (newH < 530) {
          newY = startY_win + (startH - 530);
          newH = 530;
        }

        window.electronAPI.setWindowBounds({
          x: Math.round(newX),
          y: Math.round(newY),
          width: Math.round(newW),
          height: Math.round(newH)
        });
      };

      const onMouseUp = () => {
        currentResizer = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });

  // ==========================================================================
  // AI Chat & Open Models Management
  // ==========================================================================

  const dictationView = document.getElementById('dictation-view');
  const chatView = document.getElementById('chat-view');
  const btnOpenChat = document.getElementById('btn-open-chat');
  const btnChatBack = document.getElementById('btn-chat-back');
  const chatModelPickerBtn = document.getElementById('btn-chat-model-picker');
  const chatActiveModelName = document.getElementById('chat-active-model-name');
  const chatActiveModelDot = document.getElementById('chat-active-model-dot');
  const chatHwBadge = document.getElementById('chat-hw-badge');
  const btnChatClear = document.getElementById('btn-chat-clear');
  const chatMessagesContainer = document.getElementById('chat-messages');
  const chatWelcome = document.getElementById('chat-welcome');
  const chatInputTextarea = document.getElementById('chat-input-textarea') as HTMLTextAreaElement;
  const btnChatDictate = document.getElementById('btn-chat-dictate');
  const btnChatSend = document.getElementById('btn-chat-send') as HTMLButtonElement;

  const chatModelsModal = document.getElementById('chat-models-modal');
  const chatModelsClose = document.getElementById('chat-models-close');
  const chatModelsDone = document.getElementById('chat-models-done');
  const hwSpecsTitle = document.getElementById('hw-specs-title');
  const hwSpecsSubtitle = document.getElementById('hw-specs-subtitle');
  const hwTierBadge = document.getElementById('hw-tier-badge');
  const modelCatalogContainer = document.getElementById('model-catalog-container');
  const llmDownloadBanner = document.getElementById('llm-download-banner');
  const llmDownloadTitle = document.getElementById('llm-download-title');
  const llmDownloadPct = document.getElementById('llm-download-pct');
  const llmDownloadFill = document.getElementById('llm-download-fill');
  const llmDownloadBytes = document.getElementById('llm-download-bytes');

  interface ChatMessage {
    role: 'user' | 'assistant'
    content: string
    timestamp: number
  }

  let chatMessages: ChatMessage[] = [];
  let isGeneratingChat = false;
  let isChatDictating = false;
  let chatDictationStream: MediaStream | null = null;
  let currentActiveAssistantBubbleContent: HTMLElement | null = null;
  let cachedHwProfile: any = null;

  // View Navigation
  const switchToChatView = async () => {
    if (dictationView && chatView) {
      dictationView.classList.add('hidden');
      chatView.classList.remove('hidden');
      await refreshHardwareSpecs();
      await refreshActiveChatModelUI();
      chatInputTextarea?.focus();
    }
  };

  const switchToDictationView = () => {
    if (dictationView && chatView) {
      chatView.classList.add('hidden');
      dictationView.classList.remove('hidden');
    }
  };

  btnOpenChat?.addEventListener('click', switchToChatView);
  btnChatBack?.addEventListener('click', switchToDictationView);

  // Hardware Specs Detection & Display
  const refreshHardwareSpecs = async () => {
    if (!window.electronAPI) return;
    try {
      cachedHwProfile = await window.electronAPI.getHardwareProfile();
      if (cachedHwProfile) {
        const vramText = cachedHwProfile.gpuVramMb ? ` • GPU ${Math.round(cachedHwProfile.gpuVramMb / 1024)}GB VRAM` : '';
        const hwShort = `${cachedHwProfile.totalRamGb} GB RAM${vramText}`;
        if (chatHwBadge) chatHwBadge.textContent = hwShort;
        if (hwSpecsTitle) hwSpecsTitle.textContent = `Detected: ${cachedHwProfile.totalRamGb} GB RAM (${cachedHwProfile.freeRamGb} GB Available)${vramText}`;
        if (hwSpecsSubtitle) hwSpecsSubtitle.textContent = `${cachedHwProfile.cpuCores} CPU Cores • ${cachedHwProfile.cpuModel}`;
        if (hwTierBadge) {
          if (cachedHwProfile.totalRamGb >= 15) {
            hwTierBadge.textContent = 'HIGH SPEC (14B READY)';
            hwTierBadge.className = 'model-card-badge green';
          } else if (cachedHwProfile.totalRamGb >= 10) {
            hwTierBadge.textContent = 'MID SPEC (7B-8B READY)';
            hwTierBadge.className = 'model-card-badge green';
          } else {
            hwTierBadge.textContent = 'LIGHTWEIGHT (1B-4B READY)';
            hwTierBadge.className = 'model-card-badge amber';
          }
        }
      }
    } catch (e) {
      console.warn('Failed to get hardware specs:', e);
    }
  };

  const refreshActiveChatModelUI = async () => {
    if (!window.electronAPI) return;
    try {
      const s = await window.electronAPI.llmStatus();
      const catalog = await window.electronAPI.llmGetCatalog();
      const active = catalog.find(m => m.id === s.activeModelId) || catalog.find(m => m.isDownloaded) || catalog[0];

      if (chatActiveModelName) {
        if (active && active.isDownloaded) {
          chatActiveModelName.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 5px;">${checkmarkSvg} <span>${active.name}</span></span>`;
        } else {
          chatActiveModelName.textContent = active ? active.name : 'No Model Loaded';
        }
      }
      if (chatActiveModelDot) {
        if (s.status === 'ready') {
          chatActiveModelDot.className = 'status-indicator green';
        } else if (s.status === 'loading' || s.status === 'downloading') {
          chatActiveModelDot.className = 'status-indicator loading';
        } else {
          chatActiveModelDot.className = 'status-indicator';
        }
      }
    } catch (e) {
      console.warn('Failed to refresh active chat model UI:', e);
    }
  };

  // Render Open Models Catalog Modal
  const renderModelCatalogModal = async () => {
    if (!window.electronAPI || !modelCatalogContainer) return;
    try {
      const catalog = await window.electronAPI.llmGetCatalog();
      const status = await window.electronAPI.llmStatus();
      modelCatalogContainer.innerHTML = '';

      const tiers: { key: 'lightweight' | 'mid' | 'frontier'; title: string; desc: string }[] = [
        { key: 'lightweight', title: 'Ultra-Lightweight Tier (1B - 4B)', desc: 'Lightning fast on all computers (4 GB - 8 GB RAM)' },
        { key: 'mid', title: 'High Performance Tier (7B - 8B)', desc: 'Balanced reasoning & coding (12 GB - 16 GB RAM)' },
        { key: 'frontier', title: 'Frontier Reasoning Tier (14B)', desc: 'High-density chain-of-thought models (16 GB+ RAM)' }
      ];

      tiers.forEach(tier => {
        const tierModels = catalog.filter(m => m.tier === tier.key);
        if (tierModels.length === 0) return;

        const section = document.createElement('div');
        section.className = 'model-tier-section';
        section.innerHTML = `
          <div class="model-tier-title">
            <span>${tier.title}</span>
          </div>
          <p style="font-size: 11px; color: var(--text-secondary); margin: -4px 0 8px 0;">${tier.desc}</p>
          <div class="model-catalog-grid"></div>
        `;

        const grid = section.querySelector('.model-catalog-grid');

        tierModels.forEach(m => {
          const card = document.createElement('div');
          const isCurrentActive = m.id === status.activeModelId && status.status === 'ready';
          const isDownloading = status.activeDownloadModelId === m.id;

          card.className = `model-catalog-card ${isCurrentActive ? 'active' : ''} ${!m.isCompatible ? 'incompatible' : ''}`;

          const checkIconHtml = m.isDownloaded ? checkmarkSvg : '';

          let badgeHtml = '';
          if (isCurrentActive) {
            badgeHtml = `<span class="model-card-badge green" style="display: inline-flex; align-items: center; gap: 4px;">${checkmarkSvg} ACTIVE</span>`;
          } else if (m.isDownloaded) {
            badgeHtml = `<span class="model-card-badge green" style="display: inline-flex; align-items: center; gap: 4px;">${checkmarkSvg} DOWNLOADED</span>`;
          } else if (isDownloading) {
            badgeHtml = `<span class="model-card-badge amber">DOWNLOADING ${m.downloadProgress}%</span>`;
          } else if (m.isCompatible) {
            badgeHtml = `<span class="model-card-badge green">COMPATIBLE</span>`;
          } else {
            badgeHtml = `<span class="model-card-badge red">NEEDS ${m.minTotalRamGb}GB RAM</span>`;
          }

          let actionBtnHtml = '';
          if (isCurrentActive) {
            actionBtnHtml = `<span style="font-size: 11px; color: var(--green); font-weight: 600;">Currently Active</span>`;
          } else if (isDownloading) {
            actionBtnHtml = `<button class="btn btn-secondary btn-small" disabled>Downloading (${m.downloadProgress}%)...</button>`;
          } else if (m.isDownloaded) {
            actionBtnHtml = `
              <div style="display: flex; gap: 6px;">
                <button class="btn btn-primary btn-small btn-load-model" data-id="${m.id}">Select Model</button>
                <button class="btn btn-secondary btn-small btn-delete-model" data-id="${m.id}" title="Delete file to free space" style="color: var(--red); padding: 4px 8px;">Delete</button>
              </div>
            `;
          } else if (m.isCompatible) {
            actionBtnHtml = `<button class="btn btn-primary btn-small btn-download-model" data-id="${m.id}">Download (${m.sizeText})</button>`;
          } else {
            actionBtnHtml = `<button class="btn btn-secondary btn-small" disabled title="${m.compatibilityReason}">Requires ${m.minTotalRamGb} GB RAM</button>`;
          }

          card.innerHTML = `
            <div class="model-card-header">
              <span class="model-card-title" style="display: inline-flex; align-items: center; gap: 6px;">${m.name} ${checkIconHtml}</span>
              ${badgeHtml}
            </div>
            <div class="model-card-desc">${m.description}</div>
            <div class="model-card-specs">
              <span><img src="${downloadIcon}" width="13" height="13" class="spec-icon" /> Size: <b>${m.sizeText}</b></span>
              <span><img src="${boltIcon}" width="13" height="13" class="spec-icon" /> Memory: <b>${m.ramNeededText}</b></span>
            </div>
            <div class="model-card-footer">
              <div class="model-card-status" style="display: flex; align-items: center; gap: 5px;">
                ${m.isDownloaded ? checkmarkSvg : `<span class="status-indicator ${m.isCompatible ? '' : 'red'}"></span>`}
                <span style="color: ${m.isDownloaded ? 'var(--green)' : 'var(--text-secondary)'}; font-weight: ${m.isDownloaded ? '500' : 'normal'};">
                  ${m.isDownloaded ? 'Downloaded & Ready offline' : m.compatibilityReason}
                </span>
              </div>
              <div class="model-card-actions">${actionBtnHtml}</div>
            </div>
          `;

          // Button handlers
          card.querySelector('.btn-download-model')?.addEventListener('click', async () => {
            if (llmDownloadBanner) llmDownloadBanner.style.display = 'block';
            if (llmDownloadTitle) llmDownloadTitle.textContent = `Downloading ${m.name}...`;
            renderModelCatalogModal();
            const res = await window.electronAPI.llmDownloadModel(m.id);
            if (res.success) {
              await window.electronAPI.llmLoadModel(m.id);
              await refreshActiveChatModelUI();
            } else if (res.error && res.error !== 'Download cancelled') {
              // Keep the banner up long enough to read why it failed.
              if (llmDownloadTitle) llmDownloadTitle.textContent = `Download failed: ${res.error}`;
              await new Promise(r => setTimeout(r, 6000));
            }
            if (llmDownloadBanner) llmDownloadBanner.style.display = 'none';
            renderModelCatalogModal();
          });

          card.querySelector('.btn-load-model')?.addEventListener('click', async () => {
            const btn = card.querySelector('.btn-load-model') as HTMLButtonElement;
            if (btn) btn.textContent = 'Loading...';
            await window.electronAPI.llmLoadModel(m.id);
            await refreshActiveChatModelUI();
            renderModelCatalogModal();
          });

          card.querySelector('.btn-delete-model')?.addEventListener('click', async () => {
            if (confirm(`Delete downloaded model ${m.name} to free disk space?`)) {
              await window.electronAPI.llmDeleteModel(m.id);
              await refreshActiveChatModelUI();
              renderModelCatalogModal();
            }
          });

          grid?.appendChild(card);
        });

        modelCatalogContainer.appendChild(section);
      });
    } catch (e) {
      console.error('Failed to render model catalog:', e);
    }
  };

  chatModelPickerBtn?.addEventListener('click', async () => {
    await refreshHardwareSpecs();
    await renderModelCatalogModal();
    chatModelsModal?.classList.add('active');
  });

  chatModelsClose?.addEventListener('click', () => chatModelsModal?.classList.remove('active'));
  chatModelsDone?.addEventListener('click', () => chatModelsModal?.classList.remove('active'));

  // Live Download Progress listener
  if (window.electronAPI) {
    window.electronAPI.onLlmDownloadProgress((p: any) => {
      if (llmDownloadBanner) llmDownloadBanner.style.display = 'block';
      if (llmDownloadPct) llmDownloadPct.textContent = `${p.percent}%`;
      if (llmDownloadFill) llmDownloadFill.style.width = `${p.percent}%`;
      if (p.phase === 'verifying') {
        if (llmDownloadTitle) llmDownloadTitle.textContent = 'Verifying download...';
        if (llmDownloadBytes) llmDownloadBytes.textContent = 'Checking the file is intact';
      } else if (llmDownloadBytes && p.totalBytes > 0) {
        const loadedMb = (p.loadedBytes / (1024 * 1024)).toFixed(1);
        const totalMb = (p.totalBytes / (1024 * 1024)).toFixed(1);
        llmDownloadBytes.textContent = `${loadedMb} MB / ${totalMb} MB (${p.percent}%)`;
      }
    });

    document.getElementById('llm-download-cancel')?.addEventListener('click', () => {
      window.electronAPI.llmCancelDownload();
    });

    // Real-time Chat Token Streaming listener
    window.electronAPI.onLlmChatToken((token: string) => {
      if (currentActiveAssistantBubbleContent) {
        const indicator = currentActiveAssistantBubbleContent.querySelector('.typing-indicator');
        if (indicator) indicator.remove();
        currentActiveAssistantBubbleContent.textContent += token;
        if (chatMessagesContainer) {
          chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }
      }
    });
  }

  // Format and append chat messages
  const appendChatMessage = (role: 'user' | 'assistant', content: string) => {
    if (chatWelcome) chatWelcome.style.display = 'none';

    const msgEl = document.createElement('div');
    msgEl.className = `chat-msg ${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';

    if (role === 'assistant' && !content) {
      // Typing indicator placeholder while streaming begins
      bubble.innerHTML = `
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      `;
      currentActiveAssistantBubbleContent = bubble;
    } else {
      bubble.textContent = content;
    }

    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.innerHTML = `
      <span>${role === 'user' ? 'You' : (chatActiveModelName?.textContent || 'AI')} • ${timeStr}</span>
      ${role === 'assistant' ? `<button class="chat-copy-btn" title="Copy to clipboard">Copy</button>` : ''}
    `;

    meta.querySelector('.chat-copy-btn')?.addEventListener('click', () => {
      const textToCopy = bubble.textContent || '';
      if (window.electronAPI) window.electronAPI.copyText(textToCopy);
      const copyBtn = meta.querySelector('.chat-copy-btn');
      if (copyBtn) {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { if (copyBtn) copyBtn.textContent = 'Copy'; }, 1500);
      }
    });

    msgEl.appendChild(bubble);
    msgEl.appendChild(meta);
    chatMessagesContainer?.appendChild(msgEl);

    if (chatMessagesContainer) {
      chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }

    return bubble;
  };

  // Send message or Stop generation
  const handleSendChatMessage = async () => {
    // If output is currently generating, user click acts as immediate STOP button
    if (isGeneratingChat) {
      if (window.electronAPI) {
        await window.electronAPI.llmChatAbort();
      }
      isGeneratingChat = false;
      btnChatSend.classList.remove('stop-mode');
      btnChatSend.innerHTML = '↑';
      btnChatSend.title = 'Send message (Enter)';
      return;
    }

    const text = chatInputTextarea.value.trim();
    if (!text) return;

    if (chatWelcome) chatWelcome.style.display = 'none';

    // Append User Message
    chatMessages.push({ role: 'user', content: text, timestamp: Date.now() });
    appendChatMessage('user', text);

    chatInputTextarea.value = '';
    chatInputTextarea.style.height = 'auto';

    if (!window.electronAPI) return;

    isGeneratingChat = true;
    btnChatSend.classList.add('stop-mode');
    btnChatSend.innerHTML = `<img src="${stopIcon}" width="14" height="14" class="chat-stop-icon" />`;
    btnChatSend.title = 'Stop output';
    btnChatSend.disabled = false;

    // Append placeholder Assistant Message
    const assistantBubble = appendChatMessage('assistant', '');

    try {
      const apiMessages = chatMessages.map(m => ({ role: m.role, content: m.content }));
      const response = await window.electronAPI.llmChatSend(apiMessages);

      if (response.success && response.text) {
        chatMessages.push({ role: 'assistant', content: response.text, timestamp: Date.now() });
        assistantBubble.textContent = response.text;
      } else if (!response.success && response.error) {
        assistantBubble.innerHTML = `<span style="color: var(--red);">Error: ${escapeHtml(response.error || 'Failed to generate response')}</span>`;
      }
    } catch (err: any) {
      assistantBubble.innerHTML = `<span style="color: var(--red);">Error: ${escapeHtml(err.message || String(err))}</span>`;
    } finally {
      isGeneratingChat = false;
      btnChatSend.classList.remove('stop-mode');
      btnChatSend.innerHTML = '↑';
      btnChatSend.title = 'Send message (Enter)';
      btnChatSend.disabled = false;
      currentActiveAssistantBubbleContent = null;
    }
  };

  btnChatSend?.addEventListener('click', handleSendChatMessage);

  chatInputTextarea?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChatMessage();
    }
  });

  // Auto-resize textarea
  chatInputTextarea?.addEventListener('input', () => {
    chatInputTextarea.style.height = 'auto';
    chatInputTextarea.style.height = Math.min(chatInputTextarea.scrollHeight, 100) + 'px';
  });

  // Clear Chat History
  btnChatClear?.addEventListener('click', async () => {
    chatMessages = [];
    if (window.electronAPI) {
      await window.electronAPI.llmChatClear();
    }
    if (chatMessagesContainer) {
      chatMessagesContainer.innerHTML = '';
      if (chatWelcome) {
        chatWelcome.style.display = 'flex';
        chatMessagesContainer.appendChild(chatWelcome);
      }
    }
  });

  // Suggestion Chips
  document.querySelectorAll('.chat-suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = (chip as HTMLElement).dataset.prompt;
      if (prompt && chatInputTextarea) {
        chatInputTextarea.value = prompt;
        chatInputTextarea.focus();
        chatInputTextarea.style.height = 'auto';
        chatInputTextarea.style.height = Math.min(chatInputTextarea.scrollHeight, 100) + 'px';
      }
    });
  });

  // Voice Dictation directly into Chat Input with waveform & audio feedback
  let chatAnimationFrameId: number;
  let chatVolumeHistory: number[] = new Array(80).fill(0);
  let lastChatDrawTime = 0;
  let smoothedChatAmplitude = 0;

  const chatWaveformCanvas = document.getElementById('chat-waveform-canvas') as HTMLCanvasElement;
  const chatWaveformCtx = chatWaveformCanvas?.getContext('2d', { alpha: true });

  if (chatWaveformCanvas) {
    chatWaveformCanvas.width = 280;
    chatWaveformCanvas.height = 28;
  }

  const drawChatWaveform = (timestamp: number) => {
    if (!chatWaveformCanvas || !chatWaveformCtx) return;

    if (timestamp - lastChatDrawTime < 16) {
      if (isChatDictating) {
        chatAnimationFrameId = requestAnimationFrame(drawChatWaveform);
      }
      return;
    }
    lastChatDrawTime = timestamp;

    const dataArray = getVisualizerData();
    let currentAmplitude = 0;

    if (dataArray && dataArray.length > 0) {
      for (let i = 0; i < dataArray.length; i++) {
        const val = Math.abs(dataArray[i] - 128);
        if (val > currentAmplitude) currentAmplitude = val;
      }
    }

    if (currentAmplitude > smoothedChatAmplitude) {
      smoothedChatAmplitude += (currentAmplitude - smoothedChatAmplitude) * 0.25;
    } else {
      smoothedChatAmplitude += (currentAmplitude - smoothedChatAmplitude) * 0.18;
    }

    chatVolumeHistory.push(smoothedChatAmplitude);
    if (chatVolumeHistory.length > 80) {
      chatVolumeHistory.shift();
    }

    chatWaveformCtx.clearRect(0, 0, chatWaveformCanvas.width, chatWaveformCanvas.height);

    const primaryColor = themeProvider ? getComputedStyle(themeProvider).getPropertyValue('--btn-bg') : '#1f6feb';
    const barWidth = 2;
    const barGap = 1.2;

    chatWaveformCtx.fillStyle = primaryColor;

    for (let i = 0; i < chatVolumeHistory.length; i++) {
      const val = chatVolumeHistory[i];
      const minHeight = 2;
      let height = (val / 128) * chatWaveformCanvas.height * 3.5;
      if (height < minHeight) height = minHeight;
      if (height > chatWaveformCanvas.height) height = chatWaveformCanvas.height;

      const x = i * (barWidth + barGap);
      const y = (chatWaveformCanvas.height - height) / 2;

      chatWaveformCtx.beginPath();
      chatWaveformCtx.roundRect(x, y, barWidth, height, 2);
      chatWaveformCtx.fill();
    }

    if (isChatDictating) {
      chatAnimationFrameId = requestAnimationFrame(drawChatWaveform);
    }
  };

  let chatStreamingSession: StreamingTranscriptionSession | null = null;

  btnChatDictate?.addEventListener('click', async () => {
    // The microphone/audio state is shared with the main dictation flow; don't collide with it.
    if (!isChatDictating && (isRecording || isProcessing || !isModelLoaded())) return;

    if (isChatDictating) {
      // Stop recording and transcribe
      isChatDictating = false;
      btnChatDictate.classList.remove('recording');

      if (playSoundsEnabled) {
        const stopSound = new Audio(stopSoundFile);
        stopSound.play().catch(e => console.warn("Could not play stop sound:", e));
      }

      cancelAnimationFrame(chatAnimationFrameId);
      chatVolumeHistory.fill(0);
      smoothedChatAmplitude = 0;
      if (chatWaveformCanvas && chatWaveformCtx) {
        chatWaveformCtx.clearRect(0, 0, chatWaveformCanvas.width, chatWaveformCanvas.height);
      }
      chatWaveformCanvas?.classList.remove('active');
      chatInputTextarea?.classList.remove('recording');
      chatInputTextarea.placeholder = 'Transcribing voice prompt...';

      try {
        const { fullAudio, trailingAudio } = await stopRecordingDirect({ includeFull: chatStreamingSession === null });
        let transcribed = '';
        if (chatStreamingSession) {
          transcribed = await chatStreamingSession.finalize(trailingAudio);
        } else if (fullAudio && fullAudio.length > 0) {
          transcribed = await transcribeAudio(fullAudio, 30);
        }

        if (transcribed && transcribed.trim()) {
          const current = chatInputTextarea.value.trim();
          chatInputTextarea.value = current ? `${current} ${transcribed.trim()}` : transcribed.trim();
          chatInputTextarea.style.height = 'auto';
          chatInputTextarea.style.height = Math.min(chatInputTextarea.scrollHeight, 100) + 'px';
        }
      } catch (err) {
        console.error('Chat dictation error:', err);
      } finally {
        chatStreamingSession = null;
        chatInputTextarea.placeholder = 'Type or click WaveScribe to dictate prompt...';
        chatInputTextarea.focus();
      }
    } else {
      // Start recording
      try {
        chatStreamingSession = new StreamingTranscriptionSession();
        await startRecording({
          enableStreaming: true,
          onPhraseCompleted: (pcmChunk, meta) => {
            if (chatStreamingSession) {
              chatStreamingSession.addPhraseChunk(pcmChunk, meta);
            }
          }
        });
        isChatDictating = true;
        btnChatDictate.classList.add('recording');

        if (playSoundsEnabled) {
          const startSound = new Audio(startSoundFile);
          startSound.play().catch(e => console.warn("Could not play start sound:", e));
        }

        chatWaveformCanvas?.classList.add('active');
        chatInputTextarea?.classList.add('recording');
        chatAnimationFrameId = requestAnimationFrame(drawChatWaveform);
        chatInputTextarea.placeholder = 'Listening... Click WaveScribe when finished.';
      } catch (err) {
        console.error('Failed to start voice dictation in chat:', err);
      }
    }
  });
}

