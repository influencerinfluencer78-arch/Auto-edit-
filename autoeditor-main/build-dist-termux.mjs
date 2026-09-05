// Build the on-device Android (Termux) distributable. Unlike the Windows/mac
// builds there is NO single exe — Android/Termux uses its OWN native node +
// ffmpeg (installed via `pkg install nodejs ffmpeg`), so we ship the bundled
// server JS + UI + font + a start script. Runs on any dev machine (esbuild is
// cross-platform); no phone needed to produce it.
//
//   node build-dist-termux.mjs
//
// Produces:  dist/AutoEditor-android.zip
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, copyFileSync, cpSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(os.tmpdir(), "autoeditor-build-termux");
const OUT = path.join(STAGE, "AutoEditor-android");

function run(cmd, cwd = ROOT) { console.log("> " + cmd); execSync(cmd, { cwd, stdio: "inherit" }); }

const START_SH = `#!/usr/bin/env bash
# AutoEditor for Android (Termux).  Run:  bash start.sh
cd "$(dirname "$0")"

# Windows-made zips drop Unix permissions, which makes the extracted folders
# non-searchable and the server hit EACCES. Restore read + dir-execute here.
chmod -R u+rwX . 2>/dev/null || true

# First run: auto-install Node.js + ffmpeg if they're missing (needs internet).
if ! command -v node >/dev/null 2>&1 || ! command -v ffmpeg >/dev/null 2>&1; then
  echo "First run: installing Node.js and ffmpeg (one-time, needs internet)..."
  yes | pkg update >/dev/null 2>&1 || pkg update -y
  pkg install -y nodejs ffmpeg
fi

if ! command -v node >/dev/null 2>&1; then echo "Node.js install failed. Try: pkg install nodejs"; exit 1; fi
FF="$(command -v ffmpeg)"
if [ -z "$FF" ]; then echo "ffmpeg install failed. Try: pkg install ffmpeg"; exit 1; fi
export FFMPEG_PATH="$FF"
export CAPTION_FONT_PATH="$(pwd)/caption.ttf"
export FRONTEND_DIR="$(pwd)/out"
export OPEN_BROWSER=0
export PORT="\${PORT:-4000}"

# Keep the phone usable during a render:
#  - RENDER_THREADS caps CPU cores used for filtering/software-encoding
#    (default ~half the cores; RENDER_THREADS=0 = all cores).
#  - RENDER_NICE runs ffmpeg at low OS priority so foreground apps get CPU first.
#  - RENDER_ZOOM_SS lowers the Ken Burns supersample (biggest CPU/RAM cost of
#    zoom); 2 keeps the phone responsive, 3 is smoothest but heaviest.
# The app also auto-tries the phone's hardware video encoder (h264_mediacodec,
# the same silicon CapCut/KineMaster use) and only falls back to CPU libx264 if
# it isn't available. Force CPU with RENDER_ENCODER=libx264 if a render looks bad.
CORES="\$(nproc 2>/dev/null || echo 4)"
export RENDER_THREADS="\${RENDER_THREADS:-\$(( CORES > 2 ? (CORES + 1) / 2 : 1 ))}"
export RENDER_NICE="\${RENDER_NICE:-18}"
export RENDER_ZOOM_SS="\${RENDER_ZOOM_SS:-2}"
echo "Render load: RENDER_THREADS=\$RENDER_THREADS RENDER_NICE=\$RENDER_NICE RENDER_ZOOM_SS=\$RENDER_ZOOM_SS (hardware encoder auto-detected)"

# Make sure Termux can reach shared storage (Download etc.). If it isn't set up
# yet, run termux-setup-storage — it pops a one-time Android permission dialog;
# tap Allow. Without this, saves land in Termux-private storage that file apps
# can't open.
if [ ! -d "$HOME/storage" ]; then
  echo "Setting up storage access — tap Allow on the permission dialog..."
  termux-setup-storage 2>/dev/null || true
  sleep 3
fi

# Auto-save finished videos where the user can actually find them: the phone's
# Download folder (visible in Files, Gallery, and every file manager). Fall back
# to shared-storage root, then Termux-private storage as a last resort.
if [ -d "$HOME/storage/downloads" ]; then
  export OUTPUT_DIR="$HOME/storage/downloads/AutoEditor"
elif [ -d "$HOME/storage/shared" ]; then
  export OUTPUT_DIR="$HOME/storage/shared/AutoEditor"
else
  export OUTPUT_DIR="$HOME/AutoEditor-output"
fi
mkdir -p "$OUTPUT_DIR" 2>/dev/null || true
# Resolve the Termux storage symlink to the real path (/storage/emulated/0/...)
# so logs show the folder the user actually sees in Files/Gallery, not the
# confusing /data/data/com.termux/.../storage/downloads symlink path.
REAL_OUT="\$(cd "\$OUTPUT_DIR" 2>/dev/null && pwd -P)"
[ -n "\$REAL_OUT" ] && export OUTPUT_DIR="\$REAL_OUT"

# Keep the CPU running during long renders even when the screen is locked.
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock && echo "Wake-lock acquired — CPU stays on with the screen off."
else
  echo "termux-wake-lock missing. Install it:  pkg install termux-tools"
fi
trap 'termux-wake-unlock 2>/dev/null || true' EXIT
echo ""
echo "IMPORTANT: if rendering PAUSES when you lock the screen, Android is freezing"
echo "Termux. Turn OFF battery optimization for it (one time):"
echo "  Android Settings > Apps > Termux > Battery > Unrestricted (Don't optimize)."
echo "Then rendering keeps going with the screen locked."
echo ""

echo "AutoEditor is running."
echo "Open  http://localhost:\${PORT}  in Chrome/Firefox on this phone."
echo "Finished videos are saved to:  $OUTPUT_DIR"
echo "You can close the browser after hitting Render — it keeps rendering and saves there."
echo "To check progress after closing the browser: switch back to Termux (it prints Rendering... %)."
echo "Keep this Termux session open. Press Ctrl+C to stop."
node bundle.cjs
`;

