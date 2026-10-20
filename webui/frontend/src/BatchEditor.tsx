import { useState } from 'react';
import { timeLabel, type Entry, type Project } from './api';
import { IconButton } from './IconButton';

export function BatchEditor({ entries, project, busy, onAssign }: {
  entries: Entry[]; project: Project; busy: boolean; onAssign: (id: string) => void;
}) {
  const [target, setTarget] = useState('');
  const common = (value: (entry: Entry) => string) => {
    const values = new Set(entries.map(value));
    return values.size === 1 ? [...values][0] : '不同值';
  };
  return <div className="entry-editor batch-editor">
    <strong aria-label="选择数量">已选 {entries.length} 条</strong>
    <label>正文<output aria-label="共同正文">{common(e => e.text)}</output></label>
    <div className="time-fields">
      <label>开始时间<output aria-label="共同开始时间">{common(e => timeLabel(e.start_ms))}</output></label>
      <label>结束时间<output aria-label="共同结束时间">{common(e => timeLabel(e.end_ms))}</output></label>
    </div>
    <label>当前说话人<output aria-label="共同说话人">{common(e => project.speakers.find(s => s.id === e.speaker_id)!.label)}</output></label>
    <label>批量说话人归属<select aria-label="批量说话人归属" value={target} disabled={busy} onChange={event => setTarget(event.target.value)}>
      <option value="">请选择目标说话人</option>
      {project.speakers.filter(s => s.visible !== false).map(s => <option key={s.id} value={s.label}>{s.label}</option>)}
    </select></label>
    <IconButton icon="Check" label="应用批量归属" disabled={busy || !target || !project.speakers.some(s => s.label === target)} onClick={() => {
      onAssign(project.speakers.find(s => s.label === target)!.id); setTarget('');
    }} />
  </div>;
}
