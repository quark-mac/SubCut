import { useEffect, useRef, useState } from 'react';
import { api } from './api';

export interface MediaTask {
  id: string; project_id: string; state: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number; cached: boolean; artifact_id: string | null; error: { message: string } | null;
}

// The context key includes project, source and generation options. Refreshing only
// replaces a read; it never cancels a user's generation waiting for a saved draft.
export function useMediaTask<T extends { project_id: string; task: MediaTask | null }>(
  key: string, owner: string | undefined, readPath: string, submitPath: string, parameters: object,
) {
  const [snapshot, setSnapshot] = useState<{ key: string; value: T } | null>(null);
  const [task, setTask] = useState<MediaTask | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const epoch = useRef(0), read = useRef(0);
  const currentKey = useRef(key); currentKey.current = key;

  useEffect(() => {
    epoch.current++;
    setSnapshot(null); setTask(null); setError(''); setSubmitting(false);
    return () => { epoch.current++; read.current++; };
  }, [key]);

  useEffect(() => {
    const session = epoch.current, request = ++read.current;
    let active = true;
    if (!owner) return;
    setError('');
    void api<T>(readPath).then(value => {
      if (active && session === epoch.current && request === read.current) {
        setSnapshot({ key, value }); setTask(value.task);
      }
    }).catch(reason => {
      if (active && session === epoch.current && request === read.current) setError(String(reason));
    });
    return () => { active = false; };
  }, [key, owner, readPath, refresh]);

  useEffect(() => {
    if (!task || task.project_id !== owner || !['queued', 'running'].includes(task.state)) return;
    let active = true;
    const session = epoch.current, request = read.current;
    const timer = setTimeout(() => {
      void api<MediaTask>(`/projects/${owner}/tasks/${task.id}`).then(next => {
        if (!active || session !== epoch.current || request !== read.current) return;
        setTask(next); setError('');
        if (next.state === 'succeeded') setRefresh(value => value + 1);
      }).catch(reason => {
        if (active && session === epoch.current && request === read.current) setError(`任务查询失败：${String(reason)}；可刷新重试`);
      });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [key, owner, task]);

  async function generate(before: () => Promise<boolean>) {
    if (!owner) return;
    const session = epoch.current, capture = key;
    const active = () => session === epoch.current && currentKey.current === capture;
    setSubmitting(true); setError('');
    try {
      if (!await before() || !active()) return;
      // Invalidate reads both before sending and after acknowledging the POST:
      // neither a pre-submit GET nor a refresh during submission can replace it.
      read.current++;
      const next = await api<MediaTask>(submitPath, 'POST', parameters);
      if (!active()) return;
      read.current++;
      setTask(next);
      if (next.state === 'succeeded') setRefresh(value => value + 1);
    } catch (reason) { if (active()) setError(String(reason)); }
    finally { if (active()) setSubmitting(false); }
  }

  return { snapshot: snapshot?.key === key ? snapshot.value : null,
    task: task?.project_id === owner ? task : null, error, generate,
    refresh: () => setRefresh(value => value + 1), version: `${key}:${refresh}`,
    busy: submitting || !!task && task.project_id === owner && ['queued', 'running'].includes(task.state) };
}
