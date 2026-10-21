import palette from '../../speaker_palette.json' with { type: 'json' };
import type { Speaker } from './api';

export const specialColors: Record<string, string> = Object.assign(Object.create(null), palette.special);

// OKLab distance, also used by backend/speaker_colors.py. Compare shared fixtures in tests.
function linearRgb(color: string): number[] {
  return [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
}

function oklab(color: string): number[] {
  const [r, g, b] = linearRgb(color);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s];
}

export function nextSpeakerColor(occupied: string[]): string {
  const used = new Set([...occupied.map(c => c.toLowerCase()), ...Object.values(specialColors)]);
  const labs = [...used].sort().map(oklab);
  const score = (c: string) => {
    const lab = oklab(c);
    return Math.min(...labs.map(old => lab.reduce((sum, v, i) => sum + (v - old[i]) ** 2, 0)));
  };
  const candidates = palette.candidates.filter(c => !used.has(c));
  const best = () => candidates.reduce((a, b) => score(b) > score(a) ? b : a);
  if (candidates.length && score(best()) >= .01) return best();
  let generated = 0;
  for (let i = 0; generated < 72; i++) {
    const h = (i * .618033988749895) % 1, l = [.62, .74, .82][i % 3], saturation = [.65, .85][i % 2];
    const m2 = l <= .5 ? l * (1 + saturation) : l + saturation - l * saturation;
    const m1 = 2 * l - m2;
    const hue = (value: number) => {
      value = (value % 1 + 1) % 1;
      if (value * 6 < 1) return m1 + (m2 - m1) * value * 6;
      if (value * 2 < 1) return m2;
      if (value * 3 < 2) return m1 + (m2 - m1) * (2 / 3 - value) * 6;
      return m1;
    };
    const color = '#' + [h + 1 / 3, h, h - 1 / 3].map(value =>
      Math.floor(hue(value) * 255 + .5).toString(16).padStart(2, '0')).join('');
    const luminance = linearRgb(color).reduce((sum, v, j) => sum + v * [.2126, .7152, .0722][j], 0);
    if (!used.has(color) && !candidates.includes(color) && luminance >= .30) { candidates.push(color); generated++; }
  }
  return best();
}

export function optimizedSpeakerColors(speakers: Speaker[]): Speaker[] {
  // Reserve ALL locked and special colors before ordinary allocation, including hidden tracks.
  const fixed = speakers.filter(s => s.locked || specialColors[s.label]);
  const colors = new Map(fixed.map(s => [s.id, s.locked ? s.color : specialColors[s.label]]));
  const occupied = [...colors.values()];
  for (const speaker of speakers) {
    if (colors.has(speaker.id)) continue;
    const color = nextSpeakerColor(occupied);
    colors.set(speaker.id, color); occupied.push(color);
  }
  return speakers.map(s => ({ ...s, color: colors.get(s.id)! }));
}
