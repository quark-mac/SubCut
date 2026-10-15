import { useEffect, useRef, useState } from 'react';
import type { Speaker } from './api';

export function MergeSubtitleDialog({ count, speakers, onMerge, onCancel }: {
  count: number; speakers: Speaker[]; onMerge: (speakerId: string) => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [speaker, setSpeaker] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="dialog structure-dialog" aria-labelledby="merge-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="merge-title">跨说话人合并</h2>
    <p className="hint">将 {count} 条连续字幕按时间顺序换行合并，覆盖中间空隙。请明确选择结果归属。</p>
    <label>合并结果说话人<select autoFocus value={speaker} onChange={event => setSpeaker(event.target.value)}>
      <option value="" disabled>请选择结果标签</option>
      {speakers.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select></label>
    <footer><button onClick={onCancel}>取消合并</button><button className="primary" disabled={!speaker} onClick={() => onMerge(speaker)}>确认合并字幕</button></footer>
  </dialog>;
}
