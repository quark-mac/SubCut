"""Child-process entry point for the OS file dialog (JSON stdin/stdout)."""
import json
from pathlib import Path
import sys


def main():
    import tkinter as tk
    from tkinter import filedialog

    options = json.load(sys.stdin)
    media = options['kind'] == 'media'
    if media:
        filetypes = [('视频文件', '*.mp4 *.mkv *.mov *.avi *.webm *.m4v *.ts *.mts *.m2ts *.wmv *.flv *.mpg *.mpeg')]
    else:
        extension = {'normalized-jsonl': '*.jsonl', 'moss-json': '*.json'}.get(options['format'], '*.srt')
        filetypes = [('字幕文件', extension)]
    filetypes.append(('所有文件', '*.*'))
    initial = {}
    if options['current_path']:
        path = Path(options['current_path'])
        if path.is_absolute() and path.parent.is_dir():
            initial = {'initialdir': str(path.parent), 'initialfile': path.name}
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    try:
        selected = filedialog.askopenfilename(
            parent=root, title='字幕校对 WebUI · ' + ('选择视频' if media else '选择字幕'),
            filetypes=filetypes, **initial,
        )
        # Explorer extensions may also write to stdout. Frame our response so
        # their diagnostic output cannot be mistaken for the selected path.
        print('\nWEBUI_FILE_SELECTION=' + json.dumps(selected or None, ensure_ascii=False), flush=True)
    finally:
        root.destroy()


if __name__ == '__main__':
    main()
