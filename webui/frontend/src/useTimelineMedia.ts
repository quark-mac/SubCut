import { useEffect, useRef, useState } from 'react';
import { api, type Project } from './api';

interface MediaTask {
  id: string; project_id: string; state: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number; cached: boolean; artifact_id: string | null; error: { message: string } | null;
}
interface Evidence {
  project_id: string; artifact: { id: string } | null; url: string | null; task: MediaTask | null;
}

export function useTimelineMedia(project: Project | null, kind: 'waveform' | 'thumbnails') {
  const [density, setDensity] = useState('standard');
  const [evidence, setEvidence] = useState<{ key: string; value: Evidence } | null>(null);
  const [task, setTask] = useState<MediaTask | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const epoch = useRef(0), read = useRef(0);
  const id = project?.id;
  const key = `${id}:${project?.media.identity}:${project?.media.path}:${kind}:${density}`;
  const currentKey = useRef(key); currentKey.current = key;

  useEffect(() => {
    const session = ++epoch.current, request = ++read.current;
    setTask(null); setError(''); setSubmitting(false); setEvidence(null);
    if (!id) return;
    void api<Evidence>(`/projects/${id}/timeline-media/${kind}?density=${density}`).then(value => {
      if (session === epoch.current && request === read.current) { setEvidence({ key, value }); setTask(value.task); }
    }).catch(reason => { if (session === epoch.current && request === read.current) setError(String(reason)); });
    return () => { epoch.current++; };
  }, [id, key, kind, density, refresh]);

  useEffect(() => {
    if (!task || task.project_id !== id || !['queued', 'running'].includes(task.state)) return;
    let active = true;
    const timer = setTimeout(() => {
      void api<MediaTask>(`/projects/${id}/tasks/${task.id}`).then(next => {
        if (!active) return;
        setTask(next); setError('');
        if (next.state === 'succeeded') setRefresh(value => value + 1);
      }).catch(reason => { if (active) setError(`任务查询失败：${String(reason)}；可刷新重试`); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [id, task]);

  async function generate(before: () => Promise<boolean>) {
    let session = epoch.current;
    const owner = id, capture = key;
    if (!owner) return;
    setSubmitting(true); setError('');
    try {
      if (!await before() || currentKey.current !== capture) return;
      // Saving can outlive the initial metadata effect or a same-project refresh.
      // Keep that generation intent; only changing its project/source/options cancels it.
      session = epoch.current;
      setSubmitting(true);
      // A GET captured before this POST is never allowed to replace its acknowledged task.
      read.current++;
      const next = await api<MediaTask>(`/projects/${owner}/timeline-media/${kind}`, 'POST', { density });
      if (session !== epoch.current || currentKey.current !== capture) return;
      setTask(next);
      if (next.state === 'succeeded') setRefresh(value => value + 1);
    } catch (reason) { if (session === epoch.current) setError(String(reason)); }
    finally { if (session === epoch.current) setSubmitting(false); }
  }

  const loaded = evidence?.key === key ? evidence.value : null;
  return { density, setDensity, task: task?.project_id === id ? task : null, error, generate,
    url: loaded?.url ?? null, version: `${key}:${loaded?.artifact?.id ?? ''}:${refresh}`,
    refresh: () => setRefresh(value => value + 1),
    busy: submitting || !!task && task.project_id === id && ['queued', 'running'].includes(task.state) };
}

export type TimelineMedia = ReturnType<typeof useTimelineMedia>;
