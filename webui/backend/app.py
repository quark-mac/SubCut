import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .errors import Problem
from .file_picker import pick_file
from .formats import EXPORT_TYPES, read_subtitles, validate_entries, validate_sources, write_subtitles
from .media import inspect_media, local_file, probe_media, verify_media
from .resources import inventory, open_folder
from .models import CopyRequest, CreateRequest, Export, ExportRequest, FilePickerRequest, ImportRequest, NewMediaRequest, PreviewRequest, Project, RelocateRequest, SaveRequest, SubtitleSource, TimelineMediaRequest, identity
from .preview import PreviewTasks, cached_preview, parameters, valid_artifact
from .storage import Store, atomic_write
from .speakers import validate_speakers
from . import timeline_media


store = Store(Path(os.environ.get("WEBUI_WORKSPACE", Path(__file__).resolve().parents[1] / "workspace")))
tasks = PreviewTasks(store)


@asynccontextmanager
async def lifespan(app):
    yield
    tasks.close()


app = FastAPI(title="字幕校对 WebUI", version="0.1.0", lifespan=lifespan)


@app.exception_handler(Problem)
async def problem_handler(request: Request, exc: Problem):
    return JSONResponse(status_code=exc.status, content={"error": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    error = exc.errors()[0]
    location = error["loc"]
    entry = None
    if "entries" in location:
        index_position = location.index("entries") + 1
        if index_position < len(location) and isinstance(location[index_position], int):
            entry = location[index_position] + 1
    return JSONResponse(status_code=422, content={"error": {
        "code": "invalid_request", "message": "字段类型或结构无效：" + error["msg"],
        "field": ".".join(map(str, location[1:])), "entry": entry,
    }})


@app.exception_handler(OSError)
async def io_handler(request: Request, exc: OSError):
    return JSONResponse(status_code=500, content={"error": {
        "code": "storage_error", "message": "文件读写失败，请检查路径、磁盘空间和访问权限后重试", "field": None, "entry": None,
    }})


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post('/api/files/pick')
def select_local_file(body: FilePickerRequest, request: Request):
    origin = request.headers.get('origin')
    if request.headers.get('sec-fetch-site') == 'cross-site' or (origin and urlsplit(origin).netloc != request.url.netloc):
        raise Problem('请从本机 WebUI 打开文件选择窗口', status=403, code='file_picker_origin')
    return {'path': pick_file(body)}


def import_subtitles(body: ImportRequest):
    media = probe_media(body.media_path)
    source = SubtitleSource(path=str(local_file(body.subtitle_path, "subtitle_path")), format=body.format)
    entries, speakers, fingerprint = read_subtitles(Path(source.path), media.duration_ms, source.id, body.format, body.preview_fingerprint)
    return {"media": media, "subtitle_sources": [source], "speakers": speakers, "entries": entries, "fingerprint": fingerprint}


@app.post("/api/imports/preview")
def preview(body: ImportRequest):
    return import_subtitles(body)


@app.post("/api/projects", status_code=201)
def create_project(body: CreateRequest):
    if not body.name.strip():
        raise Problem("工程名称不能为空", field="name")
    imported = import_subtitles(body)
    imported.pop("fingerprint")
    project = Project(name=body.name.strip(), **imported)
    with store.lock:
        store.create(project)
    return project


@app.get("/api/projects")
def list_projects():
    with store.lock:
        return store.listing()


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    with store.lock:
        project = store.load(project_id)
    return project


@app.get("/api/projects/{project_id}/media")
def get_media(project_id: str):
    with store.lock:
        project = store.load(project_id)
    path = verify_media(project.media)
    # Starlette FileResponse supports standard byte ranges and 416 responses.
    return FileResponse(path, media_type=inspect_media(path)['mime_type'])


@app.get('/api/projects/{project_id}/playback')
def get_playback(project_id: str, quality: str = 'standard'):
    if quality not in ('standard', 'small'):
        raise Problem('未知预览质量', field='quality')
    with store.lock:
        project = store.load(project_id)
    source = inspect_media(verify_media(project.media))
    artifact = cached_preview(project, quality)
    return {'project_id': project_id, 'source': source, 'preview': artifact,
            'task': tasks.latest(project_id),
            'url': f'/api/projects/{project_id}/previews/{artifact.id}' if artifact else f'/api/projects/{project_id}/media'}


@app.post('/api/projects/{project_id}/preview', status_code=202)
def generate_preview(project_id: str, body: PreviewRequest):
    return tasks.submit(project_id, body.quality)


@app.get('/api/projects/{project_id}/tasks/{task_id}')
def get_task(project_id: str, task_id: str):
    return tasks.get(project_id, task_id)


@app.post('/api/projects/{project_id}/timeline-media/{kind}', status_code=202)
def generate_timeline_media(project_id: str, kind: str, body: TimelineMediaRequest):
    return tasks.submit_media(project_id, kind, timeline_media.parameters(kind, body.density))


@app.get('/api/projects/{project_id}/timeline-media/{kind}')
def get_timeline_media(project_id: str, kind: str, density: str = 'standard'):
    expected = timeline_media.parameters(kind, density)
    with store.lock:
        project = store.load(project_id)
    verify_media(project.media)
    artifact = timeline_media.cached(project, kind, expected)
    return {'project_id': project_id, 'artifact': artifact, 'task': tasks.latest(project_id, kind, expected),
            'url': f'/api/projects/{project_id}/timeline-artifacts/{artifact.id}' if artifact else None}


def timeline_artifact(project_id, artifact_id):
    with store.lock:
        project = store.load(project_id)
    verify_media(project.media)
    artifact = next((a for a in project.media_artifacts if a.id == artifact_id and a.kind in ('waveform', 'thumbnails')), None)
    if not artifact or not valid_artifact(artifact, project, timeline_media.parameters(artifact.kind, artifact.parameters.get('density', 'standard'))):
        raise Problem('时间轴缓存已失效或未完成，请重新生成', status=409, code='timeline_media_stale')
    return artifact


@app.get('/api/projects/{project_id}/timeline-artifacts/{artifact_id}')
def get_timeline_artifact(project_id: str, artifact_id: str, start_ms: int = 0, end_ms: int | None = None, bins: int = 1000):
    artifact = timeline_artifact(project_id, artifact_id)
    if artifact.kind == 'thumbnails':
        return timeline_media.thumbnails_manifest(artifact, f'/api/projects/{project_id}/timeline-artifacts/{artifact_id}')
    return timeline_media.waveform_range(artifact, start_ms, end_ms, bins)


@app.get('/api/projects/{project_id}/timeline-artifacts/{artifact_id}/frames/{index}')
def get_thumbnail(project_id: str, artifact_id: str, index: int):
    artifact = timeline_artifact(project_id, artifact_id)
    if artifact.kind != 'thumbnails':
        raise Problem('不是缩略图产物', status=404)
    return Response(timeline_media.thumbnail(artifact, index), media_type='image/jpeg')


@app.get('/api/projects/{project_id}/previews/{artifact_id}')
def get_preview(project_id: str, artifact_id: str):
    with store.lock:
        project = store.load(project_id)
    verify_media(project.media)
    artifact = next((a for a in project.media_artifacts if a.id == artifact_id and a.kind == 'preview'), None)
    if not artifact or not valid_artifact(artifact, project, parameters(artifact.parameters.get('quality', 'standard'))):
        raise Problem('预览缓存已失效或未完成，请重新生成', status=409, code='preview_stale')
    return FileResponse(artifact.path, media_type='video/mp4')


def check_revision(project: Project, revision: int):
    if revision != project.revision:
        raise Problem("工程已被更新，请重新打开工程后再保存；当前编辑仍保留在页面", status=409, code="revision_conflict", field="revision")


@app.post('/api/projects/{project_id}/save-as', status_code=201)
def copy_project(project_id: str, body: CopyRequest):
    with store.lock:
        project = store.load(project_id)
        check_revision(project, body.revision)
        if not body.name.strip():
            raise Problem('工程名称不能为空', field='name')
        duplicate = project.model_copy(deep=True)
        duplicate.id = identity()
        duplicate.name = body.name.strip()
        duplicate.revision = 1
        duplicate.exports = []
        duplicate.media_artifacts = []
        store.create(duplicate)
        return duplicate


@app.post('/api/projects/{project_id}/new-media', status_code=201)
def new_media_project(project_id: str, body: NewMediaRequest):
    with store.lock:
        project = store.load(project_id)
        check_revision(project, body.revision)
        if not body.name.strip():
            raise Problem('工程名称不能为空', field='name')
        media = probe_media(body.media_path)
        validate_entries(project.entries, media.duration_ms, {s.id for s in project.speakers})
        duplicate = project.model_copy(deep=True)
        duplicate.id = identity()
        duplicate.name = body.name.strip()
        duplicate.media = media
        duplicate.revision = 1
        duplicate.exports = []
        duplicate.media_artifacts = []
        store.create(duplicate)
        return duplicate


@app.post('/api/projects/{project_id}/relocate')
def relocate_project(project_id: str, body: RelocateRequest):
    with store.lock:
        project = store.load(project_id)
        check_revision(project, body.revision)
        if not project.media.identity:
            raise Problem('旧工程没有原片身份记录，无法核实同一原片；请恢复原路径后打开，或用新视频建立工程', status=409, code='media_identity_unknown', field='media_path')
        media = probe_media(body.media_path)
        if media.identity != project.media.identity or media.duration_ms != project.media.duration_ms:
            raise Problem('不是同一原片：文件内容身份不一致。换片请使用“用新视频建立工程”', status=409, code='media_identity_mismatch', field='media_path')
        project.media = media
        project.revision += 1
        atomic_write(store.directory(project_id) / 'project.json', project.model_dump_json(indent=2))
        return project


@app.put("/api/projects/{project_id}")
def save_project(project_id: str, body: SaveRequest):
    with store.lock:
        project = store.load(project_id)
        check_revision(project, body.revision)
        if not body.name.strip():
            raise Problem("工程名称不能为空", field="name")
        speakers = body.speakers if body.speakers is not None else project.speakers
        validate_speakers(speakers, project.speakers)
        validate_entries(body.entries, project.media.duration_ms, {s.id for s in speakers})
        sources = body.subtitle_sources if body.subtitle_sources is not None else project.subtitle_sources
        validate_sources(body.entries, sources)
        project.name = body.name.strip()
        project.entries = body.entries
        project.speakers = speakers
        project.subtitle_sources = sources
        project.revision += 1
        atomic_write(store.directory(project_id) / "project.json", project.model_dump_json(indent=2))
        return project


@app.post("/api/projects/{project_id}/exports", status_code=201)
def export_project(project_id: str, body: ExportRequest):
    with store.lock:
        project = store.load(project_id)
        check_revision(project, body.revision)
        export_id = identity()
        folder = store.directory(project_id) / "exports"
        folder.mkdir(exist_ok=True)
        extension, _ = EXPORT_TYPES[body.format]
        path = folder / f"{export_id}.{extension}"
        exported = Export(id=export_id, filename=f"字幕-{body.format}-r{project.revision}.{extension}", path=str(path),
                          revision=project.revision, format=body.format, keep_tags=body.keep_tags)
        atomic_write(path, write_subtitles(project, body.format, body.keep_tags))
        project.exports.append(exported)
        project.revision += 1
        try:
            atomic_write(store.directory(project_id) / "project.json", project.model_dump_json(indent=2))
        except OSError:
            path.unlink(missing_ok=True)
            raise
        return {"project": project, "export": exported, "url": f"/api/projects/{project_id}/exports/{export_id}"}


@app.get('/api/projects/{project_id}/resources')
def get_resources(project_id: str):
    with store.lock:
        project = store.load(project_id)
        return inventory(project, store.directory(project_id))


@app.post('/api/projects/{project_id}/exports/{export_id}/open-location')
def open_export_location(project_id: str, export_id: str):
    with store.lock:
        project = store.load(project_id)
        exported = next((item for item in project.exports if item.id == export_id), None)
        if exported is None:
            raise Problem('找不到导出文件', status=404, code='export_not_found')
        extension, _ = EXPORT_TYPES[exported.format]
        path = local_file(str(store.directory(project_id) / 'exports' / f'{exported.id}.{extension}'), 'export')
    open_folder(path.parent)
    return {'project_id': project_id, 'export_id': export_id, 'path': str(path.parent), 'opened': True}


@app.get("/api/projects/{project_id}/exports/{export_id}")
def download_export(project_id: str, export_id: str):
    with store.lock:
        project = store.load(project_id)
    exported = next((item for item in project.exports if item.id == export_id), None)
    if exported is None:
        raise Problem("找不到导出文件", status=404, code="export_not_found")
    extension, media_type = EXPORT_TYPES[exported.format]
    path = store.directory(project_id) / "exports" / f"{exported.id}.{extension}"
    local_file(str(path), "export")
    return FileResponse(path, media_type=media_type + "; charset=utf-8", filename=exported.filename)


dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
