import type { Entry, Project } from './api';

// One invalid target rejects the whole translation, preserving relative track spacing.
export function offsetSpeakers(entries: Entry[], speakers: Project['speakers'], offset: number): Entry[] | null {
  const tracks = [...speakers].sort((a, b) => a.order - b.order);
  const targets = entries.map(e => tracks[tracks.findIndex(s => s.id === e.speaker_id) + offset]);
  if (targets.some(s => !s)) return null;
  return entries.map((e, i) => ({ ...e, speaker_id: targets[i].id }));
}
