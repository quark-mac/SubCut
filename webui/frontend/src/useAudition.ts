import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Project } from './api';

// Audition identity is independent of editing selection. Bounds follow committed edits.
export function useAudition(video: RefObject<HTMLVideoElement | null>, project: Project | null, playing: boolean, position: (ms: number) => void, report: (message: string) => void) {
  const [range, setRange] = useState<{ id: string; loop: boolean } | null>(null);
  const latest = useRef({ project, range });
  latest.current = { project, range };
  const [speed, setSpeed] = useState(1);

  function cancel(pause = false) {
    latest.current.range = null; setRange(null);
    if (pause) video.current?.pause();
  }
  async function play() {
    try { await video.current?.play(); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) report('浏览器无法播放此视频，请使用兼容的 H.264/AAC MP4 原片'); }
  }
  function start(id: string, loop: boolean, snapshot: Project) {
    const entry = snapshot.entries.find(e => e.id === id);
    if (!entry || !video.current) return;
    latest.current = { project: snapshot, range: { id, loop } }; setRange({ id, loop });
    video.current.currentTime = entry.start_ms / 1000; position(entry.start_ms);
    void play();
  }
  function sync() {
    const media = video.current;
    if (!media) return;
    const { project, range } = latest.current;
    const entry = range && project?.entries.find(e => e.id === range.id);
    if (range && !entry) cancel(true);
    if (entry && range && !media.seeking && (media.currentTime * 1000 >= entry.end_ms || media.currentTime * 1000 < entry.start_ms)) {
      if (range.loop && (!media.paused || media.ended)) {
        media.currentTime = entry.start_ms / 1000;
        if (media.paused) void play();
      } else {
        media.pause(); media.currentTime = entry.end_ms / 1000; cancel();
      }
    }
    position(Math.round(media.currentTime * 1000));
  }
  const tick = useRef(sync); tick.current = sync;
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const update = () => { tick.current(); frame = requestAnimationFrame(update); };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => { if (video.current) video.current.playbackRate = speed; }, [speed, project?.id, video]);
  return { range, start, cancel, sync, play, speed, setSpeed };
}
