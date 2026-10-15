"""Versioned editing document. Times use the original media's integer milliseconds."""
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, StrictInt


def identity() -> str:
    return str(uuid4())


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Source(Model):
    subtitle_id: str
    index: StrictInt | None = None
    source_entries: list[StrictInt] = Field(default_factory=list)
    moss_id: str | None = None


class Entry(Model):
    id: str = Field(default_factory=identity)
    start_ms: StrictInt
    end_ms: StrictInt
    text: str
    speaker_id: str
    tags: list[str] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)


class Speaker(Model):
    id: str = Field(default_factory=identity)
    label: str
    color: str
    order: int


class Media(Model):
    path: str
    duration_ms: StrictInt
    identity: str | None = Field(default=None, pattern=r'^sha256:[0-9a-f]{64}$')
    size_bytes: StrictInt | None = None


class SubtitleSource(Model):
    id: str = Field(default_factory=identity)
    path: str
    format: Literal["plain-srt", "speaker-srt", "moss-srt", "normalized-jsonl", "moss-json"] = "plain-srt"


class Export(Model):
    id: str
    filename: str
    path: str
    format: Literal["plain-srt", "speaker-srt", "normalized-jsonl", "moss-json"] = "plain-srt"
    keep_tags: bool = False
    revision: int


class MediaArtifact(Model):
    id: str = Field(default_factory=identity)
    kind: Literal['preview', 'waveform', 'thumbnails']
    path: str
    media_identity: str
    parameters: dict = Field(default_factory=dict)
    output_identity: str | None = None


class Project(Model):
    format_version: Literal[1] = 1
    id: str = Field(default_factory=identity)
    name: str
    revision: int = 1
    media: Media
    subtitle_sources: list[SubtitleSource]
    entries: list[Entry]
    speakers: list[Speaker]
    exports: list[Export] = Field(default_factory=list)
    media_artifacts: list[MediaArtifact] = Field(default_factory=list)


class ImportRequest(Model):
    media_path: str
    subtitle_path: str
    format: Literal["plain-srt", "speaker-srt", "moss-srt", "normalized-jsonl", "moss-json"] = "plain-srt"
    preview_fingerprint: str | None = None


class CreateRequest(ImportRequest):
    name: str


class SaveRequest(Model):
    revision: StrictInt
    name: str
    entries: list[Entry]
    speakers: list[Speaker] | None = None
    subtitle_sources: list[SubtitleSource] | None = None


class ExportRequest(Model):
    revision: StrictInt
    format: Literal["plain-srt", "speaker-srt", "normalized-jsonl", "moss-json"] = "speaker-srt"
    keep_tags: bool = False


class CopyRequest(Model):
    revision: StrictInt
    name: str


class NewMediaRequest(CopyRequest):
    media_path: str


class RelocateRequest(Model):
    revision: StrictInt
    media_path: str


class PreviewRequest(Model):
    quality: Literal['standard', 'small'] = 'standard'
