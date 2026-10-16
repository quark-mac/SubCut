"""Regenerable source-time evidence. No dependency on subtitle editing or history."""
import array
from functools import lru_cache
import json
import math
from pathlib import Path
import tempfile
import wave
import zipfile

from .errors import Problem
from .media import media_tool
from .preview import valid_artifact


def parameters(kind, density='standard'):
    if kind not in ('waveform', 'thumbnails') or density not in ('standard', 'detailed'):
        raise Problem('未知时间轴资源或采样密度', field='kind')
    if kind == 'thumbnails':
        return {'version': 1, 'density': density, 'timebase': 'common-source-origin',
                'interval_ms': 1000 if density == 'standard' else 500, 'width': 160, 'height': 90,
                'format': 'jpeg', 'quality': 4, 'sampling': 'source-fps-round-up'}
    return {'version': 1, 'density': density, 'timebase': 'common-source-origin',
            'sample_rate': 8000, 'step_ms': 10 if density == 'standard' else 5, 'channels': 1, 'peak': 'absolute-max'}


def cached(project, kind, expected):
    return next((a for a in reversed(project.media_artifacts)
                 if a.kind == kind and valid_artifact(a, project, expected)), None)


def generate(tasks, task, project, source, info, staging, log_path):
    if task['kind'] == 'thumbnails':
        return generate_thumbnails(tasks, task, project, source, staging, log_path)
    options = task['parameters']
    step = options['step_ms']
    peaks = []
    if info['audio_codec']:
        with tempfile.TemporaryDirectory(prefix=task['id'] + '-', dir=staging.parent) as temporary:
            pcm = Path(temporary) / 'audio.wav'
            command = [media_tool('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                       '-copyts', '-start_at_zero', '-i', str(source), '-map', '0:a:0', '-vn',
                       '-af', 'aresample=8000:async=1:first_pts=0', '-ac', '1', '-ar', '8000',
                       '-t', str(project.media.duration_ms / 1000), '-c:a', 'pcm_s16le',
                       '-progress', 'pipe:1', '-stats_period', '0.1', str(pcm)]
            tasks.execute(task, command, project.media.duration_ms, log_path)
            with wave.open(str(pcm), 'rb') as audio:
                while chunk := audio.readframes(8000 * step // 1000):
                    samples = array.array('h', chunk)
                    peaks.append(round(max(abs(v) for v in samples) / 32768, 5))
    count = math.ceil(project.media.duration_ms / step)
    if info['audio_codec']:
        peaks = (peaks + [0] * max(0, count - len(peaks)))[:count]
    staging.write_text(json.dumps({'duration_ms': project.media.duration_ms, 'start_ms': 0, 'step_ms': step,
                                  'has_audio': bool(info['audio_codec']), 'peaks': peaks}), encoding='utf-8')


def generate_thumbnails(tasks, task, project, source, staging, log_path):
    options = task['parameters']
    interval = options['interval_ms']
    with tempfile.TemporaryDirectory(prefix=task['id'] + '-', dir=staging.parent) as temporary:
        folder = Path(temporary)
        command = [media_tool('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                   '-copyts', '-start_at_zero', '-i', str(source), '-map', '0:v:0', '-an',
                   '-vf', f"fps=1000/{interval}:start_time=0:round=up,scale={options['width']}:{options['height']}:force_original_aspect_ratio=decrease,pad={options['width']}:{options['height']}:(ow-iw)/2:(oh-ih)/2,setsar=1",
                   '-t', str(project.media.duration_ms / 1000), '-q:v', str(options['quality']),
                   '-progress', 'pipe:1', '-stats_period', '0.1', str(folder / '%08d.jpg')]
        tasks.execute(task, command, project.media.duration_ms, log_path)
        images = sorted(folder.glob('*.jpg'))
        if not images:
            raise Problem('没有生成有效缩略图', code='thumbnails_failed')
        # The final source frame remains visible when audio extends past the video.
        count = math.ceil(project.media.duration_ms / interval)
        with zipfile.ZipFile(staging, 'w', compression=zipfile.ZIP_STORED) as archive:
            for index in range(count):
                archive.write(images[min(index, len(images) - 1)], f'{index}.jpg')
            archive.writestr('manifest.json', json.dumps({'duration_ms': project.media.duration_ms,
                                'interval_ms': interval, 'width': options['width'], 'height': options['height'],
                                'times_ms': list(range(0, project.media.duration_ms, interval))}))


@lru_cache(maxsize=8)
def read_thumbnails(path, output_identity):
    with zipfile.ZipFile(path) as archive:
        return json.loads(archive.read('manifest.json'))


def thumbnails_manifest(artifact, base_url):
    data = read_thumbnails(artifact.path, artifact.output_identity)
    return {**{k: data[k] for k in ('duration_ms', 'interval_ms', 'width', 'height')},
            'frames': [{'time_ms': ms, 'url': f'{base_url}/frames/{index}'} for index, ms in enumerate(data['times_ms'])]}


def thumbnail(artifact, index):
    if not 0 <= index < len(read_thumbnails(artifact.path, artifact.output_identity)['times_ms']):
        raise Problem('缩略图序号越界', status=404, field='index')
    with zipfile.ZipFile(artifact.path) as archive:
        return archive.read(f'{index}.jpg')


@lru_cache(maxsize=4)
def read_waveform(path, output_identity):
    # The public boundary validates the complete content hash before this immutable cache.
    return json.loads(Path(path).read_text(encoding='utf-8'))


def waveform_range(artifact, start_ms, end_ms, bins):
    data = read_waveform(artifact.path, artifact.output_identity)
    end_ms = data['duration_ms'] if end_ms is None else min(end_ms, data['duration_ms'])
    if start_ms < 0 or end_ms <= start_ms or not 1 <= bins <= 4096:
        raise Problem('波形范围或采样数量无效', field='range')
    step = data['step_ms']
    stride = max(step, math.ceil((end_ms - start_ms) / bins / step) * step)
    first = start_ms // step * step
    peaks = [{'start_ms': t, 'end_ms': min(t + stride, data['duration_ms']),
              'peak': max(data['peaks'][t // step:math.ceil((t + stride) / step)], default=0)}
             for t in range(first, end_ms, stride)] if data['has_audio'] else []
    return {**{key: data[key] for key in ('duration_ms', 'has_audio')}, 'peaks': peaks}
