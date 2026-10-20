import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, timeLabel, type Project, type Resources } from './api';
import { Icon, IconButton } from './IconButton';

const statuses: Record<string, string> = { available: '可用', missing: '失联', changed: '文件已变化', unavailable: '无法读取', unverified: '身份未核实', stale: '缓存失效' };
export function ProjectResources({ project, busy, onRelocate, onNewMedia, resourceVersion, children }: {
  project: Project; busy: boolean; onRelocate: () => void; onNewMedia: () => void; resourceVersion?: string; children: ReactNode;
}) {
  const [resources, setResources] = useState<Resources | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState('');
  const [settings, setSettings] = useState(false);
  const previousExports = useRef(project.exports.length);
  const settingsPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (project.exports.length > previousExports.current) setSettings(true);
    previousExports.current = project.exports.length;
  }, [project.exports.length]);
  useEffect(() => {
    if (settings) settingsPanel.current?.focus();
  }, [settings]);
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
  const filename = (value: string) => value.split(/[\\/]/).pop();
  return <>
    <header className="resource-header"><IconButton icon="Settings2" label="工程资源菜单" aria-expanded={settings} aria-controls="resource-settings" onClick={() => setSettings(!settings)} /><h2>工程资源</h2></header>
    <div className="asset-grid" aria-label="工程文件">
      <article className="asset-card" title={project.media.path} aria-label="源视频文件">
        <div className="asset-art"><Icon name="Film" size={40} /><small>{timeLabel(project.media.duration_ms)}</small></div>
        <strong>{filename(project.media.path)}</strong>
        <small role="status" aria-label="媒体资源状态">{resources ? statuses[resources.media.status] : '检查中…'}</small>
      </article>
      {project.subtitle_sources.map(source => <article key={source.id} className="asset-card subtitle-asset" title={source.path} aria-label="字幕来源文件">
        <div className="asset-art"><Icon name="FileText" size={36} /><small>{source.format}</small></div>
        <strong>{filename(source.path)}</strong><small>{statuses[resources?.subtitle_sources.find(s => s.id === source.id)?.status ?? ''] ?? '检查中…'}</small>
      </article>)}
    </div>
    <div id="resource-settings" className="resource-settings" role="region" aria-label="工程资源配置" hidden={!settings} ref={settingsPanel} tabIndex={-1}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSettings(false); } }}>
      <header><h2>工程资源配置</h2><IconButton icon="X" label="关闭资源菜单" onClick={() => setSettings(false)} /></header>
      {children}
      <section className="resource-details">
        <h3>文件与工程</h3><div className="button-row"><IconButton icon="RefreshCw" label="刷新资源状态" onClick={() => setRefresh(refresh + 1)} />
          <IconButton icon="MapPin" label="重新定位原片" disabled={busy} onClick={onRelocate} /><IconButton icon="Copy" label="用新视频建立工程" disabled={busy} onClick={onNewMedia} /></div>
        <p className="path">{project.media.path}</p><p className="path muted">{resources?.working_subtitles.path}</p>
        <details><summary>媒体身份</summary><p className="path">{project.media.identity ?? '未记录身份'}</p></details>
        {resources?.media_artifacts.map(item => <p key={item.id} className="path">{item.kind} · {statuses[item.status]}<br />{item.path}</p>)}
      </section>
      <section><h3>导出文件</h3>{project.exports.length ? project.exports.map(file => <div className="export" key={file.id}>
        <a href={`/api/projects/${project.id}/exports/${file.id}`} download>{file.filename}</a><p className="path muted">{file.path}</p>
        <IconButton icon="FolderOpen" label="打开导出位置" onClick={() => void openLocation(file.id)} />
      </div>) : <p className="muted">暂无导出</p>}</section>
      {error && <p role="alert" className="field-error">{error}</p>}{opened && <p role="status" className="path">{opened}</p>}
    </div>
  </>;
}
