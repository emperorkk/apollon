import satori, { init as initSatori } from 'satori/standalone';
import yogaWasm from 'satori/yoga.wasm';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import latin400 from '../../node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff';
import latin700 from '../../node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff';
import greek400 from '../../node_modules/@fontsource/noto-sans/files/noto-sans-greek-400-normal.woff';
import greek700 from '../../node_modules/@fontsource/noto-sans/files/noto-sans-greek-700-normal.woff';
import iconPng from '../../frontend/icons/icon-192.png';
import { SITE_NAME } from '../lib/constants.js';

// Per-report Open Graph image (1200x630 PNG) for link previews on social
// networks and messengers: the report's own headline instead of the generic
// site card. Rendered in the Worker — satori lays out a JSX-like tree into
// SVG, resvg rasterises it — and edge-cached for a week by Workers Caching
// (src/lib/cache-policy.js), so each image is rendered roughly once per
// deploy rather than per share.
//
// Both WebAssembly modules are imported as pre-compiled modules: Workers
// don't allow compiling WebAssembly from bytes at runtime.

const WIDTH = 1200;
const HEIGHT = 630;

const FONTS = [
  { name: 'Noto Sans', data: latin400, weight: 400, style: 'normal' },
  { name: 'Noto Sans', data: latin700, weight: 700, style: 'normal' },
  // Separate family: satori falls back across *families* in fontFamily for
  // missing glyphs, not across files registered under one name.
  { name: 'Noto Sans Greek', data: greek400, weight: 400, style: 'normal' },
  { name: 'Noto Sans Greek', data: greek700, weight: 700, style: 'normal' },
];

const COLORS = {
  bg: '#04070a',
  grid: '#111a23',
  text: '#dce4eb',
  dim: '#8493a3',
  faint: '#4d5a68',
  accent: '#4fd8e8',
};

let ready;
let iconDataUrl;

function setup() {
  ready ??= Promise.all([initSatori(yogaWasm), initWasm(resvgWasm)]).then(() => {
    let binary = '';
    for (const byte of new Uint8Array(iconPng)) binary += String.fromCharCode(byte);
    iconDataUrl = `data:image/png;base64,${btoa(binary)}`;
  });
  return ready;
}

// Minimal hyperscript for satori's element tree.
function h(type, style, ...children) {
  const flat = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  // satori requires an explicit display on any multi-child box; flex is
  // its only real layout mode anyway.
  return { type, props: { style: { display: 'flex', ...style }, children: flat.length === 1 ? flat[0] : flat } };
}

function titleSize(title) {
  if (title.length <= 45) return 66;
  if (title.length <= 70) return 58;
  if (title.length <= 95) return 50;
  return 44;
}

// eyebrow: e.g. "DAILY REPORT · TUESDAY 27 OCTOBER 2026"
// tags: up to 4 short labels (macro-regions) shown as chips.
export async function renderReportImage({ eyebrow, title, tags = [], domain, lang = 'en' }) {
  // Greek capitals drop their accents (ΗΜΕΡΗΣΙΑ, not ΗΜΕΡΉΣΙΑ).
  const upper = (text) => text.toLocaleUpperCase(lang === 'el' ? 'el-GR' : 'en-GB');
  await setup();

  const tree = h(
    'div',
    {
      width: WIDTH,
      height: HEIGHT,
      display: 'flex',
      position: 'relative',
      backgroundColor: COLORS.bg,
      backgroundImage: `linear-gradient(${COLORS.grid} 1px, transparent 1px), linear-gradient(90deg, ${COLORS.grid} 1px, transparent 1px)`,
      backgroundSize: '48px 48px',
      fontFamily: 'Noto Sans, Noto Sans Greek',
      color: COLORS.text,
    },
    // Glow behind the logo
    h('div', {
      position: 'absolute',
      right: -160,
      top: -120,
      width: 720,
      height: 720,
      display: 'flex',
      backgroundImage: 'radial-gradient(circle, rgba(79,216,232,0.16), rgba(79,216,232,0) 62%)',
    }),
    h(
      'div',
      { display: 'flex', flexDirection: 'column', padding: '64px 72px 0', width: 900, height: 560 },
      // Eyebrow
      h(
        'div',
        { display: 'flex', alignItems: 'center', fontSize: 22, letterSpacing: 4, color: COLORS.accent, fontWeight: 700 },
        h('div', { width: 14, height: 14, backgroundColor: COLORS.accent, transform: 'rotate(45deg)', marginRight: 18 }),
        upper(eyebrow),
      ),
      // Headline
      h(
        'div',
        {
          display: 'flex',
          marginTop: 34,
          fontSize: titleSize(title),
          fontWeight: 700,
          lineHeight: 1.12,
          letterSpacing: -0.5,
          color: COLORS.text,
          maxHeight: 340,
          overflow: 'hidden',
        },
        title,
      ),
      // Region chips
      tags.length
        ? h(
            'div',
            { marginTop: 'auto', marginBottom: 8, alignItems: 'center' },
            tags.slice(0, 4).map((tag) =>
              h(
                'div',
                {
                  flexShrink: 0,
                  marginRight: 12,
                  padding: '6px 16px',
                  border: `2px solid ${COLORS.accent}`,
                  borderRadius: 4,
                  fontSize: 20,
                  fontWeight: 700,
                  color: COLORS.accent,
                },
                upper(tag),
              ),
            ),
          )
        : null,
    ),
    // Brand column
    h(
      'div',
      {
        position: 'absolute',
        right: 72,
        top: 64,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      },
      // satori takes an image's source as a prop rather than a style.
      {
        type: 'img',
        props: { src: iconDataUrl, width: 150, height: 150, style: { borderRadius: 6, border: '1px solid #29333f' } },
      },
    ),
    // Footer bar
    h(
      'div',
      {
        position: 'absolute',
        left: 72,
        right: 72,
        bottom: 34,
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 20,
        letterSpacing: 3,
        color: COLORS.faint,
      },
      h('div', { display: 'flex', color: COLORS.text, fontWeight: 700, letterSpacing: 8 }, SITE_NAME.toUpperCase()),
      h('div', { display: 'flex', color: COLORS.accent }, domain.toUpperCase()),
    ),
    h('div', {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 6,
      display: 'flex',
      backgroundImage: 'linear-gradient(90deg, #4fd8e8, #f2c14e 40%, #e94560 70%, #9b5de5)',
    }),
  );

  const svg = await satori(tree, { width: WIDTH, height: HEIGHT, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
}
