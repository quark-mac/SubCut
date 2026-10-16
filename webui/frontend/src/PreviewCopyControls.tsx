import type { PreviewCopy } from './usePreviewCopy';

const states = { queued: '等待', running: '运行中', succeeded: '成功', failed: '失败' };
export function PreviewCopyControls({ preview, busy, onGenerate }: { preview: PreviewCopy; busy: boolean; onGenerate: () => void }) {
  const source = preview.playback?.source;
  return <section aria-label="兼容预览副本">
    <h3>兼容预览副本</h3>
    <label>预览质量<select aria-label="预览质量" value={preview.quality} disabled={preview.busy} onChange={e => preview.setQuality(e.target.value)}>
      <option value="standard">标准（最高 1920 宽）</option><option value="small">轻量（最高 960 宽）</option>
    </select></label>
    <button disabled={busy || preview.busy} onClick={onGenerate}>{preview.task?.state === 'failed' ? '重试生成预览副本' : '生成预览副本'}</button>
    <button onClick={preview.refresh}>刷新预览状态</button>
    <div className="media-status preview-status" tabIndex={0} role="region" aria-label="预览媒体信息与任务详情">
      <p role="status" aria-label="浏览器解码状态">{preview.decoding}</p>
      {preview.task && <><p role="status" aria-label="预览任务状态">{states[preview.task.state]} · {Math.round(preview.task.progress * 100)}%{preview.task.cached ? ' · 复用缓存' : ''}</p>
        <progress aria-label="预览生成进度" value={preview.task.progress} max={1} />
        {preview.task.error && <p role="alert" className="field-error">{preview.task.error.message}</p>}</>}
      {preview.error && <p role="status" aria-label="预览读取错误" className="field-error">{preview.error}</p>}
      {source && <p className="path muted">{source.format_name} · {source.video_codec} / {source.audio_codec ?? '无音轨'}</p>}
      {source?.suggest_preview && !preview.playback?.preview && <p className="hint">容器或编码可能不受浏览器支持。请以实际画面和声音为准，可生成 H.264/AAC 副本。</p>}
      {!!source?.start_time_ms && !preview.playback?.preview && <p className="hint">原片带非零时间戳，请生成副本后按零起点校对。</p>}
      {preview.playback?.preview && <p className="hint">正在播放兼容副本；原片身份与字幕时间保持不变。</p>}
    </div>
  </section>;
}
