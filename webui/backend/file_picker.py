"""Native desktop selection, isolated from the HTTP server's worker threads."""
import json
from pathlib import Path
import subprocess
import sys
from threading import Lock

from .errors import Problem
from .media import local_file
from .models import FilePickerRequest


_dialog_lock = Lock()


def pick_file(body: FilePickerRequest) -> str | None:
    if not _dialog_lock.acquire(blocking=False):
        raise Problem('已有文件选择窗口打开，请先完成或取消选择', status=409, code='file_picker_busy')
    try:
        # Tk requires its own main thread and event loop. A separate process also
        # ensures timeout/error cleanup does not leave a modal dialog behind.
        result = subprocess.run(
            [sys.executable, '-X', 'utf8', str(Path(__file__).with_name('_file_dialog.py'))],
            input=body.model_dump_json(), capture_output=True, encoding='utf-8', errors='replace',
            timeout=600, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
        )
        if result.returncode:
            raise Problem('无法打开系统文件选择窗口，请确认本机桌面可用且 Python 已安装 Tkinter 后重试',
                          status=503, code='file_picker_failed')
        responses = [line.removeprefix('WEBUI_FILE_SELECTION=') for line in result.stdout.splitlines()
                     if line.startswith('WEBUI_FILE_SELECTION=')]
        if len(responses) != 1:
            raise ValueError('Missing file selection response')
        selected = json.loads(responses[0])
        if selected is None:
            return None
        if not isinstance(selected, str) or not selected:
            raise ValueError('Invalid file selection')
        return str(local_file(selected, 'media_path' if body.kind == 'media' else 'subtitle_path'))
    except subprocess.TimeoutExpired as exc:
        raise Problem('文件选择窗口等待超时，请重新选择文件', status=504, code='file_picker_timeout') from exc
    except (OSError, ValueError) as exc:
        raise Problem('无法读取系统文件选择结果，请重试', status=503, code='file_picker_failed') from exc
    finally:
        _dialog_lock.release()
