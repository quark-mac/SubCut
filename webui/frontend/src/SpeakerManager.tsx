import { useRef, useState } from 'react';
import type { Project } from './api';

export interface SpeakerDraft { id: string | null; label: string; color: string }
export const specialSpeaker = (label: string) => label === '?' || label === 'NONSPEECH';

interface Props {
  project: Project;
  draft: SpeakerDraft | null;
  error: string;
  busy: boolean;
  onEdit: (draft: SpeakerDraft) => void;
  onChange: (draft: SpeakerDraft) => void;
  onApply: () => void;
  onCancel: () => void;
  onReorder: (source: string, target: string) => void;
  onMerge: (source: string, target: string) => boolean;
  onDelete: (source: string) => void;
}

export function SpeakerManager({ project, draft, error, busy, onEdit, onChange, onApply, onCancel, onReorder, onMerge, onDelete }: Props) {
  const dragging = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');
  return <div className="speaker-manager" role="tabpanel" aria-label="说话人管理">
    <button disabled={busy} onClick={() => onEdit({ id: null, label: '', color: '#71a8cc' })}>新增说话人</button>
    <p className="hint">拖动 ⠿ 调整普通轨顺序，松开后提交；Esc 取消。组合标签作为一个人物保留，特殊轨固定在底部。</p>
    <p className="hint">删除人物会将其全部字幕转入未标注，不删除台词；可在时间轴撤销。</p>
    {draft && <form className="speaker-form" onSubmit={event => { event.preventDefault(); onApply(); }}>
      <h3>{draft.id ? '编辑人物' : '新增人物'}</h3>
      <label>人物名称<input autoFocus aria-invalid={!!error} aria-describedby={error ? 'speaker-field-error' : undefined}
        disabled={busy} value={draft.label} onChange={event => onChange({ ...draft, label: event.target.value })} /></label>
      <label>人物颜色<input type="color" disabled={busy} value={draft.color} onChange={event => onChange({ ...draft, color: event.target.value })} /></label>
      {error && <p id="speaker-field-error" role="alert" className="field-error">{error}</p>}
      <div className="speaker-actions"><button disabled={busy} type="submit">应用人物设置</button><button type="button" onClick={onCancel}>取消人物修改</button></div>
    </form>}
    <div className="speaker-cards">{project.speakers.map(speaker => <section key={speaker.id} role="group" aria-label={`说话人 ${speaker.label}`}
      className={`speaker-card ${dropTarget === speaker.id ? 'drop-target' : ''}`}
      onDragOver={event => {
        if (dragging.current && !specialSpeaker(speaker.label) && !busy && !draft) {
          event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(speaker.id);
        }
      }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
      onDrop={event => {
        event.preventDefault();
        if (dragging.current && !specialSpeaker(speaker.label) && !busy && !draft) onReorder(dragging.current, speaker.id);
        dragging.current = null; setDropTarget(null);
      }}>
      <strong style={{ color: speaker.color }}>{speaker.label === '?' ? '未标注 ?' : speaker.label === 'NONSPEECH' ? '非对白 NONSPEECH' : speaker.label}</strong>
      <small className="muted">{project.entries.filter(e => e.speaker_id === speaker.id).length} 条字幕{specialSpeaker(speaker.label) ? ' · 固定特殊轨' : ''}</small>
      {!specialSpeaker(speaker.label) && <div className="speaker-actions">
        <button className="speaker-drag" aria-label={`拖动排序 ${speaker.label}`} title="拖到目标人物的位置；Esc 取消" disabled={busy || !!draft} draggable={!busy && !draft}
          onDragStart={event => { dragging.current = speaker.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', speaker.id); }}
          onDragEnd={() => { dragging.current = null; setDropTarget(null); }}>⠿</button>
        <button disabled={busy} onClick={() => { setMergeSource(null); onEdit(speaker); }}>编辑人物</button>
        <button disabled={busy || !!draft} onClick={() => { setMergeSource(speaker.id); setMergeTarget(''); }}>合并说话人</button>
        <button disabled={busy || !!draft} title="字幕转入未标注，可一步撤销" onClick={() => { setMergeSource(null); onDelete(speaker.id); }}>删除人物</button>
      </div>}
      {mergeSource === speaker.id && <form className="speaker-form" onSubmit={event => {
        event.preventDefault(); if (onMerge(speaker.id, mergeTarget)) { setMergeSource(null); setMergeTarget(''); }
      }}>
        <p>将「{speaker.label}」的全部字幕转入目标并移除此人物，可一步撤销。</p>
        <label>合并目标<select value={mergeTarget} onChange={event => setMergeTarget(event.target.value)}>
          <option value="">请选择目标人物</option>
          {project.speakers.filter(s => s.id !== speaker.id && !specialSpeaker(s.label)).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select></label>
        <div className="speaker-actions"><button type="submit" disabled={busy || !mergeTarget || !!draft}>确认合并</button>
          <button type="button" onClick={() => setMergeSource(null)}>取消合并</button></div>
      </form>}
    </section>)}</div>
  </div>;
}
