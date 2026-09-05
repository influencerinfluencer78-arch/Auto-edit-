// Render-side caption helpers, copied verbatim from lib/captions.js so the
// burned-in text matches the frontend preview exactly. Only the render-side
// pieces are here — transcript parsing and canvas drawing stay in the frontend.

// ---- style presets (shared by preview canvas + ffmpeg drawtext) ----
export const CAPTION_STYLES = {
  classic: {
    id: "classic", label: "Classic outline",
    fill: "#ffffff", stroke: "#000000", box: null,
    dt: (bw) => `fontcolor=white:borderw=${bw}:bordercolor=black@0.9`,
  },
  boxed: {
    id: "boxed", label: "Boxed",
    fill: "#ffffff", stroke: null, box: "rgba(0,0,0,0.6)",
    dt: (bw, fs) => `fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=${Math.max(3, Math.round(fs * 0.16))}`,
  },
  yellow: {
    id: "yellow", label: "Yellow classic",
    fill: "#ffd400", stroke: "#000000", box: null,
    dt: (bw) => `fontcolor=0xFFD400:borderw=${bw}:bordercolor=black@0.9`,
  },
};

export const CAPTION_SIZES = { sm: 0.042, md: 0.052, lg: 0.064 };
export const CAPTION_FONT = "caption.ttf";          // path in the ffmpeg FS
export const captionCueFile = (i) => `cap${i}.txt`;  // per-cue textfile in the FS

export function captionFontPx(height, sizeId, customScale) {
  const frac = customScale > 0 ? customScale : (CAPTION_SIZES[sizeId] || CAPTION_SIZES.md);
  return Math.round(height * frac);
}

const MARGIN_FACTOR = 0.07;

// Width-aware caption wrapping (must match lib/captions.js so preview == render).
// Reflows a caption into balanced lines that each fit the frame WIDTH, so 9:16
// portrait doesn't overflow. Resolution-independent (W and fontPx scale together).
function captionMaxChars(W, fontPx) {
  return Math.max(8, Math.floor((W * 0.90) / (fontPx * 0.58)));
}
function wrapToWidth(text, maxChars) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  // Greedy fill: every line stays within maxChars, so nothing overflows.
  const words = clean.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cur && cand.length > maxChars) { lines.push(cur); cur = w; }
    else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Boxed captions need a bit more line spacing so their per-line boxes keep a gap.
const lineHeightFactor = (st) => (st && st.box ? 1.5 : 1.16);

// Vertical slot (top y) for line i of an n-line caption, bottom-anchored.
const lineTop = (H, fontPx, n, i, lhf = 1.16) =>
  Math.round(H - H * MARGIN_FACTOR - (n - i) * fontPx * lhf);

// ---- render: one centered drawtext per LINE (so each line is centered) ----
// Returns the filter chain plus the per-line textfiles to write into the FS.
export function buildCaptionBurn(cues, styleId, width, height, sizeId, lineHeight, fontScale, prefix = "") {
  const st = CAPTION_STYLES[styleId] || CAPTION_STYLES.classic;
  const fs = captionFontPx(height, sizeId, fontScale);
  const bw = Math.max(2, Math.round(fs / 9));
  const lhf = lineHeight > 0 ? lineHeight : lineHeightFactor(st);
  const files = [];
  const filters = [];
  let li = 0;
  for (const c of cues) {
    const lines = wrapToWidth(c.text, captionMaxChars(width, fs));
    const n = lines.length;
    const s = c.start.toFixed(3), e = c.end.toFixed(3);
    for (let i = 0; i < n; i++) {
      const name = prefix + captionCueFile(li++);
      files.push({ name, text: sanitizeCueText(lines[i]) });
      const y = lineTop(height, fs, n, i, lhf);
      filters.push(
        `drawtext=fontfile=${CAPTION_FONT}:textfile=${name}:${st.dt(bw, fs)}` +
        `:fontsize=${fs}:x=(w-text_w)/2:y=${y}:enable=between(t\\,${s}\\,${e})`
      );
    }
  }
  return { filter: filters.join(","), files };
}

// drawtext reads textfiles literally; strip chars its expander would choke on.
export function sanitizeCueText(text) {
  return String(text).replace(/\\/g, "").replace(/%/g, "percent");
}
