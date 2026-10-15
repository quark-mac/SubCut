import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ordered, timeLabel, type Entry, type Project } from './api';

interface Props {
  project: Project;
  selected: string | null;
  position: number;
  busy: boolean;
  onChoose: (entry: Entry) => void;
  onSeek: (milliseconds: number) => void;
}

const labelWidth = 150;
const speakerLabel = (label: string) => label === '?' ? '未标注 ?' : label === 'NONSPEECH' ? '非对白 NONSPEECH' : label;

export function SourceTimeline({ project, selected, position, busy, onChoose, onSeek }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointer: number; start: number } | null>(null);
  const zoomAnchor = useRef<number | null>(null);
  const [fitWidth, setFitWidth] = useState(1000);
  const [zoom, setZoom] = useState(0);
  const duration = project.media.duration_ms;
  const width = fitWidth * 2 ** zoom;
  // At maximum zoom a millisecond is at least one pixel, even for feature-length media.
  const maxZoom = Math.max(1, Math.ceil(Math.log2(duration / fitWidth)));

  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => setFitWidth(Math.max(100, element.clientWidth - labelWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (zoomAnchor.current !== null) {
      viewport.current!.scrollLeft = zoomAnchor.current * width - fitWidth / 2;
      zoomAnchor.current = null;
    }
  }, [width, fitWidth]);

  function changeZoom(next: number) {
    if (next === zoom) return;
    // Keep the visible center at the same source time; fitting resets to the source start.
    zoomAnchor.current = next === 0 ? 0 : (viewport.current!.scrollLeft + fitWidth / 2) / width;
    setZoom(next);
  }

  const tracks = useMemo(() => {
    const entries = ordered(project.entries);
    const speakers = [...project.speakers].sort((a, b) => a.order - b.order);
    return [
      { id: 'video', label: '🔒 视频轨', entries: [] as Entry[], color: undefined },
      { id: 'overview', label: '字幕总览', entries, color: undefined },
      ...speakers.map(s => ({ id: s.id, label: speakerLabel(s.label), color: s.color, entries: entries.filter(e => e.speaker_id === s.id) })),
    ].map(track => {
      const ends: number[] = [];
      const blocks = track.entries.map(entry => {
        const start = Math.min(entry.start_ms / duration * width, width - 4);
        // Very short adjacent entries must remain separately hittable at overview zoom, too.
        const end = Math.max(entry.end_ms / duration * width, start + 4);
        let lane = ends.findIndex(end => end <= start);
        if (lane < 0) lane = ends.length;
        ends[lane] = end;
        return { entry, lane, left: start, width: end - start };
      });
      return { ...track, blocks, height: Math.max(46, ends.length * 35 + 8) };
    });
  }, [project.entries, project.speakers, duration, width]);

  const colors = useMemo(() => new Map(project.speakers.map(s => [s.id, s.color])), [project.speakers]);
  const tickStep = useMemo(() => {
    const target = duration / width * 110;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, target)));
    return [1, 2, 5, 10].map(n => n * magnitude).find(n => n >= target)!;
  }, [duration, width]);
  // Render ruler labels only around the visible range, including while horizontally scrolling.
  const [scrollLeft, setScrollLeft] = useState(0);
  const firstTick = Math.max(0, Math.floor(scrollLeft / width * duration / tickStep));
  const lastTick = Math.min(Math.floor(duration / tickStep), Math.ceil((scrollLeft + fitWidth) / width * duration / tickStep));
  const ticks = Array.from({ length: Math.max(0, lastTick - firstTick + 1) }, (_, i) => (firstTick + i) * tickStep);

  function seekPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(duration, Math.round((event.clientX - rect.left) / rect.width * duration))));
  }

  function finish(cancel: boolean) {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    if (cancel) onSeek(current.start);
    if (ruler.current?.hasPointerCapture(current.pointer)) ruler.current.releasePointerCapture(current.pointer);
  }

  return <>
    <div className="timeline-navigation">
      <label>缩放 <input aria-label="时间轴缩放" type="range" min="0" max={maxZoom} step="1" value={zoom}
        onChange={event => changeZoom(Number(event.target.value))} /></label>
      <output aria-label="缩放倍率">{2 ** zoom}×</output>
      <button onClick={() => changeZoom(0)}>适合全片</button>
      <span>拖动刻度或播放头定位 · 滚动查看轨道 · Shift+滚轮横移</span>
    </div>
    <div className="tracks" ref={viewport} role="region" aria-label="时间轴轨道滚动区" tabIndex={0}
      onScroll={event => setScrollLeft(event.currentTarget.scrollLeft)}>
      <div className="timeline-content" style={{ width: width + labelWidth }}>
        <div className="ruler-row">
          <div className="ruler-label">原片时间</div>
          <div className="ruler" ref={ruler} aria-label="原片时间刻度" tabIndex={-1}
            onPointerDown={event => {
              if (busy || event.button !== 0 || gesture.current) return;
              event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
              gesture.current = { pointer: event.pointerId, start: position };
              event.currentTarget.setPointerCapture(event.pointerId); seekPointer(event);
            }}
            onPointerMove={event => { if (gesture.current?.pointer === event.pointerId) seekPointer(event); }}
            onPointerUp={event => { if (gesture.current?.pointer === event.pointerId) { seekPointer(event); finish(false); } }}
            onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}
            onKeyDown={event => {
              if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); finish(true); }
            }}>
            {ticks.filter(ms => ms < duration).map(ms => <span key={ms} className="tick" style={{ left: `${ms / duration * 100}%` }}>{timeLabel(ms)}</span>)}
            <span className="tick end-tick">{timeLabel(duration)}</span>
            <button className="playhead-handle" aria-label="拖动播放头" title={timeLabel(position)}
              style={{ left: `${position / duration * 100}%` }} disabled={busy}>▼</button>
          </div>
        </div>
        {tracks.map(track => <div className="track" key={track.id}>
          <div className="track-label" style={{ color: track.color }}>{track.label}</div>
          <div className={`track-body ${track.id === 'video' ? 'locked' : ''}`} style={{ height: track.height }}>
            {track.id === 'video' && <span>原片 · {timeLabel(duration)} · 锁定</span>}
            {track.blocks.map(({ entry, lane, left, width }) => <button key={entry.id} disabled={busy}
              className={`clip ${selected === entry.id ? 'selected' : ''} ${entry.start_ms <= position && entry.end_ms > position ? 'active' : ''}`}
              aria-pressed={selected === entry.id} aria-label={`${track.label}：${entry.text}`} title={`${timeLabel(entry.start_ms)} → ${timeLabel(entry.end_ms)}\n${entry.text}`}
              onClick={() => onChoose(entry)} style={{ left, width, top: lane * 35 + 4, backgroundColor: colors.get(entry.speaker_id) }}><span>{entry.text}</span></button>)}
            <div className="playhead" style={{ left: `${position / duration * 100}%` }} />
          </div>
        </div>)}
      </div>
    </div>
  </>;
}
