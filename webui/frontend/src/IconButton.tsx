import type { ButtonHTMLAttributes, InputHTMLAttributes } from 'react';
import { Play, Pause, Square, Repeat2, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward,
  Plus, Minus, FolderPlus, FolderOpen, Save, Download, FileInput, Undo2, Redo2, Trash2, Scissors, Merge,
  Magnet, Scan, Focus, ListVideo, Film, AudioLines, ListFilter, ArrowDownWideNarrow, ListOrdered,
  Eye, EyeOff, Settings2, RefreshCw, WandSparkles, Check, X, Users, Captions, UserRound, Search,
  Pencil, GripVertical, Folder, FileText, ChevronDown, MapPin, Copy, Upload, Timer, PanelLeftClose,
  LockKeyhole, LockKeyholeOpen, type LucideIcon } from 'lucide-react';

const icons = { Play, Pause, Square, Repeat2, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward,
  Plus, Minus, FolderPlus, FolderOpen, Save, Download, FileInput, Undo2, Redo2, Trash2, Scissors, Merge,
  Magnet, Scan, Focus, ListVideo, Film, AudioLines, ListFilter, ArrowDownWideNarrow, ListOrdered,
  Eye, EyeOff, Settings2, RefreshCw, WandSparkles, Check, X, Users, Captions, UserRound, Search,
   Pencil, GripVertical, Folder, FileText, ChevronDown, MapPin, Copy, Upload, Timer, PanelLeftClose, LockKeyhole, LockKeyholeOpen } satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof icons;
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Component = icons[name];
  return <Component size={size} strokeWidth={1.7} aria-hidden="true" focusable="false" />;
}
export function IconButton({ icon, label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return <button type="button" {...props} title={props.title ?? label} aria-label={label} className={`icon-button ${className}`}><Icon name={icon} /></button>;
}
export function IconToggle({ icon, label, ...props }: InputHTMLAttributes<HTMLInputElement> & { icon: IconName; label: string }) {
  return <label className={`icon-toggle ${props.checked ? 'active' : ''}`} title={label}>
    <input {...props} type="checkbox" aria-label={label} /><Icon name={icon} />
  </label>;
}
