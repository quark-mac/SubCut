import type { Project, Speaker } from './api';

export function bySubtitleCount(project: Project): string[] {
  if (project.speakers.some(s => s.locked)) return [...project.speakers].sort((a, b) => a.order - b.order).map(s => s.id);
  const counts = new Map<string, number>();
  for (const entry of project.entries) counts.set(entry.speaker_id, (counts.get(entry.speaker_id) ?? 0) + 1);
  const speakers = [...project.speakers].sort((a, b) => a.order - b.order);
  return [...speakers.filter(s => s.label !== '?' && s.label !== 'NONSPEECH')
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)),
  ...speakers.filter(s => s.label === '?' || s.label === 'NONSPEECH')].map(s => s.id);
}

export function visibleSpeakers(speakers: Speaker[], order: string[]): Speaker[] {
  const index = new Map(order.map((id, i) => [id, i]));
  return [...speakers].sort((a, b) => {
    const special = (s: Speaker) => s.label === '?' ? 1 : s.label === 'NONSPEECH' ? 2 : 0;
    return special(a) - special(b) || (index.get(a.id) ?? Infinity) - (index.get(b.id) ?? Infinity) || a.order - b.order;
  }).map((s, i) => ({ ...s, order: i }));
}
