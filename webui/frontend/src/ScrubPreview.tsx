import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, timeLabel } from './api';

export function ScrubPreview({ url, version, position, anchor }: { url: string | null; version: string; position: number; anchor: { x: number; y: number } | null }) {
  const [manifest, setManifest] = useState<{ url: string; frames: { time_ms: number; url: string }[] } | null>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => {
    let active = true;
    setManifest(null); setFailed('');
    if (url) void api<{ frames: { time_ms: number; url: string }[] }>(url.replace(/^\/api/, ''))
      .then(value => { if (active) setManifest({ url, frames: value.frames }); })
      .catch(() => { if (active) setFailed('缩略图加载失败'); });
    return () => { active = false; };
  }, [url, version]);
  if (!anchor) return null;
  const frames = manifest?.url === url ? manifest.frames : [];
  // Fixed-interval frames are sorted. Binary search avoids scanning a feature film on every pointer move.
  let low = 0, high = frames.length;
  while (low < high) { const mid = (low + high) >>> 1; if (frames[mid].time_ms <= position) low = mid + 1; else high = mid; }
  const frame = frames[Math.max(0, low - 1)];
  return createPortal(<div className="scrub-preview" role="status" aria-label="播放头拖动预览"
    style={{ left: Math.max(8, Math.min(window.innerWidth - 200, anchor.x - 96)), top: Math.max(8, anchor.y - 155) }}>
    {frame && failed !== frame.url ? <img key={frame.url} src={frame.url} alt={`采样画面 ${timeLabel(frame.time_ms)}`} onError={() => setFailed(frame.url)} />
      : <p>{!url ? '尚未生成缩略图' : failed ? '缩略图加载失败' : '缩略图加载中…'}</p>}
    <div>{timeLabel(position)}</div><small>{frame ? `参考帧 ${timeLabel(frame.time_ms)}` : '可在时间轴工具栏生成'}</small>
  </div>, document.body);
}
