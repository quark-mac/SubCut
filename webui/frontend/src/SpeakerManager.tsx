import { useMemo, useRef, useState } from 'react';
import type { Project } from './api';
import { specialSpeaker, type SpeakerDraft } from './speakerEditing';
import { IconButton } from './IconButton';
import { nextSpeakerColor } from './speakerColors';

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
  onDeleteTrack: (source: string) => void;
  onLock: (source: string) => void;
  onOptimize: () => void;
}

export function SpeakerManager({ project, draft, error, busy, onEdit, onChange, onApply, onCancel, onReorder, onMerge, onDelete, onDeleteTrack, onLock, onOptimize }: Props) {
  const dragging = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const entry of project.entries) result.set(entry.speaker_id, (result.get(entry.speaker_id) ?? 0) + 1);
    return result;
  }, [project.entries]);
  return <div className="speaker-manager" role="tabpanel" aria-label="说话人管理">
    <p className="hint">重命名可将 S00 等标签对应到角色；匹配已有角色请合并说话人。</p>
    <div className="button-row"><IconButton icon="Plus" label="新增说话人" disabled={busy} onClick={() => onEdit({ id: null, label: '', color: nextSpeakerColor(project.speakers.map(s => s.color)) })} />
      <button disabled={busy || !!draft} onClick={onOptimize}>优化轨道配色</button></div>
    {draft && <form className="speaker-form" onSubmit={event => { event.preventDefault(); onApply(); }}>
      <h3>{draft.id ? '编辑人物' : '新增人物'}</h3>
      <label>人物名称<input autoFocus aria-invalid={!!error} aria-describedby={error ? 'speaker-field-error' : undefined}
        disabled={busy} value={draft.label} onChange={event => onChange({ ...draft, label: event.target.value })} /></label>
      <label>人物颜色<input type="color" disabled={busy} value={draft.color} onChange={event => onChange({ ...draft, color: event.target.value })} /></label>
      {error && <p id="speaker-field-error" role="alert" className="field-error">{error}</p>}
      <div className="speaker-actions"><IconButton icon="Check" label="应用人物设置" disabled={busy} type="submit" /><IconButton icon="X" label="取消人物修改" onClick={onCancel} /></div>
    </form>}
    <div className="speaker-cards">{project.speakers.map(speaker => <section key={speaker.id} data-speaker-card={speaker.id} role="group" aria-label={`说话人 ${speaker.label}`}
      className={`speaker-card ${dropTarget === speaker.id ? 'drop-target' : ''}`}
      onDragOver={event => {
        if (dragging.current && !speaker.locked && !specialSpeaker(speaker.label) && !busy && !draft) {
          event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(speaker.id);
        }
      }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
      onDrop={event => {
        event.preventDefault();
        if (dragging.current && !speaker.locked && !specialSpeaker(speaker.label) && !busy && !draft) onReorder(dragging.current, speaker.id);
        dragging.current = null; setDropTarget(null);
      }}>
      <strong style={{ color: speaker.color }}>{speaker.label === '?' ? '未标注 ?' : speaker.label === 'NONSPEECH' ? '非对白 NONSPEECH' : speaker.label}</strong>
      <small className="muted">{counts.get(speaker.id) ?? 0} 条字幕{specialSpeaker(speaker.label) ? ' · 固定特殊轨' : ''}</small>
      <IconButton icon={speaker.locked ? 'LockKeyhole' : 'LockKeyholeOpen'} label={speaker.locked ? '解锁人物轨' : '锁定人物轨'} disabled={busy || !!draft} onClick={() => onLock(speaker.id)} />
      {!specialSpeaker(speaker.label) && <div className="speaker-actions">
        <IconButton icon="GripVertical" className="speaker-drag" label={`拖动排序 ${speaker.label}`} disabled={busy || !!draft || speaker.locked} draggable={!busy && !draft && !speaker.locked}
          onDragStart={event => { dragging.current = speaker.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', speaker.id); }}
          onDragEnd={() => { dragging.current = null; setDropTarget(null); }} />
        <IconButton icon="Pencil" label="编辑人物" title="重命名 / 修改颜色" disabled={busy || speaker.locked} onClick={() => { setMergeSource(null); onEdit(speaker); }} />
        <IconButton icon="Merge" label="合并说话人" title="匹配到已有角色 / 合并说话人" disabled={busy || !!draft || speaker.locked || speaker.visible === false} onClick={() => { setMergeSource(speaker.id); setMergeTarget(''); }} />
        <IconButton icon="UserRound" label="删除人物" title="删除人物，字幕转入未标注" disabled={busy || !!draft || speaker.locked || speaker.visible === false || project.speakers.some(s => s.label === '?' && (s.visible === false || s.locked))} onClick={() => { setMergeSource(null); onDelete(speaker.id); }} />
        <IconButton icon="Trash2" label="删除轨道及字幕" disabled={busy || !!draft || speaker.locked} onClick={() => { setMergeSource(null); onDeleteTrack(speaker.id); }} />
      </div>}
      {mergeSource === speaker.id && !speaker.locked && speaker.visible !== false && <form className="speaker-form" onSubmit={event => {
        event.preventDefault(); if (onMerge(speaker.id, mergeTarget)) { setMergeSource(null); setMergeTarget(''); }
      }}>
        <p>将「{speaker.label}」的全部字幕转入目标并移除此人物，可一步撤销。</p>
        <label>合并目标<select value={mergeTarget} onChange={event => setMergeTarget(event.target.value)}>
          <option value="">请选择目标人物</option>
          {project.speakers.filter(s => s.id !== speaker.id && !s.locked && s.visible !== false && !specialSpeaker(s.label)).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select></label>
        <div className="speaker-actions"><button type="submit" disabled={busy || !project.speakers.some(s => s.id === mergeTarget && s.visible !== false) || !!draft}>确认合并</button>
          <button type="button" onClick={() => setMergeSource(null)}>取消合并</button></div>
      </form>}
    </section>)}</div>
  </div>;
}
