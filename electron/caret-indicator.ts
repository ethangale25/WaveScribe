// The indicator shown next to the text caret during a dictation: a small dark pill holding the
// WaveScribe mark, with a third, fainter pair of bars so the motion visibly travels outward.
//  - listening: while the user talks, a red recording dot shows and the bars follow their voice.
//  - working:   while the speech is transcribed, the bars ripple outward from the pen.
// Kept as an inline page so it works the same in development and in the packaged app.

/** Width and height of the pill in DIP; the window is sized to fit it exactly. */
export const INDICATOR_SIZE = { width: 58, height: 28 }

export type IndicatorMode = 'listening' | 'working'

export const INDICATOR_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .pill {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    border-radius: 999px;
    background: rgba(13, 17, 23, 0.92);
    border: 1px solid rgba(91, 127, 255, 0.45);
    box-shadow: inset 0 0 10px rgba(43, 85, 245, 0.35);
    animation: appear 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .rec {
    width: 7px; height: 7px; border-radius: 50%;
    background: #ef4444; box-shadow: 0 0 6px rgba(239, 68, 68, 0.8);
    display: none;
    animation: blink 1.4s ease-in-out infinite;
  }
  .listening .rec { display: block; }
  svg { height: 22px; width: auto; overflow: visible; --v: 0; }
  .bar, .pen { transform-box: fill-box; transform-origin: center; }
  .bar { stroke: url(#barColor); }
  .pen { stroke: #ffffff; }

  /* Working: the ripple starts at the pen and travels outward through each pair of bars. */
  .working .bar { animation: ripple 1.2s ease-in-out infinite; }
  .working .inner { animation-delay: 0.1s; }
  .working .outer { animation-delay: 0.22s; }
  .working .edge { animation-delay: 0.34s; }
  .working .pen { animation: pulse 1.1s ease-in-out infinite; }

  /* Listening: the bars follow the voice level (--v, 0 to 1), strongest next to the pen. */
  .listening .bar { transition: transform 0.08s linear, opacity 0.08s linear; }
  .listening .inner { transform: scaleY(calc(0.3 + var(--v) * 0.7)); opacity: calc(0.55 + var(--v) * 0.45); }
  .listening .outer { transform: scaleY(calc(0.3 + var(--v) * 0.6)); opacity: calc(0.5 + var(--v) * 0.5); }
  .listening .edge { transform: scaleY(calc(0.3 + var(--v) * 0.5)); opacity: calc(0.45 + var(--v) * 0.55); }

  @keyframes ripple {
    0%, 100% { transform: scaleY(0.3); opacity: 0.45; }
    40% { transform: scaleY(1); opacity: 1; }
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.85; }
    30% { opacity: 1; }
  }
  @keyframes blink {
    50% { opacity: 0.45; }
  }
  @keyframes appear {
    from { opacity: 0; transform: scale(0.8); }
    to { opacity: 1; transform: scale(1); }
  }
</style>
</head>
<body class="working">
  <div class="pill">
    <span class="rec"></span>
    <svg id="mark" viewBox="-60 60 751 690" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="56">
      <defs>
        <linearGradient id="barColor" gradientUnits="userSpaceOnUse" x1="0" y1="200" x2="0" y2="590">
          <stop offset="0" stop-color="#9db3ff"/><stop offset="1" stop-color="#5b7fff"/>
        </linearGradient>
      </defs>
      <line class="bar edge" x1="-1" y1="345" x2="-1" y2="440"/>
      <line class="bar outer" x1="90" y1="305.5" x2="90" y2="479.5"/>
      <line class="bar inner" x1="180.5" y1="220.5" x2="180.5" y2="564.5"/>
      <path class="pen" d="M270 141 A45.5 45.5 0 0 1 361 141 V562 L315.5 712 L270 562 Z"/>
      <line class="bar inner" x1="451.5" y1="221.5" x2="451.5" y2="564.5"/>
      <line class="bar outer" x1="541.5" y1="305.5" x2="541.5" y2="478.5"/>
      <line class="bar edge" x1="632" y1="345" x2="632" y2="440"/>
    </svg>
  </div>
  <script>
    const mark = document.getElementById('mark');
    window.setMode = (mode, replay) => {
      document.body.className = mode;
      mark.style.setProperty('--v', '0');
      if (replay) {
        const pill = document.querySelector('.pill');
        pill.style.animation = 'none';
        void pill.offsetWidth;
        pill.style.animation = '';
      }
    };
    window.setLevel = (v) => mark.style.setProperty('--v', String(Math.max(0, Math.min(1, v))));
  </script>
</body>
</html>`
