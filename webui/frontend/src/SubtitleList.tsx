import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { timeLabel, type Entry, type Speaker } from './api';

interface Props {
  entries: Entry[];
  speakers: Speaker[];
  selected: Set<string>;
  active: Set<string>;
  search: string;
  speakerFilter: string;
  busy: boolean;
  onChoose: (entry: Entry, modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onListen: (entry: Entry) => void;
}

const rowHeight = 108;
export function SubtitleList({ entries, speakers, selected, active, search, speakerFilter, busy, onChoose, onListen }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(300);
  const byId = useMemo(() => new Map(speakers.map(s => [s.id, s])), [speakers]);
  const filtered = useMemo(() => {
    const query = search.toLocaleLowerCase();
    return entries.map((entry, index) => ({ entry, index })).filter(({ entry }) =>
      entry.text.toLocaleLowerCase().includes(query) && (!byId.has(speakerFilter) || entry.speaker_id === speakerFilter));
  }, [entries, search, speakerFilter, byId]);
  // Small lists retain natural multiline height; long lists show a two-line preview.
  const virtual = filtered.length > 100;
  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => setHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { viewport.current!.scrollTop = 0; setScroll(0); }, [search, speakerFilter]);
  useLayoutEffect(() => {
    if (!virtual || selected.size !== 1) return;
    const index = filtered.findIndex(({ entry }) => selected.has(entry.id));
    if (index < 0) return;
    const element = viewport.current!;
    if (index * rowHeight < element.scrollTop || (index + 1) * rowHeight > element.scrollTop + element.clientHeight) {
      element.scrollTop = index * rowHeight;
      setScroll(element.scrollTop);
    }
  }, [selected, filtered, virtual]);
  const first = virtual ? Math.max(0, Math.floor(scroll / rowHeight) - 3) : 0;
  const last = virtual ? Math.min(filtered.length, Math.ceil((scroll + height) / rowHeight) + 3) : filtered.length;
  return <div className="subtitle-list" aria-label="字幕列表" ref={viewport} onScroll={event => setScroll(event.currentTarget.scrollTop)}>
    <div className={virtual ? 'virtual-subtitles' : undefined} style={virtual ? { height: filtered.length * rowHeight } : undefined}>
      {filtered.slice(first, last).map(({ entry, index }, offset) => {
        const speaker = byId.get(entry.speaker_id);
        const label = speaker?.label === '?' ? '未标注 ?' : speaker?.label === 'NONSPEECH' ? '非对白 NONSPEECH' : speaker?.label;
        return <button key={entry.id} aria-label={`列表字幕 ${index + 1}`} disabled={busy}
          title={virtual ? entry.text : undefined} style={virtual ? { position: 'absolute', top: (first + offset) * rowHeight, height: rowHeight - 6 } : undefined}
          className={`subtitle-row ${selected.has(entry.id) ? 'selected' : ''} ${active.has(entry.id) ? 'active' : ''}`}
          aria-pressed={selected.has(entry.id)} onClick={event => onChoose(entry, event)} onDoubleClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) onListen(entry); }}>
          <span className="row-time">{index + 1} · {timeLabel(entry.start_ms)} → {timeLabel(entry.end_ms)}</span>
          <span className="row-text">{entry.text}</span>
          <span className="speaker-label" style={{ color: speaker?.color }}>{label}</span>
        </button>;
      })}
    </div>
    {!entries.length && <p className="muted">导入后在此选择字幕进行校对</p>}
    {!!entries.length && !filtered.length && <p className="muted">没有匹配字幕</p>}
  </div>;
}
