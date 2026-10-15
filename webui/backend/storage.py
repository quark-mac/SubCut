"""Local single-process store; atomic publication and explicit format checks."""
import json
import os
from pathlib import Path
import shutil
import tempfile
from threading import RLock
from uuid import UUID

from pydantic import ValidationError

from .errors import Problem
from .formats import validate_entries, validate_sources
from .models import Project
from .speakers import validate_speakers


def atomic_write(path: Path, content: str):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


class Store:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.lock = RLock()

    def directory(self, project_id: str):
        try:
            if str(UUID(project_id)) != project_id:
                raise ValueError()
        except ValueError as exc:
            raise Problem("工程身份无效", status=404, code="project_not_found") from exc
        return self.root / project_id

    def load(self, project_id: str) -> Project:
        path = self.directory(project_id) / "project.json"
        if not path.is_file():
            raise Problem("找不到工程文件", status=404, code="project_not_found")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or data.get("format_version") != 1:
                raise Problem("不支持此工程格式版本；请使用兼容版本打开", status=409, code="unsupported_version")
            project = Project.model_validate(data)
            if project.id != project_id:
                raise ValueError("project identity mismatch")
            validate_speakers(project.speakers)
            validate_entries(project.entries, project.media.duration_ms, {speaker.id for speaker in project.speakers})
            validate_sources(project.entries, project.subtitle_sources)
            return project
        except (ValueError, ValidationError) as exc:
            raise Problem("工程文件损坏或结构无效，原文件已保留", status=422, code="invalid_project") from exc

    def create(self, project: Project):
        self.root.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=".creating-", dir=self.root))
        try:
            atomic_write(staging / "project.json", project.model_dump_json(indent=2))
            staging.rename(self.directory(project.id))
        finally:
            if staging.exists():
                shutil.rmtree(staging)

    def listing(self):
        result = []
        if not self.root.exists():
            return result
        for folder in sorted(self.root.iterdir()):
            if not folder.is_dir() or folder.name.startswith("."):
                continue
            try:
                project = self.load(folder.name)
                result.append({"id": project.id, "name": project.name, "revision": project.revision, "error": None})
            except Problem as exc:
                result.append({"id": folder.name, "name": folder.name, "error": exc.detail})
        return result
