// The "working on it" indicator shown next to the text caret while a dictation is transcribed: a
// small dark pill holding the WaveScribe mark, with a third, fainter pair of bars added so the
// ripple visibly travels outward from the pen.
// Kept as an inline page so it works the same in development and in the packaged app.

/** Width and height of the pill in DIP; the window is sized to fit it exactly. */
export const INDICATOR_SIZE = { width: 50, height: 28 }

export const INDICATOR_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .pill {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    border-radius: 999px;
    background: rgba(13, 17, 23, 0.92);
    border: 1px solid rgba(91, 127, 255, 0.45);
    box-shadow: inset 0 0 10px rgba(43, 85, 245, 0.35);
    animation: appear 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  }
  svg { height: 22px; width: auto; overflow: visible; }
  .bar, .pen { transform-box: fill-box; transform-origin: center; }
  /* The ripple starts at the pen and travels outward through each pair of bars. */
  .bar { stroke: url(#barColor); animation: ripple 1.2s ease-in-out infinite; }
  .inner { animation-delay: 0.1s; }
  .outer { animation-delay: 0.22s; }
  .edge { animation-delay: 0.34s; }
  .pen { stroke: #ffffff; animation: pulse 1.1s ease-in-out infinite; }
  @keyframes ripple {
    0%, 100% { transform: scaleY(0.3); opacity: 0.45; }
    40% { transform: scaleY(1); opacity: 1; }
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.85; }
    30% { opacity: 1; }
  }
  @keyframes appear {
    from { opacity: 0; transform: scale(0.8); }
    to { opacity: 1; transform: scale(1); }
  }
</style>
</head>
<body>
  <div class="pill">
    <svg viewBox="-60 60 751 690" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="56">
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
</body>
</html>`
