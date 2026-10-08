// Maps the non-modifier key of an Electron accelerator (e.g. "CommandOrControl+Shift+Space") to a
// Windows virtual-key code, so push-to-talk can poll for the key being released.

const NAMED_KEYS: Record<string, number> = {
    space: 0x20, enter: 0x0d, return: 0x0d, tab: 0x09, escape: 0x1b, esc: 0x1b, backspace: 0x08,
    delete: 0x2e, insert: 0x2d, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
    up: 0x26, down: 0x28, left: 0x25, right: 0x27,
}

const MODIFIERS = new Set(['commandorcontrol', 'cmdorctrl', 'command', 'cmd', 'control', 'ctrl', 'alt', 'option', 'altgr', 'shift', 'super', 'meta'])

/** Virtual-key code of the accelerator's main key, or null if it cannot be tracked. */
export function mainKeyVirtualCode(accelerator: string): number | null {
    const parts = accelerator.split('+').map(p => p.trim()).filter(Boolean)
    const main = parts.filter(p => !MODIFIERS.has(p.toLowerCase()))
    if (main.length !== 1) return null

    const key = main[0]
    const lower = key.toLowerCase()
    if (lower in NAMED_KEYS) return NAMED_KEYS[lower]
    if (/^[a-z]$/.test(lower)) return lower.toUpperCase().charCodeAt(0)
    if (/^[0-9]$/.test(lower)) return lower.charCodeAt(0)
    const fn = lower.match(/^f(\d{1,2})$/)
    if (fn) {
        const n = parseInt(fn[1], 10)
        if (n >= 1 && n <= 24) return 0x70 + n - 1
    }
    return null
}
