import './style.css'
import { startRecording, stopRecordingDirect, decodeAudioBuffer, setAudioDevice, getVisualizerData, applyVAD } from './audio';
import { getHardwareInfo } from './hardware-info';
import { buildSetups, recommendDevice, defaultCpuThreads, modelFamily, SpeedSample, Setup } from './setups';
import { runSpeedTest, benchCpuThreads } from './speedtest';
import { DEFAULT_MODEL_ID, MODEL_VRAM_MB, MODEL_DETAILS, isHfModelDownloaded } from './models';
import { DEFAULT_SORT_DIR, MODEL_SORT_LABELS, parseModelSort, parseParamCount, sortModels, type ModelSort, type ModelSortKey } from './model-sort';
import { escapeHtml, removeFillers, applyDictionary, applyAutoFormatting, applySpokenCommands, countWords } from './postprocess';
import { loadModel, transcribeAudio, isModelLoaded, getCurrentDevice, StreamingTranscriptionSession } from './transcribe';
import { initDiagnostics } from './diagnostics';
import { assessLlmFit, assessSpeechFit, fitLabel, isChatOnly, rankFor, recommendLlm, LlmFit, LlmPurpose, MemorySnapshot } from './llm-fit';
import { renderChatMarkdown } from './chat-markdown';
import { icon, TITLEBAR } from './icons';
// @ts-ignore
import waveIcon from '../assets/wave.svg'
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
      onDictationHotkey: (callback: (action: 'toggle' | 'start' | 'stop', mode: 'dictate' | 'command') => void) => () => void
      captureSelection: () => Promise<{ text: string }>
      llmVoiceCommand: (instruction: string, selection: string) => Promise<{ success: boolean; text?: string; error?: string }>
      commandHotkeyState: () => Promise<{ hotkey: string; registered: boolean }>
      windowControl: (action: 'minimize' | 'maximize' | 'close') => void
      copyText: (text: string) => Promise<{ success: boolean }>
      toggleMiniMode: (isMini: boolean) => Promise<{ success: boolean }>
      onWindowMaximized: (callback: (isMax: boolean) => void) => () => void
      setWindowBounds: (bounds: any) => Promise<{ success: boolean }>
      showCursorSpinner: (mode?: 'listening' | 'working') => Promise<{ success: boolean }>
      caretIndicatorLevel: (level: number) => void
      hideCursorSpinner: () => Promise<{ success: boolean }>
      getVramMb: () => Promise<number | null>
      getHardwareProfile: () => Promise<{
        gpuName: string | null
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
        chatModelId: string
        chatStatus: 'unloaded' | 'loading' | 'ready' | 'error'
        chatError: string
      }>
      llmMemoryState: () => Promise<{ freeRamGb: number; totalRamGb: number; freeVramGb: number | null; totalVramGb: number | null; loaded: { slot: 'cleanup' | 'chat'; id: string; gb: number; onGpu: boolean }[] }>
      llmGetCatalog: () => Promise<Array<{
        id: string
        name: string
        parameters: string
        released: string
        quant: string
        sizeText: string
        approxBytes: number
        ramNeededText: string
        minTotalRamGb: number
        filename: string
        url: string
        tier: 'lightweight' | 'mid' | 'frontier'
        description: string
        activeParameters?: string
        retired?: boolean
        thinking?: 'optional' | 'always'
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
      llmReformat: (text: string, context?: string, style?: 'exact' | 'smart') => Promise<{ success: boolean; text: string; error?: string }>
      llmChatSend: (messages: { role: 'user' | 'assistant' | 'system'; content: string }[]) => Promise<{ success: boolean; text?: string; error?: string }>
      llmChatAbort: () => Promise<{ success: boolean }>
      llmChatClear: () => Promise<{ success: boolean }>
      llmChatSetModel: (modelId: string) => Promise<{ success: boolean }>
      llmChatLoad: () => Promise<{ success: boolean; error?: string }>
      llmChatUnload: () => Promise<{ success: boolean }>
      captureContext: () => Promise<{ success: boolean; text: string }>
      updateGetState: () => Promise<UpdateState>
      updateCheck: () => Promise<UpdateState>
      updateInstall: () => Promise<UpdateState>
      onUpdateState: (callback: (state: UpdateState) => void) => () => void
      showNotification: (title: string, body: string) => Promise<{ success: boolean }>
      onLlmDownloadProgress: (callback: (progress: { modelId: string; percent: number; loadedBytes: number; totalBytes: number; phase?: 'downloading' | 'verifying' }) => void) => () => void
      onLlmChatToken: (callback: (token: string) => void) => () => void
      onLlmChatThought: (callback: (text: string) => void) => () => void
      llmChatSetThinking: (on: boolean) => Promise<{ success: boolean }>
    }
  }
}

interface UpdateState {
  version: string
  status: 'dev' | 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error'
  newVersion?: string
  percent?: number
}

// Download buttons double as progress bars: the button keeps its size and fills from the left.
// Buttons carry data-dl="<model id>"; widths are remembered so a re-rendered button keeps its size.
const progressButtonWidths = new Map<string, number>();

function startButtonProgress(button: HTMLElement, modelId: string): void {
  progressButtonWidths.set(modelId, button.offsetWidth);
  button.style.width = `${button.offsetWidth}px`;
  button.dataset.dl = modelId;
  button.classList.add('btn-progress');
  button.innerHTML = '<span class="btn-label">0%</span>';
  button.style.setProperty('--p', '0%');
  (button as HTMLButtonElement).disabled = true;
}

function setButtonProgress(modelId: string, percent: number, label?: string): void {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  document.querySelectorAll<HTMLElement>(`[data-dl="${CSS.escape(modelId)}"].btn-progress`).forEach(button => {
    button.style.setProperty('--p', `${pct}%`);
    const text = button.querySelector('.btn-label');
    if (text) text.textContent = label ?? `${pct}%`;
  });
}

/** Markup for a button that is already showing download progress (after a re-render). */
function progressButtonHtml(modelId: string, percent: number, className: string): string {
  const width = progressButtonWidths.get(modelId);
  return `<button class="${className} btn-progress" data-dl="${escapeHtml(modelId)}" style="--p: ${percent}%;${width ? ` width: ${width}px;` : ''}" disabled><span class="btn-label">${percent}%</span></button>`;
}

/** "CommandOrControl+Shift+Space" -> "Ctrl + Shift + Space", as shown to the user. */
function formatHotkey(accelerator: string): string {
  return accelerator.replace(/CommandOrControl|CmdOrCtrl|Control/g, 'Ctrl').split('+').join(' + ');
}

