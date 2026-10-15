export interface Entry {
  id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  speaker_id: string;
  tags: string[];
  sources: { subtitle_id: string; index: number }[];
}

export interface Speaker { id: string; label: string; color: string; order: number }
export interface ExportFile { id: string; filename: string; path: string; format: string; revision: number }
export interface Imported {
  media: { path: string; duration_ms: number };
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
export interface ProjectSummary {
  id: string; name: string; revision?: number;
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
  return `${String(Math.floor(whole / 3600)).padStart(2, '0')}:${String(Math.floor(whole / 60) % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;
}
