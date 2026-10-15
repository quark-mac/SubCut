import json
import hashlib
import os
from functools import lru_cache
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


def media_tool(name: str) -> str:
    return os.environ.get('WEBUI_' + name.upper(), name)


def inspect_media(path: Path) -> dict:
    try:
        result = subprocess.run([
            media_tool('ffprobe'), "-v", "error", "-show_format", "-show_streams",
            "-of", "json", str(path),
        ], check=True, capture_output=True, text=True, encoding="utf-8", timeout=30)
        info = json.loads(result.stdout)
        format_info = info['format']
        origin = Decimal(format_info.get('start_time', '0'))
        streams = info['streams']
        video = next(s for s in streams if s['codec_type'] == 'video' and not s.get('disposition', {}).get('attached_pic'))
        audio = next((s for s in streams if s['codec_type'] == 'audio'), None)
        timed = [s for s in (video, audio) if s is not None]
        # Stream durations are lengths; Matroska's segment duration is an end timestamp.
        # Subtract one common playback origin, never independently zero each stream.
        if all('duration' in s for s in timed):
            duration = max(Decimal(s.get('start_time', str(origin))) + Decimal(s['duration']) for s in timed) - origin
        else:
            duration = Decimal(format_info['duration'])
            if 'matroska' in format_info['format_name'] or 'webm' in format_info['format_name']:
                duration -= origin
        if not duration.is_finite() or duration <= 0:
            raise ValueError("invalid duration")
        duration_ms = int((duration * 1000).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        container = format_info['format_name']
        compatible = (('mp4' in container and video['codec_name'] == 'h264' and video.get('pix_fmt') == 'yuv420p'
                       and (audio is None or audio['codec_name'] == 'aac'))
                      or ('webm' in container and video['codec_name'] in ('vp8', 'vp9', 'av1')
                          and (audio is None or audio['codec_name'] in ('opus', 'vorbis'))))
        return {'format_name': container, 'video_codec': video['codec_name'],
                'audio_codec': audio['codec_name'] if audio else None, 'duration_ms': duration_ms,
                'start_time_ms': round(origin * 1000), 'suggest_preview': not compatible,
                'mime_type': 'video/mp4' if 'mp4' in container else 'video/webm' if 'webm' in container and compatible else 'video/x-matroska' if 'matroska' in container else 'application/octet-stream'}
    except FileNotFoundError as exc:
        raise Problem("未找到 ffprobe，请配置 WEBUI_FFPROBE 或安装 FFmpeg 并加入 PATH", status=503, code="media_tool_missing") from exc
    except (subprocess.SubprocessError, ValueError, KeyError, InvalidOperation, StopIteration) as exc:
        raise Problem("无法读取有效视频及其时长，请检查媒体文件", field="media_path", code="invalid_media") from exc


def probe_media(value: str) -> Media:
    path = local_file(value, 'media_path')
    info = inspect_media(path)
    return Media(path=str(path), duration_ms=info['duration_ms'], identity=media_identity(path), size_bytes=path.stat().st_size)


def media_identity(path: Path) -> str:
    """Content identity is independent of filename/mtime; never sample the original."""
    stat = path.stat()
    signature = (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino)
    return _fingerprint(str(path.resolve()), signature)


@lru_cache(maxsize=32)
def _fingerprint(filename: str, signature: tuple) -> str:
    path = Path(filename)
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    stat = path.stat()
    if signature != (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino):
        raise Problem('读取期间媒体发生变化，请重试', status=409, code='media_changed')
    return 'sha256:' + digest.hexdigest()


def verify_media(media: Media) -> Path:
    path = local_file(media.path, 'media_path')
    if media.identity and media_identity(path) != media.identity:
        raise Problem('原路径文件已变化，请重新定位同一原片，或用新视频建立工程', status=409, code='media_identity_mismatch', field='media_path')
    return path