// Developer hook used by tools/eval to benchmark CPU thread counts.
(window as any).__wavescribe = { benchCpuThreads };

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
            ${TITLEBAR.island}
          </button>
          <button class="version-chip" id="version-chip" type="button"></button>
        </div>
        <div class="drag-region"></div>
        <div class="window-controls">
          <button class="win-btn minimize" id="win-minimize" title="Minimize Window">
            ${TITLEBAR.minimize}
          </button>
          <button class="win-btn maximize" id="win-maximize" title="Maximize Window">
            ${TITLEBAR.maximize}
          </button>
          <button class="win-btn close" id="win-close" title="Close Window">
            ${TITLEBAR.close}
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
               <span class="icon">${icon('mic')}</span>
               <span class="text" id="record-btn-text">Click to Record</span>
               <canvas id="waveform-canvas"></canvas>
             </button>
             <div class="shortcut-tip">Shortcut: <span id="hotkey-display">Alt + W</span></div>
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
            ${icon('sliders')} Settings
          </button>
          <button class="btn-chat-toggle" id="btn-open-chat" title="Chat with Open Source LLMs">
            ${icon('chat')} AI Chat
          </button>
          <button class="btn-icon" id="theme-btn" title="Toggle Theme"><span id="theme-icon">${icon('sun')}</span> Theme</button>
        </div>
      </div>

      <!-- AI Chat View (Text to Text with Open Models) -->
      <div id="chat-view" class="app-view hidden">
        <div class="chat-topbar">
          <div class="chat-topbar-left">
            <button class="btn-chat-back" id="btn-chat-back" title="Back to Dictation">
              ${icon('chevronLeft')} Dictation
            </button>
            <button class="chat-model-pill" id="btn-chat-model-picker" title="Switch or Download Open Models">
              <span class="status-indicator green" id="chat-active-model-dot"></span>
              <span id="chat-active-model-name">Loading...</span>
              <span class="pill-caret">${icon('chevronDown')}</span>
            </button>
            <button class="chat-think-toggle" id="btn-chat-thinking" aria-pressed="false" style="display: none;"
              title="Let the model reason step by step before it answers. Slower, but better on hard questions.">
              <span class="chat-think-switch"></span> Thinking
            </button>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div class="chat-hw-tag" id="chat-hw-badge" title="Hardware Profile">Checking specs...</div>
            <button class="btn-chat-action" id="btn-chat-clear" title="Clear Conversation">${icon('trash')} Clear</button>
          </div>
        </div>

        <!-- Chat Messages Container -->
        <div class="chat-messages" id="chat-messages">
          <div class="chat-welcome" id="chat-welcome">
            <div class="chat-welcome-icon">${icon('chat', 36)}</div>
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
            <button class="chat-btn-circle btn-chat-mic" id="btn-chat-dictate" title="Dictate prompt via voice">${icon('wave', 20)}</button>
            <button class="chat-btn-circle btn-chat-send" id="btn-chat-send" title="Send message (Enter)">${icon('arrowUp', 20)}</button>
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
      <div class="modal-content settings-modal">
        <div class="modal-header">
          <h2>Settings</h2>
          <button class="btn-close" id="settings-close" title="Close">${icon('close')}</button>
        </div>

        <div class="modal-body">
          <div class="stat-row">
            <div class="stat"><div class="stat-value" id="metric-dictations">0</div><div class="stat-label">Dictations</div></div>
            <div class="stat"><div class="stat-value" id="metric-words">0</div><div class="stat-label">Words</div></div>
            <div class="stat"><div class="stat-value" id="metric-time">0m</div><div class="stat-label">Time saved</div></div>
            <div class="stat"><div class="stat-value" id="metric-score">--</div><div class="stat-label">Clarity</div></div>
          </div>

          <section class="s-section">
            <h3>Models</h3>
            <input type="hidden" id="setting-model" value="">
            <div class="s-card">
              <div class="s-row preset-row">
                <span class="s-label">Preset</span>
                <div class="seg" id="setup-cards" role="radiogroup" aria-label="Preset"></div>
              </div>
              <button class="m-row" id="row-speech" type="button">
                <span class="m-icon">${icon('mic')}</span>
                <span class="m-text"><span class="m-label">Voice to text</span><span class="m-value" id="speech-model-name">…</span></span>
                <span class="m-status" id="speech-model-status"></span>
                <span class="m-chev">${icon('chevronRight')}</span>
              </button>
              <div id="settings-model-progress" class="s-progress" style="display: none;">
                <div class="s-progress-text"><span id="settings-model-progress-text">Downloading…</span><span id="settings-model-progress-pct">0%</span></div>
                <div class="progress-bar-track"><div id="settings-model-progress-fill" class="progress-bar-fill" style="width: 0%;"></div></div>
              </div>
              <div class="m-row" id="row-cleanup" role="button" tabindex="0">
                <span class="m-icon">${icon('pen')}</span>
                <span class="m-text"><span class="m-label">Text cleanup</span><span class="m-value" id="cleanup-model-name">…</span></span>
                <span class="m-status" id="cleanup-model-status"></span>
                <label class="switch" title="Turn text cleanup on or off"><input type="checkbox" id="setting-ai-reformat"><span class="slider round"></span></label>
                <span class="m-chev">${icon('chevronRight')}</span>
              </div>
              <div class="s-row s-row-sub" id="row-cleanup-style">
                <span class="s-label">Cleanup style<span class="s-hint" id="cleanup-style-hint">&nbsp;</span></span>
                <select id="setting-cleanup-style" class="s-control">
                  <option value="exact">Exact words</option>
                  <option value="smart">Smart edit</option>
                </select>
              </div>
              <div id="ai-progress-bar" class="s-progress" style="display: none;">
                <div class="progress-bar-track"><div id="ai-progress-fill" class="progress-bar-fill" style="width: 0%;"></div></div>
              </div>
              <button class="m-row" id="row-chat" type="button">
                <span class="m-icon">${icon('chat')}</span>
                <span class="m-text"><span class="m-label">AI chat</span><span class="m-value" id="chat-model-name">…</span></span>
                <span class="m-status" id="chat-model-status"></span>
                <span class="m-chev">${icon('chevronRight')}</span>
              </button>
            </div>
          </section>

          <section class="s-section">
            <h3>Dictation</h3>
            <div class="s-card">
              <div class="s-row">
                <span class="s-label">Shortcut</span>
                <select id="setting-hotkey-preset" class="s-control">
                  <option value="Alt+W">Alt + W</option>
                  <option value="CommandOrControl+Shift+Space">Ctrl + Shift + Space</option>
                  <option value="Alt+Space">Alt + Space</option>
                  <option value="CommandOrControl+Alt+Space">Ctrl + Alt + Space</option>
                  <option value="CommandOrControl+Shift+D">Ctrl + Shift + D</option>
                  <option value="custom">Custom…</option>
                </select>
              </div>
              <div class="s-row" id="custom-hotkey-group" style="display: none;">
                <span class="s-label">Custom<span class="s-hint" id="hotkey-help">Click Record, then press your keys</span></span>
                <span class="s-inline">
                  <input type="text" id="setting-hotkey" value="Alt+W" readonly class="hotkey-input s-input">
                  <button class="btn btn-secondary btn-small" id="setting-hotkey-record">Record</button>
                </span>
              </div>
              <small id="hotkey-warning" class="s-warn" style="display: none;">That shortcut is taken by another app.</small>
              <div class="s-row">
                <span class="s-label">Voice command<span class="s-hint">Select text, press this and say what to change, like “make this shorter”. With nothing selected, it writes what you ask for</span></span>
                <select id="setting-command-hotkey" class="s-control">
                  <option value="Alt+Shift+W">Alt + Shift + W</option>
                  <option value="CommandOrControl+Alt+Space">Ctrl + Alt + Space</option>
                  <option value="CommandOrControl+Shift+E">Ctrl + Shift + E</option>
                  <option value="CommandOrControl+Shift+K">Ctrl + Shift + K</option>
                  <option value="off">Off</option>
                </select>
              </div>
              <small id="command-hotkey-warning" class="s-warn" style="display: none;">That shortcut is the dictation shortcut or is taken by another app.</small>
              <div class="s-row">
                <span class="s-label">Push to talk</span>
                <label class="switch"><input type="checkbox" id="setting-push-to-talk"><span class="slider round"></span></label>
              </div>
              <div class="s-row">
                <span class="s-label">Microphone</span>
                <select id="setting-microphone" class="s-control"><option value="default">System default</option></select>
              </div>
            </div>
          </section>

          <section class="s-section">
            <h3>Text</h3>
            <div class="s-card">
              <div class="s-row">
                <span class="s-label">Remove filler words</span>
                <label class="switch"><input type="checkbox" id="setting-filler-words" checked><span class="slider round"></span></label>
              </div>
              <div class="s-row">
                <span class="s-label">Capitalize sentences</span>
                <label class="switch"><input type="checkbox" id="setting-capitalize" checked><span class="slider round"></span></label>
              </div>
              <div class="s-row">
                <span class="s-label">End with a period</span>
                <label class="switch"><input type="checkbox" id="setting-punctuate" checked><span class="slider round"></span></label>
              </div>
              <button class="m-row m-row-plain" id="dict-manage-btn" type="button">
                <span class="s-label">Custom words</span>
                <span class="m-chev">${icon('chevronRight')}</span>
              </button>
            </div>
          </section>

          <section class="s-section">
            <h3>General</h3>
            <div class="s-card">
              <div class="s-row">
                <span class="s-label">Sounds</span>
                <label class="switch"><input type="checkbox" id="setting-sounds" checked><span class="slider round"></span></label>
              </div>
              <div class="s-row">
                <span class="s-label">Notifications</span>
                <label class="switch"><input type="checkbox" id="setting-notifications" checked><span class="slider round"></span></label>
              </div>
            </div>
          </section>

          <details class="s-adv">
            <summary>Advanced</summary>
            <div class="s-card">
              <div class="s-row">
                <span class="s-label">Voice processor<span class="s-hint" id="device-hint">&nbsp;</span></span>
                <select id="setting-compute-device" class="s-control">
                  <option value="auto">Auto</option>
                  <option value="cpu">CPU</option>
                  <option value="webgpu">GPU</option>
                </select>
              </div>
              <div class="s-row">
                <span class="s-label">Speed test</span>
                <button class="btn btn-secondary btn-small" id="btn-speed-test">Run</button>
              </div>
              <div class="s-row">
                <span class="s-label">Compare all voice models</span>
                <button class="btn btn-secondary btn-small" id="diag-run-btn">Run</button>
              </div>
            </div>
            <p class="s-note" id="speed-test-result" style="display: none;"></p>
          </details>
        </div>
      </div>
    </div>

    <!-- Dictionary Modal Overlay -->
    <div class="modal-overlay" id="dictionary-modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Manage Dictionary</h2>
          <button class="btn-close" id="dictionary-close" title="Close">${icon('close')}</button>
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
              <h2 class="picker-title" id="picker-title">Chat model</h2>
              <p class="picker-sub" id="picker-sub">Checking your PC…</p>
            </div>
            <button class="btn-close" id="chat-models-close" title="Close">${icon('close')}</button>
          </div>
          <div class="pick-sort">
            <label for="picker-sort">Sort by</label>
            <select id="picker-sort" class="s-control">
              ${(Object.keys(MODEL_SORT_LABELS) as ModelSortKey[]).map(k => `<option value="${k}">${MODEL_SORT_LABELS[k]}</option>`).join('')}
            </select>
            <button class="btn btn-secondary btn-small" id="picker-sort-dir"></button>
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

  const syncThemeIcon = () => {
    const el = document.getElementById('theme-icon');
    if (el) el.innerHTML = icon(themeProvider?.classList.contains('theme-dark') ? 'moon' : 'sun');
  };
  syncThemeIcon();

  themeBtn?.addEventListener('click', () => {
    if (themeProvider?.classList.contains('theme-dark')) {
      themeProvider.classList.remove('theme-dark');
      themeProvider.classList.add('theme-light');
    } else {
      themeProvider?.classList.remove('theme-light');
      themeProvider?.classList.add('theme-dark');
    }
    syncThemeIcon();
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

  // Mini-mode transitions. The OS resizes the window in one jump, so the UI is faded out first,
  // the window is resized while nothing is visible, and the new layout fades in once the resize
  // has actually reached the page.
  const MINI_FADE_OUT_MS = 200;
  let miniTransitionBusy = false;

  const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
  const waitForWindowResize = (timeoutMs = 250) => new Promise<void>(resolve => {
    const done = () => { window.removeEventListener('resize', done); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    window.addEventListener('resize', done);
  });

  document.getElementById('win-island')?.addEventListener('click', async () => {
    if (!window.electronAPI || miniTransitionBusy) return;
    miniTransitionBusy = true;
    try {
      document.body.classList.add('ui-leaving');
      await new Promise(r => setTimeout(r, MINI_FADE_OUT_MS));
      document.body.classList.add('ui-hidden');
      document.body.classList.remove('ui-leaving');

      // Sync current status text and dot color, and move the waveform into the island.
      const statusDot = document.getElementById('status-dot');
      const statusMessage = document.getElementById('status-message');
      const islandDot = document.getElementById('island-dot');
      const islandText = document.getElementById('island-text');
      if (islandDot && statusDot) islandDot.className = statusDot.className;
      if (islandText && statusMessage) islandText.textContent = statusMessage.textContent;
      const canvas = document.getElementById('waveform-canvas');
      const islandContent = document.querySelector('.island-content');
      if (canvas && islandContent) islandContent.appendChild(canvas);

      const resized = waitForWindowResize();
      await window.electronAPI.toggleMiniMode(true);
      await resized;
      await nextFrame();

      // Swapping both classes in one frame lets the island animate in from its hidden state.
      document.body.classList.add('mini-mode');
      document.body.classList.remove('ui-hidden');
    } finally {
      miniTransitionBusy = false;
    }
  });

  document.getElementById('mini-island')?.addEventListener('click', async () => {
    if (!window.electronAPI || miniTransitionBusy) return;
    miniTransitionBusy = true;
    try {
      document.body.classList.add('transitioning-from-mini');
      await new Promise(r => setTimeout(r, MINI_FADE_OUT_MS));

      // Hide everything before the window grows, so the old pill-sized layout never flashes.
      document.body.classList.add('ui-hidden');
      document.body.classList.remove('mini-mode', 'transitioning-from-mini');

      const canvas = document.getElementById('waveform-canvas');
      const recordBtn = document.getElementById('record-btn');
      if (canvas && recordBtn) recordBtn.appendChild(canvas);

      const resized = waitForWindowResize();
      await window.electronAPI.toggleMiniMode(false);
      await resized;
      await nextFrame();
      await nextFrame();

      document.body.classList.remove('ui-hidden');
      document.body.classList.add('ui-entering');
      setTimeout(() => document.body.classList.remove('ui-entering'), 450);
      setTimeout(triggerWaveAnimation, 200);
    } finally {
      miniTransitionBusy = false;
    }
  });

  let animationFrameId: number;
  let volumeHistory: number[] = new Array(120).fill(0);
  let lastDrawTime = 0;
  let smoothedAmplitude = 0;
  let levelFrame = 0;

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

    // Feed the caret indicator about 30 times a second, on the same scale as the bars drawn here.
    if (isRecording && window.electronAPI && ++levelFrame % 2 === 0) {
      window.electronAPI.caretIndicatorLevel(Math.min(1, (smoothedAmplitude / 128) * 3.5));
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
  // 'command': the recording is a spoken instruction for the selected text ("make this shorter").
  let recordingMode: 'dictate' | 'command' = 'dictate';

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
      const isCommand = recordingMode === 'command';
      // Copy the selection now, while the user's app still has it; it is needed once the
      // instruction has been transcribed.
      const selectionPromise = isCommand && window.electronAPI
        ? window.electronAPI.captureSelection().then(r => r.text).catch(() => '')
        : Promise.resolve('');

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

      // The caret indicator switches from listening to working while the speech is transcribed.
      if (window.electronAPI) {
        window.electronAPI.showCursorSpinner('working').catch(() => { });
      }

      try {
        // The full recording is kept even when streaming: the phrases are only a draft, and the
        // final text comes from decoding the whole recording in one pass (see finalizeWithFullPass).
        const { fullAudio, trailingAudio, durationSec, hadAudio } = await stopRecordingDirect({
          includeFull: true
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
        let polishedBySession = sessionPolishesWithLlm;
        if (activeStreamingSession) {
          const result = await activeStreamingSession.finalizeWithFullPass(trailingAudio, fullAudio);
          text = result.text;
          // The full-recording text has not been through the per-phrase cleanup, so the whole-text
          // AI cleanup below has to run on it.
          if (result.usedFullPass) polishedBySession = false;
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
          // Smart edit: "new paragraph", "new line" and "scratch that", on the whole dictation so
          // a command can act across phrases.
          const smartEdit = settings?.cleanupStyle === 'smart' && !isCommand;
          if (smartEdit) processedText = applySpokenCommands(processedText, autoCapEnabled, autoPunctEnabled);

          text = processedText;

          // AI cleanup of the whole text, only if it was not already done phrase by phrase.
          if (isCommand && window.electronAPI && text) {
            // Voice command: the transcribed words are the instruction, applied to the selection.
            const instruction = text;
            const selection = await selectionPromise;
            lap(`selection copied (${selection.length} chars)`);
            statusMessage!.textContent = selection ? 'Editing selection...' : 'Writing...';
            const islandCmd = document.getElementById('island-text');
            if (islandCmd) islandCmd.textContent = statusMessage!.textContent;
            const result = await window.electronAPI.llmVoiceCommand(instruction, selection);
            if (result.success && result.text) {
              text = result.text;
            } else {
              text = '';
              window.electronAPI.showNotification('Voice command', result.error || 'The voice command did not work.').catch(() => { });
            }
            lap('voice command done');
          } else if (settings?.aiReformat && window.electronAPI && !polishedBySession && text) {
            const llmStatus = await window.electronAPI.llmStatus();
            if (llmStatus.status === 'ready') {
              statusMessage!.textContent = 'Reformatting...';
              const islandText2 = document.getElementById('island-text');
              if (islandText2) islandText2.textContent = 'Reformatting...';

              try {
                const result = await window.electronAPI.llmReformat(text, await capturedContextPromise, smartEdit ? 'smart' : 'exact');
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

          if (finalWordsCount > 0 && !isCommand) {
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
          if (aiSettings?.aiReformat && recordingMode !== 'command') {
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
        // Smart edit needs the whole dictation at once (a correction often spans phrases), so it
        // runs after stop instead of phrase by phrase.
        if (runSettings?.aiReformat && runSettings?.cleanupStyle !== 'smart' && recordingMode !== 'command' && window.electronAPI) {
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

        // Show the indicator at the text caret while the user talks; its bars follow their voice.
        window.electronAPI?.showCursorSpinner('listening').catch(() => { });

        // Reset volume history on new recording
        volumeHistory.fill(0);
        smoothedAmplitude = 0;

        // Show and start animation, hide button text
        recordBtn?.classList.add('recording');
        const canvas = document.getElementById('waveform-canvas');
        canvas?.classList.add('active');
        drawWaveform(performance.now());

        statusDot!.className = 'status-indicator red';
        statusMessage!.textContent = recordingMode === 'command' ? 'Say what to do...' : 'Recording...';
        if (islandDot) islandDot.className = 'status-indicator red';
        if (islandText) islandText.textContent = recordingMode === 'command' ? 'Say what to do...' : 'Recording...';
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
  let pendingAction: { action: 'toggle' | 'start' | 'stop'; mode: 'dictate' | 'command' } | null = null;

  const handleHotkeyAction = (action: 'toggle' | 'start' | 'stop', mode: 'dictate' | 'command' = 'dictate') => {
    if (isProcessing) {
      pendingAction = { action, mode };
      return;
    }
    // Push-to-talk sends explicit start/stop; ignore ones that no longer make sense.
    if (action === 'start' && isRecording) return;
    if (action === 'stop' && !isRecording) return;
    // Either shortcut stops a recording; the one that started it decides what it is.
    if (!isRecording) recordingMode = mode;
    toggleRecording();
  };

  runPendingAction = () => {
    const next = pendingAction;
    pendingAction = null;
    if (next) setTimeout(() => handleHotkeyAction(next.action, next.mode), 0);
  };

  recordBtn?.addEventListener('click', () => {
    if (!isRecording) recordingMode = 'dictate';
    toggleRecording();
  });

  // Settings Modal Elements
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsClose = document.getElementById('settings-close');

  // Input Elements
  const inputHotkeyPreset = document.getElementById('setting-hotkey-preset') as HTMLSelectElement;
  const inputHotkey = document.getElementById('setting-hotkey') as HTMLInputElement;
  const btnHotkeyRecord = document.getElementById('setting-hotkey-record');
  const hotkeyWarning = document.getElementById('hotkey-warning');
  const hotkeyHelp = document.getElementById('hotkey-help');
  const inputMicrophone = document.getElementById('setting-microphone') as HTMLSelectElement;
  // The chosen voice model; a hidden field so the speed test and presets can read and set it.
  const inputModel = document.getElementById('setting-model') as HTMLInputElement;
  const inputFiller = document.getElementById('setting-filler-words') as HTMLInputElement;
  const inputCap = document.getElementById('setting-capitalize') as HTMLInputElement;
  const inputPunct = document.getElementById('setting-punctuate') as HTMLInputElement;
  const inputSounds = document.getElementById('setting-sounds') as HTMLInputElement;
  const inputNotify = document.getElementById('setting-notifications') as HTMLInputElement;
  const inputPushToTalk = document.getElementById('setting-push-to-talk') as HTMLInputElement;

  // Performance Input Elements
  const inputComputeDevice = document.getElementById('setting-compute-device') as HTMLSelectElement;

  // AI Reformatting UI Elements
  const inputAiReformat = document.getElementById('setting-ai-reformat') as HTMLInputElement;
  const inputCleanupStyle = document.getElementById('setting-cleanup-style') as HTMLSelectElement | null;
  const CLEANUP_STYLE_HINTS: Record<string, string> = {
    exact: 'Keeps every word you say; adds punctuation',
    smart: 'Drops self-corrections and false starts, makes lists. Say “new paragraph” or “scratch that”',
  };
  const showCleanupStyleHint = () => {
    const hint = document.getElementById('cleanup-style-hint');
    if (hint && inputCleanupStyle) hint.textContent = CLEANUP_STYLE_HINTS[inputCleanupStyle.value] ?? '';
  };
  inputCleanupStyle?.addEventListener('change', async () => {
    showCleanupStyleHint();
    await window.electronAPI?.setSetting('cleanupStyle', inputCleanupStyle.value);
  });
  const aiProgressBar = document.getElementById('ai-progress-bar');
  const aiProgressFill = document.getElementById('ai-progress-fill');

  /** Writes a model row's status: a short word and a coloured dot. */
  const setRowStatus = (id: string, text: string, tone: 'ok' | 'busy' | 'warn' | 'off') => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `m-status tone-${tone}`;
    el.textContent = text;
  };
  const setText = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  let cleanupModelIdForUi = '';
  let chatModelIdForUi = '';

  /** Text cleanup and AI chat rows. */
  const updateAiStatusUI = async () => {
    if (!window.electronAPI) return;
    const [s, catalog] = await Promise.all([window.electronAPI.llmStatus(), window.electronAPI.llmGetCatalog()]);
    cleanupModelIdForUi = s.activeModelId;
    chatModelIdForUi = s.chatModelId;

    const cleanupModel = catalog.find(m => m.id === s.activeModelId);
    setText('cleanup-model-name', cleanupModel?.name || 'Choose a model');
    if (!cleanupModel?.isDownloaded && s.status !== 'downloading') setRowStatus('cleanup-model-status', 'Not downloaded', 'warn');
    else if (!inputAiReformat.checked) setRowStatus('cleanup-model-status', 'Off', 'off');
    else if (s.status === 'ready') setRowStatus('cleanup-model-status', 'Ready', 'ok');
    else if (s.status === 'downloading') setRowStatus('cleanup-model-status', `${s.progress}%`, 'busy');
    else if (s.status === 'loading') setRowStatus('cleanup-model-status', 'Loading', 'busy');
    else if (s.status === 'error') setRowStatus('cleanup-model-status', 'Error', 'warn');
    else setRowStatus('cleanup-model-status', 'Ready', 'ok');
    if (aiProgressBar && s.status !== 'downloading') aiProgressBar.style.display = 'none';

    const chatModel = catalog.find(m => m.id === s.chatModelId);
    setText('chat-model-name', chatModel?.name || 'Choose a model');
    if (!chatModel?.isDownloaded) setRowStatus('chat-model-status', s.activeDownloadModelId === chatModel?.id ? `${chatModel?.downloadProgress}%` : 'Not downloaded', s.activeDownloadModelId === chatModel?.id ? 'busy' : 'warn');
    else setRowStatus('chat-model-status', 'Ready', 'ok');
  };

  if (window.electronAPI) {
    window.electronAPI.onLlmDownloadProgress((progress: any) => {
      if (progress?.modelId && progress.modelId === chatModelIdForUi && progress.modelId !== cleanupModelIdForUi) {
        setRowStatus('chat-model-status', progress.percent >= 100 ? 'Ready' : `${progress.percent}%`, progress.percent >= 100 ? 'ok' : 'busy');
        return;
      }
      // Only the cleanup model's download belongs in the cleanup row (not a chat model's).
      if (progress?.modelId && progress.modelId !== cleanupModelIdForUi) return;
      const pct = typeof progress === 'number' ? progress : (progress?.percent ?? 0);
      if (aiProgressBar) aiProgressBar.style.display = pct >= 100 ? 'none' : 'block';
      if (aiProgressFill) aiProgressFill.style.width = pct + '%';
      setRowStatus('cleanup-model-status', pct >= 100 ? 'Loading' : `${pct}%`, 'busy');
    });
  }

  // Where the voice model in use stands, kept up to date by attemptLoadModel.
  let speechLoadState: 'loading' | 'ready' | 'error' = 'loading';
  // The voice model being downloaded right now, if any, for the picker's progress button.
  let speechDownload: { modelId: string; percent: number } | null = null;
  let speechStatusRequest = 0;

  /** Voice to text row. */
  const refreshSettingsModelStatus = async () => {
    const request = ++speechStatusRequest;
    const selectedModel = inputModel?.value || DEFAULT_MODEL_ID;
    setText('speech-model-name', MODEL_DETAILS[selectedModel]?.name || selectedModel);
    const progress = document.getElementById('settings-model-progress');
    if (progress && progress.style.display === 'block') return; // the progress bar is speaking for it
    if (currentModelId === selectedModel) {
      if (speechLoadState === 'ready') setRowStatus('speech-model-status', 'Ready', 'ok');
      else if (speechLoadState === 'loading') setRowStatus('speech-model-status', 'Loading', 'busy');
      else setRowStatus('speech-model-status', 'Failed to load', 'warn');
      return;
    }
    // Chosen but not the one in use: say whether it still needs downloading. The cache lookup can
    // take seconds, so drop the answer if a newer check has already run.
    const downloaded = await isHfModelDownloaded(selectedModel);
    if (request !== speechStatusRequest) return;
    setRowStatus('speech-model-status', downloaded ? 'Not loaded' : 'Not downloaded', downloaded ? 'off' : 'warn');
  };

  // Refresh model status on device change
  inputComputeDevice?.addEventListener('change', async () => {
    await window.electronAPI?.setSetting('computeDevice', inputComputeDevice.value);
    updateDeviceHint();
    // Reload the speech model only if the device it runs on actually changes.
    const newDevice = await resolveDevice(inputModel.value, inputComputeDevice.value);
    if (!isRecording && !isProcessing && (!isModelLoaded() || newDevice !== getCurrentDevice())) {
      attemptLoadModel(inputModel.value);
    }
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

  // --- Setup recommendations, processor choice and speed test ---------------------------------

  let speedSamples: SpeedSample[] = [];
  const sampleFor = (id: string): SpeedSample | null => speedSamples.find(x => x.modelId === id) ?? null;
  const deviceLabel = (d: string) => (d === 'webgpu' ? 'GPU' : 'CPU');

  /** Turns the Processor choice (Auto / CPU / GPU) into the device that will actually be used. */
  const resolveDevice = async (modelId: string, choice: string): Promise<'cpu' | 'webgpu'> => {
    const hw = await getHardwareInfo();
    if (choice === 'cpu') return 'cpu';
    if (choice === 'webgpu') return hw.hasWebGpu ? 'webgpu' : 'cpu';
    return recommendDevice(modelId, hw, sampleFor(modelId)).device;
  };

  const updateDeviceHint = async () => {
    const hint = document.getElementById('device-hint');
    if (!hint) return;
    const hw = await getHardwareInfo();
    const gpuOption = inputComputeDevice.querySelector('option[value="webgpu"]') as HTMLOptionElement | null;
    if (gpuOption) gpuOption.disabled = !hw.hasWebGpu;

    const rec = recommendDevice(inputModel.value, hw, sampleFor(inputModel.value));
    const choice = inputComputeDevice.value;
    if (choice === 'auto') hint.textContent = `Auto uses the ${deviceLabel(rec.device)}: ${rec.reason}`;
    else if (choice === rec.device) hint.textContent = rec.reason;
    else hint.textContent = `${deviceLabel(rec.device)} is recommended: ${rec.reason}`;
  };

  const showSetupNote = (text: string) => {
    const note = document.getElementById('speed-test-result');
    if (!note) return;
    note.textContent = text;
    note.style.display = text ? 'block' : 'none';
  };

  const applySetup = async (setup: Setup, button: HTMLButtonElement, llmSize: string | null, needsDownload: boolean) => {
    if (!window.electronAPI || isRecording || isProcessing) return;
    if (needsDownload && !confirm(`${setup.name} uses ${setup.llmModelName} for AI cleanup, a ${llmSize} download. Continue?`)) return;

    // Highlight the chosen preset at once; the model rows below show progress while it applies.
    document.querySelectorAll<HTMLButtonElement>('#setup-cards .seg-btn').forEach(b => {
      b.classList.toggle('is-active', b === button);
      b.disabled = true;
    });
    button.classList.add('is-busy');
    // What each row shows (model, and whether cleanup is on), to flash the ones the preset changes.
    const rowValues = () => [
      document.getElementById('speech-model-name')?.textContent,
      `${document.getElementById('cleanup-model-name')?.textContent}|${inputAiReformat.checked}`,
    ];
    const before = rowValues();
    const flashed = new Set<string>();
    const flashChangedRows = () => {
      const after = rowValues();
      ['row-speech', 'row-cleanup'].forEach((id, i) => {
        const row = document.getElementById(id);
        if (!row || before[i] === after[i] || flashed.has(id)) return;
        flashed.add(id);
        row.classList.remove('m-row-flash');
        void row.offsetWidth;
        row.classList.add('m-row-flash');
      });
    };
    try {
      await window.electronAPI.setSetting('model', setup.speechModel);
      await window.electronAPI.setSetting('computeDevice', 'auto');
      await window.electronAPI.setSetting('aiReformat', setup.aiCleanup);
      inputModel.value = setup.speechModel;
      inputComputeDevice.value = 'auto';
      inputAiReformat.checked = setup.aiCleanup;
      await refreshSettingsModelStatus();
      await updateAiStatusUI();
      flashChangedRows();

      if (setup.aiCleanup && setup.llmModelId) {
        if (needsDownload) {
          startButtonProgress(button, setup.llmModelId);
          const dl = await window.electronAPI.llmDownloadModel(setup.llmModelId);
          if (!dl.success) throw new Error(dl.error || 'Download failed');
        }
        const loading = window.electronAPI.llmLoadModel(setup.llmModelId);
        await updateAiStatusUI();
        flashChangedRows();
        await loading;
        await updateAiStatusUI();
      }

      const device = await resolveDevice(setup.speechModel, 'auto');
      if (!isModelLoaded() || setup.speechModel !== currentModelId || device !== getCurrentDevice()) {
        // A voice model that is not downloaded yet fills the button while it downloads.
        if (!(await isHfModelDownloaded(setup.speechModel))) startButtonProgress(button, setup.speechModel);
        await attemptLoadModel(setup.speechModel);
      }
      showSetupNote('');
    } catch (err: any) {
      showSetupNote(`Could not apply ${setup.name}: ${err?.message || err}`);
    } finally {
      await updateAiStatusUI();
      await refreshSettingsModelStatus();
      await updateDeviceHint();
      await renderSetupCards();
    }
  };

  /**
   * Fast / Balanced / Precise set the voice model and text cleanup together. The highlight always
   * follows the models actually in use: a preset lights up whenever they match it exactly, however
   * they were chosen, and "Custom" lights up when they match none.
   */
  const renderSetupCards = async () => {
    const host = document.getElementById('setup-cards');
    if (!host) return;

    const hw = await getHardwareInfo();
    const plan = buildSetups(hw, speedSamples);
    const settings = window.electronAPI ? await window.electronAPI.getSettings() : null;
    const catalog: any[] = window.electronAPI ? await window.electronAPI.llmGetCatalog() : [];
    const cleanupModelId = window.electronAPI ? (await window.electronAPI.llmStatus()).activeModelId : null;
    const speechModel = settings?.model || DEFAULT_MODEL_ID;
    const cleanupOn = !!settings?.aiReformat;

    const matches = (setup: Setup) => speechModel === setup.speechModel
      && cleanupOn === setup.aiCleanup
      && (!setup.aiCleanup || cleanupModelId === setup.llmModelId);
    const activeId = plan.setups.find(matches)?.id ?? null;

    host.innerHTML = '';
    for (const setup of plan.setups) {
      const llm = catalog.find(m => m.id === setup.llmModelId);
      const needsDownload = setup.aiCleanup && !!llm && !llm.isDownloaded;
      const isActive = setup.id === activeId;
      const unavailable = setup.fit === 'unavailable';

      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(isActive));
      button.className = 'seg-btn' + (isActive ? ' is-active' : '') + (setup.id === plan.recommendedId ? ' is-rec' : '');
      button.textContent = setup.name;
      button.disabled = unavailable;
      const parts = [setup.speechModelName, setup.aiCleanup ? `${setup.llmModelName} cleanup` : 'no AI cleanup'];
      button.title = `${setup.tagline} ${parts.join(' + ')}.${setup.id === plan.recommendedId ? ' Recommended for this PC.' : ''}${unavailable ? ` ${setup.fitNote}.` : ''}`;
      button.addEventListener('click', () => { if (!button.classList.contains('is-active')) applySetup(setup, button, llm?.sizeText ?? null, needsDownload); });
      host.appendChild(button);
    }

    // Shown, not clicked: it lights up when the models below are your own mix.
    const custom = document.createElement('span');
    custom.className = 'seg-btn seg-custom' + (activeId ? '' : ' is-active');
    custom.setAttribute('role', 'radio');
    custom.setAttribute('aria-checked', String(!activeId));
    custom.setAttribute('aria-disabled', 'true');
    custom.textContent = 'Custom';
    custom.title = 'Your own choice of models. Pick a preset to replace it.';
    host.appendChild(custom);
  };

  document.getElementById('btn-speed-test')?.addEventListener('click', async () => {
    const button = document.getElementById('btn-speed-test') as HTMLButtonElement;
    if (isRecording || isProcessing) return;
    const modelId = inputModel.value;
    const name = MODEL_DETAILS[modelId]?.name || modelId;
    const hw = await getHardwareInfo();
    if (!confirm(`Test ${name} on this PC? It takes about a minute and may download the model first. Please don't dictate meanwhile.`)) return;

    button.disabled = true;
    try {
      const sample = await runSpeedTest(modelId, hw.hasWebGpu, hw.cpuCores, showSetupNote);
      speedSamples = [...speedSamples.filter(x => x.modelId !== modelId), sample];
      await window.electronAPI?.setSetting('speedSamples', speedSamples);
      if (sample.cpuThreads) {
        await window.electronAPI?.setSetting('cpuThreads', sample.cpuThreads);
        // Apply right away if the model in use runs on the CPU with a different thread count.
        if (getCurrentDevice() === 'cpu' && loadedCpuThreads !== sample.cpuThreads && !isRecording && !isProcessing) {
          attemptLoadModel(currentModelId);
        }
      }
      const rec = recommendDevice(modelId, hw, sample);
      const secs = (ms: number | null) => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(2)} s`);
      showSetupNote(`${name}: CPU ${secs(sample.cpuMs)}${sample.cpuThreads ? ` (${sample.cpuThreads} threads)` : ''} \u00b7 GPU ${hw.hasWebGpu ? secs(sample.gpuMs) : 'not available'}. ${rec.reason}.`);
      await updateDeviceHint();
      await renderSetupCards();
    } catch (err: any) {
      showSetupNote(`Test failed: ${err?.message || err}`);
    } finally {
      button.disabled = false;
    }
  });

  const loadSettingsAndShow = async () => {
    let savedMicrophone: string | null = null;
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
        savedMicrophone = settings.microphone || null;
        inputModel.value = settings.model || DEFAULT_MODEL_ID;

        // Processor: new profiles default to Auto (the app picks CPU or GPU for the chosen model)
        inputComputeDevice.value = settings.computeDevice ?? 'auto';
        speedSamples = Array.isArray(settings.speedSamples) ? settings.speedSamples : [];

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
        if (inputCleanupStyle) inputCleanupStyle.value = settings.cleanupStyle === 'smart' ? 'smart' : 'exact';
      }
    }
    showCleanupStyleHint();
    void refreshCommandHotkey();
    updateDashboardUI();
    showSetupNote('');
    settingsModal?.classList.add('active');
    await Promise.all([
      populateMics().then(() => { if (savedMicrophone) inputMicrophone.value = savedMicrophone; }),
      updateAiStatusUI(),
      refreshSettingsModelStatus(),
      updateDeviceHint(),
      renderSetupCards(),
    ]);
  };

  settingsBtn?.addEventListener('click', loadSettingsAndShow);

  let activeKeydownListener: ((e: KeyboardEvent) => void) | null = null;
  let previousValidHotkey = 'Alt+W';

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
      void applyHotkey(inputHotkeyPreset.value);
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
      if (hotkeyHelp) hotkeyHelp.textContent = 'Press combination (e.g. Alt+W, Ctrl+Shift+Space). Esc to cancel.';
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
        void applyHotkey(hotkeyStr);
        if (hotkeyHelp) {
          hotkeyHelp.textContent = 'Click Record, then press your keys';
          hotkeyHelp.style.color = 'var(--text-secondary)';
        }
      };

      document.addEventListener('keydown', activeKeydownListener);
    } else {
      stopHotkeyRecording(true);
    }
  });

  // Every setting applies the moment it changes; there is no Save button.

  const markHotkey = (ok: boolean) => {
    const color = ok ? 'var(--text-primary)' : 'var(--red)';
    const border = ok ? 'var(--border-color)' : 'var(--red)';
    inputHotkey.style.borderColor = border;
    inputHotkey.style.color = color;
    inputHotkeyPreset.style.borderColor = border;
    inputHotkeyPreset.style.color = color;
    hotkeyWarning!.style.display = ok ? 'none' : 'block';
  };

  const applyHotkey = async (hotkey: string) => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.setSetting('hotkey', hotkey);
    const ok = !(result && result.success === false);
    markHotkey(ok);
    if (ok) {
      const hotkeyDisplay = document.getElementById('hotkey-display');
      if (hotkeyDisplay) hotkeyDisplay.textContent = formatHotkey(hotkey);
    }
  };

  inputMicrophone?.addEventListener('change', async () => {
    await window.electronAPI?.setSetting('microphone', inputMicrophone.value);
    setAudioDevice(inputMicrophone.value === 'default' ? null : inputMicrophone.value);
  });

  const bindSwitch = (input: HTMLInputElement, key: string, after?: (on: boolean) => void) => {
    input?.addEventListener('change', async () => {
      await window.electronAPI?.setSetting(key, input.checked);
      after?.(input.checked);
    });
  };
  bindSwitch(inputFiller, 'removeFiller');
  bindSwitch(inputCap, 'autoCap');
  bindSwitch(inputPunct, 'autoPunct');
  bindSwitch(inputPushToTalk, 'pushToTalk');

  const inputCommandHotkey = document.getElementById('setting-command-hotkey') as HTMLSelectElement | null;
  const commandHotkeyWarning = document.getElementById('command-hotkey-warning');
  const refreshCommandHotkey = async () => {
    if (!window.electronAPI || !inputCommandHotkey) return;
    const state = await window.electronAPI.commandHotkeyState();
    inputCommandHotkey.value = state.hotkey;
    if (commandHotkeyWarning) commandHotkeyWarning.style.display = state.registered ? 'none' : 'block';
  };
  inputCommandHotkey?.addEventListener('change', async () => {
    const result = await window.electronAPI.setSetting('commandHotkey', inputCommandHotkey.value);
    if (commandHotkeyWarning) commandHotkeyWarning.style.display = result?.success === false ? 'block' : 'none';
    if (result?.success === false) {
      // Keep showing what is actually in effect.
      const state = await window.electronAPI.commandHotkeyState();
      inputCommandHotkey.value = state.hotkey;
    }
  });
  bindSwitch(inputSounds, 'playSounds', (on) => { playSoundsEnabled = on; });
  bindSwitch(inputNotify, 'showNotify', (on) => { showNotifyEnabled = on; });

  inputAiReformat?.addEventListener('change', async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.setSetting('aiReformat', inputAiReformat.checked);
    if (inputAiReformat.checked) {
      const [s, catalog] = await Promise.all([window.electronAPI.llmStatus(), window.electronAPI.llmGetCatalog()]);
      if (!catalog.find(m => m.id === s.activeModelId)?.isDownloaded) {
        // Nothing to turn on yet: let the user pick and download a cleanup model.
        await openModelPicker('cleanup');
      } else if (s.status !== 'ready' && s.status !== 'downloading' && s.status !== 'loading') {
        const loading = window.electronAPI.llmInit();
        await updateAiStatusUI();
        await loading;
      }
    }
    await updateAiStatusUI();
    await renderSetupCards();
  });

  if (window.electronAPI) {
    window.electronAPI.onDictationHotkey((action, mode) => {
      handleHotkeyAction(action, mode);
    });

    window.electronAPI.onWindowMaximized((isMax: boolean) => {
      document.body.classList.toggle('maximized', isMax);
    });

    // Read settings & history
    window.electronAPI.getSettings().then((settings) => {
      if (settings) {
        if (settings.hotkey) {
          document.getElementById('hotkey-display')!.textContent = formatHotkey(settings.hotkey);
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
  let loadedCpuThreads: number | undefined;

  const modelErrorActions = document.getElementById('model-error-actions');
  const modelRetryBtn = document.getElementById('model-retry-btn');
  const modelTinyBtn = document.getElementById('model-tiny-btn');

  const attemptLoadModel = async (modelId: string) => {
    currentModelId = modelId;
    speechLoadState = 'loading';
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
      setButtonProgress(modelId, pctClamped, isCompiling ? 'Loading' : undefined);
      speechDownload = isCompiling ? null : { modelId, percent: pctClamped };

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

      setRowStatus('speech-model-status', isCompiling ? 'Loading' : pctStr, 'busy');
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
    let threads: number | undefined = undefined;
    if (window.electronAPI) {
      const s = await window.electronAPI.getSettings();
      speedSamples = Array.isArray(s?.speedSamples) ? s.speedSamples : speedSamples;
      device = await resolveDevice(modelId, s?.computeDevice ?? 'auto');
      // Tuned thread count applies to CPU decoding only; the GPU path stays at one helper thread.
      if (device === 'cpu') {
        threads = typeof s?.cpuThreads === 'number' ? s.cpuThreads : defaultCpuThreads((await getHardwareInfo()).cpuCores);
      }
      loadedCpuThreads = device === 'cpu' ? threads : undefined;
      // Automatically assign the optimal precision behind the scenes:
      // - WebGPU: 'auto' (fp32) for fast & accurate speech recognition
      // - CPU: undefined (pre-quantized q8 weights) for highest CPU performance
      dtype = undefined;
    }

    const fileMap = new Map<string, { loaded: number; total: number; progress: number; done: boolean }>();

    const setModelReadyUI = () => {
      speechLoadState = 'ready';
      speechDownload = null;
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
      speechLoadState = 'error';
      speechDownload = null;
      if (mainProgress) mainProgress.style.display = 'none';
      if (settingsProgress) settingsProgress.style.display = 'none';
      refreshSettingsModelStatus().catch(() => {});
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
      await loadModel(modelId, device, dtype, progressCallback, threads);
      setModelReadyUI();
    } catch (err: any) {
      if (err?.code === 'WEBGPU_UNAVAILABLE') {
        console.warn('[Model] WebGPU not available, falling back to CPU');
        if (window.electronAPI) await window.electronAPI.setSetting('computeDevice', 'cpu');
        if (inputComputeDevice) inputComputeDevice.value = 'cpu';
        try {
          await loadModel(modelId, 'cpu', undefined, progressCallback, threads);
          setModelReadyUI();
        } catch (cpuErr) {
          handleLoadError(cpuErr);
        }
      } else if (isOOM(err) && device === 'webgpu') {
        console.warn('[Model] WebGPU OOM — falling back to CPU');
        statusMessage!.textContent = 'GPU out of memory — falling back to CPU';
        if (window.electronAPI) await window.electronAPI.setSetting('computeDevice', 'cpu');
        if (inputComputeDevice) inputComputeDevice.value = 'cpu';
        try {
          await loadModel(modelId, 'cpu', undefined, progressCallback, threads);
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

  // --- Version and updates ---
  // The title bar shows the version. The app checks for updates by itself; as soon as one is found the
  // chip becomes "Update to vX". One click installs it: straight away if it has finished
  // downloading in the background, otherwise as soon as it has (showing progress meanwhile).
  const versionChip = document.getElementById('version-chip') as HTMLButtonElement | null;
  let updateState: UpdateState | null = null;
  let installWhenReady = false;
  let manualCheck = false;
  let chipNoteTimer: ReturnType<typeof setTimeout> | null = null;
  let installWaitTimer: ReturnType<typeof setInterval> | null = null;

  const renderVersionChip = (note?: string) => {
    if (!versionChip || !updateState) return;
    const u = updateState;
    let html = escapeHtml(`v${u.version}`);
    let mode = 'quiet';
    let title = 'Check for updates';
    if (u.status === 'dev') {
      html = escapeHtml(`v${u.version} \u00b7 dev`);
      title = 'Development build: updates are off';
    } else if (u.status === 'downloading' || u.status === 'ready') {
      const target = `Update to v${u.newVersion}`;
      if (installWhenReady) {
        html = escapeHtml(u.status === 'ready' ? 'Restarting\u2026' : `Updating ${u.percent ?? 0}%`);
        mode = 'busy';
        title = `Installing version ${u.newVersion}. WaveScribe restarts by itself.`;
      } else {
        html = `${icon('arrowUp', 13)}<span>${escapeHtml(target)}</span>`;
        mode = 'ready';
        title = u.status === 'ready'
          ? `Version ${u.newVersion} is ready. Click to restart into it (a few seconds).`
          : `Version ${u.newVersion} is downloading. Click to install it as soon as it is ready.`;
      }
    } else if (note) {
      html = escapeHtml(note);
    } else if (u.status === 'checking' && manualCheck) {
      html = 'Checking\u2026';
    }
    versionChip.innerHTML = html;
    versionChip.className = `version-chip chip-${mode}`;
    versionChip.title = title;
  };

  const showChipNote = (note: string) => {
    renderVersionChip(note);
    if (chipNoteTimer) clearTimeout(chipNoteTimer);
    chipNoteTimer = setTimeout(() => { chipNoteTimer = null; renderVersionChip(); }, 3000);
  };

  /** Restarts into the downloaded update, waiting for any dictation in progress to finish first. */
  const installWhenIdle = () => {
    if (installWaitTimer || !window.electronAPI) return;
    const tryInstall = () => {
      if (isRecording || isProcessing) return;
      if (installWaitTimer) { clearInterval(installWaitTimer); installWaitTimer = null; }
      window.electronAPI.updateInstall();
    };
    installWaitTimer = setInterval(tryInstall, 1000);
    tryInstall();
  };

  versionChip?.addEventListener('click', async () => {
    if (!window.electronAPI || !updateState) return;
    const status = updateState.status;
    if (status === 'downloading' || status === 'ready') {
      installWhenReady = true;
      renderVersionChip();
      if (status === 'ready') installWhenIdle();
    } else if (status !== 'dev') {
      manualCheck = true;
      renderVersionChip();
      await window.electronAPI.updateCheck();
    }
  });

  if (window.electronAPI) {
    window.electronAPI.onUpdateState((state) => {
      updateState = state;
      if (manualCheck && (state.status === 'up-to-date' || state.status === 'error')) {
        manualCheck = false;
        showChipNote(state.status === 'up-to-date' ? 'Up to date \u2713' : 'Couldn\u2019t check');
        return;
      }
      renderVersionChip();
      if (state.status === 'ready' && installWhenReady) installWhenIdle();
    });
    window.electronAPI.updateGetState().then((state) => { updateState = state; renderVersionChip(); }).catch(() => { });
  }

  if (window.electronAPI) {
    window.electronAPI.getSettings().then(async (settings) => {
      const modelId = settings?.model ?? DEFAULT_MODEL_ID;
      inputModel.value = modelId;

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
  const btnChatThinking = document.getElementById('btn-chat-thinking') as HTMLButtonElement | null;
  const chatMessagesContainer = document.getElementById('chat-messages');
  const chatWelcome = document.getElementById('chat-welcome');
  const chatInputTextarea = document.getElementById('chat-input-textarea') as HTMLTextAreaElement;
  const btnChatDictate = document.getElementById('btn-chat-dictate');
  const btnChatSend = document.getElementById('btn-chat-send') as HTMLButtonElement;

  const chatModelsModal = document.getElementById('chat-models-modal');
  const chatModelsClose = document.getElementById('chat-models-close');
  const chatModelsDone = document.getElementById('chat-models-done');
  const pickerTitle = document.getElementById('picker-title');
  const pickerSub = document.getElementById('picker-sub');
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
  let streamingReplyText = '';
  let streamingRenderPending = false;
  // The model's reasoning for the reply being streamed, shown in a collapsible section above it.
  let streamingThoughtEl: HTMLDetailsElement | null = null;
  let streamingThoughtText = '';
  let chatThinkingOn: boolean | null = null;
  let chatModelDisplayName = 'AI';
  let chatUnloadTimer: ReturnType<typeof setTimeout> | null = null;

  // The chat model is only kept in memory while chat is in use, so it never competes with dictation.
  const CHAT_UNLOAD_DELAY_MS = 60_000;

  // View Navigation
  const switchToChatView = async () => {
    if (dictationView && chatView) {
      if (chatUnloadTimer) { clearTimeout(chatUnloadTimer); chatUnloadTimer = null; }
      dictationView.classList.add('hidden');
      chatView.classList.remove('hidden');
      chatInputTextarea?.focus();
      await refreshHardwareSpecs();
      await refreshActiveChatModelUI();
      void ensureChatModelLoaded();
    }
  };

  const switchToDictationView = () => {
    if (dictationView && chatView) {
      chatView.classList.add('hidden');
      dictationView.classList.remove('hidden');
      if (chatUnloadTimer) clearTimeout(chatUnloadTimer);
      chatUnloadTimer = setTimeout(() => {
        chatUnloadTimer = null;
        if (!isGeneratingChat && chatView.classList.contains('hidden')) {
          window.electronAPI?.llmChatUnload();
        }
      }, CHAT_UNLOAD_DELAY_MS);
    }
  };

  btnOpenChat?.addEventListener('click', switchToChatView);
  btnChatBack?.addEventListener('click', switchToDictationView);

  btnChatThinking?.addEventListener('click', async () => {
    if (isGeneratingChat) return; // switching restarts the session; wait for the reply to finish
    chatThinkingOn = !chatThinkingOn;
    await window.electronAPI.llmChatSetThinking(chatThinkingOn);
    await refreshActiveChatModelUI();
  });

  const refreshHardwareSpecs = async () => {
    if (!window.electronAPI || !chatHwBadge) return;
    try {
      const hw = await window.electronAPI.getHardwareProfile();
      const vram = hw.gpuVramMb ? ` · ${Math.round(hw.gpuVramMb / 1024)} GB GPU` : '';
      chatHwBadge.textContent = `${Math.round(hw.totalRamGb)} GB RAM${vram}`;
    } catch (e) {
      console.warn('Failed to get hardware specs:', e);
    }
  };

  const refreshActiveChatModelUI = async () => {
    if (!window.electronAPI) return;
    try {
      const s = await window.electronAPI.llmStatus();
      const catalog = await window.electronAPI.llmGetCatalog();
      const chosen = catalog.find(m => m.id === s.chatModelId);
      chatModelDisplayName = chosen?.name || 'AI';

      if (chatThinkingOn === null) chatThinkingOn = (await window.electronAPI.getSettings())?.chatThinking === true;
      if (btnChatThinking) {
        btnChatThinking.style.display = chosen?.thinking === 'optional' ? '' : 'none';
        btnChatThinking.setAttribute('aria-pressed', String(chatThinkingOn));
        btnChatThinking.classList.toggle('is-on', chatThinkingOn);
      }

      if (chatActiveModelName) {
        chatActiveModelName.textContent = !chosen ? 'Choose a model'
          : !chosen.isDownloaded ? `${chosen.name} · not downloaded`
          : s.chatStatus === 'loading' ? `${chosen.name} · loading…`
          : chosen.name;
      }
      if (chatActiveModelDot) {
        chatActiveModelDot.className = !chosen?.isDownloaded ? 'status-indicator'
          : s.chatStatus === 'ready' ? 'status-indicator green'
          : s.chatStatus === 'loading' ? 'status-indicator loading'
          : s.chatStatus === 'error' ? 'status-indicator red'
          : 'status-indicator';
      }
    } catch (e) {
      console.warn('Failed to refresh active chat model UI:', e);
    }
  };

  /** Loads the chat model in the background while the chat view is open. */
  const ensureChatModelLoaded = async () => {
    if (!window.electronAPI || chatView?.classList.contains('hidden')) return;
    const s = await window.electronAPI.llmStatus();
    const catalog = await window.electronAPI.llmGetCatalog();
    if (s.chatStatus === 'ready' || !catalog.find(m => m.id === s.chatModelId)?.isDownloaded) return;
    const pending = window.electronAPI.llmChatLoad();
    await refreshActiveChatModelUI();
    await pending;
    await refreshActiveChatModelUI();
  };

  // ---- Model picker (voice to text, text cleanup and AI chat) ----

  type PickerPurpose = LlmPurpose | 'speech';
  let pickerPurpose: PickerPurpose = 'chat';

  // Voice models in the order shown, each with a one-word sense of what it is for.
  const SPEECH_MODELS: { id: string; tag: string }[] = [
    { id: 'onnx-community/moonshine-base-ONNX', tag: 'Fast and accurate' },
    { id: 'onnx-community/moonshine-tiny-ONNX', tag: 'Fastest' },
    { id: 'Xenova/whisper-base.en', tag: 'Balanced' },
    { id: 'Xenova/whisper-tiny.en', tag: 'Basic' },
    { id: 'Xenova/whisper-small.en', tag: 'Accurate' },
    { id: 'distil-whisper/distil-small.en', tag: 'Accurate' },
    { id: 'distil-whisper/distil-medium.en', tag: 'Very accurate' },
    { id: 'distil-whisper/distil-large-v3', tag: 'Most accurate' },
  ];

  const gb = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

  /** "Free now: 21 GB memory · 13 GB graphics": what the recommendations are based on. */
  const describeFreeMemory = (mem: MemorySnapshot) =>
    `Free now: ${gb(mem.freeRamGb)} GB memory` + (mem.freeVramGb === null ? ' · no graphics card in use' : ` · ${gb(mem.freeVramGb)} GB graphics`);

  const refreshAfterModelChange = async () => {
    await refreshActiveChatModelUI();
    await updateAiStatusUI();
    await refreshSettingsModelStatus();
    if (settingsModal?.classList.contains('active')) await renderSetupCards();
    if (chatModelsModal?.classList.contains('active')) await renderModelPicker();
  };

  const useModel = async (purpose: PickerPurpose, modelId: string) => {
    if (purpose === 'speech') {
      inputModel.value = modelId;
      await window.electronAPI.setSetting('model', modelId);
      const loading = attemptLoadModel(modelId);
      await refreshSettingsModelStatus();
      await loading;
      await refreshAfterModelChange();
    } else if (purpose === 'chat') {
      await window.electronAPI.llmChatSetModel(modelId);
      await refreshAfterModelChange();
      void ensureChatModelLoaded();
    } else {
      const pending = window.electronAPI.llmLoadModel(modelId);
      await updateAiStatusUI();
      await pending;
      await refreshAfterModelChange();
    }
  };

  interface PickerRow {
    id: string;
    name: string;
    tip: string;
    fit: LlmFit;
    /** Graphics-memory note: shown green when ok, muted when not. */
    gpuNote: { text: string; ok: boolean } | null;
    extra: string | null;
    isDownloaded: boolean;
    downloadProgress: number | null;
    sizeText: string;
    removable: boolean;
    rank: number;
    /** e.g. "26B parameters (3.8B active)". */
    paramsText: string;
    params: number;
    bytes: number;
    released: string;
  }

  const speechRows = async (mem: MemorySnapshot): Promise<{ rows: PickerRow[]; selectedId: string; recommendedId: string }> => {
    const hw = await getHardwareInfo();
    const rows = await Promise.all(SPEECH_MODELS.map(async ({ id, tag }, rank) => {
      const device = await resolveDevice(id, inputComputeDevice.value);
      const needsGpu = modelFamily(id) === 'distil';
      const verdict = assessSpeechFit(device, needsGpu, MODEL_VRAM_MB[id]?.auto ?? 0, { hasWebGpu: hw.hasWebGpu, freeVramGb: mem.freeVramGb });
      // Voice models say where they run; most are fastest on the processor.
      const gpuNote = verdict.onGpu ? { text: 'Runs on graphics card', ok: true }
        : device === 'webgpu' && hw.hasWebGpu ? { text: 'Not enough graphics memory', ok: false }
        : needsGpu ? { text: 'Needs a graphics card', ok: false }
        : { text: 'Runs on processor', ok: true };
      return {
        id, name: MODEL_DETAILS[id]?.name || id, tip: tag, fit: verdict.fit,
        gpuNote, extra: tag,
        isDownloaded: await isHfModelDownloaded(id),
        downloadProgress: speechDownload?.modelId === id ? speechDownload.percent : null,
        sizeText: MODEL_DETAILS[id]?.sizeText || '', removable: false, rank,
        paramsText: MODEL_DETAILS[id]?.params ? `${MODEL_DETAILS[id].params} parameters` : '', params: parseParamCount(MODEL_DETAILS[id]?.params || ''),
        bytes: MODEL_DETAILS[id]?.approxBytes ?? 0, released: MODEL_DETAILS[id]?.released || '',
      };
    }));
    return { rows, selectedId: inputModel.value || DEFAULT_MODEL_ID, recommendedId: DEFAULT_MODEL_ID };
  };

  const llmRows = async (purpose: LlmPurpose, mem: MemorySnapshot): Promise<{ rows: PickerRow[]; selectedId: string; recommendedId: string | null }> => {
    const [catalog, status] = await Promise.all([window.electronAPI.llmGetCatalog(), window.electronAPI.llmStatus()]);
    const models = catalog.filter(m => purpose === 'chat' || !isChatOnly(m.id));
    const rows = models.map(m => {
      const f = assessLlmFit(m, purpose, mem);
      return {
        id: m.id, name: m.name, tip: m.description, fit: f.fit,
        extra: purpose !== 'chat' ? null : m.thinking === 'optional' ? 'Can think before answering' : m.thinking === 'always' ? 'Always thinks first' : null,
        gpuNote: f.fitsOnGpu === null ? null : f.fitsOnGpu ? { text: 'Fits in graphics memory', ok: true } : { text: 'Not enough graphics memory', ok: false },
        isDownloaded: m.isDownloaded,
        downloadProgress: status.activeDownloadModelId === m.id ? m.downloadProgress : null,
        sizeText: m.sizeText.replace('~', ''), removable: m.isDownloaded, rank: rankFor(purpose, m.id),
        paramsText: `${m.parameters} parameters${m.activeParameters ? ` (${m.activeParameters} active)` : ''}`, params: parseParamCount(m.parameters), bytes: m.approxBytes, released: m.released,
      };
    });
    return {
      rows,
      selectedId: purpose === 'chat' ? status.chatModelId : status.activeModelId,
      recommendedId: recommendLlm(purpose, models, mem),
    };
  };

  // How the user likes the picker sorted, shared by all three pickers and kept between runs.
  let modelSort: ModelSort | null = null;
  const getModelSort = async (): Promise<ModelSort> => {
    if (!modelSort) {
      const settings = await window.electronAPI.getSettings().catch(() => null);
      modelSort = parseModelSort(settings?.modelSort);
    }
    return modelSort;
  };
  const setModelSort = async (sort: ModelSort) => {
    modelSort = sort;
    renderSortControls(sort);
    await renderModelPicker();
    await window.electronAPI.setSetting('modelSort', sort);
  };

  const pickerSortSelect = document.getElementById('picker-sort') as HTMLSelectElement | null;
  const pickerSortDir = document.getElementById('picker-sort-dir') as HTMLButtonElement | null;
  const SORT_DIR_TEXT: Record<ModelSortKey, [string, string]> = {
    recommended: ['', ''],
    name: ['A to Z', 'Z to A'],
    params: ['Smallest first', 'Largest first'],
    size: ['Smallest first', 'Largest first'],
    released: ['Oldest first', 'Newest first'],
  };
  const renderSortControls = (sort: ModelSort) => {
    if (pickerSortSelect) pickerSortSelect.value = sort.key;
    if (pickerSortDir) {
      // The recommended order has no meaningful reverse.
      pickerSortDir.style.display = sort.key === 'recommended' ? 'none' : '';
      pickerSortDir.textContent = SORT_DIR_TEXT[sort.key][sort.dir === 'asc' ? 0 : 1];
      pickerSortDir.title = 'Reverse the order';
    }
  };
  pickerSortSelect?.addEventListener('change', () => {
    const key = pickerSortSelect.value as ModelSortKey;
    void setModelSort({ key, dir: DEFAULT_SORT_DIR[key] });
  });
  pickerSortDir?.addEventListener('click', async () => {
    const sort = await getModelSort();
    void setModelSort({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
  });

  /** "2024-09-25" -> "Sep 2024". */
  const formatReleased = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

  const PICKER_TITLES: Record<PickerPurpose, string> = { speech: 'Voice to text', cleanup: 'Text cleanup', chat: 'AI chat' };

  const renderModelPicker = async () => {
    if (!window.electronAPI || !modelCatalogContainer) return;
    try {
      const purpose = pickerPurpose;
      const mem: MemorySnapshot = await window.electronAPI.llmMemoryState();
      const status = await window.electronAPI.llmStatus();
      const { rows, selectedId, recommendedId } = purpose === 'speech' ? await speechRows(mem) : await llmRows(purpose, mem);
      if (purpose !== pickerPurpose) return; // switched while measuring
      if (pickerTitle) pickerTitle.textContent = PICKER_TITLES[purpose];
      if (pickerSub) pickerSub.textContent = describeFreeMemory(mem);

      const sort = await getModelSort();
      sortModels(rows, sort, recommendedId);
      renderSortControls(sort);

      const anyDownload = !!status.activeDownloadModelId;
      const rowHtml = (r: PickerRow) => {
        const isSelected = r.id === selectedId;
        const gpuFact = r.gpuNote ? `<span class="pick-fact ${r.gpuNote.ok ? 'gpu-yes' : 'gpu-no'}">${r.gpuNote.text}</span>` : '';
        const label = purpose === 'speech' && r.fit === 'slow' ? 'Slow on this PC' : fitLabel(r.fit);
        // Whatever the list is sorted by is shown on every row, so the order makes sense at a glance.
        const sortFact = sort.key === 'params' ? r.paramsText
          : sort.key === 'released' && r.released ? `Released ${formatReleased(r.released)}`
          : sort.key === 'size' && r.isDownloaded ? `${r.sizeText} download`
          : '';

        let action: string;
        if (isSelected && r.isDownloaded) action = '<span class="badge badge-on">In use</span>';
        else if (r.downloadProgress !== null) action = progressButtonHtml(r.id, r.downloadProgress, 'btn btn-secondary btn-small');
        else if (r.isDownloaded) action = '<button class="btn btn-primary btn-small" data-act="use">Use</button>';
        else if (r.fit === 'too-big') action = '';
        else action = `<button class="btn btn-secondary btn-small" data-act="download" ${anyDownload && purpose !== 'speech' ? 'disabled' : ''}>Download</button>`;

        const remove = r.removable ? '<button class="s-link pick-remove" data-act="remove" title="Delete the downloaded file">Remove</button>' : '';
        return `
          <div class="pick-row${isSelected ? ' is-selected' : ''}${r.fit === 'too-big' ? ' is-too-big' : ''}" data-id="${escapeHtml(r.id)}" title="${escapeHtml(r.tip)}">
            <div class="pick-main">
              <div class="pick-name">${escapeHtml(r.name)}${r.id === recommendedId ? ' <span class="badge badge-rec">Recommended</span>' : ''}</div>
              <div class="pick-facts">
                <span class="pick-fact fit-${r.fit}"><span class="pick-dot"></span>${label}</span>
                ${gpuFact}
                ${sortFact ? `<span class="pick-fact">${escapeHtml(sortFact)}</span>` : ''}
                ${r.extra ? `<span class="pick-fact">${escapeHtml(r.extra)}</span>` : ''}
                ${r.isDownloaded ? (remove ? `<span class="pick-fact">${remove}</span>` : '') : `<span class="pick-fact">${escapeHtml(r.sizeText)}</span>`}
              </div>
            </div>
            <div class="pick-actions">${action}</div>
          </div>`;
      };

      const usable = rows.filter(r => r.fit !== 'too-big' || r.id === selectedId);
      const tooBig = rows.filter(r => r.fit === 'too-big' && r.id !== selectedId);
      const wasOpen = !!modelCatalogContainer.querySelector('.pick-more[open]');
      modelCatalogContainer.innerHTML = `
        <div class="pick-list">${usable.map(rowHtml).join('')}</div>
        ${tooBig.length ? `<details class="pick-more"${wasOpen ? ' open' : ''}><summary>${tooBig.length} more need more free memory</summary><div class="pick-list">${tooBig.map(rowHtml).join('')}</div></details>` : ''}`;

      modelCatalogContainer.querySelectorAll<HTMLElement>('.pick-row').forEach(row => {
        const r = rows.find(x => x.id === row.dataset.id)!;
        row.querySelector('[data-act="use"]')?.addEventListener('click', async (e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.textContent = 'Loading…';
          btn.disabled = true;
          await useModel(purpose, r.id);
        });
        row.querySelector('[data-act="download"]')?.addEventListener('click', async (e) => {
          startButtonProgress(e.currentTarget as HTMLButtonElement, r.id);
          if (purpose === 'speech') {
            // The voice model downloads as it loads; attemptLoadModel reports its progress.
            await useModel(purpose, r.id);
            return;
          }
          if (llmDownloadBanner) llmDownloadBanner.style.display = 'block';
          if (llmDownloadTitle) llmDownloadTitle.textContent = `Downloading ${r.name}…`;
          const pending = window.electronAPI.llmDownloadModel(r.id);
          await renderModelPicker();
          const res = await pending;
          if (res.success) {
            await useModel(purpose, r.id);
          } else if (res.error && res.error !== 'Download cancelled') {
            // Keep the banner up long enough to read why it failed.
            if (llmDownloadTitle) llmDownloadTitle.textContent = `Download failed: ${res.error}`;
            await new Promise(res => setTimeout(res, 6000));
          }
          if (llmDownloadBanner) llmDownloadBanner.style.display = 'none';
          await renderModelPicker();
        });
        row.querySelector('[data-act="remove"]')?.addEventListener('click', async () => {
          if (!confirm(`Delete ${r.name} (${r.sizeText}) from this PC? You can download it again later.`)) return;
          await window.electronAPI.llmDeleteModel(r.id);
          await refreshAfterModelChange();
        });
      });
    } catch (e) {
      console.error('Failed to render model picker:', e);
    }
  };

  const openModelPicker = async (purpose: PickerPurpose) => {
    pickerPurpose = purpose;
    // Open straight away; measuring free memory can take a moment the first time.
    if (pickerTitle) pickerTitle.textContent = PICKER_TITLES[purpose];
    if (pickerSub) pickerSub.textContent = 'Checking free memory…';
    if (modelCatalogContainer) modelCatalogContainer.innerHTML = '';
    chatModelsModal?.classList.add('active');
    await renderModelPicker();
    const body = chatModelsModal?.querySelector('.chat-models-modal-body');
    if (body) body.scrollTop = 0;
  };

  chatModelPickerBtn?.addEventListener('click', () => openModelPicker('chat'));
  document.getElementById('row-speech')?.addEventListener('click', () => openModelPicker('speech'));
  document.getElementById('row-chat')?.addEventListener('click', () => openModelPicker('chat'));
  const rowCleanup = document.getElementById('row-cleanup');
  rowCleanup?.addEventListener('click', (e) => {
    // The on/off switch inside the row must not also open the picker.
    if ((e.target as HTMLElement).closest('.switch')) return;
    openModelPicker('cleanup');
  });
  rowCleanup?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModelPicker('cleanup'); }
  });

  chatModelsClose?.addEventListener('click', () => chatModelsModal?.classList.remove('active'));
  chatModelsDone?.addEventListener('click', () => chatModelsModal?.classList.remove('active'));

  // Live Download Progress listener
  if (window.electronAPI) {
    window.electronAPI.onLlmDownloadProgress((p: any) => {
      setButtonProgress(p.modelId, p.percent, p.phase === 'verifying' ? 'Checking' : undefined);
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

    window.electronAPI.onLlmChatThought((text: string) => {
      if (!currentActiveAssistantBubbleContent) return;
      if (!streamingThoughtEl) {
        streamingThoughtEl = document.createElement('details');
        streamingThoughtEl.className = 'chat-thought';
        streamingThoughtEl.open = true;
        streamingThoughtEl.innerHTML = '<summary>Thinking…</summary><div class="chat-thought-body"></div>';
        currentActiveAssistantBubbleContent.before(streamingThoughtEl);
      }
      streamingThoughtText += text;
      const body = streamingThoughtEl.querySelector('.chat-thought-body');
      if (body) body.textContent = streamingThoughtText;
      if (chatMessagesContainer) chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    });

    // Real-time Chat Token Streaming listener
    // Tokens arrive faster than the screen refreshes; render the Markdown at most once per frame.
    window.electronAPI.onLlmChatToken((token: string) => {
      if (!currentActiveAssistantBubbleContent) return;
      streamingReplyText += token;
      endThoughtSection();
      if (streamingRenderPending) return;
      streamingRenderPending = true;
      requestAnimationFrame(() => {
        streamingRenderPending = false;
        if (!currentActiveAssistantBubbleContent) return;
        currentActiveAssistantBubbleContent.innerHTML = renderChatMarkdown(streamingReplyText);
        if (chatMessagesContainer) {
          chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }
      });
    });
  }

  /** The answer has started (or the reply ended): fold the reasoning away under a short label. */
  const endThoughtSection = () => {
    if (!streamingThoughtEl || streamingThoughtEl.dataset.done) return;
    streamingThoughtEl.dataset.done = '1';
    streamingThoughtEl.open = false;
    const summary = streamingThoughtEl.querySelector('summary');
    if (summary) summary.textContent = 'Thought process';
  };

  // Format and append chat messages
  const appendChatMessage = (role: 'user' | 'assistant', content: string) => {
    if (chatWelcome) chatWelcome.style.display = 'none';

    const msgEl = document.createElement('div');
    msgEl.className = `chat-msg ${role}`;

    const bubble = document.createElement('div');
    bubble.className = role === 'assistant' ? 'chat-bubble chat-md' : 'chat-bubble';

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
    } else if (role === 'assistant') {
      bubble.innerHTML = renderChatMarkdown(content);
      bubble.dataset.raw = content;
    } else {
      bubble.textContent = content;
    }

    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.innerHTML = `
      <span>${role === 'user' ? 'You' : escapeHtml(chatModelDisplayName)} • ${timeStr}</span>
      ${role === 'assistant' ? `<button class="chat-copy-btn" title="Copy to clipboard">Copy</button>` : ''}
    `;

    meta.querySelector('.chat-copy-btn')?.addEventListener('click', async () => {
      // Rich text for apps that accept formatting (Word, email), Markdown for plain-text editors.
      const raw = bubble.dataset.raw ?? bubble.textContent ?? '';
      try {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([raw], { type: 'text/plain' }),
          'text/html': new Blob([bubble.innerHTML], { type: 'text/html' }),
        })]);
      } catch {
        if (window.electronAPI) window.electronAPI.copyText(raw);
      }
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
      btnChatSend.innerHTML = icon('arrowUp', 20);
      btnChatSend.title = 'Send message (Enter)';
      return;
    }

    const text = chatInputTextarea.value.trim();
    if (!text) return;

    // No chat model on disk yet: let the user pick one first and keep what they typed.
    if (window.electronAPI) {
      const s = await window.electronAPI.llmStatus();
      const catalog = await window.electronAPI.llmGetCatalog();
      if (!catalog.find(m => m.id === s.chatModelId)?.isDownloaded) {
        await openModelPicker('chat');
        return;
      }
    }

    if (chatWelcome) chatWelcome.style.display = 'none';

    // Append User Message
    chatMessages.push({ role: 'user', content: text, timestamp: Date.now() });
    appendChatMessage('user', text);

    chatInputTextarea.value = '';
    chatInputTextarea.style.height = 'auto';

    if (!window.electronAPI) return;

    isGeneratingChat = true;
    btnChatSend.classList.add('stop-mode');
    btnChatSend.innerHTML = icon('stop', 20);
    btnChatSend.title = 'Stop output';
    btnChatSend.disabled = false;

    // Append placeholder Assistant Message
    streamingReplyText = '';
    streamingThoughtText = '';
    streamingThoughtEl = null;
    const assistantBubble = appendChatMessage('assistant', '');
    void refreshActiveChatModelUI();

    try {
      const apiMessages = chatMessages.map(m => ({ role: m.role, content: m.content }));
      const response = await window.electronAPI.llmChatSend(apiMessages);

      if (response.success && response.text) {
        chatMessages.push({ role: 'assistant', content: response.text, timestamp: Date.now() });
        currentActiveAssistantBubbleContent = null;
        assistantBubble.innerHTML = renderChatMarkdown(response.text);
        assistantBubble.dataset.raw = response.text;
      } else if (!response.success && response.error) {
        assistantBubble.innerHTML = `<span style="color: var(--red);">Error: ${escapeHtml(response.error || 'Failed to generate response')}</span>`;
      }
    } catch (err: any) {
      assistantBubble.innerHTML = `<span style="color: var(--red);">Error: ${escapeHtml(err.message || String(err))}</span>`;
    } finally {
      isGeneratingChat = false;
      btnChatSend.classList.remove('stop-mode');
      btnChatSend.innerHTML = icon('arrowUp', 20);
      btnChatSend.title = 'Send message (Enter)';
      btnChatSend.disabled = false;
      endThoughtSection();
      streamingThoughtEl = null;
      currentActiveAssistantBubbleContent = null;
      void refreshActiveChatModelUI();
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
        const { fullAudio, trailingAudio } = await stopRecordingDirect({ includeFull: true });
        let transcribed = '';
        if (chatStreamingSession) {
          transcribed = (await chatStreamingSession.finalizeWithFullPass(trailingAudio, fullAudio)).text;
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

