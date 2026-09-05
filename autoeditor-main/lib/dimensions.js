// Resolve output frame size (even numbers, required by libx264) from the chosen
// aspect. "auto" matches a sample image's natural size.
const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

export function resolveDimensions(aspect, sample) {
  if (aspect === "9:16") return { width: 1080, height: 1920 };
  if (aspect === "auto" && sample && sample.width && sample.height) {
    return { width: even(sample.width), height: even(sample.height) };
  }
  return { width: 1920, height: 1080 }; // 16:9 default (and auto fallback)
}

// Scale a resolution down to a 720p box (short side ≤ 720, long side ≤ 1280),
// preserving aspect and keeping even dimensions. Returns it unchanged if it
// already fits. Used by the "720p (faster)" render-quality option — ~2× less
// filter/encode work than 1080p, big win on phones.
export function capTo720(d) {
  const short = Math.min(d.width, d.height);
  const long = Math.max(d.width, d.height);
  const s = Math.min(1, 720 / short, 1280 / long);
  if (s >= 1) return d;
  return { width: even(d.width * s), height: even(d.height * s) };
}
