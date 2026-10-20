import { ordered, visibleEntries, type Entry, type Project } from './api';

// Search filters don't change continuity; hidden tracks are excluded from editing.
export function mergeSelection(project: Project, selected: Set<string>): Entry[] | null {
  if (selected.size < 2) return null;
  const all = ordered(visibleEntries(project));
  const start = all.findIndex(e => selected.has(e.id));
  const group = all.slice(start, start + selected.size);
  return group.length === selected.size && group.every(e => selected.has(e.id)) ? group : null;
}

export function splitSubtitle(project: Project, id: string, at: number, identities: [string, string]) {
  const entry = project.entries.find(e => e.id === id);
  if (!entry || at <= entry.start_ms || at >= entry.end_ms) return null;
  const parts = [{ ...entry, id: identities[0], end_ms: at }, { ...entry, id: identities[1], start_ms: at }];
  return { project: { ...project, entries: project.entries.flatMap(e => e.id === id ? parts : [e]) }, parts };
}

export function mergeSubtitles(project: Project, ids: Set<string>, speakerId: string, identity: string) {
  const group = mergeSelection(project, ids);
  if (!group || !project.speakers.some(s => s.id === speakerId && s.visible !== false)) return null;
  const entry: Entry = {
    id: identity, start_ms: group[0].start_ms, end_ms: Math.max(...group.map(e => e.end_ms)),
    text: group.map(e => e.text).join('\n'), speaker_id: speakerId,
    tags: [...new Set(group.flatMap(e => e.tags))], sources: group.flatMap(e => e.sources),
  };
  return { project: { ...project, entries: project.entries.flatMap(e => e.id === group[0].id ? [entry] : ids.has(e.id) ? [] : [e]) }, entry };
}

export function addSubtitle(project: Project, range: { start: number; end: number }, text: string, speakerId: string, identity: string) {
  if (!text.trim() || !project.speakers.some(s => s.id === speakerId && s.visible !== false)) return null;
  const entry: Entry = { id: identity, start_ms: range.start, end_ms: range.end, text, speaker_id: speakerId, tags: [], sources: [] };
  return { project: { ...project, entries: [...project.entries, entry] }, entry };
}
