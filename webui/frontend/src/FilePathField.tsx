import { useId } from 'react';

interface Props {
  label: string;
  button: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onPick: () => void;
}

export function FilePathField({ label, button, value, disabled, onChange, onPick }: Props) {
  const id = useId();
  return <div className="file-path-field">
    <label htmlFor={id}>{label}</label>
    <div className="file-path-controls">
      <input id={id} value={value} disabled={disabled} placeholder="点击右侧按钮选择本机文件" title={value} onChange={event => onChange(event.target.value)} />
      <button type="button" disabled={disabled} onClick={onPick}>{button}</button>
    </div>
  </div>;
}
