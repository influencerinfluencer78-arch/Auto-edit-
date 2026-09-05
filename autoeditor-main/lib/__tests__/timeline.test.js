import { describe, it, expect } from "vitest";
import { buildTimeline, trimClips, LEAD_IN } from "../timeline.js";

const item = (name, seconds) => ({ name, seconds });

describe("buildTimeline", () => {
  it("does not flag a false overlap for the last image when audio isn't loaded", () => {
    const { clips, warnings } = buildTimeline([item("s0", 0)], 0);
    expect(clips).toEqual([]);
    expect(warnings).toEqual([]); // no audio yet → no spurious warning
  });

  it("flags a genuine duplicate timestamp using the filename label", () => {
    const { warnings } = buildTimeline(
      [{ name: "s0", seconds: 3, label: "0-03.png" }, { name: "s1", seconds: 3, label: "shot.png" }],
      10
    );
    expect(warnings.some((w) => w.includes("0-03.png"))).toBe(true);
    expect(warnings.join(" ")).not.toContain("s0"); // never leak the internal id
  });

  it("builds clips covering the full audio", () => {
    const { clips } = buildTimeline(
      [item("a", 0), item("b", 3), item("c", 9)],
      12
    );
    expect(clips).toEqual([
      { name: "a", start: 0, duration: 3, gap: false },
      { name: "b", start: 3, duration: 6, gap: false },
      { name: "c", start: 9, duration: 3, gap: false },
    ]);
  });

  it("sorts unordered items", () => {
    const { clips } = buildTimeline([item("c", 9), item("a", 0), item("b", 3)], 12);
    expect(clips.map((c) => c.name)).toEqual(["a", "b", "c"]);
  });

  it("emits a lead-in gap instead of stretching the first image to 0", () => {
    const { clips } = buildTimeline([item("a", 3), item("b", 6)], 10);
    expect(clips).toEqual([
      { name: LEAD_IN, start: 0, duration: 3, gap: true },
      { name: "a", start: 3, duration: 3, gap: false },
      { name: "b", start: 6, duration: 4, gap: false },
    ]);
  });

  it("keeps an empty slot as a gap without extending its neighbours", () => {
    const { clips } = buildTimeline(
      [item("a", 0), { name: "x", seconds: 5, empty: true }, item("c", 8)],
      12
    );
    expect(clips).toEqual([
      { name: "a", start: 0, duration: 5, gap: false },
      { name: "x", start: 5, duration: 3, gap: true },
      { name: "c", start: 8, duration: 4, gap: false },
    ]);
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
    expect(clips.length).toBe(2);
    expect(warnings.some((w) => /duplicate/i.test(w))).toBe(true);
  });

  it("returns empty clips with a warning when there are no valid items", () => {
    const { clips, warnings } = buildTimeline([], 10);
    expect(clips).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

const clip = (name, start, duration, gap = false) => ({ name, start, duration, gap });

describe("trimClips", () => {
  const clips = [
    clip("a", 0, 5),
    clip("b", 5, 5),
    clip("c", 10, 5), // ends at 15
  ];

  it("returns clips unchanged when end is at or beyond the total length", () => {
    expect(trimClips(clips, 15)).toBe(clips);
    expect(trimClips(clips, 99)).toBe(clips);
  });

  it("returns clips unchanged when end is falsy or non-positive", () => {
    expect(trimClips(clips, 0)).toBe(clips);
    expect(trimClips(clips, undefined)).toBe(clips);
    expect(trimClips(clips, -3)).toBe(clips);
  });

  it("drops clips that start at or after end", () => {
    // end exactly on b's start: b and c both dropped, a runs full
    expect(trimClips(clips, 5)).toEqual([clip("a", 0, 5)]);
  });

  it("truncates the clip straddling end to stop exactly at end", () => {
    expect(trimClips(clips, 7)).toEqual([
      clip("a", 0, 5),
      clip("b", 5, 2),
    ]);
  });

  it("preserves gap and other fields on a truncated clip", () => {
    const withGap = [clip("a", 0, 5), clip("x", 5, 5, true)];
    expect(trimClips(withGap, 8)).toEqual([
      clip("a", 0, 5),
      clip("x", 5, 3, true),
    ]);
  });

  it("keeps the same object reference for clips left unchanged", () => {
    const out = trimClips(clips, 7);
    expect(out[0]).toBe(clips[0]); // 'a' fully inside → not reallocated
  });
});
