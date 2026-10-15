import { useEffect, useRef, useState } from 'react';
import { api, ordered, timeLabel, type Entry, type Imported, type Project, type ProjectSummary } from './api';

interface Draft { text: string; start: string; end: string; speaker: string }
const draftFor = (entry: Entry): Draft => ({ text: entry.text, start: String(entry.start_ms), end: String(entry.end_ms), speaker: entry.speaker_id });

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('尚未打开工程');
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'new' | 'open' | 'help' | null>(null);
  const [menu, setMenu] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState('新建校对工程');
  const [mediaPath, setMediaPath] = useState('');
  const [subtitlePath, setSubtitlePath] = useState('');
  const [preview, setPreview] = useState<Imported | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const video = useRef<HTMLVideoElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const startInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);
  const current = project?.entries.find(entry => entry.id === selected);
  const draftChanged = !!(current && draft && JSON.stringify(draftFor(current)) !== JSON.stringify(draft));
  const unsaved = dirty || draftChanged;

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (unsaved) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  function report(reason: unknown) {
    setError(reason instanceof Error ? reason.message : String(reason));
  }

  function commitDraft(): Project | null {
    if (!project || !current || !draft || !draftChanged) return project;
    if (!draft.text.trim()) {
      setError('字幕正文不能为空'); textInput.current?.focus(); return null;
    }
    const start = Number(draft.start), end = Number(draft.end);
    if (!draft.start.trim() || !Number.isSafeInteger(start) || start < 0 || start >= end) {
      setError('开始时间须为整数毫秒，且满足 0 ≤ 开始 < 结束'); startInput.current?.focus(); return null;
    }
    if (!draft.end.trim() || !Number.isSafeInteger(end) || end <= start || end > project.media.duration_ms) {
      setError('结束时间须为整数毫秒，大于开始且不超过原片时长'); endInput.current?.focus(); return null;
    }
    const next = { ...project, entries: project.entries.map(entry => entry.id === selected
      ? { ...entry, text: draft.text, start_ms: start, end_ms: end, speaker_id: draft.speaker } : entry) };
    setProject(next); setDirty(true); setError('');
    return next;
  }

  function choose(entry: Entry) {
    if (busy) return;
    const snapshot = commitDraft();
    if (!snapshot) return;
    const committed = snapshot.entries.find(item => item.id === entry.id)!;
    setSelected(committed.id); setDraft(draftFor(committed));
    if (video.current) { video.current.pause(); video.current.currentTime = committed.start_ms / 1000; }
    setPosition(committed.start_ms);
  }

  function accept(project: Project) {
    video.current?.pause();
    setProject(project); setSelected(null); setDraft(null); setDirty(false);
    setStatus('已保存'); setError(''); setPosition(0); setPlaying(false); setDialog(null);
  }

  async function save(snapshot: Project): Promise<Project> {
    setStatus('保存中…');
    const result = await api<Project>(`/projects/${snapshot.id}`, 'PUT', {
      revision: snapshot.revision, name: snapshot.name, entries: snapshot.entries,
    });
    setProject(result); setDirty(false); setStatus('已保存');
    return result;
  }

  async function persist(exporting = false) {
    if (busy) return;
    const snapshot = commitDraft();
    if (!snapshot) return;
    setBusy(true); setError('');
    let saved = false;
    try {
      const result = await save(snapshot);
      saved = true;
      if (exporting) {
        const output = await api<{ project: Project }>(`/projects/${result.id}/exports`, 'POST', { revision: result.revision });
        setProject(output.project);
      }
    } catch (reason) {
      report(reason);
      if (!saved) setStatus('保存失败');
    } finally { setBusy(false); }
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); void persist();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  async function showDialog(kind: 'new' | 'open' | 'help') {
    setMenu(false); setError('');
    if (kind !== 'help' && unsaved && !window.confirm('当前修改尚未保存。确定离开当前编辑工程吗？')) return;
    if (kind === 'open') {
      setBusy(true);
      try { setProjects(await api<ProjectSummary[]>('/projects')); setDialog(kind); }
      catch (reason) { report(reason); }
      finally { setBusy(false); }
    } else { setPreview(null); setDialog(kind); }
  }

  async function importAction(create: boolean) {
    setBusy(true); setError('');
    try {
      const body = { media_path: mediaPath.trim(), subtitle_path: subtitlePath.trim() };
      if (create) accept(await api<Project>('/projects', 'POST', { ...body, name }));
      else setPreview(await api<Imported>('/imports/preview', 'POST', body));
    } catch (reason) { setPreview(null); report(reason); }
    finally { setBusy(false); }
  }

  async function openProject(id: string) {
    setBusy(true); setError('');
    try { accept(await api<Project>(`/projects/${id}`)); }
    catch (reason) { report(reason); }
    finally { setBusy(false); }
  }

  async function togglePlayback() {
    if (!video.current) return;
    if (video.current.paused) {
      try { await video.current.play(); } catch { setError('浏览器无法播放此视频，请使用兼容的 H.264/AAC MP4 原片'); }
    } else video.current.pause();
  }

  const entries = ordered(project?.entries ?? []);
  const duration = project?.media.duration_ms ?? 1;
  const activeEntries = entries.filter(entry => entry.start_ms <= position && entry.end_ms > position);
  const speakerName = (id: string) => {
    const label = project?.speakers.find(s => s.id === id)?.label ?? '?';
    return label === '?' ? '未标注 ?' : label === 'NONSPEECH' ? '非对白 NONSPEECH' : label;
  };

  function track(label: string, items: Entry[], locked = false) {
    const ends: number[] = [];
    const blocks = ordered(items).map(entry => {
      let lane = ends.findIndex(end => end <= entry.start_ms);
      if (lane < 0) lane = ends.length;
      ends[lane] = entry.end_ms;
      return { entry, lane };
    });
    return <div className="track" key={label}>
      <div className="track-label">{label}</div>
      <div className={`track-body ${locked ? 'locked' : ''}`} style={{ height: Math.max(46, ends.length * 35 + 8) }}>
        {locked && <span>原片 · {timeLabel(duration)}</span>}
        {blocks.map(({ entry, lane }) => <button key={entry.id} disabled={busy}
          className={`clip ${selected === entry.id ? 'selected' : ''}`}
          aria-label={`${label}：${entry.text}`} title={entry.text} onClick={() => choose(entry)}
          style={{ left: `${entry.start_ms / duration * 100}%`, width: `${(entry.end_ms - entry.start_ms) / duration * 100}%`, top: lane * 35 + 4,
            backgroundColor: project?.speakers.find(s => s.id === entry.speaker_id)?.color }}>
          {entry.text}
        </button>)}
        <div className="playhead" style={{ left: `${position / duration * 100}%` }} />
      </div>
    </div>;
  }

  return <div className="app">
    <header className="menubar">
      <span className="brand">◈ 字幕校对</span>
      <div className="file-menu"><button onClick={() => setMenu(!menu)} disabled={busy}>文件</button>
        {menu && <div className="menu-popup">
          <button onClick={() => void showDialog('new')}>新建工程…</button>
          <button onClick={() => void showDialog('open')}>打开工程…</button>
          <button disabled={!project} onClick={() => { setMenu(false); void persist(); }}>保存</button>
        </div>}
      </div>
      <button onClick={() => textInput.current?.focus()} disabled={!selected || busy}>编辑</button>
      <button onClick={() => setShowSubtitles(!showSubtitles)} aria-pressed={showSubtitles}>视图</button>
      <button onClick={() => void showDialog('help')}>帮助</button>
      <span className="local-badge">本机工作区</span>
    </header>
    <div className="projectbar">
      <h1>{project?.name ?? '打开一段故事，开始校对'}</h1>
      <span role="status" aria-label="保存状态" className={unsaved ? 'unsaved' : ''}>{busy && status === '保存中…' ? status : status === '保存失败' ? status : unsaved ? '未保存' : status}</span>
      <div className="actions">
        <button onClick={() => void showDialog('new')} disabled={busy}>新建工程</button>
        <button onClick={() => void persist()} disabled={!project || busy}>保存工程</button>
        <button className="primary" onClick={() => void persist(true)} disabled={!project || busy}>导出普通 SRT</button>
      </div>
    </div>
    {error && <div role="alert" className="error">{error}<button aria-label="关闭错误" onClick={() => setError('')}>×</button></div>}
    <main className="workspace">
      <aside className="resources panel" aria-label="工程资源">
        <h2>工程资源</h2>
        {project ? <>
          <h3>源视频</h3><p className="path">{project.media.path}</p>
          <p className="muted">时长 {timeLabel(duration)} · 原路径引用</p>
          <h3>字幕来源</h3>{project.subtitle_sources.map(source => <p key={source.id} className="path">{source.path}</p>)}
          <h3>工作字幕</h3><p>{entries.length} 条 · 工程修订 {project.revision}</p>
          <h3>预览副本</h3><p className="muted">当前直接播放原片</p>
          <h3>导出文件</h3>
          {project.exports.length ? project.exports.map(file => <div className="export" key={file.id}>
            <a href={`/api/projects/${project.id}/exports/${file.id}`} download>{file.filename}</a>
            <p className="path muted">{file.path}</p>
          </div>) : <p className="muted">保存校对结果后导出</p>}
        </> : <p className="muted">新建工程，选定本机视频与普通 SRT；也可从“文件”菜单继续已有工程。</p>}
      </aside>
      <section className="preview-panel panel" aria-label="视频预览">
        <h2>视频预览 <span>原片时间轴</span></h2>
        <div className="video-stage">
          {project ? <>
            <video key={project.id} ref={video} src={`/api/projects/${project.id}/media`} controls preload="auto"
              onTimeUpdate={event => setPosition(event.currentTarget.currentTime * 1000)}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
              onError={() => setError('视频读取或解码失败，请检查源路径与浏览器编码兼容性（建议 H.264/AAC MP4）')} />
            {showSubtitles && <div className="subtitle-overlay" aria-label="播放字幕">{activeEntries.map(entry => <div key={entry.id}>{entry.text}</div>)}</div>}
          </> : <div className="empty-preview"><span>▷</span><p>视频与字幕，在同一时间线上</p></div>}
        </div>
        <div className="transport">
          <button onClick={() => void togglePlayback()} disabled={!project}>{playing ? '暂停' : '播放'}</button>
          <output aria-label="播放位置">{timeLabel(position)} / {project ? timeLabel(duration) : '—'}</output>
          <label><input type="checkbox" checked={showSubtitles} onChange={event => setShowSubtitles(event.target.checked)} />字幕</label>
        </div>
        <p className="hint">单击字幕定位原片 · 修改正文或时间后保存 · Ctrl+S 保存工程</p>
      </section>
      <section className="editor panel" aria-label="字幕编辑器">
        <h2>字幕 <span>{entries.length} 条</span></h2>
        <div className="subtitle-list" aria-label="字幕列表">
          {entries.map((entry, index) => <button key={entry.id} aria-label={`列表字幕 ${index + 1}`} disabled={busy}
            className={`subtitle-row ${selected === entry.id ? 'selected' : ''} ${activeEntries.some(active => active.id === entry.id) ? 'active' : ''}`}
            onClick={() => choose(entry)}>
            <span className="row-time">{index + 1} · {timeLabel(entry.start_ms)} → {timeLabel(entry.end_ms)}</span>
            <span className="row-text">{entry.text}</span>
            <span className="speaker-label">{speakerName(entry.speaker_id)}</span>
          </button>)}
          {!entries.length && <p className="muted">导入后在此选择字幕进行校对</p>}
        </div>
        {draft ? <div className="entry-editor">
          <label>字幕正文<textarea ref={textInput} value={draft.text} disabled={busy}
            onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
          <div className="time-fields">
            <label>开始时间（毫秒）<input ref={startInput} type="number" step="1" value={draft.start} disabled={busy}
              onChange={event => setDraft({ ...draft, start: event.target.value })} /></label>
            <label>结束时间（毫秒）<input ref={endInput} type="number" step="1" value={draft.end} disabled={busy}
              onChange={event => setDraft({ ...draft, end: event.target.value })} /></label>
          </div>
          <label>说话人归属<select value={draft.speaker} disabled={busy} onChange={event => setDraft({ ...draft, speaker: event.target.value })}>
            {project?.speakers.map(s => <option value={s.id} key={s.id}>{speakerName(s.id)}</option>)}
          </select></label>
          <button disabled={busy || !draftChanged} onClick={() => commitDraft()}>应用修改</button>
          <p className="hint">保存和导出会先校验并提交当前输入。</p>
        </div> : <p className="muted editor-prompt">选择一条字幕，开始校对</p>}
      </section>
    </main>
    <section className="timeline panel" aria-label="原片时间轴">
      <div className="timeline-toolbar"><h2>时间轴</h2><span className="muted">视频轨锁定 · 合法重叠保留</span></div>
      {project ? <>
        <div className="ruler"><span>00:00</span><span>{timeLabel(duration / 2)}</span><span>{timeLabel(duration)}</span></div>
        <div className="tracks">
          {track('🔒 视频轨', [], true)}
          {track('字幕总览', entries)}
          {project.speakers.map(speaker => track(speakerName(speaker.id), entries.filter(entry => entry.speaker_id === speaker.id)))}
        </div>
      </> : <div className="timeline-empty">工程打开后将在此显示原片与工作字幕</div>}
    </section>
    {dialog && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="dialog">
      <header><h2 id="dialog-title">{dialog === 'new' ? '新建编辑工程' : dialog === 'open' ? '打开工程' : '使用帮助'}</h2>
        <button disabled={busy} aria-label="关闭对话框" onClick={() => setDialog(null)}>×</button></header>
      {dialog === 'new' && <>
        <p className="muted">使用浏览器可直接播放的原片。视频和字幕保留在原路径，校对结果保存为独立工程。</p>
        <label>工程名称<input value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
        <label>视频绝对路径<input value={mediaPath} disabled={busy} placeholder="D:\视频\短片.mp4" onChange={event => { setMediaPath(event.target.value); setPreview(null); }} /></label>
        <label>普通 SRT 绝对路径<input value={subtitlePath} disabled={busy} placeholder="D:\字幕\来源.srt" onChange={event => { setSubtitlePath(event.target.value); setPreview(null); }} /></label>
        <p className="hint">普通模式完整保留方括号、冒号与换行，归属设为未标注 ?。字幕需 UTF-8 编码。</p>
        <button disabled={busy || !mediaPath || !subtitlePath} onClick={() => void importAction(false)}>{busy ? '处理中…' : '解析预览'}</button>
        {preview && <div className="import-preview"><h3>预览 · {preview.entries.length} 条 · 未标注 ?</h3>
          {preview.entries.map((entry, index) => <div key={entry.id}><small>{index + 1} · {timeLabel(entry.start_ms)} → {timeLabel(entry.end_ms)}</small><p>{entry.text}</p></div>)}
        </div>}
        <footer><button disabled={busy || !preview || !name.trim()} className="primary" onClick={() => void importAction(true)}>创建工程</button></footer>
      </>}
      {dialog === 'open' && <div className="project-list">{projects.length ? projects.map(item => <div key={item.id}>
        <button disabled={busy} onClick={() => void openProject(item.id)}>{item.name}</button>
        <small>{item.error?.message ?? `修订 ${item.revision}`} · {item.id}</small>
      </div>) : <p>尚无工程，请先新建。</p>}</div>}
      {dialog === 'help' && <div className="help"><p>1. 新建工程，输入本机视频与普通 SRT 的绝对路径，先预览再创建。</p><p>2. 点击字幕暂停并定位；右侧编辑正文、整数毫秒时间与归属。重叠字幕各自保留。</p><p>3. 点击保存或 Ctrl+S。通过文件菜单重开工程。导出生成独立普通 SRT，可从资源区下载。</p><p>当前为最小校对闭环：请使用 H.264/AAC MP4 等浏览器兼容原片。工程需手动保存。</p></div>}
    </section></div>}
  </div>;
}
