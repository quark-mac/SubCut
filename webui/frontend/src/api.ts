export interface Entry {
  id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  speaker_id: string;
  tags: string[];
  sources: { subtitle_id: string; index: number | null; source_entries: number[]; moss_id: string | null }[];
}

export type ImportFormat = 'plain-srt' | 'speaker-srt' | 'moss-srt' | 'normalized-jsonl' | 'moss-json';
export type ExportFormat = Exclude<ImportFormat, 'moss-srt'>;
export interface ExportOptions { format: ExportFormat; keep_tags: boolean }

export interface Speaker { id: string; label: string; color: string; order: number; visible?: boolean }
export interface ExportFile { id: string; filename: string; path: string; format: string; revision: number }
export interface Imported {
  media: { path: string; duration_ms: number; identity: string | null; size_bytes: number | null };
  subtitle_sources: { id: string; path: string; format: string }[];
  entries: Entry[];
  speakers: Speaker[];
}
export interface Project extends Imported {
  id: string;
  format_version: number;
  revision: number;
  name: string;
  exports: ExportFile[];
}
export interface Resources {
  project_id: string;
  revision: number;
  media: Imported['media'] & { status: string };
  subtitle_sources: (Imported['subtitle_sources'][number] & { status: string })[];
  working_subtitles: { path: string; count: number; status: string };
  media_artifacts: { id: string; kind: string; path: string; media_identity: string; parameters: Record<string, unknown>; status: string }[];
  exports: (ExportFile & { status: string })[];
}
export interface ImportPreview extends Imported { fingerprint: string }
export interface ProjectSummary {
  id: string; name: string; revision?: number;
  media?: Imported['media']; media_missing?: boolean;
  error: { message: string } | null;
}

export async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = data.error;
    throw new Error(error
      ? `${error.entry ? `第 ${error.entry} 条 · ` : ''}${error.field ? `${error.field}：` : ''}${error.message}`
      : `请求失败（${response.status}）`);
  }
  return data as T;
}

export const ordered = (entries: Entry[]) => [...entries].sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
export function timeLabel(ms: number): string {
  const whole = Math.floor(ms / 1000);
  return `${String(Math.floor(whole / 3600)).padStart(2, '0')}:${String(Math.floor(whole / 60) % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')},${String(Math.floor(ms % 1000)).padStart(3, '0')}`;
}

export function parseTimecode(value: string): number | null {
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/.exec(value.trim());
  if (!match) return null;
  const ms = ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
  return Number.isSafeInteger(ms) ? ms : null;
}

export function visibleEntries(project: Pick<Project, 'entries' | 'speakers'>): Entry[] {
  const shown = new Set(project.speakers.filter(s => s.visible !== false).map(s => s.id));
  return project.entries.filter(e => shown.has(e.speaker_id));
}
