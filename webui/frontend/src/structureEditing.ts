import { ordered, type Entry, type Project } from './api';

// Always use the complete working set, never a filtered list or a speaker track.
export function mergeSelection(project: Project, selected: Set<string>): Entry[] | null {
  if (selected.size < 2) return null;
  const all = ordered(project.entries);
  const start = all.findIndex(e => selected.has(e.id));
  const group = all.slice(start, start + selected.size);
  return group.length === selected.size && group.every(e => selected.has(e.id)) ? group : null;
}
