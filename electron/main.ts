import { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Menu, screen, Rectangle, Notification, nativeImage, Tray } from 'electron'
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
    clearChat,
    abortChat,
    isModelDownloaded,
    OPEN_MODELS,
    setPreferredModel
} from './llm'
import { captureContext } from './context-capture'
import { sendCtrlV, getCursorPosition, isKeyDown } from './win32'
import { mainKeyVirtualCode } from './hotkey'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

if (process.platform === 'win32') {
    app.setAppUserModelId('com.wavescribe.app')
}

const store = new Store() as any

// Only one instance may run: a second one cannot register the global hotkey and would add a second tray icon.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
    app.quit()
}

let isQuitting = false
app.on('before-quit', () => { isQuitting = true })

let mainWindow: BrowserWindow | null = null
let originalBounds: Rectangle | null = null
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

let activeHotkey = ''
let holdActive = false
let holdTimer: ReturnType<typeof setInterval> | null = null

function sendDictationAction(action: 'toggle' | 'start' | 'stop') {
    console.log(`[Hotkey] ${action} @ ${Date.now()}`)
    mainWindow?.webContents.send('dictation-hotkey', action)
}

function onHotkeyPressed() {
    const pushToTalk = store.get('pushToTalk', false) as boolean
    const vk = pushToTalk ? mainKeyVirtualCode(activeHotkey) : null

    // Push-to-talk needs a key we can poll for release; anything else behaves as a toggle.
    if (!pushToTalk || vk === null || isKeyDown(vk) === null) {
        sendDictationAction('toggle')
        return
    }

    // Holding the keys makes the OS repeat the hotkey; only the first press starts recording.
    if (holdActive) return
    holdActive = true
    sendDictationAction('start')
    holdTimer = setInterval(() => {
        if (isKeyDown(vk) === false) {
            if (holdTimer) clearInterval(holdTimer)
            holdTimer = null
            holdActive = false
            sendDictationAction('stop')
        }
    }, 25)
}

/** Registers the dictation hotkey. Returns false if the OS refused it (e.g. another app owns it). */
function registerDictationHotkey(accelerator: string): boolean {
    try {
        const ok = globalShortcut.register(accelerator, onHotkeyPressed)
        if (ok) activeHotkey = accelerator
        return ok
    } catch (e) {
        console.warn('Failed to register hotkey:', accelerator, e)
        return false
    }
}

