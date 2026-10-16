import { useEffect, useState } from 'react';
import { type Project } from './api';
import { useMediaTask, type MediaTask } from './useMediaTask';

interface Playback {
  project_id: string; url: string; preview: { id: string; path: string } | null; task: MediaTask | null;
  source: { format_name: string; video_codec: string; audio_codec: string | null; suggest_preview: boolean; start_time_ms: number };
}

export function usePreviewCopy(project: Project | null) {
  const [quality, setQuality] = useState('standard');
  const [decoding, setDecoding] = useState('等待浏览器解码');
  const id = project?.id, path = project?.media.path;
  const key = `${id}:${project?.media.identity}:${path}:${quality}`;
  const lifecycle = useMediaTask<Playback>(key, id, `/projects/${id}/playback?quality=${quality}`, `/projects/${id}/preview`, { quality });
  const loaded = lifecycle.snapshot;
  const url = loaded ? loaded.url : id ? `/api/projects/${id}/media` : undefined;
  const src = url ? `${url}?identity=${project?.media.identity ?? ''}&path=${encodeURIComponent(path ?? '')}` : undefined;
  useEffect(() => { setDecoding('等待浏览器解码'); }, [src]);

  function decoded(video: HTMLVideoElement) {
    setDecoding(video.videoWidth > 0 ? '浏览器已解码画面' : '浏览器视频解码失败（仅识别到音轨），请生成预览副本');
  }
  return { quality, setQuality, playback: loaded, task: lifecycle.task, error: lifecycle.error, decoding, src, generate: lifecycle.generate, decoded,
    failed: () => setDecoding('浏览器解码失败或媒体读取失败，请生成预览副本或检查原片'),
    refresh: lifecycle.refresh,
    resourceVersion: `${lifecycle.version}:${loaded?.preview?.id ?? ''}`,
    busy: lifecycle.busy };
}

export type PreviewCopy = ReturnType<typeof usePreviewCopy>;
