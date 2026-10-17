import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
    insertText: (text: string) => ipcRenderer.invoke('insert-text', text),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    setSetting: (key: string, value: any) => ipcRenderer.invoke('set-setting', key, value),
    checkHotkey: (hotkey: string) => ipcRenderer.invoke('check-hotkey', hotkey),
    onDictationHotkey: (callback: (action: 'toggle' | 'start' | 'stop', mode: 'dictate' | 'command') => void) => {
        const handler = (_: any, action?: 'toggle' | 'start' | 'stop', mode?: 'dictate' | 'command') => callback(action ?? 'toggle', mode ?? 'dictate');
        ipcRenderer.on('dictation-hotkey', handler);
        return () => { ipcRenderer.removeListener('dictation-hotkey', handler); }
    },
    windowControl: (action: string) => ipcRenderer.invoke('window-control', action),
    copyText: (text: string) => ipcRenderer.invoke('copy-text', text),
    toggleMiniMode: (isMini: boolean) => ipcRenderer.invoke('toggle-mini-mode', isMini),
    onWindowMaximized: (callback: (isMax: boolean) => void) => {
        const handler = (_: any, isMax: boolean) => callback(isMax);
        ipcRenderer.on('window-maximized', handler);
        return () => { ipcRenderer.removeListener('window-maximized', handler); }
    },
    setWindowBounds: (bounds: any) => ipcRenderer.invoke('set-window-bounds', bounds),
    showCursorSpinner: (mode?: 'listening' | 'working') => ipcRenderer.invoke('show-cursor-spinner', mode),
    caretIndicatorLevel: (level: number) => ipcRenderer.send('caret-indicator-level', level),
    hideCursorSpinner: () => ipcRenderer.invoke('hide-cursor-spinner'),
    getVramMb: () => ipcRenderer.invoke('get-vram-mb'),
    getHardwareProfile: () => ipcRenderer.invoke('get-hardware-profile'),
    llmInit: (download?: boolean) => ipcRenderer.invoke('llm-init', download),
    llmStatus: () => ipcRenderer.invoke('llm-status'),
    llmGetCatalog: () => ipcRenderer.invoke('llm-get-catalog'),
    llmMemoryState: () => ipcRenderer.invoke('llm-memory-state'),
    llmDownloadModel: (modelId: string) => ipcRenderer.invoke('llm-download-model', modelId),
    llmCancelDownload: () => ipcRenderer.invoke('llm-cancel-download'),
    llmDeleteModel: (modelId: string) => ipcRenderer.invoke('llm-delete-model', modelId),
    llmLoadModel: (modelId: string) => ipcRenderer.invoke('llm-load-model', modelId),
    llmReformat: (text: string, context?: string, style?: 'exact' | 'smart') => ipcRenderer.invoke('llm-reformat', text, context, style),
    llmChatSend: (messages: { role: 'user' | 'assistant' | 'system'; content: string }[]) => ipcRenderer.invoke('llm-chat-send', { messages }),
    llmChatAbort: () => ipcRenderer.invoke('llm-chat-abort'),
    captureSelection: () => ipcRenderer.invoke('capture-selection'),
    llmVoiceCommand: (instruction: string, selection: string) => ipcRenderer.invoke('llm-voice-command', instruction, selection),
    commandHotkeyState: () => ipcRenderer.invoke('command-hotkey-state'),
    llmChatClear: () => ipcRenderer.invoke('llm-chat-clear'),
    llmChatSetModel: (modelId: string) => ipcRenderer.invoke('llm-chat-set-model', modelId),
    llmChatSetThinking: (on: boolean) => ipcRenderer.invoke('llm-chat-set-thinking', on),
    llmChatLoad: () => ipcRenderer.invoke('llm-chat-load'),
    llmChatUnload: () => ipcRenderer.invoke('llm-chat-unload'),
    captureContext: () => ipcRenderer.invoke('capture-context'),
    updateGetState: () => ipcRenderer.invoke('update-get-state'),
    updateCheck: () => ipcRenderer.invoke('update-check'),
    updateDownload: () => ipcRenderer.invoke('update-download'),
    updateInstall: () => ipcRenderer.invoke('update-install'),
    onUpdateState: (callback: (state: any) => void) => {
        const handler = (_: any, state: any) => callback(state);
        ipcRenderer.on('update-state', handler);
        return () => { ipcRenderer.removeListener('update-state', handler); }
    },
    showNotification: (title: string, body: string) => ipcRenderer.invoke('show-notification', { title, body }),
    onLlmDownloadProgress: (callback: (progress: any) => void) => {
        const handler = (_: any, progress: any) => callback(progress);
        ipcRenderer.on('llm-download-progress', handler);
        return () => { ipcRenderer.removeListener('llm-download-progress', handler); }
    },
    onLlmChatToken: (callback: (token: string) => void) => {
        const handler = (_: any, token: string) => callback(token);
        ipcRenderer.on('llm-chat-token', handler);
        return () => { ipcRenderer.removeListener('llm-chat-token', handler); }
    },
    onLlmChatThought: (callback: (text: string) => void) => {
        const handler = (_: any, text: string) => callback(text);
        ipcRenderer.on('llm-chat-thought', handler);
        return () => { ipcRenderer.removeListener('llm-chat-thought', handler); }
    },
})
