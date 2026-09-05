# AutoEditor on Android (Termux) — Setup Reference

Run AutoEditor entirely on an Android phone using **Termux**. Rendering happens
**on the device** with Termux's own Node + ffmpeg — nothing is uploaded, no cloud,
no app store.

The distributable is **`AutoEditor-android.zip`** (built on a dev machine with
`node build-dist-termux.mjs`). It contains only `bundle.cjs` (the server), the
`out/` UI, `caption.ttf`, `start.sh`, and a README — **no binaries**, so it's tiny
(~1 MB). Node and ffmpeg are installed by `start.sh` on first run.

---

## One-time setup (per phone)

### 1. Install Termux (from the Google Play Store)
Install **Termux** from the **Google Play Store**.

### 2. Grant Termux access to your files (storage access)
Open Termux and run:

```bash
termux-setup-storage
```

Tap **Allow** on the Android permission dialog. This creates `~/storage/…`
inside Termux, symlinked to your phone's shared storage:

- `~/storage/downloads` → the phone's **Download** folder
- `~/storage/shared`   → internal shared storage root (visible to Gallery/Files)

This step is what lets Termux read the zip from Downloads and **save finished
videos where your Gallery/Files app can see them**.

### 3. Install `unzip` (if it's missing)
```bash
pkg install -y unzip
```

---

## Getting the app onto the phone and running it

### 4. Put `AutoEditor-android.zip` in Downloads
Copy/transfer `AutoEditor-android.zip` to the phone's **Download** folder (WhatsApp,
a cable, cloud drive — whatever's easiest).

### 5. Unzip it
```bash
cd ~/storage/downloads
unzip AutoEditor-android.zip
cd AutoEditor-android
```

### 6. Start it
```bash
bash start.sh
```

**On the first run**, `start.sh` automatically:
- installs Node.js + ffmpeg if missing (`pkg update` + `pkg install -y nodejs ffmpeg`) — needs internet, one-time,
- fixes file permissions (`chmod -R u+rwX .`) — Windows-made zips drop the Unix
  permission bits, which otherwise causes `EACCES` errors serving the UI,
- picks the output folder (shared storage if available),
- takes a **wake-lock** so long renders survive the screen turning off,
- starts the server on **port 4000**.

Every run after that just starts the server instantly.

### 7. Open the editor
In **Chrome or Firefox on the same phone**, go to:

```
http://localhost:4000
```

Build your timeline and render, exactly like the desktop app.

To **stop**: return to Termux and press **Ctrl+C**.

---

## Important on-device notes

### Add images via "Files", not the Gallery
Android's **Gallery / Google Photos** picker renames files (it hands the browser a
MediaStore id, not `0-03.png`), which breaks the timestamp naming. On phones the
app is set to open the **Files / Documents** picker instead, which keeps the real
filename. If a chooser ever opens Photos, back out and pick **Files**.

### Keep rendering while the screen is locked (IMPORTANT)
`start.sh` takes a **wake-lock** so the CPU stays on with the screen off. But many
phones (Xiaomi/MIUI, Samsung, Oppo, Realme, etc.) also **freeze Termux via battery
optimization** the moment you lock the screen — so a render appears to *pause* when
locked and *resume* when you unlock. To stop that, turn battery optimization OFF
for Termux, once:

**Android Settings → Apps → Termux → Battery → Unrestricted** ("Don't optimize").

With that set (plus the wake-lock), rendering keeps running with the screen locked.
Keeping the phone on the charger during long renders helps too.

### Rendering runs in the background — you can close the browser
The render runs in the Termux server, not the browser. After you tap **Render**
you can **close the browser or lock the screen** — it keeps rendering.

The finished MP4 is **auto-saved** to your phone's **Download** folder:

```
~/storage/downloads/AutoEditor/     →  /storage/emulated/0/Download/AutoEditor/
```

