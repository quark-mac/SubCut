import type { ImportPreview, Project, Speaker } from './api';

export interface SpeakerDraft { id: string | null; label: string; color: string }
export const specialSpeaker = (label: string) => label === '?' || label === 'NONSPEECH';
const orderedSpeakers = (speakers: Speaker[]) => speakers.map((s, order) => ({ ...s, order }));

export function speakerDraftError(project: Project, draft: SpeakerDraft): string {
  const label = draft.label.trim();
  if (!label) return '说话人名称不能为空';
  return project.speakers.some(s => s.id !== draft.id && s.label === label) ? '名称已存在，请使用“合并说话人”操作' : '';
}

// Identity is allocated by the caller once, so history reuses the same result.
export function saveSpeaker(project: Project, speaker: Pick<Speaker, 'id' | 'label' | 'color'>): Project {
  const existing = project.speakers.some(s => s.id === speaker.id);
  const speakers = existing ? project.speakers.map(s => s.id === speaker.id ? { ...s, ...speaker } : s)
    : [...project.speakers.slice(0, -2), { ...speaker, order: 0 }, ...project.speakers.slice(-2)];
  return { ...project, speakers: orderedSpeakers(speakers) };
}

export function resolveSpeaker(project: Project, label: string, newId: string) {
  const existing = project.speakers.find(s => s.label === label);
  if (existing) return { project, speaker: existing };
  const speaker = { id: newId, label, color: '#71a8cc' };
  return { project: saveSpeaker(project, speaker), speaker };
}

export function reorderSpeaker(project: Project, source: string, target: string): Project | null {
  if (source === target) return null;
  const ordinary = project.speakers.filter(s => !specialSpeaker(s.label));
  const from = ordinary.findIndex(s => s.id === source), to = ordinary.findIndex(s => s.id === target);
  if (from < 0 || to < 0) return null;
  ordinary.splice(to, 0, ordinary.splice(from, 1)[0]);
  return { ...project, speakers: orderedSpeakers([...ordinary, ...project.speakers.slice(-2)]) };
}

export function mergeSpeaker(project: Project, source: string, target: string): Project | null {
  const from = project.speakers.find(s => s.id === source), to = project.speakers.find(s => s.id === target);
  if (source === target || !from || !to || specialSpeaker(from.label) || specialSpeaker(to.label)) return null;
  return transferSpeaker(project, source, target);
}

export function removeSpeaker(project: Project, source: string): Project | null {
  const speaker = project.speakers.find(s => s.id === source);
  if (!speaker || specialSpeaker(speaker.label)) return null;
  return transferSpeaker(project, source, project.speakers.find(s => s.label === '?')!.id);
}

function transferSpeaker(project: Project, source: string, target: string): Project {
  return { ...project, speakers: orderedSpeakers(project.speakers.filter(s => s.id !== source)),
    entries: project.entries.map(e => e.speaker_id === source ? { ...e, speaker_id: target } : e) };
}

export function replaceSubtitles(project: Project, preview: ImportPreview): Project {
  const remap = new Map(preview.speakers.map(s => [s.id, project.speakers.find(old => old.label === s.label)]));
  const speakers = preview.speakers.map(s => ({ ...s, id: remap.get(s.id)?.id ?? s.id, color: remap.get(s.id)?.color ?? s.color }));
  const entries = preview.entries.map(e => ({ ...e, speaker_id: remap.get(e.speaker_id)?.id ?? e.speaker_id }));
  return { ...project, entries, speakers, subtitle_sources: preview.subtitle_sources };
}
