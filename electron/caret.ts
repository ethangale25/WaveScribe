import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

// Finds the text caret (the blinking insertion line) in whatever app has focus, so the dictation
// indicator can sit where the text will appear rather than at the mouse.
//
// The lookup runs in one long-lived PowerShell process: compiling the C# helper takes 1-3 s, so it is
// done once and each query then costs tens of milliseconds. Coordinates are physical screen pixels.

export interface CaretRect {
    x: number
    y: number
    width: number
    height: number
    /** Which technique found it: gui (Win32 caret), msaa (accessibility caret), uia (UI Automation). */
    source: 'gui' | 'msaa' | 'uia'
}

// Tried in order of cost and reliability:
//  1. GetGUIThreadInfo: the classic Win32 caret (Notepad, WordPad, dialogs, many native apps).
//  2. MSAA OBJID_CARET: the accessibility caret object (Chrome, Edge, Electron apps, Office).
//  3. UI Automation TextPattern: modern apps. A plain caret is an empty selection, which has no
//     rectangle, so it is measured from the neighbouring character instead.
const HELPER = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase, Accessibility -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using System.Windows.Automation.Text;
using Accessibility;

public static class CaretFinder {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO {
        public int cbSize, flags;
        public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
        public RECT rcCaret;
    }
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint tid, ref GUITHREADINFO info);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hWnd, ref POINT pt);
    [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object acc);

    const uint OBJID_CARET = 0xFFFFFFF8;
    static Guid IID_IAccessible = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");

    public static string Find() {
        // Physical pixels on every monitor, whatever its scaling.
        SetThreadDpiAwarenessContext((IntPtr)(-4));
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return "";
        uint pid;
        var info = new GUITHREADINFO();
        info.cbSize = Marshal.SizeOf(info);
        if (!GetGUIThreadInfo(GetWindowThreadProcessId(fg, out pid), ref info)) return "";

        if (info.hwndCaret != IntPtr.Zero && info.rcCaret.Bottom > info.rcCaret.Top) {
            var pt = new POINT { X = info.rcCaret.Left, Y = info.rcCaret.Top };
            if (ClientToScreen(info.hwndCaret, ref pt))
                return Result("gui", pt.X, pt.Y, info.rcCaret.Right - info.rcCaret.Left, info.rcCaret.Bottom - info.rcCaret.Top);
        }

        IntPtr focus = info.hwndFocus != IntPtr.Zero ? info.hwndFocus : fg;
        try {
            object obj;
            if (AccessibleObjectFromWindow(focus, OBJID_CARET, ref IID_IAccessible, out obj) == 0 && obj != null) {
                int l, t, w, h;
                ((IAccessible)obj).accLocation(out l, out t, out w, out h, 0);
                if (h > 0 && (l != 0 || t != 0)) return Result("msaa", l, t, w, h);
            }
        } catch { }

        try {
            var el = AutomationElement.FocusedElement;
            object p;
            if (el != null && el.TryGetCurrentPattern(TextPattern.Pattern, out p)) {
                var sel = ((TextPattern)p).GetSelection();
                if (sel != null && sel.Length > 0) return FromRange(sel[0]);
            }
        } catch { }
        return "";
    }

    static string FromRange(TextPatternRange range) {
        var rects = range.GetBoundingRectangles();
        if (rects.Length > 0 && rects[0].Height > 0) {
            var r = rects[rects.Length - 1];
            return Result("uia", (int)r.Right, (int)r.Top, 1, (int)r.Height);
        }
        // An empty selection (a plain caret) has no rectangle: use the right edge of the character
        // before it, or the left edge of the one after it when the caret starts a line.
        var before = range.Clone();
        before.MoveEndpointByUnit(TextPatternRangeEndpoint.Start, TextUnit.Character, -1);
        string prev = before.GetText(1);
        if (prev.Length > 0 && prev != "\r" && prev != "\n") {
            rects = before.GetBoundingRectangles();
            if (rects.Length > 0 && rects[0].Height > 0) {
                var r = rects[rects.Length - 1];
                return Result("uia", (int)r.Right, (int)r.Top, 1, (int)r.Height);
            }
        }
        var after = range.Clone();
        after.ExpandToEnclosingUnit(TextUnit.Character);
        rects = after.GetBoundingRectangles();
        if (rects.Length > 0 && rects[0].Height > 0) return Result("uia", (int)rects[0].Left, (int)rects[0].Top, 1, (int)rects[0].Height);
        return "";
    }

    static string Result(string source, int x, int y, int w, int h) {
        return source + "," + x + "," + y + "," + Math.Max(1, w) + "," + h;
    }
}
"@
[Console]::Out.WriteLine('ready')
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq $null -or $line -eq 'exit') { break }
    $answer = ''
    try { $answer = [CaretFinder]::Find() } catch { }
    [Console]::Out.WriteLine($answer)
}
`

let proc: ChildProcess | null = null
let ready: Promise<boolean> | null = null
let buffer = ''
const waiting: Array<(line: string) => void> = []

function start(): Promise<boolean> {
    if (ready) return ready
    if (process.platform !== 'win32') return (ready = Promise.resolve(false))
    ready = new Promise((resolve) => {
        const script = path.join(app.getPath('temp'), 'wavescribe-caret-helper.ps1')
        fs.writeFileSync(script, HELPER, 'utf-8')
        const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true })
        proc = child
        let started = false
        child.stdout.on('data', (data: Buffer) => {
            buffer += data.toString()
            let i
            while ((i = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, i).trim()
                buffer = buffer.slice(i + 1)
                if (!started) {
                    if (line === 'ready') { started = true; resolve(true) }
                    continue
                }
                waiting.shift()?.(line)
            }
        })
        child.on('error', () => resolve(false))
        child.on('exit', () => {
            // Answer anything still pending, and let the next lookup start a fresh helper.
            while (waiting.length) waiting.shift()!('')
            if (!started) resolve(false)
            if (proc === child) { proc = null; ready = null; buffer = '' }
        })
    })
    return ready
}

/** Starts the helper ahead of time so the first dictation does not pay the compile cost. */
export function warmUpCaretLocator(): void {
    void start()
}

/** The focused app's caret in physical pixels, or null if it has none or the lookup is too slow. */
export async function locateCaret(timeoutMs = 400): Promise<CaretRect | null> {
    const deadline = Date.now() + timeoutMs
    const started = await Promise.race([start(), new Promise<false>(r => setTimeout(() => r(false), timeoutMs))])
    if (!started || !proc?.stdin) return null

    const line = await new Promise<string>((resolve) => {
        // A late answer still has to be consumed in order, so the slot stays queued after a timeout.
        let settled = false
        const timer = setTimeout(() => { settled = true; resolve('') }, Math.max(0, deadline - Date.now()))
        waiting.push((answer) => { if (!settled) { clearTimeout(timer); resolve(answer) } })
        proc!.stdin!.write('find\n')
    })

    const [source, ...nums] = line.split(',')
    const [x, y, width, height] = nums.map(Number)
    if (!['gui', 'msaa', 'uia'].includes(source) || [x, y, width, height].some(n => !Number.isFinite(n)) || height <= 0) return null
    return { source: source as CaretRect['source'], x, y, width, height }
}

export function stopCaretLocator(): void {
    try { proc?.stdin?.write('exit\n') } catch { }
    try { proc?.kill() } catch { }
    proc = null
    ready = null
}
