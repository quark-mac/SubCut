import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ordered, timeLabel, type Entry, type ExportFormat, type ImportPreview, type ImportFormat, type Project, type ProjectSummary } from './api';
import { useProjectSession } from './useProjectSession';
import { useAudition } from './useAudition';
import { WorkspaceSplitter } from './WorkspaceSplitter';
import { WorkspaceHelp } from './WorkspaceHelp';
import { FilePathField } from './FilePathField';
import { bySubtitleCount, visibleSpeakers } from './trackOrder';
import { ProjectResources } from './ProjectResources';
import { usePreviewCopy } from './usePreviewCopy';
import { PreviewCopyControls } from './PreviewCopyControls';
import { SourceTimeline } from './SourceTimeline';
import { SubtitleList } from './SubtitleList';
import { activeEntryQuery } from './activeEntries';
import { useTimelineMedia } from './useTimelineMedia';
import { TimelineMediaControls } from './TimelineMediaControls';
import { BatchEditor } from './BatchEditor';
import { AddSubtitleDialog } from './AddSubtitleDialog';
import { MergeSubtitleDialog } from './MergeSubtitleDialog';
import { addSubtitle as addEntry, splitSubtitle as splitEntry, mergeSubtitles as mergeEntries, mergeSelection } from './structureEditing';
import { offsetSpeakers } from './selectionEditing';
import { SpeakerManager } from './SpeakerManager';
import { mergeSpeaker, removeSpeaker, reorderSpeaker, replaceSubtitles, resolveSpeaker, saveSpeaker, speakerDraftError, type SpeakerDraft } from './speakerEditing';

interface Draft { text: string; start: string; end: string; speaker: string }
const draftFor = (entry: Entry, project: Project): Draft => ({ text: entry.text, start: String(entry.start_ms), end: String(entry.end_ms), speaker: project.speakers.find(s => s.id === entry.speaker_id)!.label });
const exportLabels: Record<ExportFormat, string> = { 'speaker-srt': '说话人 SRT', 'plain-srt': '普通 SRT', 'normalized-jsonl': '项目 JSONL', 'moss-json': 'MOSS JSON' };

