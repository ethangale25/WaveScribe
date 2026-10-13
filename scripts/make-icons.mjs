// Generates the app icon (ICO + PNG) and the installer artwork from one vector source, so every
// size is drawn on purpose instead of being shrunk from a single 256px image.
//
//   node scripts/make-icons.mjs            write assets/icon.*, assets/wave.*, assets/installer/*
//   node scripts/make-icons.mjs --preview  write a comparison sheet of the style options instead

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Brand colours (src/style.css): primary blue, its hover/deep shades, and the dark app background.
const BLUE = '#2b55f5';
const BLUE_LIGHT = '#5b7fff';
const BLUE_DEEP = '#1a3ecc';
const NAVY = '#0d1117';
const NAVY_2 = '#141c33';

/**
 * The WaveScribe mark, rebuilt as clean geometry from assets/wave.svg (same coordinates): a pen
 * (the "scribe") between two pairs of sound bars (the "wave"). Every line there is 33 units thick;
 * the pen outline is 124 wide. Measured bounds: x 73-558, y 75-731, centred on x 315.5.
 */
const MARK = { cx: 315.5, cy: 403, height: 656 };

function glyph({ pen, bars, size }) {
    // Pen centreline: outline width 124 and line 33 put the sides 45.5 from the centre.
    const penPath = 'M270 141 A45.5 45.5 0 0 1 361 141 V562 L315.5 712 L270 562 Z';
    if (size <= 24) {
        // At 16-24px the hollow pen and the outer bars blur together: fill the pen, keep the
        // inner bars, and thicken them so they stay distinct pixels.
        return `
          <path d="${penPath}" fill="${pen}" stroke="${pen}" stroke-width="40" stroke-linejoin="round"/>
          <line x1="180.5" y1="235" x2="180.5" y2="550" stroke="${bars}" stroke-width="62" stroke-linecap="round"/>
          <line x1="451.5" y1="235" x2="451.5" y2="550" stroke="${bars}" stroke-width="62" stroke-linecap="round"/>`;
    }
    // Slightly heavier lines at 32-48px, where 33 units would be about one pixel.
    const w = size <= 48 ? 42 : 33;
    return `
      <path d="${penPath}" fill="none" stroke="${pen}" stroke-width="${w}" stroke-linejoin="round"/>
      <line x1="180.5" y1="220.5" x2="180.5" y2="564.5" stroke="${bars}" stroke-width="${w}" stroke-linecap="round"/>
      <line x1="451.5" y1="221.5" x2="451.5" y2="564.5" stroke="${bars}" stroke-width="${w}" stroke-linecap="round"/>
      <line x1="90" y1="305.5" x2="90" y2="479.5" stroke="${bars}" stroke-width="${w}" stroke-linecap="round"/>
      <line x1="541.5" y1="305.5" x2="541.5" y2="478.5" stroke="${bars}" stroke-width="${w}" stroke-linecap="round"/>`;
}

// Mark gradient in glyph coordinates (a per-element gradient would vanish on the zero-width bars).
const MARK_GRADIENT = `<linearGradient id="mark" gradientUnits="userSpaceOnUse" x1="0" y1="75" x2="0" y2="731"><stop offset="0" stop-color="#9db3ff"/><stop offset="1" stop-color="${BLUE_LIGHT}"/></linearGradient>`;
// The mark fills ~76% of the tile's height (more at tiny sizes, where every pixel counts).
const markTransform = (size, s) => `translate(${size / 2} ${size / 2}) scale(${(s * (size <= 24 ? 0.82 : 0.76)) / MARK.height}) translate(${-MARK.cx} ${-MARK.cy})`;

