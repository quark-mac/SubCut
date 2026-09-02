"""
project_io.py — sub/input 下的"项目"文件夹发现与媒体/字幕配对。

每个项目一个子目录，通常自包含媒体 + 字幕 (+ 可选 speaker_aliases.json)：

    sub/input/<project_name>/
        <something>.mp4 / .mkv / .wav / .flac / ...   ← 媒体（视频或音频）
        <something>.ass / .srt / .vtt                  ← 字幕
        speaker_aliases.json                           ← 可选

本模块只做"找到正确的文件"，不解析字幕、不调 ffmpeg。调用方可以显式允许
MKV-only 项目，此时 subtitle 为 None。

直接运行可自检 sub/input 下所有项目:
    python sub/project_io.py
    python sub/project_io.py "Cosmic Princess Kaguya"
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

# --- Windows 控制台 UTF-8 修复（项目里日文/CJK 输出用） ---
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


# 默认 input 根目录（相对仓库根，命令行从仓库根跑就 OK）
DEFAULT_INPUT_ROOT = Path("sub/input")

# 媒体扩展名（小写，含点）
VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".avi", ".ts", ".webm", ".flv", ".m4v", ".wmv"}
AUDIO_EXTS = {".wav", ".flac", ".mp3", ".m4a", ".aac", ".opus", ".ogg", ".wma"}
MEDIA_EXTS = VIDEO_EXTS | AUDIO_EXTS

# 字幕扩展名
SUBTITLE_EXTS = {".ass", ".ssa", ".srt", ".vtt"}

# 别名映射文件名（固定，不可改）
ALIASES_FILENAME = "speaker_aliases.json"


# ============================================================
# 异常
# ============================================================

class ProjectIOError(Exception):
    """项目文件配对相关的基类异常。"""


class ProjectNotFoundError(ProjectIOError):
    """项目目录不存在 / 缺少必需文件（媒体或字幕）。"""


class MultipleCandidatesError(ProjectIOError):
    """同类文件存在多个、未通过 CLI 显式指定。"""

    def __init__(self, kind: str, candidates: list[Path]):
        self.kind = kind
        self.candidates = candidates
        listing = "\n".join(f"    - {p.name}" for p in candidates)
        super().__init__(
            f"项目目录里有多个 {kind} 文件，请用 CLI 参数指定具体哪个:\n{listing}"
        )


# ============================================================
# 数据结构
# ============================================================

@dataclass
class ProjectFiles:
    project_name: str          # 子目录名（保留原始大小写/空格）
    project_dir: Path          # 绝对/相对项目目录
    media: Path                # 已解析的媒体文件路径
    subtitle: Path | None      # 字幕文件路径；允许 MKV-only 时可能为 None
    aliases: Path | None       # speaker_aliases.json，没有就是 None
    media_kind: str            # "video" 或 "audio"

    def summary(self) -> str:
        return (
            f"project    : {self.project_name}\n"
            f"  dir      : {self.project_dir}\n"
            f"  media    : {self.media.name}  ({self.media_kind}, "
            f"{_fmt_size(self.media)})\n"
            f"  subtitle : {self.subtitle.name if self.subtitle else '(none)'}\n"
            f"  aliases  : {self.aliases.name if self.aliases else '(none)'}"
        )


# ============================================================
# 内部工具
# ============================================================

def _classify(path: Path) -> str | None:
    ext = path.suffix.lower()
    if ext in VIDEO_EXTS:
        return "video"
    if ext in AUDIO_EXTS:
        return "audio"
    return None


def _fmt_size(p: Path) -> str:
    try:
        n = p.stat().st_size
    except OSError:
        return "?"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}PB"


def _resolve_override(
    raw: str | Path,
    project_dir: Path,
    *,
    must_exist: bool = True,
) -> Path:
    """把 CLI 传的 --media / --subtitle 解析为绝对路径。
    支持: 绝对路径 / 相对仓库根 / 相对项目目录 / 仅文件名。"""
    p = Path(raw)
    candidates = []
    if p.is_absolute():
        candidates.append(p)
    else:
        # 1) 相对当前工作目录
        candidates.append(p.resolve())
        # 2) 相对项目目录（最常见用法：只给文件名）
        candidates.append((project_dir / p).resolve())

    for c in candidates:
        if c.exists():
            return c

    if must_exist:
        raise ProjectNotFoundError(
            f"找不到指定文件: {raw}\n候选搜索路径:\n  "
            + "\n  ".join(str(c) for c in candidates)
        )
    return candidates[0]


def _pick_one(
    files: list[Path],
    kind: str,
    override: str | Path | None,
    project_dir: Path,
) -> Path | None:
    """从扫描到的同类文件里挑一个。

    override 非 None 时优先解析 override；
    files 为空 + override 为 None → 返回 None（让上层决定是否报错）；
    files 长度 == 1 → 直接用；
    files 长度 > 1 → 抛 MultipleCandidatesError。
    """
    if override is not None:
        return _resolve_override(override, project_dir)

    if not files:
        return None
    if len(files) == 1:
        return files[0]
    raise MultipleCandidatesError(kind, sorted(files))


# ============================================================
# 公共 API
# ============================================================

def list_projects(input_root: Path = DEFAULT_INPUT_ROOT) -> list[Path]:
    """列出 input_root 下所有非空子目录（视为项目）。结果按名字排序。"""
    if not input_root.is_dir():
        return []
    out = []
    for child in sorted(input_root.iterdir()):
        if child.is_dir() and any(child.iterdir()):
            out.append(child)
    return out


def resolve_project(
    project: str | Path,
    *,
    input_root: Path = DEFAULT_INPUT_ROOT,
    media: str | Path | None = None,
    subtitle: str | Path | None = None,
    aliases: str | Path | None = None,
    require_subtitle: bool = True,
) -> ProjectFiles:
    """定位一个项目的媒体/字幕/别名文件。

    project 可以是:
        - 项目名（"Cosmic Princess Kaguya"）→ 解析为 input_root / project
        - 项目目录的相对/绝对路径

    media/subtitle/aliases:
        - 显式覆盖；可以是文件名（在项目目录里查找）或路径
        - 留空则自动扫描项目目录
    require_subtitle:
        - True（默认）要求独立字幕文件
        - False 允许 MKV-only 项目；目录中若有唯一字幕仍会返回

    异常:
        - ProjectNotFoundError: 目录不存在 / 没找到必需文件
        - MultipleCandidatesError: 同类文件多个且未指定
    """
    # 1) 解析项目目录
    p = Path(project)
    if p.is_absolute() or p.exists():
        project_dir = p.resolve()
    else:
        project_dir = (input_root / p).resolve()

    if not project_dir.is_dir():
        raise ProjectNotFoundError(f"项目目录不存在: {project_dir}")

    project_name = project_dir.name

    # 2) 扫描目录里所有文件，分类
    media_files: list[Path] = []
    subtitle_files: list[Path] = []
    aliases_in_dir: Path | None = None

    for entry in project_dir.iterdir():
        if not entry.is_file():
            continue
        if entry.name == ALIASES_FILENAME:
            aliases_in_dir = entry
            continue
        ext = entry.suffix.lower()
        if ext in MEDIA_EXTS:
            media_files.append(entry)
        elif ext in SUBTITLE_EXTS:
            subtitle_files.append(entry)
        # 其他文件忽略（README、封面等）

    # 3) 挑出唯一媒体/字幕
    media_path = _pick_one(media_files, "媒体", media, project_dir)
    if media_path is None:
        raise ProjectNotFoundError(
            f"项目 {project_name} 里没找到媒体文件 "
            f"(支持扩展名: {sorted(MEDIA_EXTS)})"
        )

    if require_subtitle or subtitle is not None:
        subtitle_path = _pick_one(subtitle_files, "字幕", subtitle, project_dir)
    else:
        # Media-only callers do not consume the source subtitle. Preserve a
        # unique candidate for diagnostics, but ignore irrelevant ambiguity.
        subtitle_path = subtitle_files[0] if len(subtitle_files) == 1 else None
    if subtitle_path is None and require_subtitle:
        raise ProjectNotFoundError(
            f"项目 {project_name} 里没找到字幕文件 "
            f"(支持扩展名: {sorted(SUBTITLE_EXTS)})"
        )

    # 4) 别名映射（可选）
    if aliases is not None:
        aliases_path = _resolve_override(aliases, project_dir)
    else:
        aliases_path = aliases_in_dir  # 可能 None

    # 5) 媒体类型
    media_kind = _classify(media_path)
    if media_kind is None:
        # 用户用 --media 指定了非白名单扩展名
        raise ProjectNotFoundError(
            f"无法识别媒体类型: {media_path.name} "
            f"(扩展名 {media_path.suffix} 不在白名单)"
        )

    return ProjectFiles(
        project_name=project_name,
        project_dir=project_dir,
        media=media_path,
        subtitle=subtitle_path,
        aliases=aliases_path,
        media_kind=media_kind,
    )


# ============================================================
# CLI 自检
# ============================================================

def _self_test(argv: list[str]) -> int:
    """打印 sub/input 下所有项目的解析结果。"""
    if argv:
        # 指定项目名
        try:
            pf = resolve_project(argv[0])
            print(pf.summary())
            return 0
        except ProjectIOError as e:
            print(f"[!] {e}", file=sys.stderr)
            return 1

    projects = list_projects()
    if not projects:
        print(f"[!] {DEFAULT_INPUT_ROOT} 下没有项目子目录")
        return 1

    print(f"在 {DEFAULT_INPUT_ROOT} 下发现 {len(projects)} 个项目:\n")
    rc = 0
    for proj_dir in projects:
        print(f"--- {proj_dir.name} ---")
        try:
            pf = resolve_project(proj_dir.name)
            print(pf.summary())
        except ProjectIOError as e:
            print(f"[!] 配对失败: {e}")
            rc = 2
        print()
    return rc


if __name__ == "__main__":
    sys.exit(_self_test(sys.argv[1:]))