const README = `AutoEditor for Android (via Termux)
Runs entirely on your phone. Nothing is uploaded.

SETUP
1. Install Termux from the Google Play Store.
2. Open Termux and give it file access (once):
     termux-setup-storage
3. Go to this folder (e.g. if it's in Downloads):
     cd ~/storage/downloads/AutoEditor-android
4. Run:
     bash start.sh

That's it. On the first run start.sh installs Node.js + ffmpeg for you
(one-time, needs internet), then starts the app.

USE
   Open  http://localhost:4000  in Chrome or Firefox on the same phone.
   To stop: return to Termux and press Ctrl+C.
   Next time, just run "bash start.sh" again.

NOTES
- Rendering runs on the phone's CPU; short/medium videos work best.
- After the one-time setup, no internet is needed.
`;

async function main() {
  console.log("[1/5] Building frontend...");
  if (!existsSync(path.join(ROOT, "node_modules"))) run("npm install");
  run("npm run build");

  console.log("[2/5] Ensuring server deps (for bundling)...");
  if (!existsSync(path.join(ROOT, "server", "node_modules"))) run("npm install", path.join(ROOT, "server"));

  console.log("[3/5] Clean staging...");
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  console.log("[4/5] Bundling server + assembling folder...");
  run(`npx --yes esbuild server/index.js --bundle --platform=node --format=cjs --minify --outfile="${path.join(OUT, "bundle.cjs")}"`);
  copyFileSync(path.join(ROOT, "server", "assets", "caption.ttf"), path.join(OUT, "caption.ttf"));
  cpSync(path.join(ROOT, "out"), path.join(OUT, "out"), { recursive: true });
  writeFileSync(path.join(OUT, "start.sh"), START_SH.replace(/\r\n/g, "\n"));
  writeFileSync(path.join(OUT, "READ ME FIRST.txt"), README);

  console.log("[5/5] Zipping...");
  mkdirSync(DIST, { recursive: true }); // keep dist/ — only overwrite our own zip
  const zip = path.join(DIST, "AutoEditor-android.zip");
  rmSync(zip, { force: true });
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${OUT}' -DestinationPath '${zip}' -CompressionLevel Optimal -Force"`,
    { stdio: "inherit" },
  );
  rmSync(STAGE, { recursive: true, force: true });
  console.log("\nDone. Share:  " + zip);
}

main().catch((e) => { console.error("BUILD FAILED:", e.message); process.exit(1); });
