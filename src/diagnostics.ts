import { loadModel, transcribeAudio, disposeTranscriber } from './transcribe';
import { startRecording, stopRecordingDirect, decodeAudioBuffer } from './audio';

// Models, mirroring the Settings dropdown order/IDs.
const MODELS: { id: string; name: string }[] = [
    { id: 'Xenova/whisper-tiny.en', name: 'Whisper Tiny' },
    { id: 'Xenova/whisper-base.en', name: 'Whisper Base' },
    { id: 'Xenova/whisper-small.en', name: 'Whisper Small' },
    { id: 'distil-whisper/distil-small.en', name: 'Distil Small' },
    { id: 'distil-whisper/distil-medium.en', name: 'Distil Medium' },
    { id: 'distil-whisper/distil-large-v3', name: 'Distil Large' },
    { id: 'onnx-community/moonshine-tiny-ONNX', name: 'Moonshine Tiny' },
    { id: 'onnx-community/moonshine-base-ONNX', name: 'Moonshine Base' },
];

// Estimated WebGPU VRAM (MB) per model/precision — mirrors MODEL_VRAM_MB in
// main.ts. Used for a pre-flight skip so a too-big WebGPU load doesn't trigger
// an uncatchable GPU-worker OOM that would crash the whole run.
const MODEL_VRAM_MB: Record<string, Record<string, number>> = {
    'Xenova/whisper-tiny.en': { auto: 150, fp32: 150, int8: 40, q8: 40 },
    'Xenova/whisper-base.en': { auto: 290, fp32: 290, int8: 75, q8: 75 },
    'Xenova/whisper-small.en': { auto: 990, fp32: 990, int8: 250, q8: 250 },
    'distil-whisper/distil-small.en': { auto: 500, fp32: 500, int8: 125, q8: 125 },
    'distil-whisper/distil-medium.en': { auto: 1200, fp32: 1200, int8: 300, q8: 300 },
    'distil-whisper/distil-large-v3': { auto: 2800, fp32: 2800, int8: 700, q8: 700 },
    'onnx-community/moonshine-tiny-ONNX': { auto: 150, fp32: 150, int8: 40, q8: 40 },
    'onnx-community/moonshine-base-ONNX': { auto: 350, fp32: 350, int8: 90, q8: 90 },
};

// WebGPU precisions the app can actually request (fp16 is deliberately excluded
// — it loads but produces garbage Whisper output, see main.ts).
const WEBGPU_PRECISIONS: { label: string; dtype: string | undefined }[] = [
    { label: 'auto', dtype: undefined },
    { label: 'fp32', dtype: 'fp32' },
    { label: 'int8', dtype: 'int8' },
    { label: 'q8', dtype: 'q8' },
];

type Verdict = 'PASS' | 'GARBAGE' | 'LOAD-FAIL' | 'RUN-FAIL' | 'SKIP';

interface ComboResult {
    model: string;
    device: 'cpu' | 'webgpu';
    precision: string;
    verdict: Verdict;
    wer: number | null;
    output: string;
    detail: string;
}

const PASS_WER = 0.4; // <=40% word error rate counts as a pass

