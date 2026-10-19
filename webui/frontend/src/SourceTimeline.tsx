import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ordered, timeLabel, type Entry, type Project } from './api';
import { offsetSpeakers } from './selectionEditing';
import { TimelineEvidence } from './TimelineEvidence';
import { WorkspaceSplitter } from './WorkspaceSplitter';
import { ScrubPreview } from './ScrubPreview';

interface Props {
  project: Project;
  selected: Set<string>;
  position: number;
  busy: boolean;
  currentTrack: string;
  waveform: string | null;
  thumbnails: string | null;
  thumbnailVersion: string;
  speakers: Project['speakers'];
  onSort: () => void;
  onStoredOrder: () => void;
  onGenerateThumbnails: () => void;
  onGenerateWaveform: () => void;
  generatingThumbnails: boolean;
  generatingWaveform: boolean;
  onTrack: (id: string) => void;
  onChoose: (entry: Entry, modifiers?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onSeek: (milliseconds: number) => void;
  onListen: (entry: Entry) => void;
  onBeginEdit: (id: string) => Entry[] | null;
  onPreview: (entries: Entry[] | null) => void;
  onCommitEdit: (entries: Entry[]) => void;
  onBeginSelect: () => boolean;
  onSelect: (ids: Set<string>) => void;
  onEndSelect: () => void;
}

const labelWidth = 150;
const speakerLabel = (label: string) => label === '?' ? '未标注 ?' : label === 'NONSPEECH' ? '非对白 NONSPEECH' : label;

interface EditGesture {
  pointer: number;
  clientX: number;
  clientY: number;
  entry: Entry;
  entries: Entry[];
  origin: number;
  y: number;
  mode: 'move' | 'start' | 'end';
  moved: boolean;
  horizontal: boolean;
  next: Entry[];
  targets: number[];
}

export function SourceTimeline({ project, selected, position, busy, currentTrack, waveform, thumbnails, thumbnailVersion, speakers, onSort, onStoredOrder, onGenerateThumbnails, onGenerateWaveform, generatingThumbnails, generatingWaveform, onTrack, onChoose, onListen, onSeek, onBeginEdit, onPreview, onCommitEdit, onBeginSelect, onSelect, onEndSelect }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointer: number; start: number; scroll: number; clientX: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [showOverview, setShowOverview] = useState(true);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [showWaveform, setShowWaveform] = useState(false);
  const [follow, setFollow] = useState(true);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const edit = useRef<EditGesture | null>(null);
  const box = useRef<{ pointer: number; x: number; y: number; clientX: number; clientY: number; original: Set<string>; additive: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [preview, setPreview] = useState<Entry[] | null>(null);
  const previewById = new Map(preview?.map(e => [e.id, e]));
  const [snapping, setSnapping] = useState(true);
  const [snapTime, setSnapTime] = useState<number | null>(null);
  const [invalidTrack, setInvalidTrack] = useState(false);
  const suppressClick = useRef(false);
  const clickedEntry = useRef<string | null>(null);
  const zoomAnchor = useRef<{ time: number; x: number } | null>(null);
  const [fitWidth, setFitWidth] = useState(1000);
  const [viewportHeight, setViewportHeight] = useState(300);
  const [scrollTop, setScrollTop] = useState(0);
  const [zoom, setZoom] = useState(0);
  const duration = project.media.duration_ms;
  const width = fitWidth * 2 ** zoom;
  // At maximum zoom a millisecond is at least one pixel, even for feature-length media.
  const maxZoom = Math.max(1, Math.ceil(Math.log2(duration / fitWidth)));

  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => { setFitWidth(Math.max(100, element.clientWidth - labelWidth)); setViewportHeight(element.clientHeight); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // Edge can interpret a horizontal wheel at the left boundary as browser
    // Back even with CSS overscroll containment. Own horizontal timeline pan.
    const pan = (event: WheelEvent) => {
      if (event.ctrlKey || (!event.deltaX && !event.shiftKey)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1;
      element.scrollLeft += (event.deltaX || event.deltaY) * unit;
      if (event.deltaX && !event.shiftKey) element.scrollTop += event.deltaY * (event.deltaMode === 2 ? element.clientHeight : unit);
    };
    element.addEventListener('wheel', pan, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', pan); };
  }, []);

  useLayoutEffect(() => {
    if (zoomAnchor.current !== null) {
      viewport.current!.scrollLeft = zoomAnchor.current.time * width - zoomAnchor.current.x;
      zoomAnchor.current = null;
    }
  }, [width, fitWidth]);

  function changeZoom(next: number) {
    if (next === zoom) return;
    // Keep the visible center at the same source time; fitting resets to the source start.
    const x = position / duration * width - viewport.current!.scrollLeft;
    zoomAnchor.current = next === 0 ? { time: 0, x: 0 } : x >= 0 && x <= fitWidth
      ? { time: position / duration, x } : { time: position / duration, x: fitWidth / 2 };
    setZoom(Math.max(0, Math.min(maxZoom, next)));
  }

  function focusThirtySeconds() {
    const next = Math.max(0, Math.min(maxZoom, Math.log2(duration / 30000)));
    if (next === zoom) viewport.current!.scrollLeft = Math.max(0, position / duration * width - fitWidth / 2);
    else {
      zoomAnchor.current = { time: position / duration, x: fitWidth / 2 };
      setZoom(next);
    }
  }

  useLayoutEffect(() => {
    if (!follow || gesture.current || edit.current || box.current) return;
    const element = viewport.current!;
    const x = position / duration * width;
    if (x < element.scrollLeft + 16 || x > element.scrollLeft + fitWidth - 16) element.scrollLeft = Math.max(0, x - fitWidth * .25);
  }, [position, follow, fitWidth]);

  useEffect(() => {
    if (!scrubbing) return;
    let frame = 0, previous = 0;
    const advance = (now: number) => {
      const current = gesture.current, element = viewport.current;
      if (!current || !element) return;
      const rect = element.getBoundingClientRect(), left = rect.left + labelWidth, right = rect.left + element.clientWidth;
      const edge = current.clientX < left + 36 ? -Math.min(1, (left + 36 - current.clientX) / 36)
        : current.clientX > right - 36 ? Math.min(1, (current.clientX - right + 36) / 36) : 0;
      if (edge) {
        element.scrollLeft += edge * Math.min(32, previous ? now - previous : 16) * .8;
        seekAt(current.clientX);
      }
      previous = now; frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [scrubbing, width, duration]);

  // Preview overlays never relayout rows under the pointer; commit recalculates overlap lanes.
  const tracks = useMemo(() => {
    const entries = ordered(project.entries);
    return [
      { id: 'video', label: '🔒 视频轨', entries: [] as Entry[], color: undefined },
      ...(showWaveform ? [{ id: 'waveform', label: '音频波形', entries: [] as Entry[], color: undefined }] : []),
      ...(showOverview ? [{ id: 'overview', label: '字幕总览', entries, color: undefined }] : []),
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
      const minimum = track.id === 'video' || track.id === 'waveform' ? 48 : Math.max(46, ends.length * 35 + 8);
      const height = Math.max(minimum, heights[track.id] ?? (track.id === 'video' ? 80 : track.id === 'waveform' ? 100 : minimum));
      return { ...track, blocks, minimum, height, laneHeight: (height - 8) / Math.max(1, ends.length) };
    });
  }, [project.entries, speakers, duration, width, showWaveform, showOverview, heights]);

  const colors = useMemo(() => new Map(project.speakers.map(s => [s.id, s.color])), [project.speakers]);
  const tickStep = useMemo(() => {
    const target = duration / width * 110;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, target)));
    return [1, 2, 5, 10].map(n => n * magnitude).find(n => n >= target)!;
  }, [duration, width]);
  // Render ruler labels only around the visible range, including while horizontally scrolling.
  const [scrollLeft, setScrollLeft] = useState(0);
  // Layout includes every entry (minimum hit width and overlap lanes), but DOM only
  // includes blocks intersecting the viewport. Playback doesn't repeat this scan.
  const renderedTracks = useMemo(() => {
    let top = 30;
    return tracks.map(track => {
      const trackTop = top; top += track.height + 1;
      const blocks = [...track.blocks.filter(b => !previewById.has(b.entry.id) || track.id === 'overview' || track.id === previewById.get(b.entry.id)!.speaker_id),
        ...(preview ?? []).filter(e => track.id === e.speaker_id && !track.blocks.some(b => b.entry.id === e.id))
          .map((entry, lane) => ({ entry, lane, left: Math.min(entry.start_ms / duration * width, width - 4), width: Math.max(4, (entry.end_ms - entry.start_ms) / duration * width) })),
      ].filter(block => {
        if (project.entries.length <= 100) return true;
        const entry = previewById.get(block.entry.id) ?? block.entry;
        const left = Math.min(entry.start_ms / duration * width, width - 4);
        const right = Math.max(entry.end_ms / duration * width, left + 4);
        const y = trackTop + block.lane * track.laneHeight + 4;
        return left <= scrollLeft + fitWidth + 100 && right >= scrollLeft - 100 &&
          y <= scrollTop + viewportHeight + track.laneHeight && y + track.laneHeight - 7 >= scrollTop - track.laneHeight;
      });
      return { ...track, blocks };
    });
  }, [tracks, preview, duration, width, scrollLeft, fitWidth, scrollTop, viewportHeight]);
  const firstTick = Math.max(0, Math.floor(scrollLeft / width * duration / tickStep));
  const lastTick = Math.min(Math.floor(duration / tickStep), Math.ceil((scrollLeft + fitWidth) / width * duration / tickStep));
  const ticks = Array.from({ length: Math.max(0, lastTick - firstTick + 1) }, (_, i) => (firstTick + i) * tickStep);

  function seekAt(clientX: number) {
    const bounds = viewport.current!.getBoundingClientRect();
    const rect = ruler.current!.getBoundingClientRect();
    const x = Math.max(bounds.left + labelWidth, Math.min(bounds.left + viewport.current!.clientWidth, clientX));
    onSeek(Math.max(0, Math.min(duration, Math.round((x - rect.left) / rect.width * duration))));
  }

  function seekPointer(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current) gesture.current.clientX = event.clientX;
    seekAt(event.clientX);
  }

