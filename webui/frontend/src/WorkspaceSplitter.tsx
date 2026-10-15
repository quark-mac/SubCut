import { useRef } from 'react';

export function WorkspaceSplitter({ label, horizontal = false, onBegin }: {
  label: string; horizontal?: boolean;
  onBegin: () => { move: (delta: number) => void; cancel: () => void };
}) {
  const drag = useRef<{ pointer: number; start: number; move: (delta: number) => void; cancel: () => void } | null>(null);
  return <div className={`workspace-splitter ${horizontal ? 'horizontal' : ''}`} role="separator" aria-label={label}
    aria-orientation={horizontal ? 'horizontal' : 'vertical'} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current = { pointer: event.pointerId, start: horizontal ? event.clientY : event.clientX, ...onBegin() };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => { if (drag.current) drag.current.move((horizontal ? event.clientY : event.clientX) - drag.current.start); }}
    onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current?.cancel(); drag.current = null; }}
    onLostPointerCapture={() => { drag.current?.cancel(); drag.current = null; }}
    onKeyDown={event => {
      if (drag.current) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') {
          const current = drag.current; drag.current = null; current.cancel();
          event.currentTarget.releasePointerCapture(current.pointer);
        }
      } else if ((horizontal ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']).includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        onBegin().move(['ArrowUp', 'ArrowLeft'].includes(event.key) ? -10 : 10);
      }
    }} />;
}
