import { clipboard, ClipboardItem } from 'electron'
import { isKeyDown, releaseKeys, sendCtrlC } from './win32'

// Reads the text selected in the focused app, for voice commands ("make this shorter"). Windows
// offers no general way to read another app's selection, so this copies it: Ctrl+C, read the
// clipboard, then put the user's clipboard back.

const VK_SHIFT = 0x10
const VK_CONTROL = 0x11
const VK_MENU = 0x12 // Alt
const VK_LWIN = 0x5b
const VK_RWIN = 0x5c
const MODIFIERS = [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN]

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Waits for the shortcut's keys to be let go. Ctrl+C sent while Shift or Alt is still held is a
 * different shortcut (Ctrl+Shift+C opens developer tools in browsers). If they are still down after
 * a moment, they are released synthetically.
 */
async function waitForModifiersReleased(): Promise<void> {
    for (let waited = 0; waited < 600; waited += 20) {
        if (!MODIFIERS.some(vk => isKeyDown(vk))) return
        await sleep(20)
    }
    releaseKeys(MODIFIERS.filter(vk => isKeyDown(vk)))
}

/** The selected text, or '' when nothing is selected or it cannot be read. */
export async function captureSelection(): Promise<string> {
    if (isKeyDown(VK_SHIFT) === null) return '' // native input layer unavailable

    await waitForModifiersReleased()

    const previous = await snapshotClipboard()
    // A marker shows whether the copy happened: with no selection, most apps copy nothing.
    const marker = `wavescribe-selection-${Date.now()}`
    await clipboard.writeText(marker)
    let selected = ''
    try {
        if (!sendCtrlC()) return ''
        for (let waited = 0; waited < 400; waited += 20) {
            await sleep(20)
            const text = await clipboard.readText()
            if (text !== marker) {
                selected = text
                break
            }
        }
    } finally {
        try {
            if (previous.length === 0) clipboard.clear()
            else await clipboard.write(previous)
        } catch (err) {
            console.warn('[Selection] Could not restore the clipboard:', err)
        }
    }
    return selected
}

/**
 * Copies everything on the clipboard (text, HTML, RTF, images, files...) into standalone items, so
 * it can be put back after a paste. Formats that cannot be read are skipped rather than failing.
 */
export async function snapshotClipboard(): Promise<ClipboardItem[]> {
    try {
        const items = await clipboard.read();
        const copies = await Promise.all(items.map(async (item) => {
            const entries = await Promise.all(item.types.map(async (type) => {
                try { return [type, await item.getType(type)] as const; } catch { return null; }
            }));
            const readable = entries.filter((e): e is NonNullable<typeof e> => e !== null);
            return readable.length ? new ClipboardItem(Object.fromEntries(readable)) : null;
        }));
        return copies.filter((c): c is ClipboardItem => c !== null);
    } catch (err) {
        console.warn('[Clipboard] Could not read the clipboard:', err);
        return [];
    }
}
