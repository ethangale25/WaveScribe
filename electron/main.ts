import { app, BrowserWindow, globalShortcut, ipcMain, clipboard, ClipboardItem, Menu, screen, Rectangle, Notification, nativeImage, Tray, protocol, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import Store from 'electron-store'
import { spawn } from 'child_process'
import { detectHardware, probeGpuVram } from './hardware'
import {
    downloadModel,
    initLlm,
    loadModel,
    deleteModel,
    reformatText,
    getLlmStatus,
    getModelCatalog,
    chatStream,
    runVoiceCommand,
    clearChat,
    abortChat,
    isModelDownloaded,
    setPreferredModel,
    currentModelId,
    migrateRenamedModelFiles,
    cancelDownload,
    setChatModel,
    setChatThinking,
    loadChatModel,
    unloadChatModel,
    getCleanupModelId,
    getMemoryState
} from './llm'
import { captureContext } from './context-capture'
import { locateCaret, warmUpCaretLocator, stopCaretLocator, CaretRect } from './caret'
import { INDICATOR_HTML, INDICATOR_SIZE, IndicatorMode } from './caret-indicator'
import { sendCtrlV, isKeyDown } from './win32'
import { captureSelection, snapshotClipboard } from './selection'
import { mainKeyVirtualCode } from './hotkey'
import { initAutoUpdate, checkForUpdatesIfStale } from './updater'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Windows takes the taskbar icon from a Start Menu shortcut carrying the app's ID. The installed
// app's shortcut uses that ID; a development build has its own ID, or Windows would mix the two up
// and could show the bare Electron icon (Electron auto-creates such a shortcut for notifications).
const APP_USER_MODEL_ID = app.isPackaged ? 'com.wavescribe.app' : 'com.wavescribe.app.dev'
if (process.platform === 'win32') {
    app.setAppUserModelId(APP_USER_MODEL_ID)
}

/** Gives the development build a Start Menu shortcut with the WaveScribe icon (see above). */
function ensureDevShortcut(): void {
    if (process.platform !== 'win32' || app.isPackaged) return
    const iconPath = getAppIconPath()
    if (!iconPath.endsWith('.ico')) return
    const link = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'WaveScribe (dev).lnk')
    try {
        shell.writeShortcutLink(link, fs.existsSync(link) ? 'replace' : 'create', {
            target: process.execPath,
            args: `"${app.getAppPath()}"`,
            cwd: app.getAppPath(),
            description: 'WaveScribe development build',
            icon: iconPath,
            iconIndex: 0,
            appUserModelId: APP_USER_MODEL_ID,
        })
    } catch (err) {
        console.warn('Could not write the development shortcut:', err)
    }
}

// The app is served from its own origin (app://wavescribe) instead of file:// so the page can be
// "cross-origin isolated". That unlocks SharedArrayBuffer, which WebAssembly threads need to decode
// speech on several CPU cores. The scheme must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
}

function registerAppProtocol() {
    const distDir = path.join(app.getAppPath(), 'dist')
    protocol.handle('app', async (request) => {
        try {
            let relative = decodeURIComponent(new URL(request.url).pathname)
            if (relative === '/' || relative === '') relative = '/index.html'
            const file = path.normalize(path.join(distDir, relative))
            // Never serve anything outside the app's own dist folder.
            if (!file.startsWith(distDir + path.sep)) return new Response('Forbidden', { status: 403 })

            const data = await fs.promises.readFile(file)
            return new Response(data as unknown as BodyInit, {
                headers: {
                    'Content-Type': MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
                    // Cross-origin isolation. "credentialless" still lets the page load cross-origin
                    // resources (fonts, model files from Hugging Face) as long as no cookies are sent.
                    'Cross-Origin-Opener-Policy': 'same-origin',
                    'Cross-Origin-Embedder-Policy': 'credentialless',
                    'Cross-Origin-Resource-Policy': 'same-origin',
                },
            })
        } catch {
            console.warn('[app://] not found:', request.url)
            return new Response('Not found', { status: 404 })
        }
    })
}

const store = new Store() as any

