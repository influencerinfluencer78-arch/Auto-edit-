# Story → Video Assembler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a client-side web app that assembles an MP4 from timestamp-named images + a single voiceover, auto-syncing each image to the narration.

**Architecture:** Next.js static-export SPA. Pure, unit-tested logic modules (timestamp parsing, timeline building, dimension resolving) drive a React UI that previews sync on a `<canvas>` and renders the final MP4 entirely in-browser with single-thread `ffmpeg.wasm` (no backend, no SharedArrayBuffer, static-hostable).

**Tech Stack:** Next.js 14 (App Router, `output: 'export'`), React 18, Vitest for unit tests, `@ffmpeg/ffmpeg` + single-thread `@ffmpeg/core` self-hosted in `/public/ffmpeg`.

---

## File Structure

- `package.json` — deps + scripts (`dev`, `build`, `test`)
- `next.config.mjs` — `output: 'export'`
- `vitest.config.mjs` — node test env for `lib/`
- `app/layout.js` — root layout
- `app/globals.css` — styling
- `app/page.js` — main UI (client): upload → parse → preview → render → download
- `components/PreviewPlayer.js` — `<canvas>` + `<audio>` sync preview
- `lib/timestamp.js` — `parseTimestampName(filename) -> seconds | null` (pure)
- `lib/timeline.js` — `buildTimeline(items, audioDuration) -> { clips, warnings }` (pure)
- `lib/dimensions.js` — `resolveDimensions(aspect, sample) -> { width, height }` (pure)
- `lib/audio.js` — `getAudioDuration(file) -> Promise<number>` (browser)
- `lib/ffmpegRender.js` — `renderVideo(opts) -> Promise<Blob>` (browser, ffmpeg.wasm)
- `lib/__tests__/timestamp.test.js`
- `lib/__tests__/timeline.test.js`
- `lib/__tests__/dimensions.test.js`
- `public/ffmpeg/ffmpeg-core.js`, `public/ffmpeg/ffmpeg-core.wasm` — self-hosted core

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`, `next.config.mjs`, `vitest.config.mjs`, `app/layout.js`, `app/globals.css`, `app/page.js`, `.gitignore` (already exists)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "story-to-video",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "^14.2.15",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@ffmpeg/ffmpeg": "^0.12.10",
    "@ffmpeg/util": "^0.12.1",
    "@ffmpeg/core": "^0.12.6"
  },
  "devDependencies": {
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  reactStrictMode: true,
};
export default nextConfig;
```

- [ ] **Step 3: Create `vitest.config.mjs`**

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.js"],
  },
});
```

- [ ] **Step 4: Create `app/layout.js`**

```js
export const metadata = {
  title: "Story → Video Assembler",
  description: "Assemble an MP4 from timestamp-named images and one voiceover.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: Create `app/globals.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; background: #0d0f14; color: #e7ecf3;
  font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; }
