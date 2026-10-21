import { useEffect, useState } from 'react';
import { api, type ProjectSummary, type TrashedProject } from './api';
import { IconButton } from './IconButton';

export function ProjectBrowser({ busy, onBusy, onOpen, onDeleted, onError }: {
  busy: boolean; onBusy: (busy: boolean) => void; onOpen: (id: string) => void;
  onDeleted: (id: string) => void; onError: (reason: unknown) => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [trash, setTrash] = useState<TrashedProject[]>([]);
  const [recycled, setRecycled] = useState(false);
  async function refresh() {
    const [projects, trash] = await Promise.all([api<ProjectSummary[]>('/projects'), api<TrashedProject[]>('/recycle-bin')]);
    setProjects(projects); setTrash(trash);
  }
  useEffect(() => { void refresh().catch(onError); }, []);
  async function remove(item: ProjectSummary) {
    if (!window.confirm(`将「${item.name}」移入回收站？7 天内可恢复，之后自动永久删除工程及缓存、工程内导出。原视频和导入字幕不受影响。`)) return;
    onBusy(true);
    try {
      await api(`/projects/${item.id}`, 'DELETE', { revision: item.revision });
      onDeleted(item.id); await refresh();
    } catch (reason) { onError(reason); }
    finally { onBusy(false); }
  }
  async function restore(id: string) {
    onBusy(true);
    try { await api(`/recycle-bin/${id}/restore`, 'POST'); await refresh(); }
    catch (reason) { onError(reason); }
    finally { onBusy(false); }
  }
  return <>
    <div className="button-row project-tabs">
      <button aria-pressed={!recycled} onClick={() => setRecycled(false)}>工程列表</button>
      <button aria-pressed={recycled} onClick={() => setRecycled(true)}>回收站 · {trash.length}</button>
      <IconButton icon="RefreshCw" label="刷新工程列表" disabled={busy} onClick={() => void refresh().catch(onError)} />
    </div>
    {recycled ? <>
      <p className="hint">删除后保留 7 天。运行期间定期清理；服务关闭时，到下次启动再清理到期项目。</p>
      <div className="project-list">{trash.map(item => <div key={item.id} role="group" aria-label={`回收工程 ${item.name}`}>
        <strong>{item.name}</strong><small>自动清理：{new Date(item.expires_at).toLocaleString()}</small>
        <button disabled={busy} onClick={() => void restore(item.id)}>恢复工程</button>
      </div>)}{!trash.length && <p>回收站为空。</p>}</div>
    </> : <div className="project-list">{projects.map(item => <div key={item.id} role="group" aria-label={`工程 ${item.name}`}>
      <div className="project-card-actions"><button disabled={busy} onClick={() => onOpen(item.id)}>{item.name}</button>
        <IconButton icon="Trash2" label={`删除工程 ${item.name}`} disabled={busy || !item.revision} onClick={() => void remove(item)} /></div>
      <small>{item.error?.message ?? `修订 ${item.revision}`} · {item.id}</small>
      {item.media && <small className="path">{item.media_missing ? '原片失联 · 字幕可编辑' : '原片路径'} · {item.media.path}</small>}
    </div>)}{!projects.length && <p>尚无工程，请先新建。</p>}</div>}
  </>;
}
