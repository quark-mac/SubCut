"""Drive only a native file dialog owned by the disposable test server."""
import ctypes
from ctypes import wintypes
import subprocess
import time


def respond_to_dialog(server_pid: int, title: str, selected_path: str | None, timeout=15, on_open=None, required=True):
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetDlgItem.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetDlgItem.restype = wintypes.HWND
    user32.FindWindowExW.argtypes = [wintypes.HWND, wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR]
    user32.FindWindowExW.restype = wintypes.HWND
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        window = user32.FindWindowExW(None, None, '#32770', title)
        while window:
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(window, ctypes.byref(pid))
            parent = subprocess.check_output([
                'powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
                f'(Get-CimInstance Win32_Process -Filter "ProcessId = {pid.value}").ParentProcessId',
            ], text=True, timeout=10).strip()
            if parent != str(server_pid):
                window = user32.FindWindowExW(None, window, '#32770', title)
                continue
            if on_open:
                on_open()
            if selected_path is not None:
                # Standard Windows common dialog's filename ComboBoxEx (cmb13).
                filename = user32.GetDlgItem(window, 1148)
                combo = user32.FindWindowExW(filename, None, 'ComboBox', None) if filename else None
                filename = user32.FindWindowExW(combo, None, 'Edit', None) if combo else None
                if not filename:
                    user32.PostMessageW(window, 0x0111, 2, 0)
                    raise AssertionError('Native filename field was not available')
                # Typing (rather than WM_SETTEXT) updates the shell dialog's
                # selection and sends its edit notifications.
                user32.SendMessageW(filename, 0x00B1, 0, -1)
                for char in selected_path:
                    user32.SendMessageW(filename, 0x0102, ord(char), 0)
            button_id = 1 if selected_path is not None else 2
            button = user32.GetDlgItem(window, button_id)
            user32.PostMessageW(window, 0x0111, button_id, button)
            return True
        time.sleep(.05)
    if required:
        raise AssertionError(f'Native dialog did not open: {title}')
    return False
