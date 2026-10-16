import { useState } from 'react';
import { type Project } from './api';
import { useMediaTask, type MediaTask } from './useMediaTask';

interface Evidence {
  project_id: string; artifact: { id: string } | null; url: string | null; task: MediaTask | null;
}

export function useTimelineMedia(project: Project | null, kind: 'waveform' | 'thumbnails') {
  const [density, setDensity] = useState('standard');
  const id = project?.id;
  const key = `${id}:${project?.media.identity}:${project?.media.path}:${kind}:${density}`;
  const lifecycle = useMediaTask<Evidence>(key, id, `/projects/${id}/timeline-media/${kind}?density=${density}`,
    `/projects/${id}/timeline-media/${kind}`, { density });
  const loaded = lifecycle.snapshot;
  return { density, setDensity, task: lifecycle.task, error: lifecycle.error, generate: lifecycle.generate,
    url: loaded?.url ?? null, version: `${lifecycle.version}:${loaded?.artifact?.id ?? ''}`,
    refresh: lifecycle.refresh, busy: lifecycle.busy };
}

export type TimelineMedia = ReturnType<typeof useTimelineMedia>;
