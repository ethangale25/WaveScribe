import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

// While an update installs, WaveScribe is closed and the installer runs silently for a minute or two.
// This small window, run by a separate PowerShell process so it outlives the app, shows that the
// update is under way and closes itself as soon as the new version's window appears.

const SCRIPT = String.raw`
param([string]$Version, [int]$X, [int]$Y, [double]$Scale, [string]$Icon, [string]$ReadyFile)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public class UpdateSplash : Form {
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);

    const int W = 380, H = 128;
    readonly float scale;
    readonly Image logo;
    string title, sub;
    float phase;

    public static void UsePhysicalPixels() { SetThreadDpiAwarenessContext((IntPtr)(-4)); }

    public UpdateSplash(float scale, Image logo, string title, string sub) {
        this.scale = scale; this.logo = logo; this.title = title; this.sub = sub;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        DoubleBuffered = true;
        BackColor = Color.FromArgb(13, 17, 23);
        StartPosition = FormStartPosition.Manual;
        Size = new Size((int)(W * scale), (int)(H * scale));
        Region = Region.FromHrgn(CreateRoundRectRgn(0, 0, Width + 1, Height + 1, (int)(24 * scale), (int)(24 * scale)));
        var timer = new Timer { Interval = 16 };
        timer.Tick += (s, e) => { phase = (phase + 0.011f) % 1f; Invalidate(); };
        timer.Start();
    }

    // Appear without taking the keyboard from whatever the user is doing.
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get { var cp = base.CreateParams; cp.ExStyle |= 0x08000000 | 0x80; return cp; }
    }

    public void SetText(string title, string sub) { this.title = title; this.sub = sub; Invalidate(); }

    static GraphicsPath Rounded(RectangleF r, float radius) {
        var p = new GraphicsPath();
        float d = radius * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.ScaleTransform(scale, scale);

        using (var glow = new LinearGradientBrush(new RectangleF(0, 0, W, H), Color.FromArgb(28, 43, 85, 245), Color.FromArgb(0, 43, 85, 245), 90f))
            g.FillRectangle(glow, 0, 0, W, H);
        using (var border = new Pen(Color.FromArgb(70, 91, 127, 255), 1f))
        using (var outline = Rounded(new RectangleF(0.5f, 0.5f, W - 1, H - 1), 12))
            g.DrawPath(border, outline);

        if (logo != null) g.DrawImage(logo, 24, 32, 52, 52);

        using (var titleFont = new Font("Segoe UI Semibold", 16f, GraphicsUnit.Pixel))
        using (var subFont = new Font("Segoe UI", 12.5f, GraphicsUnit.Pixel))
        using (var white = new SolidBrush(Color.FromArgb(240, 246, 252)))
        using (var grey = new SolidBrush(Color.FromArgb(139, 148, 158))) {
            g.DrawString(title, titleFont, white, 92, 30);
            g.DrawString(sub, subFont, grey, new RectangleF(92, 54, W - 92 - 22, 36));
        }

        // An indeterminate bar: a blue segment sweeping across a dark track.
        var track = new RectangleF(92, 96, W - 92 - 24, 4);
        using (var trackBrush = new SolidBrush(Color.FromArgb(40, 46, 56)))
        using (var trackPath = Rounded(track, 2))
            g.FillPath(trackBrush, trackPath);
        float seg = track.Width * 0.32f;
        float x = track.X - seg + phase * (track.Width + seg);
        var bar = RectangleF.Intersect(new RectangleF(x, track.Y, seg, track.Height), track);
        if (bar.Width > 1) {
            using (var barBrush = new SolidBrush(Color.FromArgb(43, 85, 245)))
            using (var barPath = Rounded(bar, 2))
                g.FillPath(barBrush, barPath);
        }
    }
}
"@

[UpdateSplash]::UsePhysicalPixels()
$logo = $null
if (Test-Path $Icon) { $logo = [System.Drawing.Image]::FromFile($Icon) }
$form = New-Object UpdateSplash([single]$Scale, $logo, 'Updating WaveScribe', "Installing version $Version. WaveScribe reopens by itself in a minute or two.")
$form.Location = New-Object System.Drawing.Point(($X - [int]($form.Width / 2)), ($Y - [int]($form.Height / 2)))
$start = Get-Date
$script:warned = $false
$form.Add_Shown({ Set-Content -Path $ReadyFile -Value 'ready' })

$poll = New-Object System.Windows.Forms.Timer
$poll.Interval = 700
$poll.Add_Tick({
    # Done once the new version (started after this window) has its window up.
    $new = Get-Process -Name WaveScribe | Where-Object { $_.StartTime -gt $start -and $_.MainWindowHandle -ne [IntPtr]::Zero }
    if ($new) { $form.Close(); return }
    $minutes = ((Get-Date) - $start).TotalMinutes
    if ($minutes -gt 6 -and -not $script:warned) {
        $script:warned = $true
        $form.SetText('Update is taking longer than usual', 'If WaveScribe does not reopen soon, start it from the Start menu.')
    }
    if ($minutes -gt 8) { $form.Close() }
})
$poll.Start()
[System.Windows.Forms.Application]::Run($form)
`

/**
 * Shows the "Updating WaveScribe" window centred on the given point (physical pixels) and resolves
 * once it is on screen, or after a few seconds at worst, so the app never quits to a blank screen.
 */
export async function showUpdateSplash(version: string, center: { x: number; y: number }, scale: number, iconPng: string): Promise<void> {
    if (process.platform !== 'win32') return
    const dir = path.join(app.getPath('temp'), 'wavescribe-update')
    fs.mkdirSync(dir, { recursive: true })
    const script = path.join(dir, 'splash.ps1')
    const icon = path.join(dir, 'icon.png')
    const ready = path.join(dir, `ready-${Date.now()}`)
    fs.writeFileSync(script, SCRIPT, 'utf-8')
    // The packaged icon lives inside app.asar, which only this process can read.
    try { fs.copyFileSync(iconPng, icon) } catch { }

    const child = spawn('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
        '-Version', version, '-X', String(Math.round(center.x)), '-Y', String(Math.round(center.y)),
        '-Scale', String(scale), '-Icon', icon, '-ReadyFile', ready,
    ], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()

    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !fs.existsSync(ready)) {
        await new Promise(r => setTimeout(r, 100))
    }
    try { fs.unlinkSync(ready) } catch { }
}