// Only one instance may run: a second one cannot register the global hotkey and would add a second tray icon.
// One copy at a time, so only one owns the dictation hotkey. Opening the same build again brings
// its window forward. The installed app and a development copy share a settings folder (and so this
// lock); between those two, the one opened last wins: the running one closes and the new one waits
// for it, instead of the new one quitting and leaving the user in the copy they did not open.
// WAVESCRIBE_INSTANCE_KIND lets automated tests stand in for the other kind.
const INSTANCE_KIND = process.env.WAVESCRIBE_INSTANCE_KIND || (app.isPackaged ? 'installed' : 'dev')
const instanceLock: Promise<boolean> = (async () => {
    if (app.requestSingleInstanceLock({ kind: INSTANCE_KIND })) return true
    // A copy of the other kind is closing for us: take over once it has gone. A copy of the same
    // kind stays open, so this gives up after a few seconds.
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 200))
        if (app.requestSingleInstanceLock({ kind: INSTANCE_KIND })) return true
    }
    return false
})()

let isQuitting = false
app.on('before-quit', () => { isQuitting = true })

let mainWindow: BrowserWindow | null = null
let originalBounds: Rectangle | null = null
let originalMinSize: number[] | null = null
let spinnerWindow: BrowserWindow | null = null
let tray: Tray | null = null

function getAppIconPath(): string {
    const paths = [
        path.join(__dirname, '../assets/icon.ico'),
        path.join(app.getAppPath(), 'assets/icon.ico'),
        path.join(process.cwd(), 'assets/icon.ico'),
        path.join(__dirname, '../assets/icon.png'),
        path.join(app.getAppPath(), 'assets/icon.png'),
        path.join(process.cwd(), 'assets/icon.png'),
        path.join(__dirname, '../assets/wave.png'),
        path.join(process.cwd(), 'assets/wave.png'),
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return '';
}

function getAppIcon(): Electron.NativeImage {
    const iconPath = getAppIconPath();
    if (iconPath) {
        const img = nativeImage.createFromPath(iconPath);
        if (!img.isEmpty()) return img;
    }
    return nativeImage.createEmpty();
}

function createTray(icon: Electron.NativeImage) {
    if (tray) return;
    try {
        const trayIcon = icon.isEmpty() ? icon : icon.resize({ width: 32, height: 32 });
        tray = new Tray(trayIcon);
        tray.setToolTip('WaveScribe - Voice Dictation & AI Chat');
        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'Show WaveScribe',
                click: () => {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.focus();
                    }
                }
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    app.quit();
                }
            }
        ]);
        tray.setContextMenu(contextMenu);
        tray.on('click', () => {
            if (mainWindow) {
                if (mainWindow.isVisible()) {
                    mainWindow.focus();
                } else {
                    mainWindow.show();
                }
            }
        });
    } catch (err) {
        console.warn('Could not create system tray:', err);
    }
}

// --- Global hotkey: toggle mode, or push-to-talk (hold to dictate) ---

// Two shortcuts: dictation, and voice commands that act on the selected text ("make this shorter").
type HotkeyMode = 'dictate' | 'command'
const DEFAULT_COMMAND_HOTKEY = 'CommandOrControl+Alt+Space'

let activeHotkey = ''
let activeCommandHotkey = ''
let holdActive = false
let holdTimer: ReturnType<typeof setInterval> | null = null

function sendDictationAction(action: 'toggle' | 'start' | 'stop', mode: HotkeyMode = 'dictate') {
    console.log(`[Hotkey] ${mode} ${action} @ ${Date.now()}`)
    mainWindow?.webContents.send('dictation-hotkey', action, mode)
}

function onHotkeyPressed(accelerator: string, mode: HotkeyMode) {
    const pushToTalk = store.get('pushToTalk', false) as boolean
    const vk = pushToTalk ? mainKeyVirtualCode(accelerator) : null

    // Push-to-talk needs a key we can poll for release; anything else behaves as a toggle.
    if (!pushToTalk || vk === null || isKeyDown(vk) === null) {
        sendDictationAction('toggle', mode)
        return
    }

    // Holding the keys makes the OS repeat the hotkey; only the first press starts recording.
    if (holdActive) return
    holdActive = true
    sendDictationAction('start', mode)
    holdTimer = setInterval(() => {
        if (isKeyDown(vk) === false) {
            if (holdTimer) clearInterval(holdTimer)
            holdTimer = null
            holdActive = false
            sendDictationAction('stop', mode)
        }
    }, 25)
}