Open it from any file manager under **Download › AutoEditor**, or from your
**Gallery/Files** — it appears as `autoeditor-<timestamp>-<id>.mp4`. If storage
access isn't set up yet, `start.sh` runs `termux-setup-storage` for you on launch
(tap **Allow**); only if you decline does it fall back to Termux-private storage
(`~/AutoEditor-output`), which file apps can't browse.

### Seeing progress after the browser is closed
Two ways:
1. **Termux console** — switch to Termux; it prints `Rendering… 5% / 10% / …` and
   `Saved video to …` when done.
2. **`/status` endpoint** — open `http://localhost:4000/status` (or
   `curl localhost:4000/status`) → `[{"status":"running","percent":45}]`.

### Reopening the browser reconnects
If you close the tab and reopen `http://localhost:4000` while a render is still
running, a banner reconnects to it and shows live progress + a Download when done.

### One render at a time
A second render is refused while one is running (phones can't do two at once) —
wait for the current one to finish, or Cancel it first.

### The phone stays usable during a render
Apps like CapCut/KineMaster stay smooth because they encode video on the phone's
**dedicated hardware encoder** (MediaCodec), not the CPU. AutoEditor now does the
same: it auto-detects and uses **`h264_mediacodec`** (the on-device hardware
encoder) and only falls back to CPU `libx264` if it isn't available. `start.sh`
prints which settings are active on launch (`Render load: …`).

The zoom/transition *math* still runs on the CPU, so `start.sh` also:
- runs ffmpeg at **low priority** (`RENDER_NICE=15`) so foreground apps get CPU first,
- caps it to **about half the cores** (`RENDER_THREADS`) so it won't peg the CPU / overheat,
- lowers the Ken Burns **supersample** (`RENDER_ZOOM_SS=2`) — zoom's single biggest
  CPU/RAM cost — so zoomed renders don't make the phone crawl (3 is smoothest but heaviest).

Tune any of it before running:
```bash
RENDER_THREADS=0 RENDER_NICE=0 RENDER_ZOOM_SS=3 bash start.sh   # full speed / smoothest (phone may get sluggish)
RENDER_THREADS=2 RENDER_NICE=19 RENDER_ZOOM_SS=1 bash start.sh  # gentlest (slowest, phone stays snappy)
RENDER_ENCODER=libx264 bash start.sh                           # force CPU encode if a hardware render looks wrong
```

If a rendered video ever looks corrupt or the render fails right after starting,
the hardware encoder on that phone is misbehaving — rerun with
`RENDER_ENCODER=libx264 bash start.sh` to force the reliable CPU path.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `EACCES: permission denied … out/…` | Old zip without the permission self-heal. Run `chmod -R u+rwX .` in the folder, then `bash start.sh`. Newer `start.sh` does this automatically. |
| Image timestamp shows a huge number (e.g. `10000689:15`) | You added it via **Gallery/Photos**. Re-add via **Files**. |
| `node not found` / `ffmpeg not found` | Needs internet on first run. Or install manually: `pkg install -y nodejs ffmpeg`. |
| `unzip: command not found` | `pkg install -y unzip`. |
| Render pauses when you lock the screen, resumes when you unlock | Android is freezing Termux. Turn OFF battery optimization: Settings → Apps → Termux → Battery → **Unrestricted**. The wake-lock alone isn't enough on aggressive OEMs. |
| Video saved somewhere file apps can't open (`/data/data/...`) | Storage access wasn't granted. Run `termux-setup-storage` (tap Allow), then restart `bash start.sh` — it saves to **Download/AutoEditor**. |

---

## Quick reference — the whole flow

```bash
# one-time
# (install Termux from the Google Play Store first)
termux-setup-storage          # tap Allow
pkg install -y unzip

# each app version
cd ~/storage/downloads
unzip AutoEditor-android.zip
cd AutoEditor-android
bash start.sh                 # first run installs node+ffmpeg
# → open http://localhost:4000 in the browser
```
