import type { ImportPreview, Project, Speaker } from './api';
import { nextSpeakerColor } from './speakerColors';

export interface SpeakerDraft { id: string | null; label: string; color: string }
export const specialSpeaker = (label: string) => label === '?' || label === 'NONSPEECH';
const orderedSpeakers = (speakers: Speaker[]) => speakers.map((s, order) => ({ ...s, order }));

export function speakerDraftError(project: Project, draft: SpeakerDraft): string {
  if (project.speakers.some(s => s.id === draft.id && s.locked)) return '该轨道已锁定，请先解锁';
  const label = draft.label.trim();
  if (!label) return '说话人名称不能为空';
  return project.speakers.some(s => s.id !== draft.id && s.label === label) ? '名称已存在，请使用“合并说话人”操作' : '';
}

// Identity is allocated by the caller once, so history reuses the same result.
export function saveSpeaker(project: Project, speaker: Pick<Speaker, 'id' | 'label' | 'color'>): Project {
  if (project.speakers.some(s => s.id === speaker.id && s.locked)) return project;
  const existing = project.speakers.some(s => s.id === speaker.id);
  const speakers = existing ? project.speakers.map(s => s.id === speaker.id ? { ...s, ...speaker } : s)
    : [...project.speakers.slice(0, -2), { ...speaker, order: 0, visible: true, locked: false }, ...project.speakers.slice(-2)];
  return { ...project, speakers: orderedSpeakers(speakers) };
}

export function resolveSpeaker(project: Project, label: string, newId: string) {
  const existing = project.speakers.find(s => s.label === label);
  if (existing) return { project, speaker: existing };
  const speaker = { id: newId, label, color: nextSpeakerColor(project.speakers.map(s => s.color)) };
  return { project: saveSpeaker(project, speaker), speaker };
}

export function reorderSpeaker(project: Project, source: string, target: string): Project | null {
  if (source === target) return null;
  const ordinary = project.speakers.filter(s => !specialSpeaker(s.label));
  const from = ordinary.findIndex(s => s.id === source), to = ordinary.findIndex(s => s.id === target);
  if (from < 0 || to < 0) return null;
  if (ordinary.slice(Math.min(from, to), Math.max(from, to) + 1).some(s => s.locked)) return null;
  ordinary.splice(to, 0, ordinary.splice(from, 1)[0]);
  return { ...project, speakers: orderedSpeakers([...ordinary, ...project.speakers.slice(-2)]) };
}

export function mergeSpeaker(project: Project, source: string, target: string): Project | null {
  const from = project.speakers.find(s => s.id === source), to = project.speakers.find(s => s.id === target);
  if (source === target || !from || !to || from.locked || to.locked || from.visible === false || to.visible === false || specialSpeaker(from.label) || specialSpeaker(to.label)) return null;
  return transferSpeaker(project, source, target);
}

export function removeSpeaker(project: Project, source: string): Project | null {
  const speaker = project.speakers.find(s => s.id === source);
  const unknown = project.speakers.find(s => s.label === '?');
  if (!speaker || speaker.locked || speaker.visible === false || specialSpeaker(speaker.label) || !unknown || unknown.locked || unknown.visible === false) return null;
  return transferSpeaker(project, source, unknown.id);
}

function transferSpeaker(project: Project, source: string, target: string): Project {
  return { ...project, speakers: orderedSpeakers(project.speakers.filter(s => s.id !== source)),
    entries: project.entries.map(e => e.speaker_id === source ? { ...e, speaker_id: target } : e) };
}

export function deleteTrack(project: Project, source: string): Project | null {
  const speaker = project.speakers.find(s => s.id === source);
  if (!speaker || speaker.locked || specialSpeaker(speaker.label)) return null;
  return { ...project, speakers: orderedSpeakers(project.speakers.filter(s => s.id !== source)),
    entries: project.entries.filter(e => e.speaker_id !== source) };
}

export function replaceSubtitles(project: Project, preview: ImportPreview): Project {
  if (project.speakers.some(s => s.locked)) return project;
  const remap = new Map(preview.speakers.map(s => [s.id, project.speakers.find(old => old.label === s.label)]));
  const occupied = [...remap.values()].filter((s): s is Speaker => !!s).map(s => s.color);
  const speakers = preview.speakers.map(s => {
    const old = remap.get(s.id);
    const color = old?.color ?? nextSpeakerColor(occupied);
    occupied.push(color);
    return { ...s, id: old?.id ?? s.id, color, visible: old?.visible ?? true };
  });
  const entries = preview.entries.map(e => ({ ...e, speaker_id: remap.get(e.speaker_id)?.id ?? e.speaker_id }));
  return { ...project, entries, speakers, subtitle_sources: preview.subtitle_sources };
}
