import { useEffect, useRef, useState } from 'react';
import { IconButton } from './IconButton';

interface Props {
  id: string; label: string; color?: string; hidden: boolean; selected: boolean;
  movable: boolean; busy: boolean; onSelect: () => void; onToggle?: () => void;
  onBegin: () => boolean; onEnd: () => void; onReorder: (source: string, target: string) => void;
}

// Pointer capture keeps a long-press drag independent of subtitle editing.
export function TrackHeader({ id, label, color, hidden, selected, movable, busy, onSelect, onToggle, onBegin, onEnd, onReorder }: Props) {
  const button = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; active: boolean; target: string | null; clientY: number; timer: ReturnType<typeof setTimeout> } | null>(null);
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
    const rect = button.current!.getBoundingClientRect();
    const row = document.elementFromPoint(rect.left + 25, clientY)?.closest<HTMLElement>('[data-reorder-id]');
    current.target = row?.dataset.reorderId ?? null;
    setTarget(current.target);
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
    clearTimeout(current.timer); drag.current = null; setActive(false); setTarget(null);
    if (current.active) {
      suppressClick.current = true;
      if (!cancel && current.target && current.target !== id) onReorder(id, current.target);
      onEnd();
    }
    if (button.current?.hasPointerCapture(current.pointer)) button.current.releasePointerCapture(current.pointer);
  }
  return <div className={`track-header ${hidden ? 'hidden-track' : ''} ${active ? 'reordering' : ''}`} data-reorder-id={movable ? id : undefined}>
    <button ref={button} className="track-label" style={{ color }} title={movable ? `${label} · 长按拖动排序` : label}
      aria-label={`选择轨道 ${label}`} aria-pressed={selected} disabled={busy}
      onPointerDown={event => {
        if (!movable || busy || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation(); button.current!.focus({ preventScroll: true });
        suppressClick.current = false;
        const current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, clientY: event.clientY, active: false, target: null as string | null,
          timer: setTimeout(() => {
            if (drag.current !== current || !onBegin()) return;
            current.active = true; suppressClick.current = true; setActive(true);
          }, 350) };
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
    {onToggle && <IconButton icon={hidden ? 'EyeOff' : 'Eye'} label={`${hidden ? '显示' : '隐藏'}轨道 ${label}`} aria-pressed={!hidden} disabled={busy || active} onClick={onToggle} />}
    {active && <span role="status" className="track-drag-status">{target && target !== id ? '松开调整顺序' : '拖动至目标轨道'}</span>}
  </div>;
}