function registerHotkey(accelerator: string, mode: HotkeyMode): boolean {
    try {
        return globalShortcut.register(accelerator, () => onHotkeyPressed(accelerator, mode))
    } catch (e) {
        console.warn('Failed to register hotkey:', accelerator, e)
        return false
    }
}

/** Registers the dictation hotkey. Returns false if the OS refused it (e.g. another app owns it). */
function registerDictationHotkey(accelerator: string): boolean {
    const ok = registerHotkey(accelerator, 'dictate')
    if (ok) activeHotkey = accelerator
    return ok
}

/** Registers the voice-command hotkey ('off' disables it). False if it could not be registered. */
function registerCommandHotkey(accelerator: string): boolean {
    if (activeCommandHotkey) {
        try { globalShortcut.unregister(activeCommandHotkey) } catch { }
        activeCommandHotkey = ''
    }
    if (!accelerator || accelerator === 'off') return true
    if (accelerator === activeHotkey) return false // already the dictation shortcut
    const ok = registerHotkey(accelerator, 'command')
    if (ok) activeCommandHotkey = accelerator
    return ok
}

// Test mode: automated runs set WAVESCRIBE_TEST_DISPLAY_POINT (physical pixel "x,y") to a point on the
// monitor they may use. The window then opens centred on that monitor and does not take focus, so
// a developer working on another screen is never interrupted.
function getTestDisplay(): Electron.Display | null {
    const raw = process.env.WAVESCRIBE_TEST_DISPLAY_POINT
    if (!raw) return null
    const [x, y] = raw.split(',').map(Number)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return screen.getDisplayNearestPoint(screen.screenToDipPoint({ x, y }))
}

function createWindow() {
    const testDisplay = getTestDisplay()
    const iconPath = getAppIconPath();
    const appIcon = getAppIcon();

    // Roomy by default (Settings has a lot to show), but never larger than a small or scaled screen.
    const workArea = (testDisplay ?? screen.getPrimaryDisplay()).workArea
    const windowWidth = Math.min(680, Math.round(workArea.width * 0.9))
    const windowHeight = Math.min(800, Math.round(workArea.height * 0.92))
    const testPosition = testDisplay ? {
        x: Math.round(testDisplay.workArea.x + (testDisplay.workArea.width - windowWidth) / 2),
        y: Math.round(testDisplay.workArea.y + (testDisplay.workArea.height - windowHeight) / 2),
    } : {}

    mainWindow = new BrowserWindow({
        ...testPosition,
        width: windowWidth,
        height: windowHeight,
        minWidth: Math.min(480, windowWidth),
        minHeight: Math.min(560, windowHeight),
        transparent: true,
        icon: iconPath || appIcon,
        webPreferences: {
            preload: path.join(__dirname, 'preload.mjs'), // vite-plugin-electron compiles to .mjs or .js
            nodeIntegration: false,
            contextIsolation: true,
        },
        // frameless or modern visual
        titleBarStyle: 'hidden',
        show: false,
    })

    // Links in AI chat replies open in the default browser, never inside the app.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url)
        return { action: 'deny' }
    })

    if (iconPath && mainWindow.setIcon) {
        try { mainWindow.setIcon(iconPath); } catch (_) { }
    }

    // Load UI
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
        // mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadURL('app://wavescribe/index.html')
    }

    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[Renderer]: ${message}`);
    });

    mainWindow.once('ready-to-show', () => {
        // In test mode show the window without activating it (no focus stolen from other screens).
        if (testDisplay) mainWindow?.showInactive()
        else mainWindow?.show()
    })

    // Closing the window keeps WaveScribe running in the tray so the global hotkey keeps working.
    // "Quit" in the tray menu (or the OS shutting down) really exits.
    mainWindow.on('close', (event) => {
        if (!isQuitting && tray) {
            event.preventDefault()
            mainWindow?.hide()
        }
    })

    mainWindow.on('maximize', () => {
        mainWindow?.webContents.send('window-maximized', true);
    });

    mainWindow.on('unmaximize', () => {
        mainWindow?.webContents.send('window-maximized', false);
    });

    // Global hotkey
    const hotkey = store.get('hotkey', 'CommandOrControl+Shift+Space') as string
    if (!registerDictationHotkey(hotkey)) {
        // Without this the app would say "Ready" while the hotkey silently did nothing.
        if (!testDisplay) try {
            new Notification({
                title: 'WaveScribe hotkey unavailable',
                body: `Could not register "${hotkey}". Another app may be using it. Choose a different shortcut in Settings.`
            }).show()
        } catch (_) { }
    }
    // A taken voice-command shortcut is reported in Settings; dictation still works without it.
    if (!registerCommandHotkey(store.get('commandHotkey', DEFAULT_COMMAND_HOTKEY) as string)) {
        console.warn('[Hotkey] Voice-command shortcut unavailable')
    }

    // The caret indicator window (hidden until a dictation is being transcribed)
    spinnerWindow = new BrowserWindow({
        width: INDICATOR_SIZE.width,
        height: INDICATOR_SIZE.height,
        transparent: true,
        frame: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        show: false,
        focusable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    })
    spinnerWindow.setIgnoreMouseEvents(true)
    spinnerWindow.setAlwaysOnTop(true, 'screen-saver')
    spinnerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(INDICATOR_HTML)}`)

    // Compile the caret helper in the background so the first dictation does not wait for it.
    setTimeout(warmUpCaretLocator, 3000)
}

