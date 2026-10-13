// One icon set for the whole app: outline icons on a 24-unit grid, drawn in the current text colour
// so they follow the theme without CSS filters. Three sizes keep them consistent:
//   18px  next to text (buttons, rows, chevrons)
//   20px  inside round buttons (send, stop, dictate)
//   12px  title-bar glyphs, matching the window controls (see TITLEBAR below)

export type IconName =
  | 'mic' | 'sliders' | 'chat' | 'sun' | 'moon' | 'pen'
  | 'chevronLeft' | 'chevronRight' | 'chevronDown'
  | 'arrowUp' | 'stop' | 'trash' | 'close' | 'wave';

const PATHS: Record<Exclude<IconName, 'wave'>, string> = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  chat: '<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

// The WaveScribe mark (pen and sound bars) in its own coordinates, as in assets/wave.svg.
const WAVE = '<line x1="90" y1="305.5" x2="90" y2="479.5"/><line x1="180.5" y1="220.5" x2="180.5" y2="564.5"/>'
  + '<path d="M270 141 A45.5 45.5 0 0 1 361 141 V562 L315.5 712 L270 562 Z"/>'
  + '<line x1="451.5" y1="221.5" x2="451.5" y2="564.5"/><line x1="541.5" y1="305.5" x2="541.5" y2="478.5"/>';

export function icon(name: IconName, size = 18, className = ''): string {
  const cls = `ic${className ? ' ' + className : ''}`;
  if (name === 'wave') {
    return `<svg class="${cls}" width="${size}" height="${size}" viewBox="40 60 551 690" fill="none" stroke="currentColor" stroke-width="58" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WAVE}</svg>`;
  }
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}

// Title-bar glyphs: 12px with hairline strokes, like the Windows window controls.
const tb = (body: string) => `<svg class="ic" viewBox="0 0 10 10" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const TITLEBAR = {
  island: tb('<path d="M5 1v7.2M2 5.4L5 8.4 8 5.4" vector-effect="non-scaling-stroke"/>'),
  minimize: tb('<path d="M0 5h10" vector-effect="non-scaling-stroke"/>'),
  maximize: tb('<rect x="1.5" y="1.5" width="7" height="7" vector-effect="non-scaling-stroke"/>'),
  close: tb('<path d="M1 1l8 8M9 1L1 9" vector-effect="non-scaling-stroke"/>'),
};