export function App() {
  const session = useProjectSession();
  const { project, dirty } = session;
  const [trackOrder, setTrackOrder] = useState<string[]>([]);
  const trackSpeakers = useMemo(() => visibleSpeakers(project?.speakers ?? [], trackOrder), [project?.speakers, trackOrder]);
  const previewCopy = usePreviewCopy(project);
  const waveform = useTimelineMedia(project, 'waveform');
  const thumbnails = useTimelineMedia(project, 'thumbnails');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const selected = selectedIds.size === 1 ? [...selectedIds][0] : null;
  function setSelected(id: string | null) { setSelectedIds(new Set(id ? [id] : [])); anchor.current = id; }
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldError, setFieldError] = useState<{ field: keyof Draft; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'new' | 'replace' | 'open' | 'help' | 'save-as' | 'relocate' | 'new-media' | null>(null);
  const [menu, setMenu] = useState<'file' | 'edit' | 'view' | null>(null);
  const workspace = useRef<HTMLElement>(null);
  const defaultLayout = () => ({ left: 20, right: 29, bottom: Math.round(window.innerHeight * .4) });
  const [layout, setLayout] = useState(defaultLayout);
  const [resourcesVisible, setResourcesVisible] = useState(true);
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
  const [showSpeakerNames, setShowSpeakerNames] = useState(true);
  const [search, setSearch] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState('');
  const [editorTab, setEditorTab] = useState<'subtitles' | 'speakers'>('subtitles');
  const [speakerDraft, setSpeakerDraft] = useState<SpeakerDraft | null>(null);
  const [speakerError, setSpeakerError] = useState('');
  const [timingPreview, setTimingPreview] = useState<Entry[] | null>(null);
  const [currentTrack, setCurrentTrack] = useState('');
  const [addition, setAddition] = useState<{ start: number; end: number; speakerId: string } | null>(null);
  const [merging, setMerging] = useState<Set<string> | null>(null);
  const timing = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const audition = useAudition(video, project, playing, setPosition, setError);
  const [jump, setJump] = useState('');
  const [jumpError, setJumpError] = useState('');
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
      const error = speakerDraftError(project, speakerDraft);
      if (error) {
        setSpeakerError(error);
        document.querySelector<HTMLInputElement>('.speaker-form input')?.focus();
        return null;
      }
      const next = saveSpeaker(project, { id: speakerDraft.id ?? crypto.randomUUID(), label: speakerDraft.label.trim(), color: speakerDraft.color });
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
    const resolved = resolveSpeaker(project, label, crypto.randomUUID());
    const next = { ...resolved.project, entries: project.entries.map(entry => entry.id === selected
      ? { ...entry, text: draft.text, start_ms: start, end_ms: end, speaker_id: resolved.speaker.id } : entry) };
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
    const next = snapshot && reorderSpeaker({ ...snapshot, speakers: visibleSpeakers(snapshot.speakers, trackOrder) }, source, target);
    if (next) {
      const after = next.speakers.map(s => s.id);
      session.commit(next, { before: trackSpeakers.map(s => s.id), after });
      setTrackOrder(after); setSpeakerDraft(null); setSpeakerError(''); setError('');
    }
  }

  function mergeSpeakers(source: string, target: string): boolean {
    const snapshot = commitDraft();
    const next = snapshot && mergeSpeaker(snapshot, source, target);
    if (!next) return false;
    commitSpeakers(next);
    return true;
  }

  function deleteSpeaker(source: string) {
    const snapshot = commitDraft();
    const next = snapshot && removeSpeaker(snapshot, source);
    if (next) commitSpeakers(next);
  }

  function choose(entry: Entry, modifiers?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    if (busy) return;
    const snapshot = commitDraft();
    if (!snapshot) return;
    const committed = snapshot.entries.find(item => item.id === entry.id)!;
    if (modifiers?.ctrlKey || modifiers?.metaKey || modifiers?.shiftKey) {
      const ids = new Set(selectedIds);
      if (modifiers.shiftKey) {
        const items = ordered(snapshot.entries);
        const from = items.findIndex(e => e.id === anchor.current), to = items.findIndex(e => e.id === entry.id);
        if (!modifiers.ctrlKey && !modifiers.metaKey) ids.clear();
        for (const item of items.slice(Math.min(from < 0 ? to : from, to), Math.max(from, to) + 1)) ids.add(item.id);
        if (from < 0) anchor.current = entry.id;
      } else {
        if (ids.has(entry.id)) ids.delete(entry.id); else ids.add(entry.id);
        anchor.current = entry.id;
      }
      setSelectedIds(ids);
      const single = ids.size === 1 ? snapshot.entries.find(e => ids.has(e.id)) : null;
      setDraft(single ? draftFor(single, snapshot) : null);
      setEditorTab('subtitles');
      return;
    }
    setSelected(committed.id); setDraft(draftFor(committed, snapshot));
    setEditorTab('subtitles');
    seek(committed.start_ms);
  }

  function accept(project: Project) {
    setTrackOrder(bySubtitleCount(project));
    audition.cancel(true); setJump(''); setJumpError('');
    setSearch(''); setSpeakerFilter('');
    video.current?.pause();
    session.open(project); setSelected(null); setDraft(null); setFieldError(null);
    setSpeakerDraft(null); setSpeakerError(''); setEditorTab('subtitles');
    setError(''); setPosition(0); setPlaying(false); setDialog(null); setCurrentTrack(''); setAddition(null); setMerging(null);
  }

  function selectIds(ids: Set<string>) {
    const snapshot = session.getProject();
    setSelectedIds(ids);
    const single = ids.size === 1 ? snapshot?.entries.find(e => ids.has(e.id)) : null;
    setDraft(single && snapshot ? draftFor(single, snapshot) : null);
    setEditorTab('subtitles'); setFieldError(null);
  }

  function beginTiming(id: string): Entry[] | null {
    const snapshot = commitDraft();
    const entry = snapshot?.entries.find(e => e.id === id);
    if (!snapshot || !entry) return null;
    video.current?.pause();
    timing.current = true;
    const entries = selectedIds.has(id) ? snapshot.entries.filter(e => selectedIds.has(e.id)) : [entry];
    if (!selectedIds.has(id)) setSelected(id);
    setDraft(entries.length === 1 ? draftFor(entry, snapshot) : null); setEditorTab('subtitles');
    return entries;
  }

  function previewTiming(entries: Entry[] | null) {
    setTimingPreview(entries);
    if (!entries) timing.current = false;
  }

  function commitTiming(entries: Entry[]) {
    const snapshot = session.getProject();
    if (!snapshot) return;
    const byId = new Map(entries.map(e => [e.id, e]));
    const next = { ...snapshot, entries: snapshot.entries.map(e => byId.get(e.id) ?? e) };
    session.commit(next); setDraft(entries.length === 1 ? draftFor(entries[0], next) : null); setFieldError(null); setError('');
  }

  async function persist(exporting = false) {
    if (busy || dialog || addition || merging) return;
    const snapshot = commitDraft();
    if (!snapshot) return;
    setError('');
    await session.persist(exporting ? { format: exportFormat, keep_tags: keepTags && exportFormat.endsWith('-srt') } : false);
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || timing.current) return;
      if (event.key === 'Escape' && (menu || dialog === 'help')) {
        event.preventDefault(); setMenu(null); if (dialog === 'help') setDialog(null); return;
      }
      if (addition || merging) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault();
        return;
      }
      const input = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); void persist();
      } else if (!dialog && !busy && event.key === 'Escape') {
        event.preventDefault();
        if (input || draftChanged || speakerDraft) cancelDraft();
        else { setSelected(null); setDraft(null); setFieldError(null); }
      } else if (!dialog && !busy && !input && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); history(event.shiftKey);
      } else if (!dialog && !busy && !input && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault(); if (!event.repeat) splitSubtitle();
      } else if (!dialog && !busy && !input && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
        event.preventDefault(); if (!event.repeat) beginMerge();
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
        } else if (event.key === 'Delete') {
          event.preventDefault(); deleteSelected();
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.file-menu')) setMenu(null); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  function moveSpeaker(offset: number) {
    const snapshot = commitDraft();
    if (!snapshot) return;
    const changes = offsetSpeakers(snapshot.entries.filter(e => selectedIds.has(e.id)), visibleSpeakers(snapshot.speakers, trackOrder), offset);
    if (!changes?.length) return;
    const byId = new Map(changes.map(e => [e.id, e]));
    const next = { ...snapshot, entries: snapshot.entries.map(e => byId.get(e.id) ?? e) };
    session.commit(next); setDraft(changes.length === 1 ? draftFor(changes[0], next) : null);
  }

  function assignSelected(speakerId: string) {
    const snapshot = commitDraft();
    if (!snapshot || !snapshot.speakers.some(s => s.id === speakerId)) return;
    session.commit({ ...snapshot, entries: snapshot.entries.map(e => selectedIds.has(e.id) ? { ...e, speaker_id: speakerId } : e) });
  }

  function deleteSelected() {
    const snapshot = commitDraft();
    if (!snapshot || !snapshot.entries.some(e => selectedIds.has(e.id))) return;
    session.commit({ ...snapshot, entries: snapshot.entries.filter(e => !selectedIds.has(e.id)) });
    setSelected(null); setDraft(null); setFieldError(null);
  }

  function beginAdd() {
    if (busy || timing.current) return;
    const snapshot = commitDraft();
    if (!snapshot) return;
    video.current?.pause();
    const start = Math.round((video.current?.currentTime ?? position / 1000) * 1000);
    if (start < 0 || start >= snapshot.media.duration_ms) return;
    const speakerId = snapshot.speakers.find(s => s.id === currentTrack)?.id ?? snapshot.speakers.find(s => s.label === '?')!.id;
    setAddition({ start, end: Math.min(start + 2000, snapshot.media.duration_ms), speakerId });
  }

  function splitSubtitle() {
    if (busy || timing.current || selectedIds.size !== 1) return;
    const snapshot = commitDraft();
    const entry = snapshot?.entries.find(e => selectedIds.has(e.id));
    if (!snapshot || !entry) return;
    const at = Math.round((video.current?.currentTime ?? position / 1000) * 1000);
    const result = splitEntry(snapshot, entry.id, at, [crypto.randomUUID(), crypto.randomUUID()]);
    if (!result) return;
    video.current?.pause();
    session.commit(result.project);
    setSelectedIds(new Set(result.parts.map(e => e.id))); anchor.current = result.parts[0].id;
    setDraft(null); setFieldError(null); setError(''); setEditorTab('subtitles');
  }

  function beginMerge() {
    if (busy || timing.current) return;
    const snapshot = commitDraft();
    const group = snapshot && mergeSelection(snapshot, selectedIds);
    if (!group) return;
    video.current?.pause();
    if (group.every(e => e.speaker_id === group[0].speaker_id)) mergeSubtitles(selectedIds, group[0].speaker_id);
    else setMerging(new Set(selectedIds));
  }

  function mergeSubtitles(ids: Set<string>, speakerId: string) {
    const snapshot = session.getProject();
    const result = snapshot && mergeEntries(snapshot, ids, speakerId, crypto.randomUUID());
    if (!result) return;
    const { project: next, entry } = result;
    session.commit(next); setSelected(entry.id); setDraft(draftFor(entry, next));
    setMerging(null); setFieldError(null); setError(''); setEditorTab('subtitles');
  }

  function addSubtitle(text: string, speakerId: string) {
    const snapshot = session.getProject();
    const result = snapshot && addition && addEntry(snapshot, addition, text, speakerId, crypto.randomUUID());
    if (!result) return;
    const { project: next, entry } = result;
    session.commit(next); setSelected(entry.id); setDraft(draftFor(entry, next)); setEditorTab('subtitles'); setAddition(null); setError('');
  }

  function history(redo: boolean) {
    if (!commitDraft()) return;
    const next = session.travel(redo);
    const restoredOrder = session.getRestoredTrackOrder();
    if (restoredOrder) setTrackOrder(restoredOrder);
    const ids = new Set(next?.entries.filter(e => selectedIds.has(e.id)).map(e => e.id));
    setSelectedIds(ids);
    if (!next?.entries.some(e => e.id === anchor.current)) anchor.current = null;
    const entry = ids.size === 1 ? next?.entries.find(e => ids.has(e.id)) : null;
    setDraft(entry && next ? draftFor(entry, next) : null); setFieldError(null); setError('');
  }

  async function showDialog(kind: NonNullable<typeof dialog>) {
    if (kind !== 'help' && session.isSaving()) return;
    setMenu(null); setError('');
    if (kind === 'replace') {
      const current = commitDraft();
      if (!current) return;
      setMediaPath(current.media.path); setSubtitlePath('');
    } else if (kind !== 'help' && project) {
      if (!commitDraft()) return;
      setBusy(true);
      const success = await session.persist();
      setBusy(false);
      if (!success) return;
    }
    if (kind !== 'help') session.pauseAutosave();
    if (kind === 'save-as' || kind === 'new-media') setName(`${session.getProject()?.name ?? '工程'}-副本`);
    if (kind === 'relocate' || kind === 'new-media') setMediaPath('');
    if (kind === 'open') {
      setBusy(true);
      try { setProjects(await api<ProjectSummary[]>('/projects')); setDialog(kind); }
      catch (reason) { report(reason); session.resumeAutosave(); }
      finally { setBusy(false); }
    } else { setPreview(null); setDialog(kind); }
  }

  async function chooseFile(kind: 'media' | 'subtitle') {
    if (busy) return;
    setBusy(true); setPicking(true); setError('');
    try {
      const result = await api<{ path: string | null }>('/files/pick', 'POST', {
        kind, format: importFormat, current_path: kind === 'media' ? mediaPath : subtitlePath,
      });
      if (result.path !== null) {
        if (kind === 'media') setMediaPath(result.path);
        else setSubtitlePath(result.path);
        setPreview(null);
      }
    } catch (reason) { report(reason); }
    finally { setPicking(false); setBusy(false); }
  }

  async function projectAction() {
    const current = session.getProject();
    if (!current || !['save-as', 'relocate', 'new-media'].includes(dialog ?? '')) return;
    setBusy(true); setError('');
    try {
      const body = dialog === 'relocate' ? { revision: current.revision, media_path: mediaPath.trim() }
        : { revision: current.revision, name, ...(dialog === 'new-media' ? { media_path: mediaPath.trim() } : {}) };
      const next = await api<Project>(`/projects/${current.id}/${dialog}`, 'POST', body);
      if (dialog === 'relocate') {
        audition.cancel(true); session.relocate(next); setDialog(null); session.resumeAutosave();
      } else accept(next);
    } catch (reason) { report(reason); }
    finally { setBusy(false); }
  }

  async function importAction(create: boolean) {
    setBusy(true); setError('');
    try {
      const body = { media_path: mediaPath.trim(), subtitle_path: subtitlePath.trim(), format: importFormat };
      if (create && dialog === 'replace' && preview) {
        const current = session.getProject()!;
        session.commit(replaceSubtitles(current, preview));
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
      await audition.play();
    } else video.current.pause();
  }

  const committedEntries = useMemo(() => ordered(project?.entries ?? []), [project?.entries]);
  const entries = useMemo(() => {
    if (!timingPreview) return committedEntries;
    const previewById = new Map(timingPreview.map(e => [e.id, e]));
    return ordered(committedEntries.map(e => previewById.get(e.id) ?? e));
  }, [committedEntries, timingPreview]);
  const shownDraft = timingPreview?.length === 1 && project ? draftFor(timingPreview[0], project) : draft;
  const duration = project?.media.duration_ms ?? 1;
  const queryActive = useMemo(() => activeEntryQuery(entries), [entries]);
  const queryOverlay = useMemo(() => activeEntryQuery(committedEntries), [committedEntries]);
  const activeIds = new Set(queryActive(position).map(e => e.id));
  const overlayEntries = queryOverlay(position);
  const mergeGroup = useMemo(() => project && mergeSelection(project, selectedIds), [project?.entries, selectedIds]);
  const speakerName = (id: string) => {
    const label = project?.speakers.find(s => s.id === id)?.label ?? '?';
    return label === '?' ? '未标注 ?' : label === 'NONSPEECH' ? '非对白 NONSPEECH' : label;
  };

  function seek(milliseconds: number) {
    audition.cancel();
    if (video.current) { video.current.pause(); video.current.currentTime = milliseconds / 1000; }
    setPosition(milliseconds);
  }

  function listen(entry: Entry, loop = false) {
    if (busy) return;
    const snapshot = commitDraft();
    if (snapshot) audition.start(entry.id, loop, snapshot);
  }

  function jumpToTime() {
    const match = /^(?:(\d+):([0-5]\d):)?([0-5]?\d)(?:[.,](\d{1,3}))?$/.exec(jump.trim());
    const ms = match ? ((Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3])) * 1000 + Number((match[4] ?? '').padEnd(3, '0'))) : NaN;
    if (!Number.isSafeInteger(ms) || ms < 0 || ms > duration) { setJumpError('请输入原片范围内的 HH:MM:SS.mmm 或 0–59 秒'); return; }
    setJumpError(''); seek(ms);
  }

  function beginResize(panel: 'left' | 'right' | 'bottom') {
    const element = workspace.current!;
    const width = element.clientWidth - 28; // padding and the two seven-pixel separators
    const left = element.querySelector('.resources')!.getBoundingClientRect().width;
    const right = element.querySelector('.editor')!.getBoundingClientRect().width;
    const bottom = element.parentElement!.querySelector('.timeline')!.getBoundingClientRect().height;
    const maxBottom = bottom + element.clientHeight - 220;
    const original = layout;
    return {
      move: (delta: number) => setLayout(panel === 'bottom' ? { ...original, bottom: Math.max(180, Math.min(maxBottom, bottom - delta)) }
        : { ...original, left: resourcesVisible ? (panel === 'left' ? Math.max(140, Math.min(width - right - 300, left + delta)) : left) / width * 100 : original.left,
          right: (panel === 'right' ? Math.max(280, Math.min(width - (resourcesVisible ? left : original.left / 100 * width) - 260, right - delta)) : right) / width * 100 }),
      cancel: () => setLayout(original),
    };
  }

  return <div className="app">
    <header className="menubar">
      <span className="brand">◈ 字幕校对</span>
      <div className="file-menu"><button onClick={() => setMenu(menu === 'file' ? null : 'file')} disabled={busy || session.saving}>文件</button>
        {menu === 'file' && <div className="menu-popup">
          <button onClick={() => void showDialog('new')}>新建工程…</button>
          <button onClick={() => void showDialog('open')}>打开工程…</button>
          <button disabled={!project} onClick={() => void showDialog('save-as')}>工程另存为…</button>
          <button disabled={!project} onClick={() => void showDialog('replace')}>替换工作字幕…</button>
          <button disabled={!project} onClick={() => { setMenu(null); void persist(); }}>保存</button>
          <button disabled={!project} onClick={() => { setMenu(null); void persist(true); }}>导出当前字幕</button>
        </div>}
      </div>
      <div className="file-menu"><button onClick={() => setMenu(menu === 'edit' ? null : 'edit')} disabled={!project || busy}>编辑</button>
        {menu === 'edit' && <div className="menu-popup">
          <button disabled={!selected} onClick={() => { if (!commitDraft()) return; setMenu(null); setEditorTab('subtitles'); requestAnimationFrame(() => textInput.current?.focus()); }}>编辑字幕正文</button>
          <button disabled={!session.canUndo && !draftChanged && !speakerChanged} onClick={() => { setMenu(null); history(false); }}>撤销编辑</button>
          <button disabled={!session.canRedo || draftChanged || speakerChanged} onClick={() => { setMenu(null); history(true); }}>重做编辑</button>
          <button disabled={position >= duration} onClick={() => { setMenu(null); beginAdd(); }}>新增字幕…</button>
          <button disabled={!current || position <= current.start_ms || position >= current.end_ms} onClick={() => { setMenu(null); splitSubtitle(); }}>在播放头拆分</button>
          <button disabled={!mergeGroup} onClick={() => { setMenu(null); beginMerge(); }}>合并连续选择</button>
          <button disabled={!selectedIds.size} onClick={() => { setMenu(null); deleteSelected(); }}>删除选择</button>
        </div>}
      </div>
      <div className="file-menu"><button onClick={() => setMenu(menu === 'view' ? null : 'view')}>视图</button>
        {menu === 'view' && <div className="menu-popup">
          <button disabled={!project} onClick={() => { if (commitDraft()) { setEditorTab('subtitles'); setMenu(null); } }}>字幕编辑页签</button>
          <button disabled={!project} onClick={() => { if (commitDraft()) { setEditorTab('speakers'); setMenu(null); } }}>说话人管理页签</button>
          <button aria-pressed={showSubtitles} onClick={() => { setShowSubtitles(!showSubtitles); setMenu(null); }}>显示工作字幕</button>
          <button aria-pressed={showSpeakerNames} onClick={() => { setShowSpeakerNames(!showSpeakerNames); setMenu(null); }}>显示人物名称</button>
           <button aria-pressed={resourcesVisible} onClick={() => { setResourcesVisible(!resourcesVisible); setMenu(null); }}>显示资源面板</button>
           <button onClick={() => { setLayout(defaultLayout()); setResourcesVisible(true); setMenu(null); }}>重置面板布局</button>
        </div>}
      </div>
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
      {session.saveError && <button disabled={busy || session.saving} onClick={() => {
        if (project && window.confirm('放弃本页面尚未保存的编辑与草稿，重新读取磁盘版本？取消会保留所有当前修改。')) {
          session.pauseAutosave(); void openProject(project.id);
        }
      }}>放弃修改并重开磁盘版本</button>}
      {session.exportError && <button onClick={() => void persist(true)}>重试导出</button>}
      {error && <button aria-label="关闭错误" onClick={() => setError('')}>×</button>}</div>}
    <main className={`workspace ${resourcesVisible ? '' : 'resources-hidden'}`} ref={workspace} style={{ gridTemplateColumns: resourcesVisible ? `minmax(150px, ${layout.left}fr) 7px minmax(260px, ${100 - layout.left - layout.right}fr) 7px minmax(280px, ${layout.right}fr)` : `0px 0px minmax(260px, ${100 - layout.right}fr) 7px minmax(280px, ${layout.right}fr)` }}>
      <aside className="resources panel" aria-label="工程资源" hidden={!resourcesVisible}>
        <h2>工程资源</h2>
        {project ? <><PreviewCopyControls preview={previewCopy} busy={busy || !!dialog} onGenerate={() => void previewCopy.generate(async () => !!commitDraft() && await session.persist())} />
          <TimelineMediaControls media={waveform} kind="波形" busy={busy || !!dialog} onGenerate={() => void waveform.generate(async () => !!commitDraft() && await session.persist())} />
          <TimelineMediaControls media={thumbnails} kind="缩略图" busy={busy || !!dialog} onGenerate={() => void thumbnails.generate(async () => !!commitDraft() && await session.persist())} />
          <ProjectResources key={project.id} project={project} busy={busy || session.saving} resourceVersion={`${previewCopy.resourceVersion}:${waveform.version}:${thumbnails.version}`}
          onRelocate={() => void showDialog('relocate')} onNewMedia={() => void showDialog('new-media')} />
          </>
          : <p className="muted">新建工程，选定本机视频与字幕（SRT / JSONL / MOSS JSON）；也可从“文件”菜单继续已有工程。</p>}
      </aside>
      <WorkspaceSplitter label="调整资源面板宽度" onBegin={() => beginResize('left')} />
      <section className="preview-panel panel" aria-label="视频预览">
        <h2>视频预览 <span>原片时间轴</span></h2>
        <div className="video-stage">
          {project ? <>
            <video key={`${project.id}:${previewCopy.src}`} ref={video} src={previewCopy.src} controls preload="auto"
              onLoadedMetadata={() => { if (video.current) { video.current.currentTime = position / 1000; video.current.playbackRate = audition.speed; setPlaying(!video.current.paused); } }}
              onLoadedData={event => previewCopy.decoded(event.currentTarget)}
              onTimeUpdate={() => { if (video.current?.videoWidth) audition.sync(); }} onEnded={audition.sync}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
              onError={previewCopy.failed} />
            {showSubtitles && <div className="subtitle-overlay" aria-label="播放字幕">{overlayEntries.map(entry => <div key={entry.id}>{showSpeakerNames && <span>[{project.speakers.find(s => s.id === entry.speaker_id)?.label ?? '?'}] </span>}{entry.text}</div>)}</div>}
          </> : <div className="empty-preview"><span>▷</span><p>视频与字幕，在同一时间线上</p></div>}
        </div>
        <div className="transport">
          <button onClick={() => void togglePlayback()} disabled={!project}>{playing ? '暂停' : '播放'}</button>
          <output aria-label="播放位置">{timeLabel(position)} / {project ? timeLabel(duration) : '—'}</output>
          <label><input type="checkbox" checked={showSubtitles} onChange={event => setShowSubtitles(event.target.checked)} />字幕</label>
          <label><input aria-label="叠加人物名称" type="checkbox" checked={showSpeakerNames} onChange={event => setShowSpeakerNames(event.target.checked)} />说话人</label>
        </div>
        <div className="review-transport">
          <label>速度<select aria-label="播放速度" value={audition.speed} onChange={event => audition.setSpeed(Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
          <button disabled={!current || busy} onClick={() => current && listen(current, true)}>循环当前字幕</button>
          <button disabled={!audition.range} onClick={() => audition.cancel(true)}>退出试听</button>
          <span role="status" aria-label="试听状态">{audition.range ? audition.range.loop ? '循环试听中' : '逐句试听中' : '自由播放'}</span>
          <form onSubmit={event => { event.preventDefault(); jumpToTime(); }}>
            <input aria-label="跳转时间" aria-invalid={!!jumpError} aria-describedby={jumpError ? 'jump-error' : undefined} placeholder="HH:MM:SS.mmm" value={jump} onChange={event => { setJump(event.target.value); setJumpError(''); }} />
            <button disabled={!project}>跳转</button>
          </form>
          {jumpError && <p id="jump-error" className="field-error">{jumpError}</p>}
        </div>
        <p className="hint">单击定位 · 双击逐句试听 · 循环后用“退出试听”停止 · Ctrl+S 保存</p>
      </section>
      <WorkspaceSplitter label="调整编辑面板宽度" onBegin={() => beginResize('right')} />
      <section className="editor panel" aria-label="字幕编辑器">
        <div className="editor-tabs" role="tablist" aria-label="编辑页签">
          <button role="tab" aria-label="字幕" aria-selected={editorTab === 'subtitles'} onClick={() => { if (commitDraft()) setEditorTab('subtitles'); }}>字幕 · {entries.length}</button>
          <button role="tab" aria-selected={editorTab === 'speakers'} onClick={() => { if (commitDraft()) setEditorTab('speakers'); }}>说话人</button>
        </div>
        {editorTab === 'speakers' ? project ? <SpeakerManager project={{ ...project, speakers: trackSpeakers }} draft={speakerDraft} error={speakerError} busy={busy}
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
        <div className="subtitle-filters">
          <input aria-label="搜索字幕" type="search" placeholder="搜索字幕正文" value={search} onChange={event => setSearch(event.target.value)} />
          <select aria-label="筛选说话人" value={project?.speakers.some(s => s.id === speakerFilter) ? speakerFilter : ''} onChange={event => setSpeakerFilter(event.target.value)}>
            <option value="">全部说话人</option>{project?.speakers.map(s => <option key={s.id} value={s.id}>{speakerName(s.id)}</option>)}
          </select>
          <button aria-label="清除筛选" title="清除筛选" onClick={() => { setSearch(''); setSpeakerFilter(''); }} disabled={!search && !speakerFilter}>×</button>
        </div>
        <SubtitleList entries={entries} speakers={project?.speakers ?? []} selected={selectedIds} active={activeIds}
          search={search} speakerFilter={speakerFilter} busy={busy} onChoose={choose} onListen={listen} />
        {selectedIds.size > 1 && project ? <BatchEditor key={[...selectedIds].sort().join(',')} project={project}
          entries={entries.filter(e => selectedIds.has(e.id))} busy={busy || timing.current} onAssign={assignSelected} /> : draft ? <div className="entry-editor" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commitDraft();
        }}>
          <label>字幕正文<textarea ref={textInput} {...fieldProps('text')} value={shownDraft!.text} disabled={busy || !!timingPreview}
            onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
          <div className="time-fields">
            <label>开始时间（毫秒）<input ref={startInput} {...fieldProps('start')} type="number" step="1" value={shownDraft!.start} disabled={busy || !!timingPreview}
              onChange={event => setDraft({ ...draft, start: event.target.value })} /></label>
            <label>结束时间（毫秒）<input ref={endInput} {...fieldProps('end')} type="number" step="1" value={shownDraft!.end} disabled={busy || !!timingPreview}
              onChange={event => setDraft({ ...draft, end: event.target.value })} /></label>
          </div>
          <label>说话人归属<select aria-label="说话人归属" value={project?.speakers.some(s => s.label === shownDraft!.speaker) ? shownDraft!.speaker : ''} disabled={busy || !!timingPreview} onChange={event => setDraft({ ...draft, speaker: event.target.value })}>
            <option value="" disabled>输入新的说话人名称</option>
            {project?.speakers.map(s => <option value={s.label} key={s.id}>{speakerName(s.id)}</option>)}
          </select></label>
          <label>说话人名称<input ref={speakerInput} {...fieldProps('speaker')} value={shownDraft!.speaker} disabled={busy || !!timingPreview}
            onChange={event => setDraft({ ...draft, speaker: event.target.value })} /></label>
          <button disabled={busy || !draftChanged} onClick={() => commitDraft()}>应用修改</button>
          <button disabled={busy || !draftChanged} onClick={cancelDraft}>取消修改</button>
          {fieldError && <p id="entry-field-error" className="field-error">{fieldError.message}</p>}
          <p className="hint">离开编辑区或应用修改时提交，随后自动保存。保存/导出先校验输入；Esc 取消草稿。</p>
        </div> : <p className="muted editor-prompt">选择一条字幕，开始校对</p>}
        </>}
      </section>
    </main>
    <WorkspaceSplitter label="调整上下分区高度" horizontal onBegin={() => beginResize('bottom')} />
    <section className="timeline panel" aria-label="原片时间轴" style={{ height: `clamp(210px, ${layout.bottom}px, calc(100% - 310px))` }}>
      <div className="timeline-toolbar"><h2>时间轴</h2>
        <button disabled={busy || (!session.canUndo && !draftChanged && !speakerChanged)} onClick={() => history(false)}>撤销</button>
        <button disabled={busy || !session.canRedo || draftChanged || speakerChanged} onClick={() => history(true)}>重做</button>
        <button disabled={busy || !selectedIds.size || timing.current} onClick={deleteSelected}>删除选中字幕</button>
        <button disabled={!project || busy || timing.current || position >= duration} onClick={beginAdd}>新增字幕</button>
        <button disabled={busy || timing.current || !current || position <= current.start_ms || position >= current.end_ms} onClick={splitSubtitle} title="Ctrl+B · 单选且播放头严格位于内部，两段复制全文">拆分字幕</button>
        <button disabled={busy || timing.current || !mergeGroup} onClick={beginMerge} title="Ctrl+M · 全体工作字幕时间排序中连续多选">合并字幕</button>
        <select aria-label="当前说话人轨" value={project?.speakers.some(s => s.id === currentTrack) ? currentTrack : ''} disabled={!project || busy || timing.current} onChange={event => setCurrentTrack(event.target.value)}>
          <option value="">未明确轨道 → ?</option>
          {project?.speakers.map(s => <option key={s.id} value={s.id}>{speakerName(s.id)}</option>)}
        </select>
        <span className="muted">视频轨锁定 · 合法重叠保留</span></div>
      {project ? <SourceTimeline key={project.id} project={project} selected={selectedIds} position={position} busy={busy}
        waveform={waveform.url} thumbnails={thumbnails.url} thumbnailVersion={thumbnails.version} speakers={trackSpeakers}
        onSort={() => { const snapshot = commitDraft(); if (snapshot) setTrackOrder(bySubtitleCount(snapshot)); }}
        onStoredOrder={() => setTrackOrder(project.speakers.map(s => s.id))}
        onGenerateThumbnails={() => void thumbnails.generate(async () => !!commitDraft() && await session.persist())}
        onGenerateWaveform={() => void waveform.generate(async () => !!commitDraft() && await session.persist())}
        generatingThumbnails={thumbnails.busy} generatingWaveform={waveform.busy}
        currentTrack={currentTrack} onTrack={setCurrentTrack}
        onBeginSelect={() => { if (!commitDraft()) return false; timing.current = true; return true; }}
        onSelect={selectIds} onEndSelect={() => { timing.current = false; }}
        onChoose={choose} onListen={listen} onSeek={seek} onBeginEdit={beginTiming} onPreview={previewTiming} onCommitEdit={commitTiming} /> : <div className="timeline-empty">工程打开后将在此显示原片与工作字幕</div>}
    </section>
    {addition && project && <AddSubtitleDialog {...addition} speakers={project.speakers} onAdd={addSubtitle} onCancel={() => setAddition(null)} />}
    {merging && project && <MergeSubtitleDialog count={merging.size} speakers={project.speakers} onMerge={speakerId => mergeSubtitles(merging, speakerId)} onCancel={() => setMerging(null)} />}
    {dialog && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="dialog">
      <header><h2 id="dialog-title">{{ new: '新建编辑工程', replace: '整体替换工作字幕', open: '打开工程', help: '使用帮助', 'save-as': '工程另存为', relocate: '重新定位同一原片', 'new-media': '用新视频建立工程' }[dialog]}</h2>
        <button disabled={busy} aria-label="关闭对话框" onClick={() => { setDialog(null); if (dialog !== 'help') session.resumeAutosave(); }}>×</button></header>
      {error && <p role="alert" className="error">{error}</p>}
      {picking && <p role="status" className="hint">请在系统文件选择窗口中选择文件或取消。如果窗口在后台，请切换到该窗口。</p>}
      {(dialog === 'save-as' || dialog === 'relocate' || dialog === 'new-media') && <>
        <p className="hint">{dialog === 'relocate' ? '仅接受内容身份完全相同的原片。移动、重命名可恢复，重新编码或换片请新建工程。' : '复制完整工作字幕、人物配置与来源关系，产生独立工程。原视频按路径引用；已有导出与缓存留在原工程。'}</p>
        {dialog !== 'relocate' && <label>副本工程名称<input disabled={busy} value={name} onChange={event => setName(event.target.value)} /></label>}
        {dialog !== 'save-as' && <FilePathField label="新视频绝对路径" button="选择视频…" disabled={busy} value={mediaPath} onChange={setMediaPath} onPick={() => void chooseFile('media')} />}
        {dialog === 'new-media' && <p className="hint">带入当前字幕副本，按新原片时长验证全部字幕。越界失败不会修改当前工程。</p>}
        <button disabled={busy || (dialog !== 'relocate' && !name.trim()) || (dialog !== 'save-as' && !mediaPath.trim())} onClick={() => void projectAction()}>{dialog === 'relocate' ? '验证并重新定位' : '创建独立副本'}</button>
      </>}
      {(dialog === 'new' || dialog === 'replace') && <>
        <p className="muted">视频和字幕保留在原路径，校对结果保存为独立工程。原片不兼容时可在资源区生成保持原片时间的预览副本。</p>
        {dialog === 'new' && <label>工程名称<input value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>}
        <FilePathField label="视频绝对路径" button="选择视频…" value={mediaPath} disabled={busy || dialog === 'replace'} onChange={value => { setMediaPath(value); setPreview(null); }} onPick={() => void chooseFile('media')} />
        <label>导入格式<select value={importFormat} disabled={busy} onChange={event => { setImportFormat(event.target.value as ImportFormat); setPreview(null); }}>
          <option value="plain-srt">普通 SRT · 全文保留，未标注 ?</option>
          <option value="speaker-srt">本项目 SRT · [Speaker] 与已知元标签</option>
          <option value="moss-srt">MOSS SRT · Speaker: 正文</option>
          <option value="normalized-jsonl">本项目 normalized JSONL</option>
          <option value="moss-json">MOSS JSON · 五字段数组</option>
        </select></label>
        <FilePathField label="字幕绝对路径" button="选择字幕…" value={subtitlePath} disabled={busy} onChange={value => { setSubtitlePath(value); setPreview(null); }} onPick={() => void chooseFile('subtitle')} />
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
        {item.media && <small className="path">{item.media_missing ? '原片失联 · 字幕可编辑' : '原片路径'} · {item.media.path}</small>}
      </div>) : <p>尚无工程，请先新建。</p>}</div>}
      {dialog === 'help' && <WorkspaceHelp />}
    </section></div>}
  </div>;
}
