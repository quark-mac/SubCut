import { useEffect, useMemo, useRef, useState } from 'react';
import { api, editableSelection, editableSpeaker, ordered, timeLabel, parseTimecode, visibleEntries, type Entry, type ExportFormat, type ImportPreview, type ImportFormat, type Project } from './api';
import { ProjectBrowser } from './ProjectBrowser';
import { SpeakerColorDialog } from './SpeakerColorDialog';
import { IconButton, IconToggle } from './IconButton';
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
import { deleteTrack, mergeSpeaker, removeSpeaker, reorderSpeaker, replaceSubtitles, resolveSpeaker, saveSpeaker, speakerDraftError, type SpeakerDraft } from './speakerEditing';

interface Draft { text: string; start: string; end: string; speaker: string }
const draftFor = (entry: Entry, project: Project): Draft => ({ text: entry.text, start: timeLabel(entry.start_ms), end: timeLabel(entry.end_ms), speaker: project.speakers.find(s => s.id === entry.speaker_id)!.label });
const exportLabels: Record<ExportFormat, string> = { 'speaker-srt': '说话人 SRT', 'plain-srt': '普通 SRT', 'normalized-jsonl': '项目 JSONL', 'moss-json': 'MOSS JSON' };

export function App() {
  const [colorPreview, setColorPreview] = useState(false);
  const session = useProjectSession();
  const { project, dirty } = session;
  const [trackOrder, setTrackOrder] = useState<string[]>([]);
  const trackSpeakers = useMemo(() => visibleSpeakers(project?.speakers ?? [], trackOrder), [project?.speakers, trackOrder]);
  const visibleProject = useMemo(() => project && { ...project, entries: visibleEntries(project) }, [project]);
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
  const [name, setName] = useState('新建校对工程');
  const [mediaPath, setMediaPath] = useState('');
  const [subtitlePath, setSubtitlePath] = useState('');
  const [importFormat, setImportFormat] = useState<ImportFormat>('plain-srt');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('speaker-srt');
  const [keepTags, setKeepTags] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const videoStage = useRef<HTMLDivElement>(null);
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
  const audition = useAudition(video, visibleProject, playing, setPosition, setError);
  const [jump, setJump] = useState('');
  const [jumpError, setJumpError] = useState('');
  const textInput = useRef<HTMLTextAreaElement>(null);
  const startInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);
  const speakerInput = useRef<HTMLInputElement>(null);
  const current = project?.entries.find(entry => entry.id === selected);
  const selectionEditable = !!project && editableSelection(project, selectedIds);
  const currentLocked = !!project?.speakers.some(s => s.id === current?.speaker_id && s.locked);
  const draftChanged = !!(project && current && draft && JSON.stringify(draftFor(current, project)) !== JSON.stringify(draft));
  const speakerOriginal = project?.speakers.find(s => s.id === speakerDraft?.id);
  const speakerChanged = !!speakerDraft && (!speakerOriginal || speakerOriginal.label !== speakerDraft.label || speakerOriginal.color !== speakerDraft.color);
  const unsaved = dirty || draftChanged || speakerChanged;

  useEffect(() => {
    const allowed = new Set(visibleProject?.entries.map(e => e.id));
    if ([...selectedIds].some(id => !allowed.has(id))) {
      const next = new Set([...selectedIds].filter(id => allowed.has(id)));
      setSelectedIds(next);
      const single = next.size === 1 ? project?.entries.find(e => next.has(e.id)) : null;
      setDraft(single && project ? draftFor(single, project) : null); setFieldError(null);
    }
    if (anchor.current && !allowed.has(anchor.current)) anchor.current = null;
    if (audition.range && !allowed.has(audition.range.id)) audition.cancel(true);
    if (currentTrack && !project?.speakers.some(s => s.id === currentTrack && editableSpeaker(s))) setCurrentTrack('');
    if (speakerFilter && !project?.speakers.some(s => s.id === speakerFilter && s.visible !== false)) setSpeakerFilter('');
  }, [project?.entries, project?.speakers]);

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
    if (!editableSelection(project, new Set([current.id]))) return invalid('text', '该轨道已锁定或隐藏，请先解锁并显示');
    if (!draft.text.trim()) {
      return invalid('text', '字幕正文不能为空');
    }
    const start = parseTimecode(draft.start), end = parseTimecode(draft.end);
    if (start === null || (end !== null && start >= end)) {
      return invalid('start', '开始时间须为 HH:MM:SS,mmm，且早于结束时间');
    }
    if (end === null || end <= start || end > project.media.duration_ms) {
      return invalid('end', '结束时间须为 HH:MM:SS,mmm，大于开始且不超过原片时长');
    }
    const label = draft.speaker.trim();
    if (!label) return invalid('speaker', '说话人名称不能为空');
    if (project.speakers.some(s => s.label === label && s.visible === false)) return invalid('speaker', '该轨道已隐藏，请先显示轨道');
    if (project.speakers.some(s => s.label === label && s.locked)) return invalid('speaker', '目标轨道已锁定，请先解锁');
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

  function toggleSpeaker(id: string) {
    if (busy || timing.current) return;
    const snapshot = commitDraft();
    if (!snapshot) return;
    session.commit({ ...snapshot, speakers: snapshot.speakers.map(s => s.id === id ? { ...s, visible: s.visible === false } : s) });
  }

  function lockSpeaker(id: string) {
    if (busy || timing.current) return;
    const snapshot = commitDraft();
    if (!snapshot) return;
    const locked = id === 'overview' ? !snapshot.speakers.every(s => s.locked) : !snapshot.speakers.find(s => s.id === id)?.locked;
    const speakers = visibleSpeakers(snapshot.speakers, trackOrder).map(s => id === 'overview' || s.id === id ? { ...s, locked } : s);
    session.commit({ ...snapshot, speakers }, { before: trackSpeakers.map(s => s.id), after: speakers.map(s => s.id) });
  }

  function manageSpeaker(id: string) {
    const snapshot = commitDraft();
    const speaker = snapshot?.speakers.find(s => s.id === id);
    if (!speaker) return;
    setEditorTab('speakers'); setSpeakerDraft(speaker.locked ? null : speaker); setSpeakerError('');
    requestAnimationFrame(() => document.querySelector(`[data-speaker-card="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }

  function deleteSpeakerTrack(id: string) {
    const snapshot = commitDraft();
    const speaker = snapshot?.speakers.find(s => s.id === id);
    if (!snapshot || !speaker || speaker.locked) return;
    const count = snapshot.entries.filter(e => e.speaker_id === id).length;
    if (!window.confirm(`删除「${speaker.label}」轨道及其 ${count} 条字幕？可以撤销。`)) return;
    const next = deleteTrack(snapshot, id);
    if (next) commitSpeakers(next);
  }

  function choose(entry: Entry, modifiers?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    if (busy) return;
    const snapshot = commitDraft();
    if (!snapshot) return;
    const committed = snapshot.entries.find(item => item.id === entry.id)!;
    if (!committed || !snapshot.speakers.some(s => s.id === committed.speaker_id && s.visible !== false)) return;
    if (modifiers?.ctrlKey || modifiers?.metaKey || modifiers?.shiftKey) {
      const ids = new Set(selectedIds);
      if (modifiers.shiftKey) {
        const items = ordered(visibleEntries(snapshot));
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
    const allowed = new Set(snapshot && visibleEntries(snapshot).map(e => e.id));
    ids = new Set([...ids].filter(id => allowed.has(id)));
    setSelectedIds(ids);
    const single = ids.size === 1 ? snapshot?.entries.find(e => ids.has(e.id)) : null;
    setDraft(single && snapshot ? draftFor(single, snapshot) : null);
    setEditorTab('subtitles'); setFieldError(null);
  }

  function beginTiming(id: string): Entry[] | null {
    const snapshot = commitDraft();
    const entry = snapshot && visibleEntries(snapshot).find(e => e.id === id);
    if (!snapshot || !entry || !editableSelection(snapshot, selectedIds.has(id) ? selectedIds : new Set([id]))) return null;
    video.current?.pause();
    timing.current = true;
    const entries = selectedIds.has(id) ? visibleEntries(snapshot).filter(e => selectedIds.has(e.id)) : [entry];
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
    if (!snapshot || !editableSelection(snapshot, new Set(entries.map(e => e.id))) || entries.some(e => !snapshot.speakers.some(s => s.id === e.speaker_id && editableSpeaker(s)))) return;
    const byId = new Map(entries.map(e => [e.id, e]));
    const next = { ...snapshot, entries: snapshot.entries.map(e => byId.get(e.id) ?? e) };
    session.commit(next); setDraft(entries.length === 1 ? draftFor(entries[0], next) : null); setFieldError(null); setError('');
  }

  async function persist(exporting = false) {
    if (busy || dialog || addition || merging || colorPreview) return;
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
      if (addition || merging || colorPreview) {
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
          const items = ordered(visibleEntries(snapshot));
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
    const changes = offsetSpeakers(visibleEntries(snapshot).filter(e => selectedIds.has(e.id)), visibleSpeakers(snapshot.speakers, trackOrder).filter(s => s.visible !== false), offset);
    if (!changes?.length) return;
    const byId = new Map(changes.map(e => [e.id, e]));
    const next = { ...snapshot, entries: snapshot.entries.map(e => byId.get(e.id) ?? e) };
    session.commit(next); setDraft(changes.length === 1 ? draftFor(changes[0], next) : null);
  }

  function assignSelected(speakerId: string) {
    const snapshot = commitDraft();
    if (!snapshot || !editableSelection(snapshot, selectedIds) || !snapshot.speakers.some(s => s.id === speakerId && editableSpeaker(s))) return;
    session.commit({ ...snapshot, entries: snapshot.entries.map(e => selectedIds.has(e.id) ? { ...e, speaker_id: speakerId } : e) });
  }

  function deleteSelected() {
    const snapshot = commitDraft();
    if (!snapshot || !editableSelection(snapshot, selectedIds)) return;
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
    const available = trackSpeakers.filter(editableSpeaker);
    const speakerId = available.find(s => s.id === currentTrack)?.id ?? available.find(s => s.label === '?')?.id ?? available[0]?.id;
    if (!speakerId) return;
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
    const ids = new Set(next && visibleEntries(next).filter(e => selectedIds.has(e.id)).map(e => e.id));
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
      if (current.speakers.some(s => s.locked)) { setError('请先解锁全部轨道再整体替换字幕'); return; }
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
    setPreview(null); setDialog(kind);
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

  const committedEntries = useMemo(() => ordered(visibleProject?.entries ?? []), [visibleProject?.entries]);
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
  const mergeGroup = useMemo(() => project && mergeSelection(project, selectedIds), [project?.entries, project?.speakers, selectedIds]);
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
    if (snapshot) audition.start(entry.id, loop, { ...snapshot, entries: visibleEntries(snapshot) });
  }

  function jumpToTime() {
    const ms = parseTimecode(jump);
    if (ms === null || ms > duration) { setJumpError('请输入原片范围内的 HH:MM:SS,mmm'); return; }
    setJumpError(''); seek(ms);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await videoStage.current?.requestFullscreen();
    } catch (reason) { report(reason); }
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
      <span className="brand">◈ SubCut</span>
      <div className="file-menu"><button onClick={() => setMenu(menu === 'file' ? null : 'file')} disabled={busy || session.saving}>文件</button>
        {menu === 'file' && <div className="menu-popup">
          <button onClick={() => void showDialog('new')}>新建工程…</button>
          <button onClick={() => void showDialog('open')}>打开工程…</button>
          <button onClick={() => void showDialog('open')}>管理工程 / 回收站…</button>
          <button disabled={!project} onClick={() => void showDialog('save-as')}>工程另存为…</button>
          <button disabled={!project} onClick={() => void showDialog('replace')}>替换工作字幕…</button>
          <button disabled={!project} onClick={() => { setMenu(null); void persist(); }}>保存</button>
          <button disabled={!project} onClick={() => { setMenu(null); void persist(true); }}>导出当前字幕</button>
        </div>}
      </div>
      <div className="file-menu"><button onClick={() => setMenu(menu === 'edit' ? null : 'edit')} disabled={!project || busy}>编辑</button>
        {menu === 'edit' && <div className="menu-popup">
          <button disabled={!selected || currentLocked} onClick={() => { if (!commitDraft()) return; setMenu(null); setEditorTab('subtitles'); requestAnimationFrame(() => textInput.current?.focus()); }}>编辑字幕正文</button>
          <button disabled={!session.canUndo && !draftChanged && !speakerChanged} onClick={() => { setMenu(null); history(false); }}>撤销编辑</button>
          <button disabled={!session.canRedo || draftChanged || speakerChanged} onClick={() => { setMenu(null); history(true); }}>重做编辑</button>
           <button disabled={position >= duration || !trackSpeakers.some(editableSpeaker)} onClick={() => { setMenu(null); beginAdd(); }}>新增字幕…</button>
          <button disabled={!current || currentLocked || position <= current.start_ms || position >= current.end_ms} onClick={() => { setMenu(null); splitSubtitle(); }}>在播放头拆分</button>
          <button disabled={!mergeGroup} onClick={() => { setMenu(null); beginMerge(); }}>合并连续选择</button>
          <button disabled={!selectionEditable} onClick={() => { setMenu(null); deleteSelected(); }}>删除选择</button>
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
        <IconButton icon="FolderPlus" label="新建工程" onClick={() => void showDialog('new')} disabled={busy || session.saving} />
        <IconButton icon="FileInput" label="替换字幕" onClick={() => void showDialog('replace')} disabled={!project || busy || session.saving} />
        <IconButton icon="Save" label="保存工程" onClick={() => void persist()} disabled={!project || busy} />
        <select aria-label="导出格式" value={exportFormat} onChange={event => setExportFormat(event.target.value as ExportFormat)}>
          {Object.entries(exportLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <IconToggle icon="ListFilter" label="保留已有元标签" checked={keepTags} disabled={!exportFormat.endsWith('-srt')} onChange={event => setKeepTags(event.target.checked)} />
        <IconButton icon="Download" label={`导出${exportLabels[exportFormat]}`} className="primary" onClick={() => void persist(true)} disabled={!project || busy} />
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
        {project ? <ProjectResources key={project.id} project={project} busy={busy || session.saving} resourceVersion={`${previewCopy.resourceVersion}:${waveform.version}:${thumbnails.version}`}
          onRelocate={() => void showDialog('relocate')} onNewMedia={() => void showDialog('new-media')}>
          <PreviewCopyControls preview={previewCopy} busy={busy || !!dialog} onGenerate={() => void previewCopy.generate(async () => !!commitDraft() && await session.persist())} />
          <TimelineMediaControls media={waveform} kind="波形" busy={busy || !!dialog} onGenerate={() => void waveform.generate(async () => !!commitDraft() && await session.persist())} />
          <TimelineMediaControls media={thumbnails} kind="缩略图" busy={busy || !!dialog} onGenerate={() => void thumbnails.generate(async () => !!commitDraft() && await session.persist())} />
          </ProjectResources>
          : <><h2>工程资源</h2><button className="import-tile" onClick={() => void showDialog('new')}><span>＋</span>导入视频与字幕</button></>}
      </aside>
      <WorkspaceSplitter label="调整资源面板宽度" onBegin={() => beginResize('left')} />
      <section className="preview-panel panel" aria-label="视频预览">
        <h2>视频预览 <span>原片时间轴</span></h2>
        <div className="video-stage" ref={videoStage}>
          {project ? <>
            <video key={`${project.id}:${previewCopy.src}`} ref={video} src={previewCopy.src} preload="auto" muted={muted} playsInline
              onLoadedMetadata={() => { if (video.current) { video.current.currentTime = position / 1000; video.current.playbackRate = audition.speed; video.current.volume = volume; setPlaying(!video.current.paused); } }}
              onLoadedData={event => previewCopy.decoded(event.currentTarget)}
              onTimeUpdate={() => { if (video.current?.videoWidth) audition.sync(); }} onEnded={audition.sync}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
              onError={previewCopy.failed} />
            {showSubtitles && <div className="subtitle-overlay" aria-label="播放字幕">{overlayEntries.map(entry => {
              const speaker = project.speakers.find(s => s.id === entry.speaker_id);
              return <div key={entry.id}>{showSpeakerNames && <span className="overlay-speaker" style={{ color: speaker?.color }}>[{speaker?.label ?? '?'}] </span>}{entry.text}</div>;
            })}</div>}
            <div className="fullscreen-controls"><IconButton icon={playing ? 'Pause' : 'Play'} label="全屏播放暂停" onClick={() => void togglePlayback()} /><IconButton icon="Minimize" label="退出全屏" onClick={() => void toggleFullscreen()} /></div>
          </> : <div className="empty-preview"><span>▷</span><p>视频与字幕，在同一时间线上</p></div>}
        </div>
        <div className="transport">
          <IconButton icon={playing ? 'Pause' : 'Play'} label={playing ? '暂停' : '播放'} onClick={() => void togglePlayback()} disabled={!project} />
          <output aria-label="播放位置">{timeLabel(position)} / {project ? timeLabel(duration) : '—'}</output>
          <IconToggle icon="Captions" label="字幕" checked={showSubtitles} onChange={event => setShowSubtitles(event.target.checked)} />
          <IconToggle icon="UserRound" label="叠加人物名称" checked={showSpeakerNames} onChange={event => setShowSpeakerNames(event.target.checked)} />
          <IconButton icon={muted || volume === 0 ? 'VolumeX' : 'Volume2'} label={muted ? '取消静音' : '静音'} aria-pressed={muted} onClick={() => setMuted(!muted)} disabled={!project} />
          <input className="volume-slider" aria-label="音量" title="音量" type="range" min="0" max="1" step="0.05" value={volume} disabled={!project} onChange={event => { const value = Number(event.target.value); setVolume(value); setMuted(false); if (video.current) video.current.volume = value; }} />
          <IconButton icon="Maximize" label="全屏" disabled={!project} onClick={() => void toggleFullscreen()} />
        </div>
        <div className="review-transport">
          <select aria-label="播放速度" title="播放速度" value={audition.speed} onChange={event => audition.setSpeed(Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select>
          <IconButton icon="Repeat2" label="循环当前字幕" disabled={!current || busy} aria-pressed={!!audition.range?.loop} onClick={() => current && listen(current, true)} />
          <IconButton icon="Square" label="退出试听" disabled={!audition.range} onClick={() => audition.cancel(true)} />
          <span className="sr-only" role="status" aria-label="试听状态">{audition.range ? audition.range.loop ? '循环试听中' : '逐句试听中' : '自由播放'}</span>
          <form onSubmit={event => { event.preventDefault(); jumpToTime(); }}>
            <input aria-label="跳转时间" aria-invalid={!!jumpError} aria-describedby={jumpError ? 'jump-error' : undefined} placeholder="00:00:00,000" value={jump} onChange={event => { setJump(event.target.value); setJumpError(''); }} />
            <IconButton icon="SkipForward" label="跳转" type="submit" disabled={!project} />
          </form>
          {jumpError && <p id="jump-error" className="field-error">{jumpError}</p>}
        </div>
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
          onDeleteTrack={deleteSpeakerTrack} onLock={lockSpeaker} onOptimize={() => setColorPreview(true)}
          onCancel={() => { setSpeakerDraft(null); setSpeakerError(''); }} /> : <p className="editor-prompt muted">请先打开工程</p> : <>
        <h2>字幕 <span>{entries.length} 条</span></h2>
        <div className="subtitle-filters">
          <input aria-label="搜索字幕" type="search" placeholder="搜索字幕正文" value={search} onChange={event => setSearch(event.target.value)} />
          <select aria-label="筛选说话人" value={project?.speakers.some(s => s.id === speakerFilter) ? speakerFilter : ''} onChange={event => setSpeakerFilter(event.target.value)}>
            <option value="">全部说话人</option>{project?.speakers.filter(s => s.visible !== false).map(s => <option key={s.id} value={s.id}>{speakerName(s.id)}</option>)}
          </select>
          <IconButton icon="X" label="清除筛选" onClick={() => { setSearch(''); setSpeakerFilter(''); }} disabled={!search && !speakerFilter} />
        </div>
        <SubtitleList entries={entries} speakers={project?.speakers ?? []} selected={selectedIds} active={activeIds}
          search={search} speakerFilter={speakerFilter} busy={busy} onChoose={choose} onListen={listen} />
        {selectedIds.size > 1 && project ? <BatchEditor key={[...selectedIds].sort().join(',')} project={project}
          entries={entries.filter(e => selectedIds.has(e.id))} busy={busy || timing.current || !selectionEditable} onAssign={assignSelected} /> : draft ? <div className="entry-editor" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commitDraft();
        }}>
          {currentLocked && <small className="hint">轨道已锁定 · 解锁后编辑</small>}
          <label>字幕正文<textarea aria-label="字幕正文" ref={textInput} {...fieldProps('text')} value={shownDraft!.text} disabled={busy || !!timingPreview || currentLocked}
            onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
          <div className="time-fields">
            <label>开始时间<input ref={startInput} {...fieldProps('start')} placeholder="00:00:00,000" value={shownDraft!.start} disabled={busy || !!timingPreview || currentLocked}
              onChange={event => setDraft({ ...draft, start: event.target.value })} /></label>
            <label>结束时间<input ref={endInput} {...fieldProps('end')} placeholder="00:00:00,000" value={shownDraft!.end} disabled={busy || !!timingPreview || currentLocked}
              onChange={event => setDraft({ ...draft, end: event.target.value })} /></label>
          </div>
          <label>说话人归属<select aria-label="说话人归属" value={project?.speakers.some(s => s.label === shownDraft!.speaker) ? shownDraft!.speaker : ''} disabled={busy || !!timingPreview || currentLocked} onChange={event => setDraft({ ...draft, speaker: event.target.value })}>
            <option value="" disabled>输入新的说话人名称</option>
            {project?.speakers.filter(s => s.visible !== false).map(s => <option disabled={s.locked} value={s.label} key={s.id}>{speakerName(s.id)}</option>)}
          </select></label>
          <label>说话人名称<input ref={speakerInput} {...fieldProps('speaker')} value={shownDraft!.speaker} disabled={busy || !!timingPreview || currentLocked}
            onChange={event => setDraft({ ...draft, speaker: event.target.value })} /></label>
          <div className="button-row"><IconButton icon="Check" label="应用修改" disabled={busy || !draftChanged} onClick={() => commitDraft()} />
          <IconButton icon="X" label="取消修改" disabled={busy || !draftChanged} onClick={cancelDraft} /></div>
          {fieldError && <p id="entry-field-error" className="field-error">{fieldError.message}</p>}
        </div> : <p className="muted editor-prompt">选择一条字幕，开始校对</p>}
        </>}
      </section>
    </main>
    <WorkspaceSplitter label="调整上下分区高度" horizontal onBegin={() => beginResize('bottom')} />
    <section className="timeline panel" aria-label="原片时间轴" style={{ height: `clamp(210px, ${layout.bottom}px, calc(100% - 310px))` }}>
      <div className="timeline-toolbar"><h2>时间轴</h2>
        <IconButton icon="Undo2" label="撤销" disabled={busy || (!session.canUndo && !draftChanged && !speakerChanged)} onClick={() => history(false)} />
        <IconButton icon="Redo2" label="重做" disabled={busy || !session.canRedo || draftChanged || speakerChanged} onClick={() => history(true)} />
        <IconButton icon="Trash2" label="删除选中字幕" disabled={busy || !selectionEditable || timing.current} onClick={deleteSelected} />
        <IconButton icon="Plus" label="新增字幕" disabled={!project || !trackSpeakers.some(editableSpeaker) || busy || timing.current || position >= duration} onClick={beginAdd} />
        <IconButton icon="Scissors" label="拆分字幕" disabled={busy || timing.current || !current || currentLocked || position <= current.start_ms || position >= current.end_ms} onClick={splitSubtitle} />
        <IconButton icon="Merge" label="合并字幕" disabled={busy || timing.current || !mergeGroup} onClick={beginMerge} />
        <select aria-label="当前说话人轨" value={project?.speakers.some(s => s.id === currentTrack) ? currentTrack : ''} disabled={!project || busy || timing.current} onChange={event => setCurrentTrack(event.target.value)}>
          <option value="">未明确轨道 → ?</option>
          {trackSpeakers.filter(editableSpeaker).map(s => <option key={s.id} value={s.id}>{speakerName(s.id)}</option>)}
        </select>
        </div>
      {project ? <SourceTimeline key={project.id} project={project} selected={selectedIds} position={position} busy={busy}
        waveform={waveform.url} thumbnails={thumbnails.url} thumbnailVersion={thumbnails.version} speakers={trackSpeakers}
        onReorder={reorderSpeakers} onToggleSpeaker={toggleSpeaker}
        onLockSpeaker={lockSpeaker} onManageSpeaker={manageSpeaker}
        onBeginReorder={() => { if (busy || timing.current || !commitDraft()) return false; timing.current = true; session.pauseAutosave(); return true; }}
        onEndReorder={() => { timing.current = false; session.resumeAutosave(); }}
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
    {colorPreview && project && <SpeakerColorDialog speakers={project.speakers} onCancel={() => setColorPreview(false)} onApply={speakers => {
      const snapshot = session.getProject();
      if (snapshot) {
        const colors = new Map(speakers.map(s => [s.id, s.color]));
        commitSpeakers({ ...snapshot, speakers: snapshot.speakers.map(s => s.locked ? s : { ...s, color: colors.get(s.id) ?? s.color }) });
      }
      setColorPreview(false);
    }} />}
    {addition && project && <AddSubtitleDialog {...addition} speakers={project.speakers.filter(editableSpeaker)} onAdd={addSubtitle} onCancel={() => setAddition(null)} />}
    {merging && project && <MergeSubtitleDialog count={merging.size} speakers={project.speakers.filter(editableSpeaker)} onMerge={speakerId => mergeSubtitles(merging, speakerId)} onCancel={() => setMerging(null)} />}
    {dialog && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="dialog">
      <header><h2 id="dialog-title">{{ new: '新建编辑工程', replace: '整体替换工作字幕', open: '打开工程', help: '使用帮助', 'save-as': '工程另存为', relocate: '重新定位同一原片', 'new-media': '用新视频建立工程' }[dialog]}</h2>
        <IconButton icon="X" label="关闭对话框" disabled={busy} onClick={() => { setDialog(null); if (dialog !== 'help') session.resumeAutosave(); }} /></header>
      {error && <p role="alert" className="error">{error}</p>}
      {picking && <p role="status" className="hint">请在系统文件选择窗口中选择文件或取消。如果窗口在后台，请切换到该窗口。</p>}
      {(dialog === 'save-as' || dialog === 'relocate' || dialog === 'new-media') && <>
        <p className="hint">{dialog === 'relocate' ? '选择移动或重命名后的同一原片。' : '保存为独立工程，保留完整字幕与人物配置。'}</p>
        {dialog !== 'relocate' && <label>副本工程名称<input disabled={busy} value={name} onChange={event => setName(event.target.value)} /></label>}
        {dialog !== 'save-as' && <FilePathField label="新视频绝对路径" button="选择视频…" disabled={busy} value={mediaPath} onChange={setMediaPath} onPick={() => void chooseFile('media')} />}
        <button disabled={busy || (dialog !== 'relocate' && !name.trim()) || (dialog !== 'save-as' && !mediaPath.trim())} onClick={() => void projectAction()}>{dialog === 'relocate' ? '验证并重新定位' : '创建独立副本'}</button>
      </>}
      {(dialog === 'new' || dialog === 'replace') && <>
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
        <p className="hint">字幕编码：UTF-8</p>
        <button disabled={busy || !mediaPath || !subtitlePath} onClick={() => void importAction(false)}>{busy ? '处理中…' : '解析预览'}</button>
        {preview && <div className="import-preview"><h3>预览 · {preview.entries.length} 条</h3>
          {preview.entries.map((entry, index) => <div key={entry.id}><small>{index + 1} · {timeLabel(entry.start_ms)} → {timeLabel(entry.end_ms)} · [{preview.speakers.find(s => s.id === entry.speaker_id)?.label}]</small><p>{entry.text}</p>
            <small>元标签：{entry.tags.join(', ') || '无'} · {entry.sources.map(s => `输入序号 ${s.index ?? '无'} / 原来源索引 [${s.source_entries.join(', ')}] / MOSS ID ${s.moss_id ?? '无'}`).join('；')}</small>
          </div>)}
        </div>}
        <footer><button disabled={busy || !preview || (dialog === 'new' && !name.trim())} className="primary" onClick={() => void importAction(true)}>{dialog === 'replace' ? '应用替换' : '创建工程'}</button></footer>
      </>}
      {dialog === 'open' && <ProjectBrowser busy={busy} onBusy={setBusy} onError={report} onOpen={id => void openProject(id)}
        onDeleted={id => {
          if (session.getProject()?.id !== id) return;
          audition.cancel(true); video.current?.pause(); session.close();
          setSelected(null); setDraft(null); setSpeakerDraft(null); setCurrentTrack(''); setPosition(0); setPlaying(false);
        }} />}
      {dialog === 'help' && <WorkspaceHelp />}
    </section></div>}
  </div>;
}
