import type { TimelineMedia } from './useTimelineMedia';

const states = { queued: '等待', running: '运行中', succeeded: '成功', failed: '失败' };
export function TimelineMediaControls({ media, kind, busy, onGenerate }: {
  media: TimelineMedia; kind: '波形' | '缩略图'; busy: boolean; onGenerate: () => void;
}) {
  const action = kind === '波形' ? '生成音频波形' : '生成画面缩略图';
  return <section aria-label={`${kind}生成`}>
    <h3>{kind}</h3>
    <label>{kind}采样密度<select aria-label={`${kind}采样密度`} value={media.density} disabled={media.busy}
      onChange={event => media.setDensity(event.target.value)}>
      <option value="standard">标准（{kind === '波形' ? '10 ms' : '1 秒'}）</option>
      <option value="detailed">精细（{kind === '波形' ? '5 ms' : '0.5 秒'}）</option>
    </select></label>
    <button disabled={busy || media.busy} onClick={onGenerate}>{media.task?.state === 'failed' ? `重试${action}` : action}</button>
    <button onClick={media.refresh}>刷新{kind}状态</button>
    <div className="media-status" tabIndex={0} role="region" aria-label={`${kind}任务详情`}>
      {media.task && <><p role="status" aria-label={`${kind}任务状态`}>{states[media.task.state]} · {Math.round(media.task.progress * 100)}%{media.task.cached ? ' · 复用缓存' : ''}</p>
        <progress aria-label={`${kind}生成进度`} max={1} value={media.task.progress} />
        {media.task.error && <p role="alert" className="field-error">{media.task.error.message}</p>}</>}
      {media.error && <p role="status" aria-label={`${kind}读取错误`} className="field-error">{media.error}</p>}
    </div>
  </section>;
}