function createWindow() {
    const iconPath = getAppIconPath();
    const appIcon = getAppIcon();

    mainWindow = new BrowserWindow({
        width: 550,
        height: 600,
        minWidth: 450,
        minHeight: 540,
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

    if (iconPath && mainWindow.setIcon) {
        try { mainWindow.setIcon(iconPath); } catch (_) { }
    }

    // Load UI
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
        // mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadFile('dist/index.html')
    }

    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[Renderer]: ${message}`);
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow?.show()
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
        try {
            new Notification({
                title: 'WaveScribe hotkey unavailable',
                body: `Could not register "${hotkey}". Another app may be using it. Choose a different shortcut in Settings.`
            }).show()
        } catch (_) { }
    }

    // Create the spinner overlay window (hidden until needed)
    spinnerWindow = new BrowserWindow({
        width: 40,
        height: 40,
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

    // Inline the spinner HTML as a data URI so it works in both dev and production
    const spinnerHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0}html,body{width:100%;height:100%;background:transparent;overflow:hidden;display:flex;align-items:center;justify-content:center}.spinner{box-sizing:border-box;width:24px;height:24px;border:3.5px solid rgba(245,158,11,0.25);border-top-color:#f59e0b;border-radius:50%;animation:spin .65s linear infinite;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3))}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="spinner"></div></body></html>`;
    spinnerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(spinnerHTML)}`)
}

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
    }
})

app.whenReady().then(async () => {
    if (!gotSingleInstanceLock) return
    Menu.setApplicationMenu(null)
    // Warm the GPU-memory probe in the background so nothing ever blocks on it later.
    probeGpuVram().catch(() => { })
    const appIcon = getAppIcon()
    createWindow()
    createTray(appIcon)

    // Auto-init LLM if enabled and model is already downloaded
    const savedLlm = store.get('llmModelId') as string | undefined
    if (savedLlm) setPreferredModel(savedLlm)
    const aiEnabled = store.get('aiReformat', false)
    const hasDownloaded = OPEN_MODELS.some(m => isModelDownloaded(m.id))
    if (aiEnabled && hasDownloaded) {
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
        // Remember everything on the clipboard (not just text) so images and rich text survive.
        const previous = {
            text: clipboard.readText(),
            html: clipboard.readHTML(),
            rtf: clipboard.readRTF(),
            image: clipboard.readImage(),
        };
        clipboard.writeText(text);

        // Native SendInput takes ~1ms; PowerShell (cold start + C# compile) takes hundreds.
        const success = sendCtrlV() || await sendCtrlVViaPowerShell();

        // Restore the original clipboard only if it still holds what we pasted.
        setTimeout(() => {
            if (clipboard.readText() === text) {
                const hasContent = previous.text || previous.html || previous.rtf || !previous.image.isEmpty();
                if (!hasContent) {
                    clipboard.clear();
                } else {
                    clipboard.write({
                        text: previous.text || undefined,
                        html: previous.html || undefined,
                        rtf: previous.rtf || undefined,
                        image: previous.image.isEmpty() ? undefined : previous.image,
                    });
                }
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
            return { success: false };
        }

        store.set(key, value);
        return { success: true };
    }

    store.set(key, value);
    return { success: true };
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

ipcMain.handle('copy-text', (event, text) => {
    clipboard.writeText(text);
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
        win.setAlwaysOnTop(false);
    }
    return { success: true };
});

// --- Cursor-Position Spinner ---

function getCaretScreenPosition(): Promise<{ x: number, y: number }> {
    return new Promise((resolve) => {
        const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const scriptPath = path.join(app.getPath('temp'), `get-caret-${uniqueId}.ps1`);

        const ps1 = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public struct POINT { public int X; public int Y; }

[StructLayout(LayoutKind.Sequential)]
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

[StructLayout(LayoutKind.Sequential)]
public struct GUITHREADINFO {
    public int cbSize;
    public int flags;
    public IntPtr hwndActive;
    public IntPtr hwndFocus;
    public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner;
    public IntPtr hwndMoveSize;
    public IntPtr hwndCaret;
    public RECT rcCaret;
}

public class Win32Caret {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);

    public static string GetWin32Caret() {
        try {
            IntPtr fg = GetForegroundWindow();
            if (fg != IntPtr.Zero) {
                uint pid;
                uint tid = GetWindowThreadProcessId(fg, out pid);
                var gui = new GUITHREADINFO();
                gui.cbSize = Marshal.SizeOf(gui);
                if (GetGUIThreadInfo(tid, ref gui)) {
                    IntPtr target = gui.hwndCaret != IntPtr.Zero ? gui.hwndCaret : gui.hwndFocus;
                    if (target != IntPtr.Zero && (gui.rcCaret.Right > gui.rcCaret.Left || gui.rcCaret.Bottom > gui.rcCaret.Top || gui.rcCaret.Left != 0 || gui.rcCaret.Top != 0)) {
                        var pt = new POINT { X = gui.rcCaret.Left, Y = gui.rcCaret.Top };
                        ClientToScreen(target, ref pt);
                        if (pt.X > 0 || pt.Y > 0) return pt.X + "," + pt.Y;
                    }
                }
            }
        } catch {}
        return "";
    }

    public static string GetMouse() {
        POINT mouse;
        GetCursorPos(out mouse);
        return mouse.X + "," + mouse.Y;
    }
}
"@

$pos = $null

# 1. Check UI Automation (Chrome, Edge, Word, VSCode, Slack, Notepad, Discord, etc.)
try {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    if ($focused -and $focused -ne $root) {
        $pattern = $null
        if ($focused.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
            $selection = $pattern.GetSelection()
            if ($selection -and $selection.Length -gt 0) {
                $rects = $selection[0].GetBoundingRectangles()
                if ($rects -and $rects.Length -gt 0) {
                    $r = $rects[0]
                    if ($r.Left -gt 0 -or $r.Top -gt 0) {
                        $pos = "$([int]$r.Left),$([int]$r.Top)"
                    }
                }
            }
        }
        
        # If text selection is not available, check if focused element is an Edit/Document control
        if (-not $pos) {
            $cType = $focused.Current.ControlType
            if ($cType -eq [System.Windows.Automation.ControlType]::Edit -or $cType -eq [System.Windows.Automation.ControlType]::Document) {
                $b = $focused.Current.BoundingRectangle
                if ($b -and $b.Width -gt 0 -and $b.Height -gt 0 -and ($b.Left -gt 0 -or $b.Top -gt 0)) {
                    $pos = "$([int]($b.Left + 4)),$([int]($b.Top + 4))"
                }
            }
        }
    }
} catch {}

# 2. Check Win32 Foreground Thread Caret (Notepad, WordPad, native dialogs)
if (-not $pos) {
    $win32Pos = [Win32Caret]::GetWin32Caret()
    if ($win32Pos) {
        $pos = $win32Pos
    }
}

# 3. Fallback to mouse cursor
if (-not $pos) {
    $pos = [Win32Caret]::GetMouse()
}

[Console]::Out.Write($pos)
        `;

        fs.writeFileSync(scriptPath, ps1, 'utf-8');

        let output = '';
        const proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });

        proc.stdout.on('data', (data: Buffer) => { output += data.toString(); });

        proc.on('close', () => {
            try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch (_) { }
            const parts = output.trim().split(',');
            if (parts.length === 2) {
                resolve({ x: parseInt(parts[0], 10), y: parseInt(parts[1], 10) });
            } else {
                const display = screen.getPrimaryDisplay();
                resolve({ x: display.bounds.width / 2, y: display.bounds.height / 2 });
            }
        });

        proc.on('error', () => {
            const display = screen.getPrimaryDisplay();
            resolve({ x: display.bounds.width / 2, y: display.bounds.height / 2 });
        });
    });
}

