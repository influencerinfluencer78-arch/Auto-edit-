# Draggable image durations (roll edit) — design

## Problem

Image durations are fully derived from timestamps: each image's on-screen length runs
from its own start until the next image's start (the last image fills to the audio end).
The only way to change how long an image holds is to rename its file's timestamp and
re-import. Users want to fine-tune a hold time directly on the timeline, like a video
editor — grab an image's edge and drag.

## Goal

Let the user drag the **right edge** of an image clip to change how long it holds. This
is a **roll edit**: the boundary between the dragged image (A) and the next clip (B)
moves, so A lengthens/shortens and B shortens/lengthens by the same amount. Every other
image's timing, and the total video length, stay put.

Scope (decided during brainstorming):

- **Right edge only** — no left-edge handles.
- **Roll edit** — the neighbor's start moves; nothing ripples, total length is preserved.

## The core mapping

A slot stores only `seconds` (its start). A clip's *duration* is derived by
`buildTimeline` as the gap to the next clip. Therefore:

> Dragging image A's right edge to time `b` == setting the **next** clip's slot
> `seconds = b`.

`buildTimeline` re-derives all clips from the updated slots, so A now ends at `b` and B
now starts at `b`. This reuses the existing undoable composition (`commitDoc` over
`slots`) with no new data model.

Boundary → slot: for clip index `i` (the dragged image), the boundary is the start of
clip `i+1`; the slot to update is the one whose `id === clips[i+1].name`. `clips[i+1]`
is never the synthetic `LEAD_IN` (that is only ever `clips[0]`), so it always maps to a
real slot (an image slot or an empty-gap slot).

## Which clips expose a handle

A right-edge resize grip is rendered on a clip when **all** of:

- the clip is an image (`!clip.gap`), and
- it is **not** the last clip (`i < clips.length - 1`).

The last clip's right edge is the video end (governed by trim, not resize). Gap clips get
no grip (the feature is "extend an image"). Note the next clip `B` (`clips[i+1]`) may
itself be an image or an empty gap — both are valid roll targets (dragging A into a black
gap simply shortens the gap).

## Clamping

Let `Astart = clips[i].start` and `Bend = clips[i+1].start + clips[i+1].duration`
(B's fixed right edge). The dragged boundary `b` is clamped to:

```
b ∈ [ Astart + MIN_CLIP , Bend − MIN_CLIP ]      MIN_CLIP = 0.3 (seconds)
```

This keeps both A and B at least `MIN_CLIP` long, which also guarantees `buildTimeline`
never reorders slots or emits a duplicate/zero-length warning (`b` stays strictly between
`clips[i].start` and `clips[i+2].start`/audio-end).

## Interaction & drag feel

- The grip is a ~8px-wide strip on the clip's right edge, `cursor: ew-resize`, revealed on
  hover and always visible on touch (no hover).
- `pointerdown` on the grip calls `stopPropagation()` so it does **not** open the clip
  inspector or scrub the playhead, then begins a window-level `pointermove`/`pointerup`
  drag (same pattern as the existing scrubber and trim handle).
- **Live feedback, commit once:** during the drag, `Timeline` holds the in-progress
  boundary in local state and visually overrides the geometry of the two adjacent clips
  (A's width and B's left/width via inline `pct()` styles) — page state is not touched, so
  there is no per-move history spam. On `pointerup` it calls
  `onResizeBoundary(nextClipName, seconds)` exactly once → a single undo step.

## Components & changes

### `app/page.js`

- Add `resizeBoundary(nextClipName, seconds)`:

  ```js
  const resizeBoundary = useCallback((id, seconds) => {
    commitDoc((d) => ({
      ...d,
      slots: d.slots.map((s) => (s.id === id ? { ...s, seconds: +seconds.toFixed(3) } : s)),
    }));
  }, [commitDoc]);
  ```

- Pass `resizeBoundary` down to `Editor`.

### `components/Editor.js`

- Accept `resizeBoundary` and forward it to `<Timeline onResizeBoundary={resizeBoundary} />`.

### `components/Timeline.js`

- New prop `onResizeBoundary`.
- Constant `MIN_CLIP = 0.3`.
- Local state `drag` = `{ index, sec }` (or `null`) for the in-progress boundary.
- A `boundaryAt(clientX, i)` helper mapping pointer x → clamped boundary seconds (reuses
  the `trackRef.getBoundingClientRect()` math already used by `seekAt`/`trimAt`).
- `onResizeDown(e, i)`: `stopPropagation`; set `drag = { index: i, sec: clips[i+1].start }`;
  add window `pointermove` (update `drag.sec` via `boundaryAt`) and `pointerup`
  (call `onResizeBoundary(clips[i+1].name, drag.sec)`, clear `drag`, remove listeners).
- In the video-lane render: for each eligible image clip, when `drag` overrides its
  geometry compute the overridden `left`/`width`; add the grip element
  (`<span className="clip__resize" onPointerDown={(e) => onResizeDown(e, i)} />`).
  The affected next clip (`drag.index + 1`) is rendered with `left = pct(drag.sec)` and
  `width = pct(Bend − drag.sec)`.

### `app/globals.css`

- `.clip__resize`: absolutely positioned right-edge strip, `cursor: ew-resize`,
  `touch-action: none`, subtle grip visible on hover; always visible under the existing
  phone media query (touch has no hover). Sits above the clip body but below the trim
  handle / playhead.

## Data flow

```
drag right edge of image i ─(pointerup)→ onResizeBoundary(clips[i+1].name, b)
   → page.js resizeBoundary → commitDoc updates slot.seconds = b (undoable)
   → buildTimeline re-derives clips → A ends at b, B starts at b, others unchanged
```

## Edge cases

- **Dragged image is second-to-last:** B is the last clip (fills to end). Rolling moves
  B's start; B still fills to the video/trim end. Allowed; `MIN_CLIP` clamp keeps B alive.
- **Next clip is an empty gap:** valid — rolling shortens/extends the black gap.
- **Drag past a neighbor:** impossible; the `MIN_CLIP` clamp stops the boundary before
  either clip collapses.
- **Undo/redo:** one commit per completed drag, so a single Ctrl+Z reverts a resize.
- **Transitions:** keyed by clip name and anchored to `clip.start` at render time, so a
  moved boundary re-anchors the affected transition automatically — no extra work.
- **Trim interaction:** trim handle is at the video end; resize grips are on interior
  image boundaries. Independent. If a trim point falls inside clip B, export still
  truncates at the trim (unchanged behavior).

## Testing

- **Manual:** import audio + several images; hover an interior image → grip appears; drag
  its right edge right → that image lengthens, the next starts later and shortens, later
  images unchanged, total length unchanged; drag left → reverse; confirm it can't collapse
  either clip; Ctrl+Z reverts in one step; a transition on the moved boundary still plays;
  render an MP4 and confirm the new hold times.
- No new pure logic warrants a unit test (the clamp is inline DOM-drag math, consistent
  with the untested scrubber/trim handles); `buildTimeline` already has coverage for the
  re-derivation.

## Out of scope (YAGNI)

- Left-edge handles.
- Ripple mode.
- Numeric duration entry.
- Drag-to-reorder images.