// Tile styles. Each returns an SVG for an icon of `size` px.
const STYLES = {
    // Brand-blue tile, white mark: the most recognisable on any taskbar.
    blue(size) {
        const inset = size <= 24 ? 0 : size * 0.04;
        const s = size - inset * 2;
        const r = s * 0.225;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="${BLUE_LIGHT}"/><stop offset="0.55" stop-color="${BLUE}"/><stop offset="1" stop-color="${BLUE_DEEP}"/>
            </linearGradient>
            <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <rect x="${inset}" y="${inset}" width="${s}" height="${s}" rx="${r}" fill="url(#bg)"/>
          <rect x="${inset}" y="${inset}" width="${s}" height="${s}" rx="${r}" fill="url(#sheen)"/>
          ${size > 24 ? `<rect x="${inset + 0.5}" y="${inset + 0.5}" width="${s - 1}" height="${s - 1}" rx="${r}" fill="none" stroke="#fff" stroke-opacity="0.18"/>` : ''}
          <g transform="${markTransform(size, s)}">${glyph({ pen: '#fff', bars: '#fff', size })}</g>
        </svg>`;
    },
    // Midnight tile like the app window (dark, blue glow, graph-paper grid), blue mark.
    midnight(size, duotone = false) {
        const inset = size <= 24 ? 0 : size * 0.04;
        const s = size - inset * 2;
        const r = s * 0.225;
        const grid = size >= 64 ? Array.from({ length: 7 }, (_, i) => {
            const p = inset + (s / 8) * (i + 1);
            return `<line x1="${p}" y1="${inset}" x2="${p}" y2="${inset + s}"/><line x1="${inset}" y1="${p}" x2="${inset + s}" y2="${p}"/>`;
        }).join('') : '';
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY_2}"/><stop offset="1" stop-color="${NAVY}"/></linearGradient>
            <radialGradient id="glow" cx="0.5" cy="0.18" r="0.75"><stop offset="0" stop-color="${BLUE}" stop-opacity="0.55"/><stop offset="1" stop-color="${BLUE}" stop-opacity="0"/></radialGradient>
            ${MARK_GRADIENT}
            <clipPath id="c"><rect x="${inset}" y="${inset}" width="${s}" height="${s}" rx="${r}"/></clipPath>
          </defs>
          <rect x="${inset}" y="${inset}" width="${s}" height="${s}" rx="${r}" fill="url(#bg)"/>
          <g clip-path="url(#c)" stroke="#fff" stroke-opacity="0.05" stroke-width="${Math.max(1, size / 256)}">${grid}</g>
          <rect x="${inset}" y="${inset}" width="${s}" height="${s}" rx="${r}" fill="url(#glow)"/>
          ${size > 24 ? `<rect x="${inset + 0.5}" y="${inset + 0.5}" width="${s - 1}" height="${s - 1}" rx="${r}" fill="none" stroke="#fff" stroke-opacity="0.12"/>` : ''}
          <g transform="${markTransform(size, s)}">${glyph({ pen: duotone ? '#fff' : (size <= 24 ? '#8aa4ff' : 'url(#mark)'), bars: size <= 24 ? '#8aa4ff' : 'url(#mark)', size })}</g>
        </svg>`;
    },
    // Midnight tile with a white pen and blue bars: the text (scribe) and the dictation (wave).
    duotone(size) {
        return STYLES.midnight(size, true);
    },
};

const png = (svg, size) => sharp(Buffer.from(svg), { density: 72 }).resize(size, size).png().toBuffer();

async function preview() {
    const sizes = [256, 48, 32, 24, 16];
    const names = process.argv.includes('--all') ? Object.keys(STYLES) : ['blue'];
    const cell = 300, rowH = 320;
    const parts = [];
    for (const [row, name] of names.entries()) {
        for (const [bgIndex, bg] of ['#202020', '#f3f3f3'].entries()) {
            const x0 = bgIndex * 620;
            parts.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${rowH - 20}"><rect width="600" height="${rowH - 20}" rx="16" fill="${bg}"/><text x="16" y="28" font-family="Segoe UI" font-size="18" fill="${bgIndex ? '#333' : '#ccc'}">${name}</text></svg>`), left: x0, top: row * rowH });
            let x = x0 + 16;
            for (const size of sizes) {
                parts.push({ input: await png(STYLES[name](size), size), left: x, top: row * rowH + 40 + (256 - size) });
                x += size + 24;
            }
        }
    }
    const out = path.join(process.argv[3] || ROOT, 'icon-preview.png');
    await sharp({ create: { width: 1220, height: names.length * rowH, channels: 4, background: '#00000000' } }).composite(parts).png().toFile(out);
    console.log('wrote', out, `(${cell})`);
}