  function finish(cancel: boolean) {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    setScrubbing(false);
    if (cancel) { onSeek(current.start); viewport.current!.scrollLeft = current.scroll; }
    if (ruler.current?.hasPointerCapture(current.pointer)) ruler.current.releasePointerCapture(current.pointer);
  }

  function pointerTime(clientX: number) {
    const rect = ruler.current!.getBoundingClientRect();
    return (clientX - rect.left) / rect.width * duration;
  }

  function beginEdit(event: PointerEvent<HTMLButtonElement>, entry: Entry) {
    if (busy || event.button !== 0 || edit.current || gesture.current) return;
    event.preventDefault();
    suppressClick.current = true;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      onChoose(entry, event);
      viewport.current!.focus({ preventScroll: true });
      return;
    }
    const originals = onBeginEdit(entry.id);
    const original = originals?.find(e => e.id === entry.id);
    if (!originals || !original) return;
    viewport.current!.focus({ preventScroll: true });
    const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-edge]')?.dataset.edge;
    edit.current = { pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      entry: original, entries: originals, next: originals, origin: pointerTime(event.clientX), y: event.clientY,
      mode: edge === 'start' || edge === 'end' ? edge : 'move', moved: false, horizontal: false,
      targets: [...new Set([position, ...project.entries.filter(e => !originals.some(item => item.id === e.id)).flatMap(e => [e.start_ms, e.end_ms])])] };
    viewport.current!.setPointerCapture(event.pointerId);
  }

  function moveEdit(event: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>) {
    const current = edit.current;
    if (!current || current.pointer !== event.pointerId) return;
    current.clientX = event.clientX; current.clientY = event.clientY;
    const rawDelta = pointerTime(event.clientX) - current.origin;
    // Activate each horizontal edit past click slop, then allow returning to any integer ms.
    // A purely vertical gesture never snaps its existing timing to a nearby boundary.
    if (Math.abs(rawDelta) * width / duration >= 3) current.horizontal = true;
    let delta = current.horizontal ? Math.round(rawDelta) : 0;
    if (!current.moved && delta === 0 && Math.abs(event.clientY - current.y) < 3) return;
    current.moved = true;
    const min = Math.max(...current.entries.map(e => current.mode === 'end' ? e.start_ms + 1 - e.end_ms : -e.start_ms));
    const max = Math.min(...current.entries.map(e => current.mode === 'start' ? e.end_ms - 1 - e.start_ms : duration - e.end_ms));
    let snapped: number | null = null;
    if (snapping && current.horizontal) {
      const edges = current.entries.flatMap(e => current.mode === 'start' ? [e.start_ms] : current.mode === 'end' ? [e.end_ms] : [e.start_ms, e.end_ms]);
      let distance = Infinity, correction = 0;
      for (const target of current.targets) for (const edge of edges) {
        const offset = target - (edge + delta);
        if (Math.abs(offset) * width / duration <= 8 && Math.abs(offset) < distance && delta + offset >= min && delta + offset <= max) {
          distance = Math.abs(offset); correction = offset; snapped = target;
        }
      }
      delta += correction;
    }
    setSnapTime(snapped);
    const shift = Math.max(min, Math.min(max, delta));
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-speaker-id]')?.dataset.speakerId;
    const speaker = project.speakers.find(s => s.id === target);
    current.next = current.entries.map(e => current.mode === 'start'
      ? { ...e, start_ms: e.start_ms + shift }
      : current.mode === 'end'
        ? { ...e, end_ms: e.end_ms + shift }
        : { ...e, start_ms: e.start_ms + shift, end_ms: e.end_ms + shift,
          speaker_id: current.entries.length === 1 ? speaker?.id ?? e.speaker_id : e.speaker_id });
    let rejected = false;
    if (current.mode === 'move' && speaker && current.entries.length > 1) {
      const tracks = speakers;
      const offset = tracks.findIndex(s => s.id === speaker.id) - tracks.findIndex(s => s.id === current.entry.speaker_id);
      const shifted = offsetSpeakers(current.next, tracks, offset);
      rejected = !shifted;
      current.next = shifted ?? current.entries;
    }
    setInvalidTrack(rejected);
    if (rejected) setSnapTime(null);
    setPreview(current.next); onPreview(current.next);
  }

  function finishEdit(cancel: boolean) {
    const current = edit.current;
    if (!current) return;
    edit.current = null;
    clickedEntry.current = !cancel && !current.moved ? current.entry.id : null;
    if (!cancel && current.moved) onCommitEdit(current.next);
    setPreview(null); setSnapTime(null); setInvalidTrack(false); onPreview(null);
    if (!cancel && !current.moved) onChoose(current.entry);
    if (viewport.current?.hasPointerCapture(current.pointer)) viewport.current.releasePointerCapture(current.pointer);
  }

  function contentPoint(clientX: number, clientY: number) {
    const element = viewport.current!;
    const rect = element.getBoundingClientRect();
    return { x: clientX - rect.left + element.scrollLeft, y: clientY - rect.top + element.scrollTop };
  }

  function beginBox(event: PointerEvent<HTMLDivElement>) {
    if (busy || event.button !== 0 || edit.current || gesture.current || box.current ||
      !(event.target as HTMLElement).closest('.track-body:not(.locked)') || (event.target as HTMLElement).closest('.clip')) return;
    if (!onBeginSelect()) return;
    event.preventDefault();
    viewport.current!.focus({ preventScroll: true });
    const point = contentPoint(event.clientX, event.clientY);
    box.current = { pointer: event.pointerId, ...point, clientX: event.clientX, clientY: event.clientY,
      original: new Set(selected), additive: event.ctrlKey || event.metaKey || event.shiftKey };
    suppressClick.current = true;
    viewport.current!.setPointerCapture(event.pointerId);
    moveBox(event);
  }

  function moveBox(event: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>) {
    const current = box.current;
    if (!current || current.pointer !== event.pointerId) return;
    current.clientX = event.clientX; current.clientY = event.clientY;
    const point = contentPoint(event.clientX, event.clientY);
    const left = Math.min(current.x, point.x), top = Math.min(current.y, point.y);
    const right = Math.max(current.x, point.x), bottom = Math.max(current.y, point.y);
    setMarquee({ left, top, width: right - left, height: bottom - top });
    const ids = new Set(current.additive ? current.original : []);
    if (right - left >= 3 || bottom - top >= 3) {
      // Hit-test the complete layout, not mounted DOM: scrolling a marquee must
      // retain crossed entries even after their virtual blocks leave the viewport.
      let trackTop = 30;
      for (const track of tracks) {
        for (const block of track.blocks) {
          const x = labelWidth + block.left, y = trackTop + 1 + block.lane * track.laneHeight + 4;
          if (x <= right && x + block.width >= left && y <= bottom && y + track.laneHeight - 7 >= top) ids.add(block.entry.id);
        }
        trackTop += track.height + 1;
      }
    }
    onSelect(ids);
  }

  function finishBox(cancel: boolean) {
    const current = box.current;
    if (!current) return;
    box.current = null;
    if (cancel) onSelect(current.original);
    setMarquee(null); onEndSelect();
    if (viewport.current?.hasPointerCapture(current.pointer)) viewport.current.releasePointerCapture(current.pointer);
  }

  return <>
    <div className="timeline-navigation">
      <button aria-pressed={snapping} disabled={!!preview} onClick={() => setSnapping(!snapping)}
        title="吸附到播放头或其他字幕边界（8 像素内）">吸附</button>
      <button aria-label="缩小时间轴" disabled={!!preview || zoom <= 0} onClick={() => changeZoom(zoom - .125)}>−</button>
      <label>缩放 <input aria-label="时间轴缩放" type="range" min="0" max={maxZoom} step="0.125" value={zoom} disabled={!!preview}
        onChange={event => changeZoom(Number(event.target.value))} /></label>
      <button aria-label="放大时间轴" disabled={!!preview || zoom >= maxZoom} onClick={() => changeZoom(zoom + .125)}>＋</button>
      <output aria-label="缩放倍率">{Number((2 ** zoom).toFixed(2))}×</output>
      <button onClick={() => changeZoom(0)} disabled={!!preview}>适合全片</button>
      <button onClick={focusThirtySeconds} disabled={!!preview} title="以播放头为中心查看约 30 秒，适合长片逐句校对">30 秒视窗</button>
      <label><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />跟随播放头</label>
      <label><input type="checkbox" checked={showOverview} disabled={!!preview || busy} onChange={e => setShowOverview(e.target.checked)} />字幕总览</label>
      <label><input type="checkbox" checked={showThumbnails} onChange={e => setShowThumbnails(e.target.checked)} />视频缩略图</label>
      <label><input type="checkbox" checked={showWaveform} disabled={!!preview || busy} onChange={e => setShowWaveform(e.target.checked)} />音频波形</label>
      <button disabled={busy || !!preview} onClick={onSort}>按字幕数排序</button>
      <button disabled={busy || !!preview} onClick={onStoredOrder} title="恢复工程保存的人物顺序">工程轨序</button>
      {showThumbnails && !thumbnails && <button disabled={busy || generatingThumbnails} onClick={onGenerateThumbnails}>{generatingThumbnails ? '缩略图生成中…' : '生成缩略图'}</button>}
      {showWaveform && !waveform && <button disabled={busy || generatingWaveform} onClick={onGenerateWaveform}>{generatingWaveform ? '波形生成中…' : '生成波形'}</button>}
      <span>{invalidTrack ? '轨道越界 · 整次移动不执行' : preview ? `预览 ${preview.length} 条 · ${timeLabel(preview[0].start_ms)} → ${timeLabel(preview[0].end_ms)}${snapTime !== null ? ' · 已吸附' : ''} · 松开提交 / Esc 取消` : '拖动字幕或两端调整 · 空白框选 · Ctrl/Shift 多选 · 拖动刻度定位'}</span>
    </div>
    <div className="tracks" ref={viewport} role="region" aria-label="时间轴轨道滚动区" tabIndex={0}
      onPointerDown={beginBox}
      onPointerMove={event => { moveEdit(event); moveBox(event); }}
      onPointerUp={event => {
        if (edit.current?.pointer === event.pointerId) { moveEdit(event); finishEdit(false); }
        if (box.current?.pointer === event.pointerId) { moveBox(event); finishBox(false); }
      }}
      onPointerCancel={() => { finishEdit(true); finishBox(true); }} onLostPointerCapture={() => { finishEdit(true); finishBox(true); }}
      onClickCapture={event => { if (suppressClick.current) { event.stopPropagation(); suppressClick.current = false; } }}
      onDoubleClick={event => {
        // Pointer capture retargets native double-clicks to the viewport.
        const id = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId;
        const entry = project.entries.find(e => e.id === id && e.id === clickedEntry.current);
        if (entry && !busy && !event.ctrlKey && !event.metaKey && !event.shiftKey) onListen(entry);
      }}
      onKeyDown={event => {
        if (edit.current) { event.preventDefault(); event.stopPropagation(); if (event.key === 'Escape') finishEdit(true); }
        if (box.current) { event.preventDefault(); event.stopPropagation(); if (event.key === 'Escape') finishBox(true); }
      }}
      onScroll={event => {
        setScrollLeft(event.currentTarget.scrollLeft);
        setScrollTop(event.currentTarget.scrollTop);
        if (edit.current) moveEdit({ pointerId: edit.current.pointer, clientX: edit.current.clientX, clientY: edit.current.clientY });
        if (box.current) moveBox({ pointerId: box.current.pointer, clientX: box.current.clientX, clientY: box.current.clientY });
      }}>
      <div className="timeline-content" style={{ width: width + labelWidth }}>
        <div className="ruler-row">
          <div className="ruler-label">原片时间</div>
          <div className="ruler" ref={ruler} aria-label="原片时间刻度" tabIndex={-1}
            onPointerDown={event => {
              if (busy || event.button !== 0 || gesture.current) return;
              event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
               gesture.current = { pointer: event.pointerId, start: position, scroll: viewport.current!.scrollLeft, clientX: event.clientX };
               setScrubbing(true);
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
        {renderedTracks.map(track => <div className="track" key={track.id} style={{ height: track.height + 1 }}
          data-speaker-id={project.speakers.some(s => s.id === track.id) ? track.id : undefined}>
          <button className="track-label" style={{ color: track.color }} title={track.label} aria-label={`选择轨道 ${track.label}`}
            aria-pressed={currentTrack === track.id} disabled={busy || !!preview}
            onClick={() => onTrack(project.speakers.some(s => s.id === track.id) ? track.id : '')}>{track.label}</button>
          <div className={`track-body ${track.id === 'video' || track.id === 'waveform' ? 'locked' : ''}`} style={{ height: track.height }}>
            {(track.id === 'video' || track.id === 'waveform') && <TimelineEvidence waveform={track.id === 'waveform' ? waveform : null} thumbnails={track.id === 'video' && showThumbnails ? thumbnails : null}
              duration={duration} width={width} scrollLeft={scrollLeft} viewportWidth={fitWidth} height={track.height} kind={track.id} />}
            {track.blocks.map(({ entry: original, lane, left, width: blockWidth }) => {
              const entry = previewById.get(original.id) ?? original;
              const previewLeft = Math.min(entry.start_ms / duration * width, width - 4);
              const displayWidth = entry === original ? blockWidth : Math.max(4, entry.end_ms / duration * width - previewLeft);
              return <button key={entry.id} disabled={busy} data-entry-id={entry.id}
              className={`clip ${displayWidth < 12 ? 'narrow' : ''} ${selected.has(entry.id) ? 'selected' : ''} ${entry.start_ms <= position && entry.end_ms > position ? 'active' : ''}`}
              aria-pressed={selected.has(entry.id)} aria-label={`${track.label}：${entry.text}`} title={`${timeLabel(entry.start_ms)} → ${timeLabel(entry.end_ms)}\n${entry.text}`}
              onPointerDown={event => beginEdit(event, entry)} onClick={event => onChoose(entry, event)}
              style={{ left: entry === original ? left : previewLeft,
                width: displayWidth,
                top: lane * track.laneHeight + 4, height: track.laneHeight - 7, backgroundColor: colors.get(entry.speaker_id) }}>
                <span>{entry.text}</span>
                <span className="resize-handle start" data-edge="start" aria-label="开始边界" title="拖动开始边界" />
                <span className="resize-handle end" data-edge="end" aria-label="结束边界" title="拖动结束边界" />
              </button>;
            })}
            <div className="playhead" style={{ left: `${position / duration * 100}%` }} />
            {snapTime !== null && <div className="snap-guide" style={{ left: `${snapTime / duration * 100}%` }} />}
          </div>
          <div className="track-height-handle" style={{ left: scrollLeft }} title="拖动调整此轨高度 · Esc 取消">
            <WorkspaceSplitter label={`调整轨道高度 ${track.label}`} horizontal onBegin={() => {
              const original = heights;
              return { move: delta => { if (!busy && !edit.current && !box.current && !gesture.current) setHeights({ ...original, [track.id]: Math.max(track.minimum, Math.min(Math.max(320, track.minimum * 3), track.height + delta)) }); }, cancel: () => setHeights(original) };
            }} />
          </div>
        </div>)}
        {marquee && <div className="selection-marquee" aria-label="框选范围" style={marquee} />}
      </div>
    </div>
    <ScrubPreview url={thumbnails} version={thumbnailVersion} position={position} anchor={scrubbing && showThumbnails && viewport.current && ruler.current ? {
      x: viewport.current.getBoundingClientRect().left + labelWidth + position / duration * width - scrollLeft,
      y: ruler.current.getBoundingClientRect().top,
    } : null} />
  </>;
}