// The UI Automation caret lookup is slow (PowerShell + C# compile), so it runs when recording
// STARTS, while the CPU is idle, instead of on the critical path when recording stops.
let cachedCaret: { x: number, y: number } | null = null;

ipcMain.handle('prime-caret', () => {
    cachedCaret = null;
    getCaretScreenPosition()
        .then((pos) => { cachedCaret = pos; })
        .catch(() => { });
    return { success: true };
});

ipcMain.handle('show-cursor-spinner', () => {
    if (!spinnerWindow) return { success: false };
    try {
        // Use the primed caret if ready, otherwise the mouse position. Never wait on PowerShell here.
        const pos = cachedCaret ?? getCursorPosition() ?? (() => {
            const display = screen.getPrimaryDisplay();
            return { x: display.bounds.width / 2, y: display.bounds.height / 2 };
        })();
        // Offset slightly right and above/level with the caret so it aligns with the text insertion point
        spinnerWindow.setBounds({ x: pos.x + 2, y: pos.y - 4, width: 36, height: 36 });
        spinnerWindow.showInactive();
        return { success: true };
    } catch (err) {
        console.error('Failed to show spinner:', err);
        return { success: false };
    }
});

ipcMain.handle('hide-cursor-spinner', () => {
    if (spinnerWindow) {
        spinnerWindow.hide();
    }
    return { success: true };
});

// Returns the dedicated GPU VRAM in MB, or null if it cannot be determined (probed async, cached).
ipcMain.handle('get-vram-mb', (): Promise<number | null> => probeGpuVram());

// --- Hardware & LLM IPC Handlers ---

ipcMain.handle('get-hardware-profile', () => {
    return detectHardware();
});

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

ipcMain.handle('llm-reformat', async (_event: any, text: string, context?: string) => {
    try {
        const result = await reformatText(text, context);
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
            activeChatAbortSignal
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

ipcMain.handle('capture-context', async () => {
    try {
        const text = await captureContext();
        return { success: true, text };
    } catch {
        return { success: true, text: '' };
    }
});
