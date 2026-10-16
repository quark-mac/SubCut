"""Resource inventory and local OS actions, independent of editable subtitles."""
import os
from pathlib import Path
import subprocess
import sys

from .errors import Problem
from .media import verify_media
from .models import Project
from .preview import parameters, valid_artifact
from . import timeline_media


def file_status(path: str) -> str:
    return 'available' if Path(path).is_file() else 'missing'


def inventory(project: Project, directory: Path):
    media = project.media.model_dump()
    try:
        verify_media(project.media)
        media['status'] = 'available' if project.media.identity else 'unverified'
    except Problem as exc:
        media['status'] = 'missing' if exc.detail['code'] == 'missing_file' else 'changed'
    except OSError:
        media['status'] = 'unavailable'
    artifacts = []
    for artifact in project.media_artifacts:
        valid = artifact.media_identity == project.media.identity and media['status'] == 'available'
        if artifact.kind == 'preview' and Path(artifact.path).is_file():
            valid = valid and valid_artifact(artifact, project, parameters(artifact.parameters.get('quality', 'standard')))
        elif artifact.kind in ('waveform', 'thumbnails'):
            valid = valid and valid_artifact(artifact, project, timeline_media.parameters(artifact.kind, artifact.parameters.get('density', 'standard')))
        artifacts.append({**artifact.model_dump(), 'status': file_status(artifact.path) if valid else 'stale'})
    return {
        'project_id': project.id, 'revision': project.revision, 'media': media,
        'subtitle_sources': [{**source.model_dump(), 'status': file_status(source.path)} for source in project.subtitle_sources],
        'working_subtitles': {'path': str(directory / 'project.json'), 'count': len(project.entries), 'status': 'available'},
        'media_artifacts': artifacts,
        'exports': [{**export.model_dump(), 'status': file_status(export.path)} for export in project.exports],
    }


def open_folder(path: Path):
    try:
        if sys.platform == 'win32':
            os.startfile(str(path))
        else:
            subprocess.Popen(['open' if sys.platform == 'darwin' else 'xdg-open', str(path)])
    except OSError as exc:
        raise Problem('无法打开资源管理器，请复制显示的绝对路径手动打开', status=503, code='open_location_failed') from exc
