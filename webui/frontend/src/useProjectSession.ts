import { useEffect, useRef, useState } from 'react';
import { api, type ExportOptions, type Project } from './api';

// History contains editing content only. Disk revision/export receipts never rewind.
type Content = Pick<Project, 'name' | 'entries' | 'speakers' | 'subtitle_sources'>;
const content = ({ name, entries, speakers, subtitle_sources }: Project): Content => ({ name, entries, speakers, subtitle_sources });

export function useProjectSession() {
  const [project, render] = useState<Project | null>(null);
  const current = useRef<Project | null>(null);
  const past = useRef<Content[]>([]);
  const future = useRef<Content[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [exportError, setExportError] = useState('');
  const generation = useRef(0);
  const savedGeneration = useRef(0);
  const revision = useRef(0);
  const epoch = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const uncertain = useRef<{ snapshot: Project; version: number } | null>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  function update(next: Project) { current.current = next; render(next); }

  function open(next: Project) {
    clearTimeout(timer.current); epoch.current++;
    generation.current = 0; savedGeneration.current = 0; revision.current = next.revision;
    uncertain.current = null;
    queue.current = Promise.resolve(); pending.current = 0; setSaving(false); setSaveError('');
    setExportError('');
    past.current = []; future.current = [];
    update(next); setDirty(false);
  }

  function commit(next: Project) {
    const before = current.current;
    if (!before || JSON.stringify(content(before)) === JSON.stringify(content(next))) return before;
    past.current.push(content(before)); future.current = [];
    changed(next);
    return next;
  }

  function travel(redo: boolean) {
    const before = current.current;
    const source = redo ? future.current : past.current;
    const target = redo ? past.current : future.current;
    if (!before || !source.length) return before;
    target.push(content(before));
    const next = { ...before, ...source.pop()! };
    changed(next);
    return next;
  }

  function changed(next: Project) {
    generation.current++;
    update(next); setDirty(true);
    resumeAutosave();
  }

  function pauseAutosave() { clearTimeout(timer.current); }

  function resumeAutosave() {
    clearTimeout(timer.current);
    if (generation.current !== savedGeneration.current) timer.current = setTimeout(() => { void persist(); }, 650);
  }

  function receipt(saved: Project, version: number) {
    revision.current = saved.revision;
    savedGeneration.current = version;
    // An old HTTP response acknowledges its snapshot, never replaces newer edits.
    update({ ...current.current!, revision: saved.revision, exports: saved.exports });
    setDirty(generation.current !== version);
  }

  function persist(exporting: ExportOptions | false = false): Promise<void> {
    clearTimeout(timer.current);
    const snapshot = current.current;
    if (!snapshot) return Promise.resolve();
    const version = generation.current, session = epoch.current;
    pending.current++; setSaving(true); setSaveError('');
    if (exporting) setExportError('');
    // All writes (including export registration) share one revision stream.
    // Edits stay enabled while I/O runs; exports capture the trigger-time snapshot.
    const task = queue.current.then(async () => {
      if (epoch.current !== session) return;
      let stage: 'save' | 'export' = 'save';
      try {
        if (uncertain.current) {
          // The previous PUT may have reached disk before its response was lost.
          // Only acknowledge an exact match; a distinct external revision stays a conflict.
          const disk = await api<Project>(`/projects/${snapshot.id}`);
          if (epoch.current !== session) return;
          if (JSON.stringify(content(disk)) === JSON.stringify(content(uncertain.current.snapshot))) {
            receipt(disk, uncertain.current.version);
          }
          uncertain.current = null;
        }
        if (savedGeneration.current !== version) {
          uncertain.current = { snapshot, version };
          const saved = await api<Project>(`/projects/${snapshot.id}`, 'PUT', {
            revision: revision.current, name: snapshot.name, entries: snapshot.entries, speakers: snapshot.speakers,
            subtitle_sources: snapshot.subtitle_sources,
          });
          if (epoch.current !== session) return;
          uncertain.current = null;
          receipt(saved, version);
        }
        if (exporting) {
          stage = 'export';
          uncertain.current = { snapshot, version };
          const output = await api<{ project: Project }>(`/projects/${snapshot.id}/exports`, 'POST', { revision: revision.current, ...exporting });
          if (epoch.current !== session) return;
          uncertain.current = null;
          receipt(output.project, version);
          setExportError('');
        }
        setSaveError('');
      } catch (reason) {
        if (epoch.current === session) {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (stage === 'export') setExportError(`导出失败：${message}`);
          else setSaveError(message);
        }
      } finally {
        if (epoch.current === session) { pending.current--; setSaving(pending.current > 0); }
      }
    });
    queue.current = task;
    return task;
  }

  return { project, dirty, saving, saveError, exportError, open, commit, travel, persist, pauseAutosave, resumeAutosave,
    isSaving: () => pending.current > 0,
    getProject: () => current.current, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
