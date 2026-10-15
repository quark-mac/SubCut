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