// Overlays the rebuilt mark (red) on the original logo (black) to check the proportions match.
async function overlay(outDir) {
    const original = fs.readFileSync(path.join(ROOT, 'assets/wave.svg'), 'utf-8').match(/<path[\s\S]*<\/path>|<path[\s\S]*\/>/g).join('\n');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="641" height="810" viewBox="0 0 641 810">
      <rect width="641" height="810" fill="#fff"/>${original.replace(/fill="#0[0-9]+"/g, 'fill="#000"')}
      <g opacity="0.55">${glyph({ pen: '#ff2020', bars: '#ff2020', size: 256 })}</g></svg>`;
    const out = path.join(outDir, 'mark-overlay.png');
    await sharp(Buffer.from(svg)).png().toFile(out);
    console.log('wrote', out);
}
if (process.argv.includes('--overlay')) await overlay(process.argv[3] || ROOT);

// ---- File writers ----

/** ICO with an uncompressed 32-bit entry per small size (what NSIS and older shells expect) and PNG for 128+. */
async function writeIco(file, sizes, render) {
    const entries = [];
    for (const size of sizes) {
        const { data } = await sharp(await render(size)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        if (size >= 128) {
            entries.push({ size, bytes: await sharp(data, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer() });
            continue;
        }
        // BITMAPINFOHEADER, bottom-up BGRA pixels, then an all-zero AND mask (alpha carries transparency).
        const header = Buffer.alloc(40);
        header.writeUInt32LE(40, 0);
        header.writeInt32LE(size, 4);
        header.writeInt32LE(size * 2, 8);
        header.writeUInt16LE(1, 12);
        header.writeUInt16LE(32, 14);
        const pixels = Buffer.alloc(size * size * 4);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const src = (y * size + x) * 4, dst = ((size - 1 - y) * size + x) * 4;
                pixels[dst] = data[src + 2]; pixels[dst + 1] = data[src + 1]; pixels[dst + 2] = data[src]; pixels[dst + 3] = data[src + 3];
            }
        }
        const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
        entries.push({ size, bytes: Buffer.concat([header, pixels, mask]) });
    }
    const dir = Buffer.alloc(6 + 16 * entries.length);
    dir.writeUInt16LE(1, 2);
    dir.writeUInt16LE(entries.length, 4);
    let offset = dir.length;
    entries.forEach((e, i) => {
        const o = 6 + 16 * i;
        dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);
        dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
        dir.writeUInt16LE(1, o + 4);
        dir.writeUInt16LE(32, o + 6);
        dir.writeUInt32LE(e.bytes.length, o + 8);
        dir.writeUInt32LE(offset, o + 12);
        offset += e.bytes.length;
    });
    fs.writeFileSync(file, Buffer.concat([dir, ...entries.map(e => e.bytes)]));
}

/** 24-bit BMP, the only format the NSIS installer pages accept for their artwork. */
async function writeBmp(file, svg, width, height) {
    const { data } = await sharp(Buffer.from(svg)).resize(width, height).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const pixels = Buffer.alloc(rowSize * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const src = (y * width + x) * 3, dst = (height - 1 - y) * rowSize + x * 3;
            pixels[dst] = data[src + 2]; pixels[dst + 1] = data[src + 1]; pixels[dst + 2] = data[src];
        }
    }
    const header = Buffer.alloc(54);
    header.write('BM', 0);
    header.writeUInt32LE(54 + pixels.length, 2);
    header.writeUInt32LE(54, 10);
    header.writeUInt32LE(40, 14);
    header.writeInt32LE(width, 18);
    header.writeInt32LE(height, 22);
    header.writeUInt16LE(1, 26);
    header.writeUInt16LE(24, 28);
    header.writeUInt32LE(pixels.length, 34);
    fs.writeFileSync(file, Buffer.concat([header, pixels]));
}

// ---- Installer artwork ----

/** Welcome/finish page side panel (164x314): the app's dark grid look with the icon and wordmark. */
function sidebarSvg() {
    const W = 164, H = 314;
    const grid = [];
    for (let x = 10; x < W; x += 20) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`);
    for (let y = 10; y < H; y += 20) grid.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`);
    const icon = STYLES.blue(256).replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/id="(bg|sheen)"/g, 'id="i_$1"').replace(/url\(#(bg|sheen)\)/g, 'url(#i_$1)');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY_2}"/><stop offset="1" stop-color="${NAVY}"/></linearGradient>
        <radialGradient id="glow" cx="0.5" cy="0.3" r="0.7"><stop offset="0" stop-color="${BLUE}" stop-opacity="0.45"/><stop offset="1" stop-color="${BLUE}" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#bg)"/>
      <g stroke="#fff" stroke-opacity="0.045">${grid.join('')}</g>
      <rect width="${W}" height="${H}" fill="url(#glow)"/>
      <g transform="translate(${(W - 84) / 2} 62) scale(${84 / 256})">${icon}</g>
      <text x="${W / 2}" y="180" text-anchor="middle" font-family="Segoe UI" font-weight="700" font-size="19" fill="#f0f6fc">WaveScribe</text>
      <text x="${W / 2}" y="200" text-anchor="middle" font-family="Segoe UI" font-size="9.5" fill="#8b949e">Make Waves. Not Keystrokes.</text>
    </svg>`;
}

/** Header image for the inner installer pages (150x57, drawn on the page's white header band). */
function headerSvg() {
    const icon = STYLES.blue(256).replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
      <rect width="150" height="57" fill="#ffffff"/>
      <g transform="translate(${150 - 10 - 40} 8.5) scale(${40 / 256})">${icon}</g>
    </svg>`;
}

async function writeAll() {
    const render = (size) => png(STYLES.blue(size), size);
    const assets = path.join(ROOT, 'assets');
    const installer = path.join(ROOT, 'build');
    fs.mkdirSync(installer, { recursive: true });

    const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
    await writeIco(path.join(assets, 'icon.ico'), icoSizes, render);
    await writeIco(path.join(assets, 'wave.ico'), icoSizes, render);
    fs.writeFileSync(path.join(assets, 'icon.png'), await render(512));
    fs.writeFileSync(path.join(assets, 'wave.png'), await render(512));
    await writeBmp(path.join(installer, 'installerSidebar.bmp'), sidebarSvg(), 164, 314);
    await writeBmp(path.join(installer, 'installerHeader.bmp'), headerSvg(), 150, 57);
    console.log('wrote assets/icon.{ico,png}, assets/wave.{ico,png}, build/installerSidebar.bmp, build/installerHeader.bmp');
}

if (process.argv.includes('--preview')) await preview();
else if (!process.argv.includes('--overlay')) await writeAll();
