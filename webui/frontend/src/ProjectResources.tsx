import { useEffect, useState } from 'react';
import { api, timeLabel, type Project, type Resources } from './api';

const statuses: Record<string, string> = { available: '可用', missing: '失联', changed: '文件已变化', unavailable: '无法读取', unverified: '身份未核实', stale: '缓存失效' };
export function ProjectResources({ project, busy, onRelocate, onNewMedia, resourceVersion }: {
  project: Project; busy: boolean; onRelocate: () => void; onNewMedia: () => void; resourceVersion?: string;
}) {
  const [resources, setResources] = useState<Resources | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    void api<Resources>(`/projects/${project.id}/resources`).then(value => { if (active) setResources(value); })
      .catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [project.id, project.revision, refresh, resourceVersion]);
  async function openLocation(id: string) {
    setError(''); setOpened('');
    try {
      const result = await api<{ path: string }>(`/projects/${project.id}/exports/${id}/open-location`, 'POST');
      setOpened(`已请求资源管理器打开：${result.path}`);
    } catch (reason) { setError(String(reason)); }
  }
  return <>
    <button onClick={() => setRefresh(refresh + 1)}>刷新资源状态</button>
    {error && <p role="alert" className="field-error">{error}</p>}
    <h3>源视频</h3><p className="path">{project.media.path}</p>
    <p className="muted">时长 {timeLabel(project.media.duration_ms)} · 原路径引用</p>
    <p role="status" aria-label="媒体资源状态">{resources ? statuses[resources.media.status] : '检查中…'}</p>
    {resources?.media.status !== 'available' && <p className="hint">编辑数据仍保留，可继续保存字幕；重新定位用于找回同一原片。</p>}
    <details><summary>媒体身份</summary><p className="path">{project.media.identity ?? '旧工程尚未记录身份'}</p></details>
    <button disabled={busy} onClick={onRelocate}>重新定位原片</button>
    <button disabled={busy} onClick={onNewMedia}>用新视频建立工程</button>
    <h3>字幕来源</h3>{project.subtitle_sources.map(source => <div key={source.id}><p className="path">{source.path}</p><small className="muted">{source.format} · {statuses[resources?.subtitle_sources.find(s => s.id === source.id)?.status ?? ''] ?? '检查中…'}</small></div>)}
    <h3>工作字幕</h3><p>{project.entries.length} 条 · 工程修订 {project.revision}</p><p className="path muted">{resources?.working_subtitles.path}</p>
    <h3>媒体派生产物 / 预览副本</h3>
    {resources?.media_artifacts.length ? resources.media_artifacts.map(item => <div key={item.id}><p>{item.kind} · {statuses[item.status]}</p><p className="path">{item.path}</p></div>) : <p className="muted">暂无派生产物；可用时直接播放原片</p>}
    <h3>导出文件</h3><p className="hint">继续编辑请保存工程。交换字幕不包含完整身份、来源和人物配置。</p>
    {project.exports.length ? project.exports.map(file => <div className="export" key={file.id}>
      <a href={`/api/projects/${project.id}/exports/${file.id}`} download>{file.filename}</a>
      <p className="path muted">{file.path}</p>
      <small>{statuses[resources?.exports.find(e => e.id === file.id)?.status ?? ''] ?? '检查中…'}</small>
      <button onClick={() => void openLocation(file.id)}>打开导出位置</button>
    </div>) : <p className="muted">保存校对结果后导出</p>}
    {opened && <p role="status" className="path">{opened}</p>}
  </>;
}
