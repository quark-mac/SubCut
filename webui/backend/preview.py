"""Shared media job queue, progress and atomic publication; full-timeline preview encoder."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
from threading import RLock

from .errors import Problem
from .media import inspect_media, media_identity, media_tool, verify_media
from .models import MediaArtifact, Project, identity
from .storage import Store, atomic_write


def parameters(quality='standard'):
    return {'version': 1, 'quality': quality, 'container': 'mp4', 'video': 'libx264', 'pixel_format': 'yuv420p',
            'audio': 'aac', 'audio_bitrate': '160k', 'sample_rate': 48000, 'preset': 'fast',
            'crf': 23 if quality == 'standard' else 28, 'max_width': 1920 if quality == 'standard' else 960,
            'timebase': 'common-source-origin', 'gop': 50}


def valid_artifact(artifact: MediaArtifact, project: Project, expected=None):
    if artifact.media_identity != project.media.identity or not artifact.output_identity:
        return False
    if expected is not None and artifact.parameters != expected:
        return False
    try:
        return Path(artifact.path).is_file() and media_identity(Path(artifact.path)) == artifact.output_identity
    except (OSError, Problem):
        return False


def cached_preview(project: Project, quality='standard'):
    expected = parameters(quality)
    return next((a for a in reversed(project.media_artifacts) if a.kind == 'preview' and valid_artifact(a, project, expected)), None)


class PreviewTasks:
    def __init__(self, store: Store):
        self.store = store
        self.lock = RLock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='webui-preview')
        self.active = set()
        self.process = None
        self.closed = False

    def task_path(self, project_id, task_id):
        # Apply the same UUID validation to both user-controlled path components.
        self.store.directory(task_id)
        return self.store.directory(project_id) / 'tasks' / f'{task_id}.json'

    def write(self, task):
        # Windows readers do not share delete access. Even an atomic replace
        # fails if a concurrent GET has the old task file open. All writers,
        # including FFmpeg progress, must use the same lock as get().
        with self.lock:
            path = self.task_path(task['project_id'], task['id'])
            path.parent.mkdir(exist_ok=True)
            atomic_write(path, json.dumps(task, ensure_ascii=False, indent=2))

    def get(self, project_id, task_id):
        with self.lock:
            path = self.task_path(project_id, task_id)
            if not path.is_file():
                raise Problem('找不到媒体任务', status=404, code='task_not_found')
            task = json.loads(path.read_text(encoding='utf-8'))
            if task['state'] in ('queued', 'running') and task_id not in self.active:
                task.update(state='failed', error={'code': 'task_interrupted', 'message': '服务重启中断了任务，请重试'})
                self.write(task)
            return task

    def latest(self, project_id, kind='preview', expected=None):
        folder = self.store.directory(project_id) / 'tasks'
        files = list(folder.glob('*.json'))
        for path in sorted(files, key=lambda p: p.stat().st_mtime_ns, reverse=True):
            task = self.get(project_id, path.stem)
            if task.get('kind', 'preview') == kind and (expected is None or task['parameters'] == expected):
                return task
        return None

    def submit(self, project_id, quality):
        return self.submit_media(project_id, 'preview', parameters(quality))

    def submit_media(self, project_id, kind, expected):
        with self.lock, self.store.lock:
            project = self.store.load(project_id)
            verify_media(project.media)
            artifact = next((a for a in reversed(project.media_artifacts)
                             if a.kind == kind and valid_artifact(a, project, expected)), None)
            if artifact:
                task = {'id': identity(), 'project_id': project_id, 'state': 'succeeded', 'progress': 1,
                        'cached': True, 'artifact_id': artifact.id, 'error': None,
                        'kind': kind, 'parameters': artifact.parameters, 'media_identity': project.media.identity}
                self.write(task)
                return task
            for task_id in self.active:
                path = self.task_path(project_id, task_id)
                if path.is_file():
                    task = self.get(project_id, task_id)
                    if task.get('kind', 'preview') == kind and task['parameters'] == expected and task['media_identity'] == project.media.identity:
                        return task
            task = {'id': identity(), 'project_id': project_id, 'state': 'queued', 'progress': 0,
                    'kind': kind, 'parameters': expected, 'media_identity': project.media.identity,
                    'artifact_id': None, 'cached': False, 'error': None, 'tools': {}}
            self.write(task)
            self.active.add(task['id'])
            # Capture the queued response before the worker can mutate its own copy.
            self.executor.submit(self.run, dict(task), project)
            return task

    def run(self, task, original):
        kind = task.get('kind', 'preview')
        folder = self.store.directory(original.id) / ('previews' if kind == 'preview' else 'timeline-media')
        extension = {'preview': '.mp4', 'waveform': '.json', 'thumbnails': '.zip'}[kind]
        staging = folder / (task['id'] + '.partial' + extension)
        output = folder / (task['id'] + extension)
        log_path = self.task_path(original.id, task['id']).with_suffix('.log')
        published = False
        try:
            with self.lock:
                if self.closed:
                    raise Problem('服务正在停止，请重试', code='task_interrupted')
                task['state'] = 'running'
                self.write(task)
            source = verify_media(original.media)
            info = inspect_media(source)
            for name in ('ffmpeg', 'ffprobe'):
                try:
                    version = subprocess.check_output([media_tool(name), '-version'], text=True, encoding='utf-8', timeout=10)
                except FileNotFoundError as exc:
                    raise Problem(f'未找到 {name}，请配置 WEBUI_{name.upper()} 或加入 PATH 后重试', code='media_tool_missing') from exc
                task['tools'][name] = version.splitlines()[0]
            folder.mkdir(exist_ok=True)
            if kind != 'preview':
                from .timeline_media import generate
                generate(self, task, original, source, info, staging, log_path)
            else:
                self.generate_preview(task, original, source, info, staging, log_path)
            artifact = MediaArtifact(id=task['id'], kind=kind, path=str(output), media_identity=original.media.identity,
                                     parameters=task['parameters'], output_identity=media_identity(staging))
            with self.store.lock:
                latest = self.store.load(original.id)
                verify_media(latest.media)
                if latest.media.identity != original.media.identity:
                    raise Problem('生成期间源媒体发生变化', code='media_changed')
                os.replace(staging, output)
                latest.media_artifacts.append(artifact)
                # Reload under the PUT lock; resource publication never advances editing revision.
                atomic_write(self.store.directory(original.id) / 'project.json', latest.model_dump_json(indent=2))
                published = True
            task.update(state='succeeded', progress=1, artifact_id=artifact.id)
        except Exception as exc:
            task.update(state='failed', error=exc.detail if isinstance(exc, Problem) else
                        {'code': f'{kind}_failed', 'message': f'媒体生成失败，请检查工具、文件及磁盘权限后重试：{exc}'})
        finally:
            staging.unlink(missing_ok=True)
            if not published:
                output.unlink(missing_ok=True)
            with self.lock:
                try:
                    self.write(task)
                finally:
                    self.active.discard(task['id'])

    def generate_preview(self, task, original, source, info, staging, log_path):
        options = task['parameters']
        command = [media_tool('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                   '-copyts', '-start_at_zero', '-i', str(source), '-map', '0:v:0', '-map', '0:a:0?',
                   '-sn', '-dn', '-map_metadata', '-1', '-c:v', 'libx264', '-preset', options['preset'],
                   '-crf', str(options['crf']), '-pix_fmt', 'yuv420p', '-g', str(options['gop']),
                   '-vf', f"scale=w='min({options['max_width']},iw)':h=-2:force_divisible_by=2,setsar=1",
                   '-fps_mode', 'vfr', '-c:a', 'aac', '-b:a', options['audio_bitrate'], '-ar', '48000',
                   '-af', 'aresample=async=1:first_pts=0', '-t', str(original.media.duration_ms / 1000),
                   '-movflags', '+faststart', '-progress', 'pipe:1', '-stats_period', '0.1', str(staging)]
        self.execute(task, command, original.media.duration_ms, log_path)
        generated = inspect_media(staging)
        if (generated['video_codec'] != 'h264' or generated['audio_codec'] != ('aac' if info['audio_codec'] else None)
                or abs(generated['duration_ms'] - original.media.duration_ms) > 100
                or abs(generated['start_time_ms']) > 50):
            raise Problem('生成产物的编码、时长或起点校验失败', code='invalid_preview')

    def execute(self, task, command, duration_ms, log_path, frame_interval_ms=None):
        task['command'] = command
        if frame_interval_ms is not None:
            task.update(progress_source='sampled_frames', processed_frames=0)
        self.write(task)
        with log_path.open('a', encoding='utf-8') as log:
            with self.lock:
                if self.closed:
                    raise Problem('服务正在停止，请重试', code='task_interrupted')
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=log, text=True, encoding='utf-8')
                self.process = process
            try:
                for line in process.stdout:
                    progress_key = 'frame=' if frame_interval_ms is not None else 'out_time_us='
                    if line.startswith(progress_key):
                        value = line.strip().split('=', 1)[1]
                        if value.lstrip('-').isdigit():
                            if frame_interval_ms is not None:
                                # With -copyts, image2's out_time_us can be rebased to the
                                # first progress report (even dozens of source seconds in).
                                # Uniform source-time samples have an exact work unit instead.
                                task['processed_frames'] = int(value)
                                progress = int(value) * frame_interval_ms / duration_ms
                            else:
                                progress = int(value) / (duration_ms * 1000)
                            task['progress'] = max(task['progress'], min(.99, progress))
                            with self.lock:
                                self.write(task)
                if process.wait() != 0:
                    raise Problem('FFmpeg 生成失败：' + log_path.read_text(encoding='utf-8')[-3000:], code=f'{task.get("kind", "preview")}_failed')
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=10)
                process.stdout.close()
                with self.lock:
                    self.process = None

    def close(self):
        with self.lock:
            self.closed = True
            if self.process and self.process.poll() is None:
                self.process.terminate()
        self.executor.shutdown(wait=True)
