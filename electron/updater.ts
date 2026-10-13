import { app, BrowserWindow, ipcMain, Notification, screen } from 'electron'
import electronUpdater from 'electron-updater'
import path from 'path'
import { showUpdateSplash } from './update-splash'

const { autoUpdater } = electronUpdater

// Check soon after start, then hourly, and again when the window comes back to the front (at
// most every 15 minutes), so a new version shows up without the user doing anything.
const FIRST_CHECK_MS = 5_000
const CHECK_INTERVAL_MS = 60 * 60 * 1000
const FOCUS_CHECK_MIN_GAP_MS = 15 * 60 * 1000
let lastCheck = 0

export type UpdateStatus = 'dev' | 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
    /** The version running now. */
    version: string
    status: UpdateStatus
    /** The version being downloaded or ready to install. */
    newVersion?: string
    percent?: number
}

let state: UpdateState = { version: app.getVersion(), status: 'idle' }
let sendState: (state: UpdateState) => void = () => { }

function setState(next: Partial<UpdateState>): void {
    state = { ...state, ...next }
    sendState(state)
}

function check(): void {
    if (state.status === 'downloading' || state.status === 'ready') return
    lastCheck = Date.now()
    autoUpdater.checkForUpdates().catch(() => { })
}

/** Called when the window is focused: checks again if the last check was a while ago. */
export function checkForUpdatesIfStale(): void {
    if (!app.isPackaged || Date.now() - lastCheck < FOCUS_CHECK_MIN_GAP_MS) return
    check()
}

// Checks GitHub Releases, downloads new versions in the background and reports progress to the
// window, which offers a one-click restart. Unchosen updates still install when the app quits.
export function initAutoUpdate(onState: (state: UpdateState) => void, getWindow: () => BrowserWindow | null): void {
    sendState = onState

    ipcMain.handle('update-get-state', () => state)
    ipcMain.handle('update-check', () => { if (app.isPackaged) check(); return state })
    // Silent install, then reopen: no installer pages for the user to click through.
    // The "Updating WaveScribe" window covers the minute or two the installer takes, so the app
    // does not simply vanish; it appears where the WaveScribe window was before the app closes.
    ipcMain.handle('update-install', async () => {
        if (state.status !== 'ready') return state
        try {
            const win = getWindow()
            const b = win?.getBounds() ?? screen.getPrimaryDisplay().workArea
            const centre = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
            const scale = screen.getDisplayNearestPoint({ x: Math.round(centre.x), y: Math.round(centre.y) }).scaleFactor || 1
            await showUpdateSplash(state.newVersion ?? '', screen.dipToScreenPoint(centre), scale, path.join(app.getAppPath(), 'assets', 'icon.png'))
        } catch (err) {
            console.warn('[Updater] Could not show the update window:', err)
        }
        setImmediate(() => autoUpdater.quitAndInstall(true, true))
        return state
    })

    // Development builds have no update feed.
    if (!app.isPackaged) {
        setState({ status: 'dev' })
        return
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }))
    autoUpdater.on('update-not-available', () => setState({ status: 'up-to-date', newVersion: undefined, percent: undefined }))
    autoUpdater.on('update-available', (info) => setState({ status: 'downloading', newVersion: info.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) => setState({ status: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => {
        setState({ status: 'ready', newVersion: info.version, percent: 100 })
        if (Notification.isSupported()) {
            new Notification({
                title: 'WaveScribe update ready',
                body: `Version ${info.version} is ready. Click "Update to ${info.version}" at the top of WaveScribe, or it installs when you quit.`
            }).show()
        }
    })
    autoUpdater.on('error', (err) => {
        console.warn('[Updater]', err?.message ?? err)
        // A failed check is not worth alarming anyone; keep a finished download installable.
        if (state.status !== 'ready') setState({ status: 'error' })
    })

    setTimeout(check, FIRST_CHECK_MS)
    setInterval(check, CHECK_INTERVAL_MS)
}
