import type { Entry } from './api';

// Build once per committed/preview entry array, not on each playback frame.
// Prefix maxima retain long/nested overlaps; binary search skips ended ranges.
export function activeEntryQuery(entries: Entry[]) {
  let end = 0;
  const ends = entries.map(entry => (end = Math.max(end, entry.end_ms)));
  return (position: number) => {
    let lo = 0, hi = ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ends[mid] <= position) lo = mid + 1; else hi = mid;
    }
    const active: Entry[] = [];
    for (let i = lo; i < entries.length && entries[i].start_ms <= position; i++) {
      if (entries[i].end_ms > position) active.push(entries[i]);
    }
    return active;
  };
}
