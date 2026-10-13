import koffi from 'koffi'

// Direct Win32 calls via FFI. These replace spawning PowerShell and compiling C# with
// Add-Type on every dictation. Each export returns null/false if the native layer is unavailable
// so callers can fall back to the PowerShell path.

const INPUT_KEYBOARD = 1
const KEYEVENTF_KEYUP = 0x0002
const VK_CONTROL = 0x11
const VK_V = 0x56

interface Win32Api {
    sendInput: (inputs: any[], size: number) => number
    getAsyncKeyState: (vk: number) => number
    inputSize: number
}

let api: Win32Api | null | undefined

function load(): Win32Api | null {
    if (api !== undefined) return api
    if (process.platform !== 'win32') return (api = null)
    try {
        const user32 = koffi.load('user32.dll')

        const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
            wVk: 'uint16',
            wScan: 'uint16',
            dwFlags: 'uint32',
            time: 'uint32',
            dwExtraInfo: 'uintptr_t',
        })
        // MOUSEINPUT is the largest union member; it determines the INPUT struct size.
        const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
            dx: 'int32',
            dy: 'int32',
            mouseData: 'uint32',
            dwFlags: 'uint32',
            time: 'uint32',
            dwExtraInfo: 'uintptr_t',
        })
        const INPUT_U = koffi.union('INPUT_U', { ki: KEYBDINPUT, mi: MOUSEINPUT })
        const INPUT = koffi.struct('INPUT', { type: 'uint32', u: INPUT_U })

        const SendInput = user32.func('uint32 SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)')
        const GetAsyncKeyState = user32.func('int16 GetAsyncKeyState(int vKey)')

        api = {
            inputSize: koffi.sizeof(INPUT),
            sendInput: (inputs, size) => SendInput(inputs.length, inputs, size),
            getAsyncKeyState: (vk) => GetAsyncKeyState(vk),
        }
    } catch (err) {
        console.warn('[win32] Native bindings unavailable, falling back to PowerShell:', err)
        api = null
    }
    return api
}

function key(vk: number, up: boolean) {
    return { type: INPUT_KEYBOARD, u: { ki: { wVk: vk, wScan: 0, dwFlags: up ? KEYEVENTF_KEYUP : 0, time: 0, dwExtraInfo: 0 } } }
}

/** Sends Ctrl+V to the focused window. Returns false if the native layer failed. */
export function sendCtrlV(): boolean {
    const w = load()
    if (!w) return false
    try {
        const events = [key(VK_CONTROL, false), key(VK_V, false), key(VK_V, true), key(VK_CONTROL, true)]
        return w.sendInput(events, w.inputSize) === events.length
    } catch (err) {
        console.warn('[win32] SendInput failed:', err)
        return false
    }
}

/**
 * Whether a key is physically held down right now. Returns null if the native layer is unavailable
 * (callers should then fall back to toggle behaviour).
 */
export function isKeyDown(virtualKey: number): boolean | null {
    const w = load()
    if (!w) return null
    try {
        // The high bit of the result is set while the key is down.
        return (w.getAsyncKeyState(virtualKey) & 0x8000) !== 0
    } catch {
        return null
    }
}
