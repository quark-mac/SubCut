import { useEffect, useRef, useState } from 'react';
import { api, type Project } from './api';

interface PreviewTask {
  id: string; project_id: string; state: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number; cached: boolean; artifact_id: string | null; error: { message: string } | null;
}
interface Playback {
  project_id: string; url: string; preview: { id: string; path: string } | null; task: PreviewTask | null;
  source: { format_name: string; video_codec: string; audio_codec: string | null; suggest_preview: boolean; start_time_ms: number };
}

export function usePreviewCopy(project: Project | null) {
  const [quality, setQuality] = useState('standard');
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [task, setTask] = useState<PreviewTask | null>(null);
  const [error, setError] = useState('');
  const [decoding, setDecoding] = useState('等待浏览器解码');
  const [submitting, setSubmitting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const epoch = useRef(0);
  const id = project?.id, path = project?.media.path;
  const playbackKey = `${id}:${path}:${quality}`;
  const currentId = useRef(id); currentId.current = id;

  useEffect(() => {
    const session = ++epoch.current;
    setTask(null); setError(''); setSubmitting(false);
    if (!id) return;
    void api<Playback>(`/projects/${id}/playback?quality=${quality}`).then(value => {
      if (session === epoch.current) { setPlayback(value); setLoadedKey(`${id}:${path}:${quality}`); setTask(value.task); }
    }).catch(reason => { if (session === epoch.current) { setPlayback(null); setError(String(reason)); } });
    return () => { epoch.current++; };
  }, [id, path, quality, refresh]);

  const loaded = playback?.project_id === id && loadedKey === playbackKey ? playback : null;
  const url = loaded ? loaded.url : id ? `/api/projects/${id}/media` : undefined;
  const src = url ? `${url}?identity=${project?.media.identity ?? ''}&path=${encodeURIComponent(path ?? '')}` : undefined;
  useEffect(() => { setDecoding('等待浏览器解码'); }, [src]);

  useEffect(() => {
    if (!task || task.project_id !== id || !['queued', 'running'].includes(task.state)) return;
    let active = true;
    const timer = setTimeout(() => {
      void api<PreviewTask>(`/projects/${id}/tasks/${task.id}`).then(next => {
        if (!active) return;
        setTask(next); setError('');
        if (next.state === 'succeeded') setRefresh(value => value + 1);
      }).catch(reason => { if (active) setError(`任务查询失败：${String(reason)}；可刷新重试`); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [id, task]);

  async function generate(before: () => Promise<boolean>) {
    const session = epoch.current, owner = id;
    if (!owner) return;
    setSubmitting(true); setError('');
    try {
      if (!await before() || currentId.current !== owner || session !== epoch.current) return;
      const next = await api<PreviewTask>(`/projects/${owner}/preview`, 'POST', { quality });
      if (session !== epoch.current || currentId.current !== owner) return;
      setTask(next);
      if (next.state === 'succeeded') setRefresh(value => value + 1);
    } catch (reason) { if (session === epoch.current) setError(String(reason)); }
    finally { if (session === epoch.current) setSubmitting(false); }
  }

  function decoded(video: HTMLVideoElement) {
    setDecoding(video.videoWidth > 0 ? '浏览器已解码画面' : '浏览器视频解码失败（仅识别到音轨），请生成预览副本');
  }
  return { quality, setQuality, playback: loaded, task: task?.project_id === id ? task : null, error, decoding, src, generate, decoded,
    failed: () => setDecoding('浏览器解码失败或媒体读取失败，请生成预览副本或检查原片'),
    refresh: () => setRefresh(value => value + 1),
    resourceVersion: `${id}:${playback?.preview?.id ?? ''}:${refresh}`,
    busy: submitting || !!task && ['queued', 'running'].includes(task.state) };
}

export type PreviewCopy = ReturnType<typeof usePreviewCopy>;
