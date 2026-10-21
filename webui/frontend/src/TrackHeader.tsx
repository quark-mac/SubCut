import { useEffect, useRef, useState } from 'react';
import { IconButton } from './IconButton';

interface Props {
  id: string; label: string; color?: string; hidden: boolean; selected: boolean;
  locked: boolean; count?: number; onLock?: () => void; onManage?: () => void;
  onPreview: (value: { source: string; target: string; delta: number } | null) => void;
  movable: boolean; busy: boolean; onSelect: () => void; onToggle?: () => void;
  onBegin: () => boolean; onEnd: () => void; onReorder: (source: string, target: string) => void;
}

// Pointer capture keeps a long-press drag independent of subtitle editing.
export function TrackHeader({ id, label, color, hidden, selected, movable, busy, locked, count, onLock, onManage, onPreview, onSelect, onToggle, onBegin, onEnd, onReorder }: Props) {
  const button = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; scroll: number; active: boolean; target: string | null; clientY: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [active, setActive] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const suppressClick = useRef(false);
  const end = useRef(onEnd); end.current = onEnd;
  useEffect(() => () => {
    if (drag.current) { clearTimeout(drag.current.timer); if (drag.current.active) end.current(); }
  }, []);
  function aim(clientY: number) {
    const current = drag.current;
    if (!current?.active) return;
    current.clientY = clientY;
    const viewport = button.current!.closest<HTMLElement>('.tracks')!;
    const contentY = clientY - viewport.getBoundingClientRect().top + viewport.scrollTop;
    // offsetTop ignores the preview transforms: a moving row cannot change its own hit target.
    const rows = [...viewport.querySelectorAll<HTMLElement>('.track[data-reorder-id]')];
    const row = rows.find(row => contentY >= row.offsetTop && contentY < row.offsetTop + row.offsetHeight);
    current.target = row?.dataset.reorderId ?? id;
    const sourceRow = button.current!.closest<HTMLElement>('.track')!;
    if (row && [...viewport.querySelectorAll<HTMLElement>('[data-sort-locked]')].some(locked =>
      locked.offsetTop >= Math.min(sourceRow.offsetTop, row.offsetTop) && locked.offsetTop <= Math.max(sourceRow.offsetTop, row.offsetTop))) current.target = id;
    setTarget(current.target);
    onPreview({ source: id, target: current.target, delta: clientY - current.y + viewport.scrollTop - current.scroll });
  }
  useEffect(() => {
    if (!active) return;
    let frame = 0, previous = 0;
    const tick = (now: number) => {
      const current = drag.current, viewport = button.current?.closest<HTMLElement>('.tracks');
      if (!current?.active || !viewport) return;
      const rect = viewport.getBoundingClientRect();
      const direction = current.clientY < rect.top + 60 ? -1 : current.clientY > rect.bottom - 30 ? 1 : 0;
      if (direction) { viewport.scrollTop += direction * Math.min(32, previous ? now - previous : 16) * .6; aim(current.clientY); }
      previous = now; frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);
  function finish(cancel: boolean) {
    const current = drag.current;
    if (!current) return;
    clearTimeout(current.timer); drag.current = null; setActive(false); setTarget(null); onPreview(null);
    if (current.active) {
      suppressClick.current = true;
      if (!cancel && current.target && current.target !== id) onReorder(id, current.target);
      onEnd();
    }
    if (button.current?.hasPointerCapture(current.pointer)) button.current.releasePointerCapture(current.pointer);
  }
  return <div className={`track-header ${hidden ? 'hidden-track' : ''} ${active ? 'reordering' : ''}`} style={{ borderLeftColor: color }}>
    <button ref={button} className="track-label" style={{ color }} title={movable ? `${label} · 长按拖动排序` : label}
      aria-label={`选择轨道 ${label}`} aria-pressed={selected} disabled={busy}
      onPointerDown={event => {
        if (!movable || busy || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation(); button.current!.focus({ preventScroll: true });
        suppressClick.current = false;
        const current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, clientY: event.clientY, scroll: button.current!.closest('.tracks')!.scrollTop, active: false, target: null as string | null,
          timer: setTimeout(() => {
            if (drag.current !== current || !onBegin()) return;
             current.active = true; suppressClick.current = true; setActive(true);
             aim(current.clientY);
           }, 180) };
        drag.current = current; button.current!.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current) return;
        event.stopPropagation();
        if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 6) { suppressClick.current = true; finish(true); }
        else aim(event.clientY);
      }}
      onPointerUp={event => { if (drag.current) { event.stopPropagation(); aim(event.clientY); finish(false); } }}
      onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}
      onKeyDown={event => { if (drag.current && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); suppressClick.current = true; finish(true); } }}
      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(); }}>{label}</button>
    <div className="track-controls">
      <IconButton icon={locked ? 'LockKeyhole' : 'LockKeyholeOpen'} label={`${locked ? '解锁' : '锁定'}轨道 ${label}`} aria-pressed={locked} disabled={!onLock || busy || active} onClick={onLock} />
      {onToggle && <IconButton icon={hidden ? 'EyeOff' : 'Eye'} label={`${hidden ? '显示' : '隐藏'}轨道 ${label}`} aria-pressed={!hidden} disabled={busy || active} onClick={onToggle} />}
      {onManage && <IconButton icon="Pencil" label={`管理说话人 ${label}`} disabled={busy || active} onClick={onManage} />}
      {count !== undefined && <small className="track-count">{count}</small>}
    </div>
    {active && <span role="status" className="sr-only">{target && target !== id ? '松开调整顺序' : '拖动至目标轨道'}</span>}
  </div>;
}
