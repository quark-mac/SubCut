import { useEffect, useRef, useState } from 'react';
import { timeLabel, type Speaker } from './api';

export function AddSubtitleDialog({ start, end, speakerId, speakers, onAdd, onCancel }: {
  start: number; end: number; speakerId: string; speakers: Speaker[];
  onAdd: (text: string, speakerId: string) => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const [speaker, setSpeaker] = useState(speakerId);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="dialog structure-dialog" aria-labelledby="add-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="add-title">在播放头新增字幕</h2>
    <p className="hint">{timeLabel(start)} → {timeLabel(end)} · 填写正文后才创建，取消不保存草稿。</p>
    <label>新增字幕正文<textarea autoFocus value={text} onChange={event => setText(event.target.value)} /></label>
    <label>新增说话人归属<select value={speaker} onChange={event => setSpeaker(event.target.value)}>
      {speakers.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select></label>
    <footer><button onClick={onCancel}>取消新增</button><button className="primary" disabled={!text.trim()} onClick={() => onAdd(text, speaker)}>确认新增</button></footer>
  </dialog>;
}
