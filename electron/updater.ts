import { app, ipcMain, Notification } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

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
    autoUpdater.checkForUpdates().catch(() => { })
}

// Checks GitHub Releases, downloads new versions in the background and reports progress to the
// window, which offers a one-click restart. Unchosen updates still install when the app quits.
export function initAutoUpdate(onState: (state: UpdateState) => void): void {
    sendState = onState

    ipcMain.handle('update-get-state', () => state)
    ipcMain.handle('update-check', () => { if (app.isPackaged) check(); return state })
    // Silent install, then reopen: no installer pages for the user to click through.
    ipcMain.handle('update-install', () => {
        if (state.status === 'ready') setImmediate(() => autoUpdater.quitAndInstall(true, true))
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
                body: `Version ${info.version} is ready. Click "Restart to update" in WaveScribe, or it installs when you quit.`
            }).show()
        }
    })
    autoUpdater.on('error', (err) => {
        console.warn('[Updater]', err?.message ?? err)
        // A failed check is not worth alarming anyone; keep a finished download installable.
        if (state.status !== 'ready') setState({ status: 'error' })
    })

    setTimeout(check, 15_000)
    setInterval(check, CHECK_INTERVAL_MS)
}
