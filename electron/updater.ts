import { app, Notification } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// Checks GitHub Releases quietly, downloads in the background, and installs when the app quits.
// Does nothing in dev (unpackaged) builds, where there is no update feed.
export function initAutoUpdate(): void {
    if (!app.isPackaged) return

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-downloaded', (info) => {
        if (Notification.isSupported()) {
            new Notification({
                title: 'WaveScribe update ready',
                body: `Version ${info.version} will install the next time you quit WaveScribe.`
            }).show()
        }
    })
    autoUpdater.on('error', (err) => console.warn('[Updater]', err?.message ?? err))

    const check = () => { autoUpdater.checkForUpdates().catch(() => { }) }
    setTimeout(check, 15_000)
    setInterval(check, CHECK_INTERVAL_MS)
}