// Word-level Levenshtein → word error rate vs the expected transcript.
function wordErrorRate(expected: string, actual: string): number {
    const norm = (s: string) => s.toLowerCase().replace(/[.,!?;:'"\[\]()]/g, '').trim().split(/\s+/).filter(Boolean);
    const ref = norm(expected);
    const hyp = norm(actual);
    if (ref.length === 0) return hyp.length === 0 ? 0 : 1;

    const dp: number[][] = Array.from({ length: ref.length + 1 }, () => new Array(hyp.length + 1).fill(0));
    for (let i = 0; i <= ref.length; i++) dp[i][0] = i;
    for (let j = 0; j <= hyp.length; j++) dp[0][j] = j;
    for (let i = 1; i <= ref.length; i++) {
        for (let j = 1; j <= hyp.length; j++) {
            const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[ref.length][hyp.length] / ref.length;
}

export function initDiagnostics(restoreModel: () => void): void {
    // Inject the diagnostics modal once inside theme-provider.
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'diagnostics-modal';
    modal.innerHTML = `
      <div class="modal-content diag-modal-content">
        <div class="modal-header">
          <div>
            <h2 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary);">Configuration Diagnostics</h2>
            <p style="font-size: 12px; color: var(--text-secondary); margin: 3px 0 0 0;">Test model inference accuracy and speed across hardware</p>
          </div>
          <button class="btn-close" id="diag-close">×</button>
        </div>
        <div class="modal-body diag-modal-body">
          <div class="settings-section" style="margin-bottom: 20px;">
            <h3>Step 1 — Reference Recording</h3>
            <p style="font-size: 12.5px; color: var(--text-secondary); margin: 0 0 12px 0; line-height: 1.45;">Record one clear phrase, then type exactly what you said. Every model/device/precision combo is replayed against this same audio.</p>
            <div class="form-group">
              <label>Expected Transcript</label>
              <input type="text" id="diag-expected" class="hotkey-input" placeholder="e.g. Oscar has a very old armpit" style="width: 100%; box-sizing: border-box;">
            </div>
            <div style="display:flex; gap:10px; align-items:center; margin-top:10px;">
              <button class="btn btn-secondary btn-small" id="diag-record" style="font-weight: 600;">Record Reference</button>
              <span id="diag-record-status" style="font-size:12px; color: var(--text-secondary);">No reference captured</span>
            </div>
          </div>
          <div class="settings-section" style="margin-bottom: 20px;">
            <h3>Step 2 — Benchmark Execution</h3>
            <p style="font-size: 12.5px; color: var(--text-secondary); margin: 0 0 12px 0; line-height: 1.45;">Tests models on CPU + WebGPU precisions. Combos that exceed available VRAM are safely skipped to prevent crashes.</p>
            <button class="btn btn-primary" id="diag-run" style="width:100%; font-weight: 600; padding: 10px;" disabled>Run All Permutations</button>
            <div id="diag-progress" style="font-size:12px; color: var(--text-secondary); margin-top:10px; min-height:16px;"></div>
          </div>
          <div class="settings-section" id="diag-results-section" style="display:none; margin-bottom: 0;">
            <h3>Results Summary</h3>
            <div id="diag-summary" style="font-size:12.5px; margin-bottom:12px; display: flex; flex-wrap: wrap; gap: 8px;"></div>
            <div id="diag-results" class="diag-results-table"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="diag-exit">Close</button>
        </div>
      </div>
    `;

    const container = document.getElementById('theme-provider') || document.body;
    container.appendChild(modal);

    const expectedInput = modal.querySelector('#diag-expected') as HTMLInputElement;
    const recordBtn = modal.querySelector('#diag-record') as HTMLButtonElement;
    const recordStatus = modal.querySelector('#diag-record-status') as HTMLElement;
    const runBtn = modal.querySelector('#diag-run') as HTMLButtonElement;
    const progress = modal.querySelector('#diag-progress') as HTMLElement;
    const resultsSection = modal.querySelector('#diag-results-section') as HTMLElement;
    const summary = modal.querySelector('#diag-summary') as HTMLElement;
    const resultsEl = modal.querySelector('#diag-results') as HTMLElement;
    const closeBtn = modal.querySelector('#diag-close') as HTMLElement;
    const exitBtn = modal.querySelector('#diag-exit') as HTMLElement;

    let referenceAudio: Float32Array | null = null;
    let isRecording = false;
    let isRunning = false;

    const maybeEnableRun = () => {
        runBtn.disabled = !(referenceAudio && expectedInput.value.trim().length > 0) || isRunning;
    };
    expectedInput.addEventListener('input', maybeEnableRun);

    recordBtn.addEventListener('click', async () => {
        if (isRunning) return;
        if (!isRecording) {
            try {
                await startRecording();
                isRecording = true;
                recordBtn.textContent = 'Stop Recording';
                recordStatus.textContent = 'Recording… speak now';
            } catch (err) {
                recordStatus.textContent = 'Mic error: ' + (err as Error).message;
            }
        } else {
            isRecording = false;
            recordBtn.textContent = 'Record Reference';
            try {
                const { fullAudio } = await stopRecordingDirect();
                referenceAudio = fullAudio;
                const secs = (referenceAudio.length / 16000).toFixed(1);
                recordStatus.textContent = `Reference captured (${secs}s)`;
            } catch (err) {
                recordStatus.textContent = 'Decode error: ' + (err as Error).message;
            }
            maybeEnableRun();
        }
    });

    const checkmarkSvg = `<svg class="check-icon-svg" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--green); display: inline-block; vertical-align: -1px; margin-right: 3px;"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5"/></svg>`;

    const verdictBadgeClass = (v: Verdict) =>
        v === 'PASS' ? 'model-card-badge green' :
        v === 'GARBAGE' ? 'model-card-badge red' :
        v === 'SKIP' ? 'model-card-badge' : 'model-card-badge amber';

    const renderResults = (results: ComboResult[]) => {
        resultsSection.style.display = 'block';
        const counts = results.reduce((acc, r) => { acc[r.verdict] = (acc[r.verdict] || 0) + 1; return acc; }, {} as Record<string, number>);
        summary.innerHTML = (['PASS', 'GARBAGE', 'LOAD-FAIL', 'RUN-FAIL', 'SKIP'] as Verdict[])
            .filter(v => (counts[v] || 0) > 0)
            .map(v => `<span class="${verdictBadgeClass(v)}" style="font-size: 11px; display: inline-flex; align-items: center;">${v === 'PASS' ? checkmarkSvg : ''}${v}: ${counts[v] || 0}</span>`).join('');

        resultsEl.innerHTML = `
          <div class="diag-table-header">
            <span style="width:120px; flex-shrink:0;">Model</span>
            <span style="width:75px; flex-shrink:0;">Device</span>
            <span style="width:85px; flex-shrink:0;">Verdict</span>
            <span style="flex:1;">Details / Transcript</span>
          </div>
          <div class="diag-table-body">
            ${results.map(r => {
                const cfg = r.device === 'cpu' ? 'CPU' : `GPU/${r.precision}`;
                const werStr = r.wer === null ? '' : ` · WER ${Math.round(r.wer * 100)}%`;
                const out = r.output ? ` · "${r.output.slice(0, 60)}"` : '';
                return `<div class="diag-table-row">
                  <span style="width:120px; flex-shrink:0; font-weight:600; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.model}</span>
                  <span style="width:75px; flex-shrink:0; color:var(--text-secondary);">${cfg}</span>
                  <span style="width:85px; flex-shrink:0;"><span class="${verdictBadgeClass(r.verdict)}" style="display: inline-flex; align-items: center;">${r.verdict === 'PASS' ? checkmarkSvg : ''}${r.verdict}</span></span>
                  <span style="flex:1; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${r.detail || (werStr + out)}">${r.detail || (werStr + out)}</span>
                </div>`;
            }).join('')}
          </div>
        `;
    };

    runBtn.addEventListener('click', async () => {
        if (!referenceAudio || isRunning) return;
        const expected = expectedInput.value.trim();
        isRunning = true;
        runBtn.disabled = true;
        recordBtn.disabled = true;
        resultsSection.style.display = 'none';

        const webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
        let vramMb: number | null = null;
        try { vramMb = (window as any).electronAPI ? await (window as any).electronAPI.getVramMb() : null; } catch {}

        // Build the combo list: CPU (1) + WebGPU precisions per model.
        const combos: { model: { id: string; name: string }; device: 'cpu' | 'webgpu'; precision: string; dtype: string | undefined }[] = [];
        for (const model of MODELS) {
            combos.push({ model, device: 'cpu', precision: 'q8', dtype: undefined });
            for (const p of WEBGPU_PRECISIONS) {
                combos.push({ model, device: 'webgpu', precision: p.label, dtype: p.dtype });
            }
        }

        const results: ComboResult[] = [];
        // Push + log + render in one step. A WebGPU OOM throws an uncatchable
        // RangeError in a GPU worker that can crash the renderer mid-run — by
        // logging each result immediately, the captured console keeps a full
        // trail even if the on-screen table is wiped by a reload.
        const record = (r: ComboResult) => {
            results.push(r);
            console.log(`[Diagnostics] ${r.model} | ${r.device}/${r.precision} | ${r.verdict}${r.wer === null ? '' : ' WER=' + Math.round(r.wer * 100) + '%'}${r.output ? ' | "' + r.output + '"' : ''}${r.detail ? ' | ' + r.detail : ''}`);
            renderResults(results);
        };

        // VRAM safety margin: estimates can run low, so skip WebGPU combos that
        // need more than 85% of detected VRAM rather than risk an OOM crash.
        const VRAM_MARGIN = 0.85;

        for (let i = 0; i < combos.length; i++) {
            const c = combos[i];
            progress.textContent = `Testing ${i + 1}/${combos.length}: ${c.model.name} · ${c.device === 'cpu' ? 'CPU' : 'GPU/' + c.precision}…`;

            const base: ComboResult = { model: c.model.name, device: c.device, precision: c.precision, verdict: 'SKIP', wer: null, output: '', detail: '' };

            // Skip WebGPU when unavailable or VRAM clearly insufficient (prevents crashes).
            if (c.device === 'webgpu') {
                if (!webgpuAvailable) { record({ ...base, detail: 'WebGPU not available' }); continue; }
                const need = MODEL_VRAM_MB[c.model.id]?.[c.precision] ?? MODEL_VRAM_MB[c.model.id]?.['auto'] ?? 0;
                if (vramMb !== null && need > vramMb * VRAM_MARGIN) { record({ ...base, detail: `needs ~${need}MB > ${Math.round(vramMb * VRAM_MARGIN)}MB usable VRAM` }); continue; }
            }

            try {
                await disposeTranscriber();
                await loadModel(c.model.id, c.device, c.dtype);
            } catch (err) {
                record({ ...base, verdict: 'LOAD-FAIL', detail: (err as Error).message?.slice(0, 80) || 'load error' });
                continue;
            }

            try {
                const out = await transcribeAudio(referenceAudio, 30);
                const wer = wordErrorRate(expected, out);
                record({ ...base, verdict: wer <= PASS_WER ? 'PASS' : 'GARBAGE', wer, output: out });
            } catch (err) {
                record({ ...base, verdict: 'RUN-FAIL', detail: (err as Error).message?.slice(0, 80) || 'run error' });
            }
        }

        progress.textContent = `Done — ${combos.length} combos tested.`;
        renderResults(results);
        console.log('[Diagnostics] Full results:', JSON.stringify(results, null, 2));

        // Restore the app's real model so the main UI works again.
        await disposeTranscriber();
        restoreModel();

        isRunning = false;
        recordBtn.disabled = false;
        maybeEnableRun();
    });

    const open = () => {
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
    };
    const close = () => {
        if (isRunning) return; // don't close mid-run
        modal.classList.remove('active');
        setTimeout(() => { modal.style.display = 'none'; }, 300);
    };
    closeBtn.addEventListener('click', close);
    exitBtn.addEventListener('click', close);

    // Wire the trigger button in Settings.
    document.getElementById('diag-run-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        open();
    });
}