app.on('second-instance', (_event, _argv, _cwd, data) => {
    // The other build was opened: step aside for it (see INSTANCE_KIND above).
    const kind = (data as { kind?: string } | undefined)?.kind
    if (kind && kind !== INSTANCE_KIND) {
        isQuitting = true
        app.quit()
        return
    }
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
    }
})

app.whenReady().then(async () => {
    if (!(await instanceLock)) {
        app.quit()
        return
    }
    Menu.setApplicationMenu(null)
    ensureDevShortcut()
    registerAppProtocol()
    // Warm the GPU-memory probe in the background so nothing ever blocks on it later.
    probeGpuVram().catch(() => { })
    const appIcon = getAppIcon()
    createWindow()
    createTray(appIcon)
    initAutoUpdate((state) => mainWindow?.webContents.send('update-state', state), () => mainWindow)
    mainWindow?.on('focus', checkForUpdatesIfStale)

    // Auto-init LLM if enabled and model is already downloaded
    migrateRenamedModelFiles()
    for (const key of ['llmModelId', 'chatModelId']) {
        const saved = store.get(key) as string | undefined
        if (saved && currentModelId(saved) !== saved) store.set(key, currentModelId(saved))
    }
    const savedLlm = store.get('llmModelId') as string | undefined
    if (savedLlm) setPreferredModel(savedLlm)
    // Before chat had its own model, the chat picker set llmModelId; carry that choice over.
    const savedChat = (store.get('chatModelId') as string | undefined) ?? savedLlm
    if (savedChat) setChatModel(savedChat)
    setChatThinking(store.get('chatThinking', false) === true)
    const aiEnabled = store.get('aiReformat', false)
    if (aiEnabled && isModelDownloaded(getCleanupModelId())) {
        try {
            await initLlm()
            console.log('[LLM] Auto-initialized successfully')
        } catch (err) {
            console.error('[LLM] Auto-init failed:', err)
        }
    }

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
    if (holdTimer) clearInterval(holdTimer)
    stopCaretLocator()
    globalShortcut.unregisterAll()
})

