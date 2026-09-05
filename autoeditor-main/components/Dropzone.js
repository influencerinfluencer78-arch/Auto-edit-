"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Recursively read every File out of a dropped entry (file or directory).
// readEntries returns in batches of ~100, so we keep reading until it's empty.
function readEntry(entry, out) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((f) => { out.push(f); resolve(); }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readBatch = () => reader.readEntries(async (batch) => {
        if (!batch.length) return resolve();
        await Promise.all(batch.map((e) => readEntry(e, out)));
        readBatch();
      }, () => resolve());
      readBatch();
    } else {
      resolve();
    }
  });
}

// A click-or-drop file input. Dropping folders (even several at once) pulls in
// every file inside; `filled` swaps the label to the loaded state.
export default function Dropzone({
  accept, multiple, onFiles, compact,
  icon, title, hint, filled, filledLabel,
}) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  // On touch devices, accept="image/*" makes Android open Google Photos, which
  // renames files (losing the timestamp). Dropping `accept` opens the Files /
  // Documents picker instead, which preserves the real filename (0-03.png).
  // addImages/onAudio still filter by type, so nothing unwanted gets through.
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    try { setCoarse(window.matchMedia && window.matchMedia("(pointer: coarse)").matches); } catch { /* ignore */ }
  }, []);

  const onDrop = useCallback(async (e) => {
    e.preventDefault();
    setOver(false);
    const dt = e.dataTransfer;
    if (!dt) return;

    // Folder-aware path (only for multi-file zones like images). webkitGetAsEntry
    // must be called synchronously during the drop, so grab the entries first.
    if (multiple && dt.items && dt.items.length) {
      const entries = Array.from(dt.items)
        .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
        .filter(Boolean);
      if (entries.length) {
        const out = [];
        await Promise.all(entries.map((en) => readEntry(en, out)));
        const prefix = accept && accept.endsWith("/*") ? accept.split("/")[0] : null;
        const files = prefix ? out.filter((f) => f.type.startsWith(`${prefix}/`)) : out;
        if (files.length) onFiles(files);
        return;
      }
    }

    if (dt.files && dt.files.length) onFiles(dt.files);
  }, [onFiles, multiple, accept]);

  const cls = ["dz"];
  if (compact) cls.push("dz--compact");
  if (over) cls.push("is-over");
  if (filled) cls.push("is-filled");

  return (
    <button
      type="button"
      className={cls.join(" ")}
      onClick={() => inputRef.current && inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <span className="dz__icon" aria-hidden="true">{filled ? "✓" : icon}</span>
      <span className="dz__body">
        <span className="dz__title">{filled ? filledLabel : title}</span>
        {!compact && hint && <span className="dz__hint">{hint}</span>}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={coarse ? undefined : accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </button>
  );
}
