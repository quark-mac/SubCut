import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .errors import Problem
from .formats import read_plain_srt, validate_entries, write_plain_srt
from .media import local_file, probe_media
from .models import CreateRequest, Export, ExportRequest, ImportRequest, Project, SaveRequest, Speaker, SubtitleSource, identity
from .storage import Store, atomic_write


app = FastAPI(title="字幕校对 WebUI", version="0.1.0")
store = Store(Path(os.environ.get("WEBUI_WORKSPACE", Path(__file__).resolve().parents[1] / "workspace")))


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


def import_subtitles(body: ImportRequest):
    media = probe_media(body.media_path)
    source = SubtitleSource(path=str(local_file(body.subtitle_path, "subtitle_path")))
    speakers = [Speaker(label="?", color="#7899b5", order=0),
                Speaker(label="NONSPEECH", color="#a18baa", order=1)]
    entries = read_plain_srt(Path(source.path), media.duration_ms, source.id, speakers[0].id)
    return {"media": media, "subtitle_sources": [source], "speakers": speakers, "entries": entries}


@app.post("/api/imports/preview")
def preview(body: ImportRequest):
    return import_subtitles(body)


@app.post("/api/projects", status_code=201)
def create_project(body: CreateRequest):
    if not body.name.strip():
        raise Problem("工程名称不能为空", field="name")
    project = Project(name=body.name.strip(), **import_subtitles(body))
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
    local_file(project.media.path, "media_path")
    return project


@app.get("/api/projects/{project_id}/media")
def get_media(project_id: str):
    with store.lock:
        project = store.load(project_id)
    path = local_file(project.media.path, "media_path")
    # Starlette FileResponse supports standard byte ranges and 416 responses.
    return FileResponse(path)


def check_revision(project: Project, revision: int):
    if revision != project.revision:
        raise Problem("工程已被更新，请重新打开工程后再保存；当前编辑仍保留在页面", status=409, code="revision_conflict", field="revision")


@app.put("/api/projects/{project_id}")
def save_project(project_id: str, body: SaveRequest):
    with store.lock:
        project = store.load(project_id)
        check_revision(project, body.revision)
        local_file(project.media.path, "media_path")
        if not body.name.strip():
            raise Problem("工程名称不能为空", field="name")
        validate_entries(body.entries, project.media.duration_ms, {s.id for s in project.speakers})
        source_ids = {s.id for s in project.subtitle_sources}
        for position, entry in enumerate(body.entries, 1):
            if any(source.subtitle_id not in source_ids for source in entry.sources):
                raise Problem("字幕引用了不存在的来源", entry=position, field="sources")
        project.name = body.name.strip()
        project.entries = body.entries
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
        path = folder / f"{export_id}.srt"
        exported = Export(id=export_id, filename=f"字幕-r{project.revision}.srt", path=str(path), revision=project.revision)
        atomic_write(path, write_plain_srt(project.entries))
        project.exports.append(exported)
        project.revision += 1
        try:
            atomic_write(store.directory(project_id) / "project.json", project.model_dump_json(indent=2))
        except OSError:
            path.unlink(missing_ok=True)
            raise
        return {"project": project, "export": exported, "url": f"/api/projects/{project_id}/exports/{export_id}"}


@app.get("/api/projects/{project_id}/exports/{export_id}")
def download_export(project_id: str, export_id: str):
    with store.lock:
        project = store.load(project_id)
    exported = next((item for item in project.exports if item.id == export_id), None)
    if exported is None:
        raise Problem("找不到导出文件", status=404, code="export_not_found")
    path = store.directory(project_id) / "exports" / f"{exported.id}.srt"
    local_file(str(path), "export")
    return FileResponse(path, media_type="application/x-subrip; charset=utf-8", filename=exported.filename)


dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