// PowerShell fallback for pasting, used only if the native Win32 layer is unavailable.
function sendCtrlVViaPowerShell(): Promise<boolean> {
    return new Promise((resolve) => {
        const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const scriptPath = path.join(app.getPath('temp'), `insert-text-${uniqueId}.ps1`);

        const ps1Content = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Kbd {
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    public const byte VK_CONTROL = 0x11;
    public const byte VK_V = 0x56;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public static void CtrlV() {
        keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
        keybd_event(VK_V, 0, 0, UIntPtr.Zero);
        keybd_event(VK_V, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}
"@
[Kbd]::CtrlV()
            `;

        try {
            fs.writeFileSync(scriptPath, ps1Content, 'utf-8');
        } catch (e) {
            return resolve(false);
        }

        const cleanup = () => { try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch (_) { } };
        const proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });
        proc.on('close', (code) => { cleanup(); resolve(code === 0); });
        proc.on('error', (err) => { console.error('[InsertText Error]:', err); cleanup(); resolve(false); });
    });
}

// IPC commands for text injection: set clipboard, send Ctrl+V, restore clipboard.
ipcMain.handle('insert-text', async (event, text: string) => {
    // Debug/test switch: report success without touching the clipboard or the focused app.
    if (process.env.WAVESCRIBE_NO_PASTE) {
        console.log('[PasteDone] ' + Date.now());
        return { success: true };
    }
    try {
        const previous = await snapshotClipboard();
        await clipboard.writeText(text);

        // Native SendInput takes ~1ms; PowerShell (cold start + C# compile) takes hundreds.
        const success = sendCtrlV() || await sendCtrlVViaPowerShell();

        // Restore the original clipboard only if it still holds what we pasted.
        setTimeout(async () => {
            try {
                if (await clipboard.readText() !== text) return;
                if (previous.length === 0) clipboard.clear();
                else await clipboard.write(previous);
            } catch (err) {
                console.warn('[InsertText] Could not restore the clipboard:', err);
            }
        }, 350);

        return { success };
    } catch (error) {
        console.error('Failed to insert text', error)
        return { success: false, error: String(error) }
    }
})

// IPC commands for settings
ipcMain.handle('get-settings', () => {
    return store.store;
});

ipcMain.handle('set-setting', (event, key, value) => {
    // Dynamically update hotkey tracking with safe rollback
    if (key === 'hotkey') {
        const previousHotkey = activeHotkey || (store.get('hotkey', 'CommandOrControl+Shift+Space') as string);
        if (holdTimer) { clearInterval(holdTimer); holdTimer = null; holdActive = false; }
        globalShortcut.unregisterAll();

        if (!registerDictationHotkey(value)) {
            // Roll back to the previous hotkey so the user is not locked out
            console.warn(`[Hotkey] Failed to register "${value}". Reverting to "${previousHotkey}".`);
            registerDictationHotkey(previousHotkey);
            reregisterCommandHotkey();
            return { success: false };
        }
        reregisterCommandHotkey();

        store.set(key, value);
        return { success: true };
    }

    if (key === 'commandHotkey') {
        const previous = store.get('commandHotkey', DEFAULT_COMMAND_HOTKEY) as string;
        if (!registerCommandHotkey(value)) {
            registerCommandHotkey(previous);
            return { success: false };
        }
        store.set(key, value);
        return { success: true };
    }

    store.set(key, value);
    return { success: true };
});

/** unregisterAll() also drops the command shortcut; put it back. */
function reregisterCommandHotkey() {
    activeCommandHotkey = '';
    registerCommandHotkey(store.get('commandHotkey', DEFAULT_COMMAND_HOTKEY) as string);
}

ipcMain.handle('command-hotkey-state', () => {
    const wanted = store.get('commandHotkey', DEFAULT_COMMAND_HOTKEY) as string;
    return { hotkey: wanted, registered: wanted === 'off' || activeCommandHotkey === wanted };
});

ipcMain.handle('capture-selection', async () => {
    if (process.env.WAVESCRIBE_NO_PASTE) return { text: '' };
    try {
        return { text: await captureSelection() };
    } catch (err) {
        console.warn('[Selection] Could not read the selection:', err);
        return { text: '' };
    }
});

ipcMain.handle('llm-voice-command', async (_event: any, instruction: string, selection: string) => {
    try {
        return { success: true, text: await runVoiceCommand(instruction, selection) };
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
    }
});

ipcMain.handle('check-hotkey', (event, hotkey) => {
    return { registered: globalShortcut.isRegistered(hotkey) };
});

ipcMain.handle('show-notification', (event, { title, body }: { title: string; body: string }) => {
    try {
        if (Notification.isSupported()) {
            new Notification({ title: title || 'WaveScribe', body: body || '' }).show();
            return { success: true };
        }
    } catch (e) {
        console.warn('Could not show system notification:', e);
    }
    return { success: false };
});

ipcMain.handle('window-control', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    if (action === 'close') win.close();
});

ipcMain.handle('copy-text', async (event, text) => {
    await clipboard.writeText(text);
    return { success: true };
});

ipcMain.handle('set-window-bounds', (event, bounds) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        win.setBounds(bounds);
    }
    return { success: true };
});

ipcMain.handle('toggle-mini-mode', (event, isMini: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false };

    if (isMini) {
        // Save bounds before shrinking
        originalBounds = win.getBounds();
        // Electron applies the window's minimum size to setBounds, so lift it while the pill is shown.
        originalMinSize = win.getMinimumSize();
        win.setMinimumSize(0, 0);

        // Calculate new bounds for mini island (250x50, bottom center) on the CURRENT monitor
        const currentDisplay = screen.getDisplayMatching(win.getBounds());

        // Use full monitor bounds instead of workArea to ensure consistent placement regardless of taskbar thickness
        const displayBounds = currentDisplay.bounds;

        const islandWidth = 240;      // visual pill width
        const islandHeight = 52;     // visual pill height
        const buffer = 10;            // extra space on ALL sides for shadow and hover-up
        const windowWidth = islandWidth + (buffer * 2);
        const windowHeight = islandHeight + (buffer * 2);

        const x = Math.round(displayBounds.x + (displayBounds.width / 2) - (windowWidth / 2));

        // Position the WINDOW so the PILL's visual bottom is 100px from screen bottom.
        const y = Math.round(displayBounds.y + displayBounds.height - islandHeight - 100 - buffer);

        win.setBounds({ x, y, width: windowWidth, height: windowHeight }, true);
        win.setAlwaysOnTop(true, 'floating');
    } else {
        // Restore bounds
        if (originalBounds) {
            win.setBounds(originalBounds, true);
        }
        if (originalMinSize) {
            win.setMinimumSize(originalMinSize[0], originalMinSize[1]);
        }
        win.setAlwaysOnTop(false);
    }
    return { success: true };
});

// --- Caret indicator ---

/** Converts the helper's physical-pixel caret into window coordinates (DIP) on its own monitor. */
function caretToDip(caret: CaretRect): { x: number, y: number, height: number } {
    const topLeft = screen.screenToDipPoint({ x: caret.x + caret.width, y: caret.y })
    const scale = screen.getDisplayNearestPoint(topLeft).scaleFactor || 1
    return { x: topLeft.x, y: topLeft.y, height: caret.height / scale }
}

// The caret where the user started dictating, used if the lookup at the end is too slow.
let primedCaret: CaretRect | null = null;
// Bumped on every show/hide so a slow lookup cannot show the indicator after it was hidden.
let indicatorRequest = 0;
let indicatorMode: IndicatorMode | null = null;

/** Places the indicator just right of the caret, centred on its line, on the caret's own monitor. */
function placeIndicator(caret: CaretRect): void {
    if (!spinnerWindow) return;
    const pos = caretToDip(caret);
    const area = screen.getDisplayNearestPoint({ x: Math.round(pos.x), y: Math.round(pos.y) }).workArea;
    const { width, height } = INDICATOR_SIZE;
    let x = Math.round(pos.x + 6);
    let y = Math.round(pos.y + pos.height / 2 - height / 2);
    if (x + width > area.x + area.width) x = Math.round(pos.x - 6 - width);
    x = Math.max(area.x, Math.min(x, area.x + area.width - width));
    y = Math.max(area.y, Math.min(y, area.y + area.height - height));
    spinnerWindow.setBounds({ x, y, width, height });
}

// 'listening' when recording starts (bars follow the voice), 'working' when it stops (ripple while
// the speech is transcribed). The indicator follows the caret, never the mouse pointer.
ipcMain.handle('show-cursor-spinner', async (_event, mode: IndicatorMode = 'working') => {
    if (!spinnerWindow || process.env.WAVESCRIBE_TEST_DISPLAY_POINT) return { success: false };
    const request = ++indicatorRequest;
    // At the start, where the user is dictating; at the end, where the text will go now (the caret
    // can have moved while they talked).
    const found = await locateCaret(mode === 'listening' ? 1500 : 300);
    if (request !== indicatorRequest || !spinnerWindow) return { success: false };
    if (mode === 'listening') primedCaret = found;
    const caret = found ?? primedCaret;
    const wasVisible = spinnerWindow.isVisible();
    // No caret means no sensible place to show it, unless it is already showing from the start.
    if (!caret && !wasVisible) return { success: false };
    try {
        if (caret) placeIndicator(caret);
        indicatorMode = mode;
        spinnerWindow.webContents.executeJavaScript(`setMode(${JSON.stringify(mode)}, ${!wasVisible})`).catch(() => { });
        if (!wasVisible) spinnerWindow.showInactive();
        return { success: true };
    } catch (err) {
        console.error('Failed to show caret indicator:', err);
        return { success: false };
    }
});

// Live voice level (0 to 1) while listening, sent many times a second, so fire-and-forget.
ipcMain.on('caret-indicator-level', (_event, level: number) => {
    if (indicatorMode !== 'listening' || !spinnerWindow?.isVisible()) return;
    spinnerWindow.webContents.executeJavaScript(`setLevel(${Number(level) || 0})`).catch(() => { });
});

ipcMain.handle('hide-cursor-spinner', () => {
    indicatorRequest++;
    indicatorMode = null;
    spinnerWindow?.hide();
    return { success: true };
});

// Returns the dedicated GPU VRAM in MB, or null if it cannot be determined (probed async, cached).
ipcMain.handle('get-vram-mb', (): Promise<number | null> => probeGpuVram());

// --- Hardware & LLM IPC Handlers ---

ipcMain.handle('get-hardware-profile', () => {
    return detectHardware();
});

ipcMain.handle('llm-memory-state', () => getMemoryState());

ipcMain.handle('llm-get-catalog', () => {
    return getModelCatalog();
});

ipcMain.handle('llm-download-model', async (_event, modelId: string) => {
    try {
        await downloadModel(modelId, (progress) => {
            mainWindow?.webContents.send('llm-download-progress', progress);
        });
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || String(err) };
    }
});

ipcMain.handle('llm-cancel-download', () => {
    return { success: cancelDownload() };
});

ipcMain.handle('llm-delete-model', (_event, modelId: string) => {
    const success = deleteModel(modelId);
    return { success };
});

ipcMain.handle('llm-load-model', async (_event, modelId: string) => {
    try {
        await loadModel(modelId);
        store.set('llmModelId', modelId);
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || String(err) };
    }
});

ipcMain.handle('llm-init', async (_event, download?: boolean) => {
    try {
        await initLlm(download ? (progress) => {
            mainWindow?.webContents.send('llm-download-progress', progress);
        } : undefined);
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || String(err) };
    }
});

ipcMain.handle('llm-status', () => {
    return getLlmStatus();
});

ipcMain.handle('llm-reformat', async (_event: any, text: string, context?: string, style?: 'exact' | 'smart') => {
    try {
        const result = await reformatText(text, context, style === 'smart' ? 'smart' : 'exact');
        return { success: true, text: result };
    } catch (err: any) {
        return { success: false, text: text, error: err.message };
    }
});

let activeChatAbortSignal = { aborted: false };

ipcMain.handle('llm-chat-send', async (_event: any, { messages }: { messages: { role: 'user' | 'assistant' | 'system'; content: string }[] }) => {
    try {
        activeChatAbortSignal = { aborted: false };
        const fullResponse = await chatStream(
            messages,
            (token: string) => {
                mainWindow?.webContents.send('llm-chat-token', token);
            },
            activeChatAbortSignal,
            (thought: string) => {
                mainWindow?.webContents.send('llm-chat-thought', thought);
            }
        );
        return { success: true, text: fullResponse };
    } catch (err: any) {
        return { success: false, error: err.message || String(err) };
    }
});

ipcMain.handle('llm-chat-abort', () => {
    activeChatAbortSignal.aborted = true;
    abortChat();
    return { success: true };
});

ipcMain.handle('llm-chat-clear', () => {
    clearChat();
    return { success: true };
});

ipcMain.handle('llm-chat-set-thinking', (_event, on: boolean) => {
    setChatThinking(on === true);
    store.set('chatThinking', on === true);
    return { success: true };
});

ipcMain.handle('llm-chat-set-model', (_event, modelId: string) => {
    setChatModel(modelId);
    store.set('chatModelId', modelId);
    return { success: true };
});

ipcMain.handle('llm-chat-load', async () => {
    try {
        await loadChatModel();
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || String(err) };
    }
});

ipcMain.handle('llm-chat-unload', () => {
    unloadChatModel();
    return { success: true };
});

ipcMain.handle('capture-context', async () => {
    try {
        const text = await captureContext();
        return { success: true, text };
    } catch {
        return { success: true, text: '' };
    }
});
