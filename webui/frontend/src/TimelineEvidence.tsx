import { memo, useEffect, useState } from 'react';
import { api, timeLabel } from './api';

interface Waveform { duration_ms: number; has_audio: boolean; peaks: { start_ms: number; end_ms: number; peak: number }[] }
interface Thumbnails { interval_ms: number; frames: { time_ms: number; url: string }[] }
export const TimelineEvidence = memo(function TimelineEvidence({ waveform, thumbnails, duration, width, scrollLeft, viewportWidth }: {
  waveform: string | null; thumbnails: string | null; duration: number; width: number; scrollLeft: number; viewportWidth: number;
}) {
  const [wave, setWave] = useState<{ url: string; value: Waveform } | null>(null);
  const [images, setImages] = useState<{ url: string; value: Thumbnails } | null>(null);
  const [waveError, setWaveError] = useState(''), [imageError, setImageError] = useState('');
  const start = Math.max(0, Math.floor(scrollLeft / width * duration));
  const end = Math.min(duration, Math.ceil((scrollLeft + viewportWidth) / width * duration));
  useEffect(() => {
    let active = true; setWaveError('');
    if (!waveform || end <= start) { setWave(null); return; }
    const timer = setTimeout(() => {
      void api<Waveform>(`${waveform.replace(/^\/api/, '')}?start_ms=${start}&end_ms=${end}&bins=${Math.min(4096, Math.ceil(viewportWidth))}`)
        .then(value => { if (active) setWave({ url: waveform, value }); })
        .catch(reason => { if (active) { setWave(null); setWaveError(String(reason)); } });
    }, 40);
    return () => { active = false; clearTimeout(timer); };
  }, [waveform, start, end, viewportWidth]);
  useEffect(() => {
    let active = true; setImageError(''); setImages(null);
    if (thumbnails) void api<Thumbnails>(thumbnails.replace(/^\/api/, '')).then(value => { if (active) setImages({ url: thumbnails, value }); })
      .catch(reason => { if (active) setImageError(String(reason)); });
    return () => { active = false; };
  }, [thumbnails]);

  const waveData = wave?.url === waveform ? wave.value : null;
  const imageData = images?.url === thumbnails ? images.value : null;
  // Only decode images needed for this viewport. Sampling times never depend on CSS widths.
  const stride = imageData ? Math.max(1, Math.ceil(100 / (imageData.interval_ms / duration * width))) : 1;
  const shown = imageData?.frames.filter((frame, index) => index % stride === 0 &&
    frame.time_ms + imageData.interval_ms * stride > start && frame.time_ms < end) ?? [];
  const first = waveData?.peaks[0]?.start_ms ?? start;
  const svgLeft = Math.max(scrollLeft, first / duration * width);
  return <div className="timeline-evidence" aria-label="原片时间媒体证据">
    {shown.map(frame => <img key={frame.time_ms} src={frame.url} data-time-ms={frame.time_ms} alt={`原片缩略图 ${timeLabel(frame.time_ms)}`}
      title={`采样于原片 ${timeLabel(frame.time_ms)}`} draggable={false}
      style={{ left: frame.time_ms / duration * width, width: Math.min(160, imageData!.interval_ms * stride / duration * width, width - frame.time_ms / duration * width) }} />)}
    {waveData?.has_audio && <svg role="img" aria-label="音频波形" width={Math.min(viewportWidth, width - svgLeft)} height="32" style={{ left: svgLeft }}>
      {waveData.peaks.map(p => <rect key={p.start_ms} data-time-ms={p.start_ms} data-peak={p.peak}
        x={p.start_ms / duration * width - svgLeft} y={16 - p.peak * 15} width={Math.max(.5, (p.end_ms - p.start_ms) / duration * width)} height={Math.max(1, p.peak * 30)} />)}
    </svg>}
    {waveData && !waveData.has_audio && <span className="evidence-message" style={{ left: scrollLeft + 8 }}>无音轨 · 空波形</span>}
    {(waveError || imageError) && <span role="status" className="evidence-message" style={{ left: scrollLeft + 8 }}>时间轴资源加载失败，可刷新波形/缩略图状态重试：{waveError || imageError}</span>}
    {!waveform && !thumbnails && <span className="evidence-message" style={{ left: scrollLeft + 8 }}>原片 · {timeLabel(duration)} · 锁定 · 可在资源区生成波形和缩略图</span>}
  </div>;
});
