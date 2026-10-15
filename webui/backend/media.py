import json
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
import subprocess

from .errors import Problem
from .models import Media


def local_file(value: str, field: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise Problem("请输入本机文件的绝对路径", field=field)
    if not path.is_file():
        raise Problem("文件不存在或无法读取，请检查原路径", status=404, field=field, code="missing_file")
    return path.resolve()


def probe_media(value: str) -> Media:
    path = local_file(value, "media_path")
    try:
        result = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type",
            "-of", "json", str(path),
        ], check=True, capture_output=True, text=True, encoding="utf-8", timeout=30)
        info = json.loads(result.stdout)
        duration = Decimal(info["format"]["duration"])
        if not duration.is_finite() or duration <= 0:
            raise ValueError("invalid duration")
        if not any(s["codec_type"] == "video" for s in info["streams"]):
            raise ValueError("no video")
        duration_ms = int((duration * 1000).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        return Media(path=str(path), duration_ms=duration_ms)
    except FileNotFoundError as exc:
        raise Problem("未找到 ffprobe，请安装 FFmpeg 并加入 PATH", status=503, code="media_tool_missing") from exc
    except (subprocess.SubprocessError, ValueError, KeyError, InvalidOperation) as exc:
        raise Problem("无法读取有效视频及其时长，请检查媒体文件", field="media_path", code="invalid_media") from exc
