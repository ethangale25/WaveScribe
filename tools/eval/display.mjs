// Finds the monitor test windows may use, so automated runs never open windows on the screen the
// developer is working on.
//
// Windows numbers displays in Settings > System > Display. Here "screen #1" is \\.\DISPLAY1 (bottom
// right); the primary monitor (#3, \\.\DISPLAY5) is left alone. Override the device name with the
// WAVESCRIBE_TEST_DISPLAY environment variable if the layout changes.

import { spawnSync } from 'child_process';

const DEVICE = process.env.WAVESCRIBE_TEST_DISPLAY || '\\\\.\\DISPLAY1';

const SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[Dpi]::SetProcessDPIAware() | Out-Null
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.DeviceName + '|' + $_.Bounds.X + '|' + $_.Bounds.Y + '|' + $_.Bounds.Width + '|' + $_.Bounds.Height + '|' + $_.Primary }
`;

/**
 * Environment variables that make the app open its window on the test display without taking
 * focus. Throws if that display cannot be found, so a test never falls back to the main screen.
 */
export function testDisplayEnv() {
    const run = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { encoding: 'utf-8' });
    const screens = (run.stdout || '').split(/\r?\n/).filter(Boolean).map(line => {
        const [name, x, y, w, h, primary] = line.split('|');
        return { name, x: +x, y: +y, w: +w, h: +h, primary: primary === 'True' };
    });
    const target = screens.find(s => s.name.toUpperCase() === DEVICE.toUpperCase());
    if (!target) {
        throw new Error(`Test display ${DEVICE} not found (have: ${screens.map(s => s.name).join(', ') || 'none'}). Not launching.`);
    }
    if (target.primary) {
        throw new Error(`Test display ${DEVICE} is the primary monitor. Refusing to open test windows there.`);
    }
    // Physical-pixel centre of the display; the app converts it to its own coordinates.
    return { WAVESCRIBE_TEST_DISPLAY_POINT: `${Math.round(target.x + target.w / 2)},${Math.round(target.y + target.h / 2)}` };
}