.wrap { max-width: 900px; margin: 0 auto; padding: 40px 20px 80px; }
h1 { font-size: 26px; margin: 0 0 6px; }
.sub { color: #8b95a5; margin: 0 0 24px; }
.card { background: #161a22; border: 1px solid #2a313d; border-radius: 14px; padding: 20px; margin-top: 18px; }
.drop { border: 1.5px dashed #2a313d; border-radius: 12px; padding: 26px; text-align: center; cursor: pointer; }
.drop:hover { border-color: #4d9dff; }
.row { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
label.field { font-size: 13px; color: #8b95a5; display: flex; gap: 8px; align-items: center; }
select, button { font: inherit; }
button.primary { background: #4d9dff; color: #04121f; border: none; border-radius: 10px; padding: 11px 20px; font-weight: 700; cursor: pointer; }
button.primary:disabled { opacity: .5; cursor: not-allowed; }
a.dl { background: #37d67a; color: #04220f; border-radius: 10px; padding: 11px 20px; font-weight: 700; text-decoration: none; }
.warn { color: #ffb454; font-size: 13px; margin: 4px 0; }
canvas.preview { width: 100%; background: #000; border-radius: 10px; display: block; }
.bar { height: 8px; border-radius: 999px; background: #1e2430; overflow: hidden; margin-top: 10px; }
.bar > i { display: block; height: 100%; background: #4d9dff; transition: width .2s; }
```

- [ ] **Step 6: Create placeholder `app/page.js`**

```js
"use client";
export default function Home() {
  return (
    <main className="wrap">
      <h1>Story → Video Assembler</h1>
      <p className="sub">Scaffold.</p>
    </main>
  );
}
```

- [ ] **Step 7: Install deps**

Run: `npm install`
Expected: dependencies install without errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js + Vitest project"
```

---

## Task 1: Timestamp filename parser

Parses an image filename into a start time in seconds. Naming scheme (colon-free, filesystem-safe):
- `mm-ss` or `mm_ss` (e.g. `0-03`, `1-20`) → minutes*60 + seconds
- `hh-mm-ss` / `hh_mm_ss` (e.g. `1-02-05`) → hours + minutes + seconds
- 3–4 bare digits `mmss` (e.g. `0003`, `0120`) → last two = seconds, leading = minutes
- 1–2 bare digits (e.g. `3`, `45`) → plain seconds
- anything else → `null`

Extension and any directory prefix are stripped first.

**Files:**
- Create: `lib/timestamp.js`
- Test: `lib/__tests__/timestamp.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { parseTimestampName } from "../timestamp.js";

describe("parseTimestampName", () => {
  it("parses mm-ss with dash", () => {
    expect(parseTimestampName("0-03.png")).toBe(3);
    expect(parseTimestampName("1-20.jpg")).toBe(80);
  });
  it("parses mm_ss with underscore", () => {
    expect(parseTimestampName("2_05.webp")).toBe(125);
  });
  it("parses hh-mm-ss", () => {
    expect(parseTimestampName("1-02-05.png")).toBe(3725);
  });
  it("parses 4-digit mmss", () => {
    expect(parseTimestampName("0003.png")).toBe(3);
    expect(parseTimestampName("0120.png")).toBe(80);
  });
  it("parses 3-digit mmss", () => {
    expect(parseTimestampName("120.png")).toBe(80);
  });
  it("parses 1-2 digit plain seconds", () => {
    expect(parseTimestampName("3.png")).toBe(3);
    expect(parseTimestampName("45.png")).toBe(45);
  });
  it("strips directories", () => {
    expect(parseTimestampName("imgs/0-09.png")).toBe(9);
  });
  it("returns null for unparseable names", () => {
    expect(parseTimestampName("hero.png")).toBeNull();
    expect(parseTimestampName("scene_a.png")).toBeNull();
    expect(parseTimestampName("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- timestamp`
Expected: FAIL ("parseTimestampName is not a function" / module not found).

- [ ] **Step 3: Write minimal implementation in `lib/timestamp.js`**

```js
// Parse an image filename into a start time in seconds, or null if it doesn't
// encode a timestamp. Naming is colon-free (Windows-safe): mm-ss / mm_ss,
// hh-mm-ss, bare mmss (3-4 digits), or bare seconds (1-2 digits).
export function parseTimestampName(filename) {
  if (!filename || typeof filename !== "string") return null;
  // strip directory prefix and extension
  const base = filename.split(/[\\/]/).pop().replace(/\.[^.]+$/, "").trim();

  let m;
  // hh-mm-ss
  if ((m = base.match(/^(\d+)[-_](\d{1,2})[-_](\d{1,2})$/))) {
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  }
  // mm-ss
  if ((m = base.match(/^(\d+)[-_](\d{1,2})$/))) {
    return (+m[1]) * 60 + (+m[2]);
  }
  // bare digits
  if ((m = base.match(/^\d+$/))) {
    if (base.length >= 3) {
      const secs = +base.slice(-2);
      const mins = +base.slice(0, -2);
      return mins * 60 + secs;
    }
    return +base; // 1-2 digits → plain seconds
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- timestamp`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/timestamp.js lib/__tests__/timestamp.test.js
git commit -m "feat: timestamp filename parser"
```

---

## Task 2: Timeline builder

Turns parsed items + audio duration into an ordered clip list that fully covers `[0, audioDuration]`.

Rules:
- Drop items whose `seconds` is `null`, `< 0`, or `>= audioDuration` (each → a warning).
- Sort remaining by `seconds` ascending.
- The **first** clip always starts at `0` (if its timestamp was `> 0`, add an info warning — the first image covers the lead-in).
- `duration[i] = start[i+1] - start[i]`; the **last** clip runs to `audioDuration`.
- Duplicate timestamps → warning (later one wins position; a zero-length clip is dropped with a warning).
- Empty input → `{ clips: [], warnings: [...] }`.

**Files:**
- Create: `lib/timeline.js`
- Test: `lib/__tests__/timeline.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { buildTimeline } from "../timeline.js";

const item = (name, seconds) => ({ name, seconds });

describe("buildTimeline", () => {
  it("builds clips covering the full audio", () => {
    const { clips } = buildTimeline(
      [item("a", 0), item("b", 3), item("c", 9)],
      12
    );
    expect(clips).toEqual([
      { name: "a", start: 0, duration: 3 },
      { name: "b", start: 3, duration: 6 },
      { name: "c", start: 9, duration: 3 },
    ]);
  });

  it("sorts unordered items", () => {
    const { clips } = buildTimeline([item("c", 9), item("a", 0), item("b", 3)], 12);
    expect(clips.map((c) => c.name)).toEqual(["a", "b", "c"]);
  });

  it("forces the first clip to start at 0 and warns when it did not", () => {
    const { clips, warnings } = buildTimeline([item("a", 3), item("b", 6)], 10);
    expect(clips[0]).toEqual({ name: "a", start: 0, duration: 6 });
    expect(warnings.some((w) => /lead-in|starts at/i.test(w))).toBe(true);
  });

  it("drops items at or beyond the audio duration with a warning", () => {
    const { clips, warnings } = buildTimeline([item("a", 0), item("b", 20)], 10);
    expect(clips.map((c) => c.name)).toEqual(["a"]);
    expect(warnings.some((w) => /b/.test(w) && /beyond|duration/i.test(w))).toBe(true);
  });

  it("drops unparseable (null seconds) items with a warning", () => {
    const { clips, warnings } = buildTimeline([item("a", 0), item("bad", null)], 10);
    expect(clips.map((c) => c.name)).toEqual(["a"]);
    expect(warnings.some((w) => /bad/.test(w))).toBe(true);
  });

  it("warns and drops duplicate-timestamp zero-length clips", () => {
    const { clips, warnings } = buildTimeline(
      [item("a", 0), item("b", 5), item("c", 5)],
      10
    );
    // one of the two at t=5 collapses to zero length and is dropped
    expect(clips.length).toBe(2);
    expect(warnings.some((w) => /duplicate/i.test(w))).toBe(true);
  });

  it("returns empty clips with a warning when there are no valid items", () => {
    const { clips, warnings } = buildTimeline([], 10);
    expect(clips).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- timeline`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation in `lib/timeline.js`**

```js
// Build an ordered clip list that fully covers [0, audioDuration] from parsed
// items ({ name, seconds }). Returns { clips, warnings }.
export function buildTimeline(items, audioDuration) {
  const warnings = [];
  const valid = [];

  for (const it of items || []) {
    if (it.seconds == null || Number.isNaN(it.seconds)) {
      warnings.push(`Ignored "${it.name}": filename has no readable timestamp.`);
      continue;
    }
    if (it.seconds < 0) {
      warnings.push(`Ignored "${it.name}": negative timestamp.`);
      continue;
    }
    if (audioDuration > 0 && it.seconds >= audioDuration) {
      warnings.push(`Ignored "${it.name}": timestamp is beyond the audio duration.`);
      continue;
    }
    valid.push({ ...it });
  }

  valid.sort((a, b) => a.seconds - b.seconds);

  if (valid.length === 0) {
    warnings.push("No usable images. Check that filenames encode timestamps.");
    return { clips: [], warnings };
  }

  if (valid[0].seconds > 0) {
    warnings.push(
      `First image "${valid[0].name}" starts at ${valid[0].seconds}s; it will cover the lead-in from 0s.`
    );
  }

  const clips = [];
  for (let i = 0; i < valid.length; i++) {
    const start = i === 0 ? 0 : valid[i].seconds;
    const end = i + 1 < valid.length ? valid[i + 1].seconds : audioDuration;
    const duration = +(end - start).toFixed(3);
    if (duration <= 0) {
      warnings.push(`Duplicate/overlapping timestamp for "${valid[i].name}" — skipped.`);
      continue;
    }
    clips.push({ name: valid[i].name, start: +start.toFixed(3), duration });
  }

  return { clips, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- timeline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/timeline.js lib/__tests__/timeline.test.js
git commit -m "feat: timeline builder"
```

---

## Task 3: Dimension resolver

Maps the aspect choice to even output dimensions. `auto` uses a sample image's natural size (rounded to even).

**Files:**
- Create: `lib/dimensions.js`
- Test: `lib/__tests__/dimensions.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { resolveDimensions } from "../dimensions.js";

describe("resolveDimensions", () => {
  it("returns 1920x1080 for 16:9", () => {
    expect(resolveDimensions("16:9")).toEqual({ width: 1920, height: 1080 });
  });
  it("returns 1080x1920 for 9:16", () => {
    expect(resolveDimensions("9:16")).toEqual({ width: 1080, height: 1920 });
  });
  it("uses the sample image (even-rounded) for auto", () => {
    expect(resolveDimensions("auto", { width: 1281, height: 721 })).toEqual({
      width: 1280,
      height: 720,
    });
  });
  it("falls back to 16:9 for auto without a sample", () => {
    expect(resolveDimensions("auto")).toEqual({ width: 1920, height: 1080 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dimensions`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation in `lib/dimensions.js`**

```js
// Resolve output frame size (even numbers, required by libx264) from the chosen
// aspect. "auto" matches a sample image's natural size.
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

export function resolveDimensions(aspect, sample) {
  if (aspect === "9:16") return { width: 1080, height: 1920 };
  if (aspect === "auto" && sample && sample.width && sample.height) {
    return { width: even(sample.width), height: even(sample.height) };
  }
  return { width: 1920, height: 1080 }; // 16:9 default (and auto fallback)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- dimensions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dimensions.js lib/__tests__/dimensions.test.js
git commit -m "feat: output dimension resolver"
```

---

## Task 4: Audio duration helper

Browser helper (not unit-tested; verified in the E2E task).

**Files:**
- Create: `lib/audio.js`

- [ ] **Step 1: Implement `lib/audio.js`**

```js
// Decode an uploaded audio File and return its duration in seconds.
// Uses a detached <audio> element (works for mp3/wav across browsers).
export function getAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = el.duration;
      URL.revokeObjectURL(url);
      if (!isFinite(d) || d <= 0) reject(new Error("Could not read audio duration"));
      else resolve(d);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load audio file"));
    };
    el.src = url;
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/audio.js
git commit -m "feat: audio duration helper"
```

---

## Task 5: Self-host ffmpeg core + render module

Single-thread `@ffmpeg/core` avoids `SharedArrayBuffer`, so it runs on a plain static host (GitHub Pages) with no COOP/COEP headers.

**Files:**
- Create: `public/ffmpeg/ffmpeg-core.js`, `public/ffmpeg/ffmpeg-core.wasm` (copied from node_modules)
- Create: `lib/ffmpegRender.js`

- [ ] **Step 1: Copy the single-thread core into `public/ffmpeg`**

Run (Git Bash):
```bash
mkdir -p public/ffmpeg
cp node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js public/ffmpeg/
cp node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm public/ffmpeg/
ls -la public/ffmpeg
```
Expected: both files present (`ffmpeg-core.js`, `ffmpeg-core.wasm`).

- [ ] **Step 2: Implement `lib/ffmpegRender.js`**

```js
// Render an MP4 in-browser with single-thread ffmpeg.wasm.
// opts: { clips:[{name,start,duration}], imagesByName:{name->File}, audioFile:File,
//         width, height, fps, onProgress? }
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

let _ffmpeg = null;
async function getFFmpeg(onProgress) {
  if (_ffmpeg) return _ffmpeg;
  const ffmpeg = new FFmpeg();
  if (onProgress) ffmpeg.on("progress", ({ progress }) => onProgress(Math.min(1, progress)));
  await ffmpeg.load({
    coreURL: "/ffmpeg/ffmpeg-core.js",
    wasmURL: "/ffmpeg/ffmpeg-core.wasm",
  });
  _ffmpeg = ffmpeg;
  return ffmpeg;
}

function extOf(name) {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "png";
}

export async function renderVideo(opts) {
  const { clips, imagesByName, audioFile, width, height, fps, onProgress } = opts;
  const ffmpeg = await getFFmpeg(onProgress);

  // Write images with sequential FS names; build concat list.
  let concat = "";
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const file = imagesByName[clip.name];
    const fsName = `img${String(i).padStart(4, "0")}.${extOf(file.name)}`;
    await ffmpeg.writeFile(fsName, await fetchFile(file));
    concat += `file '${fsName}'\nduration ${clip.duration}\n`;
    // Repeat the last image once more so the concat demuxer honors its duration.
    if (i === clips.length - 1) concat += `file '${fsName}'\n`;
  }
  await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(concat));

  const audioExt = extOf(audioFile.name);
  const audioFs = `audio.${audioExt}`;
  await ffmpeg.writeFile(audioFs, await fetchFile(audioFile));

  const vf =
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`;

  await ffmpeg.exec([
    "-f", "concat", "-safe", "0", "-i", "concat.txt",
    "-i", audioFs,
    "-vf", vf,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k",
    "-shortest", "-movflags", "+faststart",
    "output.mp4",
  ]);

  const data = await ffmpeg.readFile("output.mp4");
  return new Blob([data.buffer], { type: "video/mp4" });
}
```

- [ ] **Step 3: Commit**

```bash
git add public/ffmpeg lib/ffmpegRender.js
git commit -m "feat: self-hosted ffmpeg core + in-browser render module"
```

---

## Task 6: Preview player component

**Files:**
- Create: `components/PreviewPlayer.js`

- [ ] **Step 1: Implement `components/PreviewPlayer.js`**

```js
"use client";
import { useEffect, useRef } from "react";

// props: clips [{name,start,duration}], imageUrls {name->objectURL},
//        imageEls {name->HTMLImageElement}, audioUrl, width, height
export default function PreviewPlayer({ clips, imageEls, audioUrl, width, height }) {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function draw(t) {
      const clip = clips.find((c) => t >= c.start && t < c.start + c.duration) || clips[0];
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!clip) return;
      const img = imageEls[clip.name];
      if (!img) return;
      // contain
      const scale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    }

    const audio = audioRef.current;
    const onTime = () => draw(audio.currentTime);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("seeked", onTime);
    draw(0);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("seeked", onTime);
    };
  }, [clips, imageEls]);

  return (
    <div>
      <canvas ref={canvasRef} width={width} height={height} className="preview" />
      <audio ref={audioRef} src={audioUrl} controls style={{ width: "100%", marginTop: 10 }} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/PreviewPlayer.js
git commit -m "feat: canvas preview player synced to audio"
```

---

## Task 7: Main page UI wiring

**Files:**
- Modify: `app/page.js` (replace scaffold)

- [ ] **Step 1: Implement `app/page.js`**

```js
"use client";
import { useCallback, useMemo, useState } from "react";
import "./globals.css";
import { parseTimestampName } from "../lib/timestamp";
import { buildTimeline } from "../lib/timeline";
import { resolveDimensions } from "../lib/dimensions";
import { getAudioDuration } from "../lib/audio";
import { renderVideo } from "../lib/ffmpegRender";
import PreviewPlayer from "../components/PreviewPlayer";

function loadImageEl(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.src = url;
  });
}

export default function Home() {
  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [imagesByName, setImagesByName] = useState({});
  const [imageEls, setImageEls] = useState({});
  const [items, setItems] = useState([]);
  const [aspect, setAspect] = useState("16:9");
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outUrl, setOutUrl] = useState(null);
  const [error, setError] = useState(null);

  const onAudio = useCallback(async (file) => {
    if (!file) return;
    setError(null);
    try {
      const d = await getAudioDuration(file);
      setAudioFile(file);
      setAudioUrl(URL.createObjectURL(file));
      setAudioDuration(d);
    } catch (e) { setError(e.message); }
  }, []);

  const onImages = useCallback(async (fileList) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    const byName = {}, els = {}, its = [];
    for (const f of files) {
      byName[f.name] = f;
      its.push({ name: f.name, seconds: parseTimestampName(f.name) });
      const { img, url } = await loadImageEl(f);
      els[f.name] = img; els[f.name].url = url;
    }
    setImagesByName(byName); setImageEls(els); setItems(its);
  }, []);

  const sample = useMemo(() => {
    const first = items.find((i) => imageEls[i.name]);
    const el = first && imageEls[first.name];
    return el ? { width: el.naturalWidth, height: el.naturalHeight } : null;
  }, [items, imageEls]);

  const dims = useMemo(() => resolveDimensions(aspect, sample), [aspect, sample]);
  const { clips, warnings } = useMemo(
    () => buildTimeline(items, audioDuration),
    [items, audioDuration]
  );

  const ready = audioFile && clips.length > 0;

  const onRender = useCallback(async () => {
    setBusy(true); setError(null); setOutUrl(null); setProgress(0);
    try {
      const blob = await renderVideo({
        clips, imagesByName, audioFile,
        width: dims.width, height: dims.height, fps,
        onProgress: setProgress,
      });
      setOutUrl(URL.createObjectURL(blob));
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  }, [clips, imagesByName, audioFile, dims, fps]);

  return (
    <main className="wrap">
      <h1>Story → Video Assembler</h1>
      <p className="sub">Upload one voiceover + timestamp-named images → download an MP4.</p>

      <div className="card">
        <div className="row">
          <label className="drop" style={{ flex: 1 }}>
            {audioFile ? `Audio: ${audioFile.name} (${audioDuration.toFixed(1)}s)` : "Choose voiceover audio"}
            <input type="file" accept="audio/*" hidden onChange={(e) => onAudio(e.target.files[0])} />
          </label>
          <label className="drop" style={{ flex: 1 }}>
            {items.length ? `${items.length} images loaded` : "Choose timestamp-named images"}
            <input type="file" accept="image/*" multiple hidden onChange={(e) => onImages(e.target.files)} />
          </label>
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <label className="field">Aspect
            <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
              <option value="16:9">16:9 (1920×1080)</option>
              <option value="9:16">9:16 (1080×1920)</option>
              <option value="auto">Auto (match images)</option>
            </select>
          </label>
          <label className="field">FPS
            <select value={fps} onChange={(e) => setFps(+e.target.value)}>
              <option value={24}>24</option>
              <option value={30}>30</option>
            </select>
          </label>
          <span className="field">Output: {dims.width}×{dims.height}</span>
        </div>

        {warnings.map((w, i) => <div className="warn" key={i}>⚠ {w}</div>)}
      </div>

      {ready && (
        <div className="card">
          <PreviewPlayer
            clips={clips}
            imageEls={imageEls}
            audioUrl={audioUrl}
            width={dims.width}
            height={dims.height}
          />
          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary" onClick={onRender} disabled={busy}>
              {busy ? "Rendering…" : "Render MP4"}
            </button>
            {outUrl && <a className="dl" href={outUrl} download="story.mp4">Download MP4</a>}
            {error && <span className="warn">Error: {error}</span>}
          </div>
          {busy && <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/page.js
git commit -m "feat: main UI — upload, preview, render, download"
```

---

## Task 8: Build verification + end-to-end manual test

**Files:** none (verification only)

- [ ] **Step 1: Unit tests all pass**

Run: `npm test`
Expected: all suites (timestamp, timeline, dimensions) PASS.

- [ ] **Step 2: Production build succeeds (static export)**

Run: `npm run build`
Expected: "Compiled successfully"; an `out/` directory is produced.

- [ ] **Step 3: Manual E2E in the dev server**

Run: `npm run dev`, open http://localhost:3000

Prepare a sample set: ~11 images named `0-00.png`, `0-03.png`, `0-09.png`, `0-13.png`, `0-20.png`, `0-26.png`, `0-31.png`, `0-34.png` (any placeholder images) and a matching narration audio (~35–45s).

Verify:
- Uploading audio shows its duration.
- Uploading the images shows the count and no unexpected warnings.
- The preview player swaps images at the right times as the audio plays.
- "Render MP4" shows a progress bar and produces a downloadable MP4.
- The downloaded MP4 plays with images changing at the correct times and audio intact.

- [ ] **Step 4: Commit any fixes discovered during E2E**

```bash
git add -A
git commit -m "fix: E2E adjustments"
```

---

## Notes / follow-ups (out of v1 scope)

- Crossfades / Ken Burns, subtitles (needs the timestamped script), CapCut draft export.
- If long-HD renders are too slow, evaluate the multi-thread core + `coi-serviceworker` for cross-origin isolation.
- Deploy: push `out/` to GitHub Pages (single-thread core needs no special headers).
