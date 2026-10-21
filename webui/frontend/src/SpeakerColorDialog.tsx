import { useEffect, useRef, useState } from 'react';
import type { Speaker } from './api';
import { optimizedSpeakerColors } from './speakerColors';

export function SpeakerColorDialog({ speakers, onApply, onCancel }: {
  speakers: Speaker[]; onApply: (speakers: Speaker[]) => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview] = useState(() => optimizedSpeakerColors(speakers));
  useEffect(() => { dialog.current?.showModal(); }, []);
  const groups = new Map<string, string[]>();
  for (const speaker of preview) {
    const key = speaker.color.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), speaker.label]);
  }
  const collisions = [...groups.values()].filter(labels => labels.length > 1);
  const changed = preview.filter((s, i) => s.color.toLowerCase() !== speakers[i].color.toLowerCase()).length;
  return <dialog ref={dialog} className="dialog structure-dialog color-dialog" aria-labelledby="color-title"
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="color-title">优化轨道配色预览</h2>
    <p>将调整 {changed} 条轨道，包含隐藏人物。锁定轨道保持原色；未锁定的特殊轨恢复固定中性色。</p>
    <p className="hint">历史工程未记录颜色来源，无法识别以前的手动选色。本次会重新分配所有未锁定人物颜色；需要保留的颜色请先锁定轨道。</p>
    {collisions.length > 0 && <p role="status">以下锁定/固定轨道仍然同色，无法自动消除：{collisions.map(labels => labels.join('、')).join('；')}。请解锁相关轨道后重试。</p>}
    <div className="color-preview" role="list" aria-label="配色前后对照">{preview.map((speaker, i) => <div role="listitem" key={speaker.id}>
      <span>{speaker.label}{speaker.locked ? ' · 已锁定' : ''}{speaker.visible === false ? ' · 已隐藏' : ''}</span>
      <span className="color-sample" style={{ backgroundColor: speakers[i].color }}>{speakers[i].color}</span><span>→</span>
      <span className="color-sample" style={{ backgroundColor: speaker.color }}>{speaker.color}</span>
    </div>)}</div>
    <footer><button onClick={onCancel}>取消配色优化</button><button className="primary" disabled={!changed} onClick={() => onApply(preview)}>应用优化配色</button></footer>
  </dialog>;
}
