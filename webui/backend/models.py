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
    index: int


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
    format: Literal["plain-srt"] = "plain-srt"


class Export(Model):
    id: str
    filename: str
    path: str
    format: Literal["plain-srt"] = "plain-srt"
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


class CreateRequest(ImportRequest):
    name: str


class SaveRequest(Model):
    revision: StrictInt
    name: str
    entries: list[Entry]
    speakers: list[Speaker] | None = None


class ExportRequest(Model):
    revision: StrictInt
