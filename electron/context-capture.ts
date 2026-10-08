import { spawn } from 'child_process'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export function captureContext(): Promise<string> {
    return new Promise((resolve) => {
        const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const scriptPath = path.join(app.getPath('temp'), `capture-context-${uniqueId}.ps1`)

        const ps1 = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

try {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($focused -ne $null) {
        $valuePattern = $null
        $hasValue = $focused.TryGetCurrentPattern(
            [System.Windows.Automation.ValuePattern]::Pattern,
            [ref]$valuePattern
        )
        if ($hasValue -and $valuePattern -ne $null) {
            $val = ([System.Windows.Automation.ValuePattern]$valuePattern).Current.Value
            if ($val -ne $null) {
                Write-Output $val
                exit 0
            }
        }
        $textPattern = $null
        $hasText = $focused.TryGetCurrentPattern(
            [System.Windows.Automation.TextPattern]::Pattern,
            [ref]$textPattern
        )
        if ($hasText -and $textPattern -ne $null) {
            $range = ([System.Windows.Automation.TextPattern]$textPattern).DocumentRange
            $text = $range.GetText(2000)
            if ($text -ne $null) {
                Write-Output $text
                exit 0
            }
        }
    }
} catch {}
Write-Output ""
`

        try {
            fs.writeFileSync(scriptPath, ps1, 'utf-8')
        } catch (e) {
            return resolve('')
        }

        let output = ''
        const proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
            windowsHide: true
        })

        proc.stdout.on('data', (data: Buffer) => { output += data.toString() })

        const timeout = setTimeout(() => {
            try { proc.kill() } catch (_) { }
            try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath) } catch (_) { }
            resolve('')
        }, 2000)

        proc.on('close', () => {
            clearTimeout(timeout)
            try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath) } catch {}
            resolve(output.trim())
        })

        proc.on('error', () => {
            clearTimeout(timeout)
            try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath) } catch {}
            resolve('')
        })
    })
}
