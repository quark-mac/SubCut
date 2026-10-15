import { useEffect, useRef, useState } from 'react';
import { api, ordered, timeLabel, type Entry, type ExportFormat, type ImportPreview, type ImportFormat, type Project, type ProjectSummary } from './api';
import { useProjectSession } from './useProjectSession';
import { SourceTimeline } from './SourceTimeline';
import { SpeakerManager, specialSpeaker, type SpeakerDraft } from './SpeakerManager';

interface Draft { text: string; start: string; end: string; speaker: string }
const draftFor = (entry: Entry, project: Project): Draft => ({ text: entry.text, start: String(entry.start_ms), end: String(entry.end_ms), speaker: project.speakers.find(s => s.id === entry.speaker_id)!.label });
const exportLabels: Record<ExportFormat, string> = { 'speaker-srt': '说话人 SRT', 'plain-srt': '普通 SRT', 'normalized-jsonl': '项目 JSONL', 'moss-json': 'MOSS JSON' };

export function App() {
  const session = useProjectSession();
  const { project, dirty } = session;
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldError, setFieldError] = useState<{ field: keyof Draft; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'new' | 'replace' | 'open' | 'help' | null>(null);
  const [menu, setMenu] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState('新建校对工程');
  const [mediaPath, setMediaPath] = useState('');
  const [subtitlePath, setSubtitlePath] = useState('');
  const [importFormat, setImportFormat] = useState<ImportFormat>('plain-srt');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('speaker-srt');
  const [keepTags, setKeepTags] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [editorTab, setEditorTab] = useState<'subtitles' | 'speakers'>('subtitles');
  const [speakerDraft, setSpeakerDraft] = useState<SpeakerDraft | null>(null);
  const [speakerError, setSpeakerError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const startInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);
  const speakerInput = useRef<HTMLInputElement>(null);
  const current = project?.entries.find(entry => entry.id === selected);
  const draftChanged = !!(project && current && draft && JSON.stringify(draftFor(current, project)) !== JSON.stringify(draft));
  const speakerOriginal = project?.speakers.find(s => s.id === speakerDraft?.id);
  const speakerChanged = !!speakerDraft && (!speakerOriginal || speakerOriginal.label !== speakerDraft.label || speakerOriginal.color !== speakerDraft.color);
  const unsaved = dirty || draftChanged || speakerChanged;

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

  function invalid(field: keyof Draft, message: string): null {
    setFieldError({ field, message }); setError(message);
    ({ text: textInput, start: startInput, end: endInput, speaker: speakerInput })[field].current?.focus();
    return null;
  }

  function cancelDraft() {
    setSpeakerDraft(null); setSpeakerError('');
    const snapshot = session.getProject();
    const entry = snapshot?.entries.find(e => e.id === selected);
    setDraft(entry && snapshot ? draftFor(entry, snapshot) : null);
    setFieldError(null); setError('');
  }

  function fieldProps(field: keyof Draft) {
    return { 'aria-invalid': fieldError?.field === field, 'aria-describedby': fieldError?.field === field ? 'entry-field-error' : undefined };
  }

  function commitDraft(): Project | null {
    const project = session.getProject();
    if (project && speakerDraft) {
      const label = speakerDraft.label.trim();
      const conflict = project.speakers.some(s => s.id !== speakerDraft.id && s.label === label);
      if (!label || conflict) {
        setSpeakerError(!label ? '说话人名称不能为空' : '名称已存在，请使用“合并说话人”操作');
        document.querySelector<HTMLInputElement>('.speaker-form input')?.focus();
        return null;
      }
      const speaker = { id: speakerDraft.id ?? crypto.randomUUID(), label, color: speakerDraft.color, order: project.speakers.length - 2 };
      const speakers = (speakerDraft.id ? project.speakers.map(s => s.id === speakerDraft.id ? { ...s, label, color: speaker.color } : s)
        : [...project.speakers.slice(0, -2), speaker, ...project.speakers.slice(-2)]).map((s, order) => ({ ...s, order }));
      const next = { ...project, speakers };
      commitSpeakers(next);
      return next;
    }
    const current = project?.entries.find(entry => entry.id === selected);
    if (!project || !current || !draft) return project;
    if (JSON.stringify(draftFor(current, project)) === JSON.stringify(draft)) {
      setFieldError(null); setError(''); return project;
    }
    if (!draft.text.trim()) {
      return invalid('text', '字幕正文不能为空');
    }
    const start = Number(draft.start), end = Number(draft.end);
    if (!draft.start.trim() || !Number.isSafeInteger(start) || start < 0 || start >= end) {
      return invalid('start', '开始时间须为整数毫秒，且满足 0 ≤ 开始 < 结束');
    }
    if (!draft.end.trim() || !Number.isSafeInteger(end) || end <= start || end > project.media.duration_ms) {
      return invalid('end', '结束时间须为整数毫秒，大于开始且不超过原片时长');
    }
    const label = draft.speaker.trim();
    if (!label) return invalid('speaker', '说话人名称不能为空');
    let speakers = project.speakers;
    let speaker = speakers.find(s => s.label === label);
    if (!speaker) {
      speaker = { id: crypto.randomUUID(), label, color: '#71a8cc', order: speakers.length - 2 };
      speakers = [...speakers.slice(0, -2), speaker, ...speakers.slice(-2)].map((s, order) => ({ ...s, order }));
    }
    const next = { ...project, speakers, entries: project.entries.map(entry => entry.id === selected
      ? { ...entry, text: draft.text, start_ms: start, end_ms: end, speaker_id: speaker.id } : entry) };
    session.commit(next); setDraft(draftFor(next.entries.find(e => e.id === selected)!, next)); setFieldError(null); setError('');
    return next;
  }

  function commitSpeakers(next: Project) {
    session.commit(next);
    const entry = next.entries.find(e => e.id === selected);
    setDraft(entry ? draftFor(entry, next) : null);
    setSpeakerDraft(null); setSpeakerError(''); setError('');
  }

  function reorderSpeakers(source: string, target: string) {
    const snapshot = commitDraft();
    if (!snapshot || source === target) return;
    const ordinary = snapshot.speakers.filter(s => !specialSpeaker(s.label));
    const from = ordinary.findIndex(s => s.id === source), to = ordinary.findIndex(s => s.id === target);
    if (from < 0 || to < 0) return;
    ordinary.splice(to, 0, ordinary.splice(from, 1)[0]);
    const speakers = [...ordinary, ...snapshot.speakers.slice(-2)].map((s, order) => ({ ...s, order }));
    commitSpeakers({ ...snapshot, speakers });
  }

  function mergeSpeakers(source: string, target: string): boolean {
    const snapshot = commitDraft();
    if (!snapshot || source === target) return false;
    const from = snapshot.speakers.find(s => s.id === source), to = snapshot.speakers.find(s => s.id === target);
    if (!from || !to || specialSpeaker(from.label) || specialSpeaker(to.label)) return false;
    commitSpeakers({ ...snapshot,
      speakers: snapshot.speakers.filter(s => s.id !== source).map((s, order) => ({ ...s, order })),
      entries: snapshot.entries.map(e => e.speaker_id === source ? { ...e, speaker_id: target } : e),
    });
    return true;
  }

  function deleteSpeaker(source: string) {
    const snapshot = commitDraft();
    const speaker = snapshot?.speakers.find(s => s.id === source);
    if (!snapshot || !speaker || specialSpeaker(speaker.label)) return;
    const unknown = snapshot.speakers.find(s => s.label === '?')!;
    commitSpeakers({ ...snapshot,
      speakers: snapshot.speakers.filter(s => s.id !== source).map((s, order) => ({ ...s, order })),
      entries: snapshot.entries.map(e => e.speaker_id === source ? { ...e, speaker_id: unknown.id } : e),
    });
  }

  function choose(entry: Entry) {
    if (busy) return;
    const snapshot = commitDraft();
    if (!snapshot) return;
    const committed = snapshot.entries.find(item => item.id === entry.id)!;
    setSelected(committed.id); setDraft(draftFor(committed, snapshot));
    setEditorTab('subtitles');
    if (video.current) { video.current.pause(); video.current.currentTime = committed.start_ms / 1000; }
    setPosition(committed.start_ms);
  }

  function accept(project: Project) {
    video.current?.pause();
    session.open(project); setSelected(null); setDraft(null); setFieldError(null);
    setSpeakerDraft(null); setSpeakerError(''); setEditorTab('subtitles');
    setError(''); setPosition(0); setPlaying(false); setDialog(null);
  }

  async function persist(exporting = false) {
    if (busy || dialog) return;
    const snapshot = commitDraft();
    if (!snapshot) return;
    setError('');
    await session.persist(exporting ? { format: exportFormat, keep_tags: keepTags && exportFormat.endsWith('-srt') } : false);
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const input = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); void persist();
      } else if (!dialog && !busy && event.key === 'Escape') {
        event.preventDefault();
        if (input || draftChanged || speakerDraft) cancelDraft();
        else { setSelected(null); setDraft(null); setFieldError(null); }
      } else if (!dialog && !busy && !input && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); history(event.shiftKey);
      } else if (!dialog && !busy && !input && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault(); moveSpeaker(event.key === 'ArrowUp' ? -1 : 1);
        } else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          const snapshot = commitDraft();
          if (!snapshot) return;
          const items = ordered(snapshot.entries);
          const index = items.findIndex(e => e.id === selected);
          const next = items[index < 0 ? (event.key === 'ArrowLeft' ? items.length - 1 : 0) : index + (event.key === 'ArrowLeft' ? -1 : 1)];
          if (next) choose(next);
        } else if (event.code === 'Space') {
          event.preventDefault(); if (!event.repeat) void togglePlayback();
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  function moveSpeaker(offset: number) {
    const snapshot = commitDraft();
    const entry = snapshot?.entries.find(e => e.id === selected);
    if (!snapshot || !entry) return;
    const speakers = [...snapshot.speakers].sort((a, b) => a.order - b.order);
    const target = speakers[speakers.findIndex(s => s.id === entry.speaker_id) + offset];
    if (!target) return;
    const changed = { ...entry, speaker_id: target.id };
    const next = { ...snapshot, entries: snapshot.entries.map(e => e.id === entry.id ? changed : e) };
    session.commit(next); setDraft(draftFor(changed, next));
  }

  function history(redo: boolean) {
    if (!commitDraft()) return;
    const next = session.travel(redo);
    const entry = next?.entries.find(e => e.id === selected);
    setDraft(entry && next ? draftFor(entry, next) : null); setFieldError(null); setError('');
  }

  async function showDialog(kind: 'new' | 'replace' | 'open' | 'help') {
    if (kind !== 'help' && session.isSaving()) return;
    setMenu(false); setError('');
    if (kind === 'replace') {
      const current = commitDraft();
      if (!current) return;
      setMediaPath(current.media.path); setSubtitlePath('');
    } else if (kind !== 'help' && unsaved && !window.confirm('当前修改尚未保存。确定离开当前编辑工程吗？')) return;
    if (kind !== 'help') session.pauseAutosave();
    if (kind === 'open') {
      setBusy(true);
      try { setProjects(await api<ProjectSummary[]>('/projects')); setDialog(kind); }
      catch (reason) { report(reason); session.resumeAutosave(); }
      finally { setBusy(false); }
    } else { setPreview(null); setDialog(kind); }
  }

  async function importAction(create: boolean) {
    setBusy(true); setError('');
    try {
      const body = { media_path: mediaPath.trim(), subtitle_path: subtitlePath.trim(), format: importFormat };
      if (create && dialog === 'replace' && preview) {
        const current = session.getProject()!;
        const remap = new Map(preview.speakers.map(s => [s.id, current.speakers.find(old => old.label === s.label)]));
        const speakers = preview.speakers.map(s => ({ ...s, id: remap.get(s.id)?.id ?? s.id, color: remap.get(s.id)?.color ?? s.color }));
        const entries = preview.entries.map(e => ({ ...e, speaker_id: remap.get(e.speaker_id)?.id ?? e.speaker_id }));
        session.commit({ ...current, entries, speakers, subtitle_sources: preview.subtitle_sources });
        setSelected(null); setDraft(null); setFieldError(null); setDialog(null); setPreview(null);
      } else if (create) accept(await api<Project>('/projects', 'POST', { ...body, name, preview_fingerprint: preview?.fingerprint }));
      else setPreview(await api<ImportPreview>('/imports/preview', 'POST', body));
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

  function seek(milliseconds: number) {
    if (video.current) { video.current.pause(); video.current.currentTime = milliseconds / 1000; }
    setPosition(milliseconds);
  }

  return <div className="app">
    <header className="menubar">
      <span className="brand">◈ 字幕校对</span>
      <div className="file-menu"><button onClick={() => setMenu(!menu)} disabled={busy || session.saving}>文件</button>
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
      <span role="status" aria-label="保存状态" className={unsaved || session.saveError ? 'unsaved' : ''}>{session.saving ? '保存中…' : session.saveError ? '保存失败' : unsaved ? '未保存' : project ? '已保存' : '尚未打开工程'}</span>
      <div className="actions">
        <button onClick={() => void showDialog('new')} disabled={busy || session.saving}>新建工程</button>
        <button onClick={() => void showDialog('replace')} disabled={!project || busy || session.saving}>替换字幕</button>
        <button onClick={() => void persist()} disabled={!project || busy}>保存工程</button>
        <select aria-label="导出格式" value={exportFormat} onChange={event => setExportFormat(event.target.value as ExportFormat)}>
          {Object.entries(exportLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="export-tags"><input type="checkbox" checked={keepTags} disabled={!exportFormat.endsWith('-srt')} onChange={event => setKeepTags(event.target.checked)} />保留已有元标签</label>
        <button className="primary" onClick={() => void persist(true)} disabled={!project || busy}>导出{exportLabels[exportFormat]}</button>
      </div>
    </div>
    {!dialog && (error || session.saveError || session.exportError) && <div role="alert" className="error">{error || session.saveError || session.exportError}
      {session.saveError && <button onClick={() => void persist()}>重试保存</button>}
      {session.exportError && <button onClick={() => void persist(true)}>重试导出</button>}
      {error && <button aria-label="关闭错误" onClick={() => setError('')}>×</button>}</div>}
    <main className="workspace">
      <aside className="resources panel" aria-label="工程资源">
        <h2>工程资源</h2>
        {project ? <>
          <h3>源视频</h3><p className="path">{project.media.path}</p>
          <p className="muted">时长 {timeLabel(duration)} · 原路径引用</p>
          <h3>字幕来源</h3>{project.subtitle_sources.map(source => <div key={source.id}><p className="path">{source.path}</p><small className="muted">{source.format}</small></div>)}
          <h3>工作字幕</h3><p>{entries.length} 条 · 工程修订 {project.revision}</p>
          <h3>预览副本</h3><p className="muted">当前直接播放原片</p>
          <h3>导出文件</h3>
          <p className="hint">继续编辑请保存工程。交换字幕不包含完整身份、来源和人物配置。</p>
          {project.exports.length ? project.exports.map(file => <div className="export" key={file.id}>
            <a href={`/api/projects/${project.id}/exports/${file.id}`} download>{file.filename}</a>
            <p className="path muted">{file.path}</p>
          </div>) : <p className="muted">保存校对结果后导出</p>}
        </> : <p className="muted">新建工程，选定本机视频与字幕（SRT / JSONL / MOSS JSON）；也可从“文件”菜单继续已有工程。</p>}
      </aside>
      <section className="preview-panel panel" aria-label="视频预览">
        <h2>视频预览 <span>原片时间轴</span></h2>
        <div className="video-stage">
          {project ? <>
            <video key={project.id} ref={video} src={`/api/projects/${project.id}/media`} controls preload="auto"
              onTimeUpdate={event => setPosition(Math.round(event.currentTarget.currentTime * 1000))}
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
        <p className="hint">单击字幕定位原片 · 有效编辑自动保存 · Ctrl+S 立即保存</p>
      </section>
      <section className="editor panel" aria-label="字幕编辑器">
        <div className="editor-tabs" role="tablist" aria-label="编辑页签">
          <button role="tab" aria-selected={editorTab === 'subtitles'} onClick={() => { if (commitDraft()) setEditorTab('subtitles'); }}>字幕</button>
          <button role="tab" aria-selected={editorTab === 'speakers'} onClick={() => { if (commitDraft()) setEditorTab('speakers'); }}>说话人</button>
        </div>
        {editorTab === 'speakers' ? project ? <SpeakerManager project={project} draft={speakerDraft} error={speakerError} busy={busy}
          onEdit={value => {
            const snapshot = commitDraft();
            if (snapshot) { setSpeakerDraft(value.id ? snapshot.speakers.find(s => s.id === value.id)! : value); setSpeakerError(''); }
          }}
          onChange={value => { setSpeakerDraft(value); setSpeakerError(''); }} onApply={() => commitDraft()}
          onReorder={reorderSpeakers}
          onMerge={mergeSpeakers}
          onDelete={deleteSpeaker}
          onCancel={() => { setSpeakerDraft(null); setSpeakerError(''); }} /> : <p className="editor-prompt muted">请先打开工程</p> : <>
        <h2>字幕 <span>{entries.length} 条</span></h2>
        <div className="subtitle-list" aria-label="字幕列表">
          {entries.map((entry, index) => <button key={entry.id} aria-label={`列表字幕 ${index + 1}`} disabled={busy}
            className={`subtitle-row ${selected === entry.id ? 'selected' : ''} ${activeEntries.some(active => active.id === entry.id) ? 'active' : ''}`}
            onClick={() => choose(entry)}>
            <span className="row-time">{index + 1} · {timeLabel(entry.start_ms)} → {timeLabel(entry.end_ms)}</span>
            <span className="row-text">{entry.text}</span>
            <span className="speaker-label" style={{ color: project?.speakers.find(s => s.id === entry.speaker_id)?.color }}>{speakerName(entry.speaker_id)}</span>
          </button>)}
          {!entries.length && <p className="muted">导入后在此选择字幕进行校对</p>}
        </div>
        {draft ? <div className="entry-editor" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commitDraft();
        }}>
          <label>字幕正文<textarea ref={textInput} {...fieldProps('text')} value={draft.text} disabled={busy}
            onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
          <div className="time-fields">
            <label>开始时间（毫秒）<input ref={startInput} {...fieldProps('start')} type="number" step="1" value={draft.start} disabled={busy}
              onChange={event => setDraft({ ...draft, start: event.target.value })} /></label>
            <label>结束时间（毫秒）<input ref={endInput} {...fieldProps('end')} type="number" step="1" value={draft.end} disabled={busy}
              onChange={event => setDraft({ ...draft, end: event.target.value })} /></label>
          </div>
          <label>说话人归属<select aria-label="说话人归属" value={project?.speakers.some(s => s.label === draft.speaker) ? draft.speaker : ''} disabled={busy} onChange={event => setDraft({ ...draft, speaker: event.target.value })}>
            <option value="" disabled>输入新的说话人名称</option>
            {project?.speakers.map(s => <option value={s.label} key={s.id}>{speakerName(s.id)}</option>)}
          </select></label>
          <label>说话人名称<input ref={speakerInput} {...fieldProps('speaker')} value={draft.speaker} disabled={busy}
            onChange={event => setDraft({ ...draft, speaker: event.target.value })} /></label>
          <button disabled={busy || !draftChanged} onClick={() => commitDraft()}>应用修改</button>
          <button disabled={busy || !draftChanged} onClick={cancelDraft}>取消修改</button>
          {fieldError && <p id="entry-field-error" className="field-error">{fieldError.message}</p>}
          <p className="hint">离开编辑区或应用修改时提交，随后自动保存。保存/导出先校验输入；Esc 取消草稿。</p>
        </div> : <p className="muted editor-prompt">选择一条字幕，开始校对</p>}
        </>}
      </section>
    </main>
    <section className="timeline panel" aria-label="原片时间轴">
      <div className="timeline-toolbar"><h2>时间轴</h2>
        <button disabled={busy || (!session.canUndo && !draftChanged && !speakerChanged)} onClick={() => history(false)}>撤销</button>
        <button disabled={busy || !session.canRedo || draftChanged || speakerChanged} onClick={() => history(true)}>重做</button>
        <span className="muted">视频轨锁定 · 合法重叠保留</span></div>
      {project ? <SourceTimeline key={project.id} project={project} selected={selected} position={position} busy={busy}
        onChoose={choose} onSeek={seek} /> : <div className="timeline-empty">工程打开后将在此显示原片与工作字幕</div>}
    </section>
    {dialog && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="dialog">
      <header><h2 id="dialog-title">{dialog === 'new' ? '新建编辑工程' : dialog === 'replace' ? '整体替换工作字幕' : dialog === 'open' ? '打开工程' : '使用帮助'}</h2>
        <button disabled={busy} aria-label="关闭对话框" onClick={() => { setDialog(null); if (dialog !== 'help') session.resumeAutosave(); }}>×</button></header>
      {error && <p role="alert" className="error">{error}</p>}
      {(dialog === 'new' || dialog === 'replace') && <>
        <p className="muted">使用浏览器可直接播放的原片。视频和字幕保留在原路径，校对结果保存为独立工程。</p>
        {dialog === 'new' && <label>工程名称<input value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>}
        <label>视频绝对路径<input value={mediaPath} disabled={busy || dialog === 'replace'} placeholder="D:\视频\短片.mp4" onChange={event => { setMediaPath(event.target.value); setPreview(null); }} /></label>
        <label>导入格式<select value={importFormat} disabled={busy} onChange={event => { setImportFormat(event.target.value as ImportFormat); setPreview(null); }}>
          <option value="plain-srt">普通 SRT · 全文保留，未标注 ?</option>
          <option value="speaker-srt">本项目 SRT · [Speaker] 与已知元标签</option>
          <option value="moss-srt">MOSS SRT · Speaker: 正文</option>
          <option value="normalized-jsonl">本项目 normalized JSONL</option>
          <option value="moss-json">MOSS JSON · 五字段数组</option>
        </select></label>
        <label>字幕绝对路径<input value={subtitlePath} disabled={busy} placeholder="D:\字幕\来源.srt" onChange={event => { setSubtitlePath(event.target.value); setPreview(null); }} /></label>
        <p className="hint">UTF-8 字幕。普通 SRT 不猜测人物；项目 SRT 仅解析前置 MULTI / MERGED，未知花括号起保留正文；MOSS SRT 按首个 ASCII 冒号加空格解析。JSON 时间为秒。替换可一步撤销。</p>
        <button disabled={busy || !mediaPath || !subtitlePath} onClick={() => void importAction(false)}>{busy ? '处理中…' : '解析预览'}</button>
        {preview && <div className="import-preview"><h3>预览 · {preview.entries.length} 条</h3>
          {preview.entries.map((entry, index) => <div key={entry.id}><small>{index + 1} · {timeLabel(entry.start_ms)} → {timeLabel(entry.end_ms)} · [{preview.speakers.find(s => s.id === entry.speaker_id)?.label}]</small><p>{entry.text}</p>
            <small>元标签：{entry.tags.join(', ') || '无'} · {entry.sources.map(s => `输入序号 ${s.index ?? '无'} / 原来源索引 [${s.source_entries.join(', ')}] / MOSS ID ${s.moss_id ?? '无'}`).join('；')}</small>
          </div>)}
        </div>}
        <footer><button disabled={busy || !preview || (dialog === 'new' && !name.trim())} className="primary" onClick={() => void importAction(true)}>{dialog === 'replace' ? '应用替换' : '创建工程'}</button></footer>
      </>}
      {dialog === 'open' && <div className="project-list">{projects.length ? projects.map(item => <div key={item.id}>
        <button disabled={busy} onClick={() => void openProject(item.id)}>{item.name}</button>
        <small>{item.error?.message ?? `修订 ${item.revision}`} · {item.id}</small>
      </div>) : <p>尚无工程，请先新建。</p>}</div>}
      {dialog === 'help' && <div className="help"><p>1. 新建工程，输入本机视频与字幕绝对路径，选择 SRT 解释方式、normalized JSONL 或 MOSS JSON，先预览再创建。替换字幕同样先预览，整体替换可一步撤销。</p><p>2. 点击字幕暂停并定位；右侧编辑正文、整数毫秒时间与归属。可选择现有人物或输入新名称，重叠字幕各自保留。</p><p>3. 点击应用修改或离开编辑区后自动保存；Ctrl+S 立即提交并保存。非法字段需修正或取消，保存失败可重试。</p><p>4. 时间轴工具栏撤销/重做，或在输入框外使用 Ctrl+Z / Ctrl+Shift+Z。保存保留历史，重开工程重置历史；输入框内撤销优先编辑文字，Esc 取消草稿。</p><p>5. 通过文件菜单重开工程。导出使用触发时的有效输入，默认干净说话人 SRT，也可选择普通 SRT、项目 JSONL、MOSS JSON。SRT 元标签须显式勾选；资源区提供实际文件下载。继续编辑请保存完整工程。请使用 H.264/AAC MP4 等浏览器兼容原片。</p></div>}
    </section></div>}
  </div>;
}
