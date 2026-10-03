"""
extract_simple.py — 字幕驱动的角色片段提取/合并。

不做 VAD 精修、不做质量评分。默认按字幕时间切；音频单条可按最小时长过滤。
合并放在剪辑层（--clip-merge-gap），不影响字幕和角色台词输出。

输入: 默认 sub/intermediate/<project>/normalized.srt（normalize_sdh.py 生成），
      可用 --srt 指定任意 SRT（如 gold_set_dedup.srt / llm_corrected.srt）。
      [NONSPEECH] 行（含 [NONSPEECH:内联描述] 变体）与普通角色同规则：受
      --speakers 过滤（是否写入输入由 normalize 层的 --keep-nonspeech 决定）；
      [?] 行默认丢弃，--keep-unlabeled 可保留。
输出: sub/output/<project>/
      <角色>__merged.<ext>                拼合文件（--shape clips 时关闭）
      <角色>/NNNN_<角色>_<时间>_<台词>.<ext>  单条片段（--shape merged 时关闭）
      <角色>/filelist_video.txt           视频输出的 TTS 标注（--no-manifest 关闭）
      <角色>/filelist_audio.txt           音频输出的 TTS 标注（--no-manifest 关闭）

参数:
    --output-type audio|video|both  必填。输出媒体类型（WAV 纯音频 / 含音轨 mp4 / 都出）
    --shape clips|merged|both       输出形态。clips=单条片段，merged=拼合文件（默认 both）
    --drop-cross-speaker-overlap N  交叉说话人重叠丢弃（默认关闭）：条目与其他说话人
                                    台词重叠超过 N 秒则丢弃（0=有任何重叠即丢；同 speaker
                                    重叠不受影响；[?]/[NONSPEECH] 不参与判断）

典型调用:
    # 默认: 输出带音轨的视频，生成单条片段 + 拼合文件
    env\\python.exe sub\\extract_simple.py "Cosmic Princess Kaguya" --speakers Iroha,Kaguya

    # 只要拼合视频，不要单条
    env\\python.exe sub\\extract_simple.py "Cosmic Princess Kaguya" --speakers Iroha \\
        --output-type video --shape merged

    # TTS 训练: 纯音频 WAV 单条 + 重采样 + 时长过滤（不要拼合大文件）
    env\\python.exe sub\\extract_simple.py "Cosmic Princess Kaguya" --speakers Iroha \\
        --output-type audio --shape clips --audio-sample-rate 24000

    # 视频 + 音频全量输出（四类产物）
    env\\python.exe sub\\extract_simple.py "Cosmic Princess Kaguya" --speakers Iroha \\
        --output-type both --shape both

    # 用 Gold Set 或 LLM 修正后的 SRT
    env\\python.exe sub\\extract_simple.py "Cosmic Princess Kaguya" --speakers Iroha,Kaguya \\
        --srt gold_set_dedup.srt

    # 全部项目
    env\\python.exe sub\\extract_simple.py --all
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from _subtitle_utils import seconds_to_ass_time
from project_io import (
    DEFAULT_INPUT_ROOT,
    list_projects,
    resolve_project,
    ProjectFiles,
    ProjectIOError,
)
from _srt_io import (
    NormalizedEntry,
    SPEAKER_UNKNOWN,
    SPEAKER_NONSPEECH,
    parse_srt,
)

# UTF-8 stdout/stderr (Windows GBK 会卡日文)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


# ============================================================
# 常量
# ============================================================

DEFAULT_OUTPUT_ROOT = Path("sub/output")
DEFAULT_INTERMEDIATE_ROOT = Path("sub/intermediate")
BUNDLED_FFMPEG = Path("env/Library/bin/ffmpeg.exe")
# CUDA 版（BtbN GPL 构建，含 h264_nvenc）优先于 conda-forge 版
BUNDLED_FFMPEG_CUDA = Path("env/Library/bin/ffmpeg_cuda.exe")

# 视频编码器候选（按优先级）。每条 = (encoder_name, codec_args)
# - libx264: GPL 构建里有；非 GPL 构建里没有
# - h264_mf: Windows MediaFoundation（conda-forge ffmpeg 默认有）
# - mpeg4:   兜底（无 H.264 时）
VIDEO_OUT_EXT = ".mp4"
VIDEO_ENCODER_CANDIDATES: list[tuple[str, list[str]]] = [
    ("libx264", ["-c:v", "libx264", "-crf", "20", "-preset", "fast",
                 "-pix_fmt", "yuv420p"]),
    ("h264_mf", ["-c:v", "h264_mf", "-rate_control", "quality",
                 "-quality", "70", "-pix_fmt", "yuv420p"]),
    ("mpeg4",   ["-c:v", "mpeg4", "-q:v", "5", "-pix_fmt", "yuv420p"]),
]

# GPU 硬件编码器候选（--hw-accel 时优先探测，找不到自动降级到 CPU）
# 按厂商覆盖率排序：NVIDIA > Intel > AMD > Windows MF（MF 在 Windows 上通过
# DXVA2/D3D11VA 调用 GPU 硬件编码，conda-forge ffmpeg 无 NVENC SDK 时的最佳选择）
GPU_ENCODER_CANDIDATES: list[tuple[str, list[str]]] = [
    # NVIDIA NVENC — preset p4 = 速度/质量均衡；rc vbr+cq 类似 CRF
    ("h264_nvenc", ["-c:v", "h264_nvenc", "-preset", "p4",
                    "-rc", "vbr", "-cq", "20", "-pix_fmt", "yuv420p"]),
    # Intel QSV — global_quality 类似 CRF（值越低质量越高）
    ("h264_qsv",   ["-c:v", "h264_qsv", "-global_quality", "20",
                    "-pix_fmt", "yuv420p"]),
    # AMD AMF — vbr_latency 低延迟模式，适合切片场景
    ("h264_amf",   ["-c:v", "h264_amf", "-quality", "balanced",
                    "-rc", "vbr_latency", "-qp_i", "20", "-qp_p", "20",
                    "-pix_fmt", "yuv420p"]),
    # Windows MediaFoundation — 通过 DXVA2/D3D11VA 调用 GPU 硬件编码
    # conda-forge ffmpeg 无 NVENC SDK 时，GTX 1660 SUPER 等 NVIDIA 卡走此路径
    ("h264_mf",    ["-c:v", "h264_mf", "-rate_control", "quality",
                    "-quality", "70", "-pix_fmt", "yuv420p"]),
]

VIDEO_EXTRA = ["-movflags", "+faststart"]

# ── 视频质量档位 ──────────────────────────────────────────────
# 档位 1~5，值越大质量越高（速度越慢）。默认 2（偏快）。
# 映射到各编码器的 CRF-like 参数值（libx264/nvenc/qsv/amf 越小越好）
VIDEO_QUALITY_DEFAULT = 2
_QUALITY_TO_CRF: dict[int, int] = {1: 28, 2: 23, 3: 18, 4: 12, 5: 0}
# h264_mf 质量方向相反（值越大越好，0~100）
_QUALITY_TO_MF: dict[int, int]  = {1: 85, 2: 70, 3: 55, 4: 40, 5: 25}
# mpeg4 q:v（兜底编码器，值越小越好）
_QUALITY_TO_QV: dict[int, int]  = {1: 8,  2: 6,  3: 4,  4: 2,  5: 1}


def _apply_quality_to_args(name: str, args: list[str], quality: int) -> list[str]:
    """把候选 codec_args 里的质量参数替换为档位对应的值。

    按编码器名称决定替换哪个参数及用哪张映射表。
    不认识的编码器原样返回（不修改）。
    """
    crf = str(_QUALITY_TO_CRF[quality])
    args = list(args)   # 不修改原列表

    if name == "libx264":
        _replace_arg(args, "-crf", crf)
    elif name == "h264_nvenc":
        # 最终输出用 -cq（vbr 模式）
        _replace_arg(args, "-cq", crf)
    elif name == "h264_qsv":
        _replace_arg(args, "-global_quality", crf)
    elif name == "h264_amf":
        _replace_arg(args, "-qp_i", crf)
        _replace_arg(args, "-qp_p", crf)
    elif name in ("h264_mf", "mpeg4"):
        if name == "h264_mf":
            _replace_arg(args, "-quality", str(_QUALITY_TO_MF[quality]))
        else:
            _replace_arg(args, "-q:v", str(_QUALITY_TO_QV[quality]))
    return args


def _replace_arg(args: list[str], flag: str, value: str) -> None:
    """原地把 args 里 flag 后面的值替换为 value；找不到时静默跳过。"""
    try:
        idx = args.index(flag)
        args[idx + 1] = value
    except (ValueError, IndexError):
        pass


def _build_tmp_video_codec_gpu(quality: int) -> list[str]:
    """生成 GPU 中间文件的编码参数（h264_nvenc constqp 模式）。

    中间文件用 constqp（固定量化）而非 vbr，保证每帧质量均匀，
    阶段 2 stream copy 时不会出现质量抖动。
    """
    qp = str(_QUALITY_TO_CRF[quality])
    return ["-c:v", "h264_nvenc", "-preset", "p1",
            "-rc", "constqp", "-qp", qp, "-pix_fmt", "yuv420p",
            "-c:a", "pcm_s16le"]


# 音频默认参数（无损 wav 便于听辨）
AUDIO_OUT_EXT = ".wav"
AUDIO_ACODEC = ["-c:a", "pcm_s16le"]

# 文件名清洗
_FILENAME_BAD = re.compile(r'[\\/:*?"<>|\r\n\t]+')

# 缓存：(ffmpeg路径字符串, hw_accel, video_quality) → (encoder_name, codec_args)
_video_encoder_cache: dict[tuple[str, bool, int], tuple[str, list[str]]] = {}


# ============================================================
# 数据结构
# ============================================================

@dataclass
class Clip:
    """一个待切的片段。"""
    start: float
    end: float
    raw_speaker: str            # 字幕原始 token (e.g. '彩葉' / '配信:かぐや')
    text_excerpt: str           # 台词截断（命名+报告用）
    full_text: str = ""         # 完整台词（\\n → 空格，用于 TTS 标注）
    source_kind: str = ""       # 'single' / 'multi'
    entry_idx: int = -1         # 原字幕条目索引（按 parse 顺序）

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass
class SpeakerBucket:
    canonical: str
    clips: list[Clip] = field(default_factory=list)

    @property
    def from_single(self) -> int:
        return sum(1 for c in self.clips if c.source_kind == "single")

    @property
    def from_multi(self) -> int:
        return sum(1 for c in self.clips if c.source_kind == "multi")

    @property
    def total_duration(self) -> float:
        return sum(c.duration for c in self.clips)


# ============================================================
# 工具
# ============================================================

def find_ffmpeg(override: str | None = None) -> Path:
    """优先级: --ffmpeg > CUDA 版（ffmpeg_cuda.exe）> 标准版 > 系统 PATH。

    CUDA 版（BtbN GPL 构建）含 h264_nvenc，优先使用以获得硬件加速。
    找不到时自动降级到 conda-forge 标准版或系统 PATH 里的 ffmpeg。
    """
    if override:
        p = Path(override)
        if p.is_file():
            return p
        raise FileNotFoundError(f"--ffmpeg 指定的文件不存在: {override}")

    if BUNDLED_FFMPEG_CUDA.is_file():
        return BUNDLED_FFMPEG_CUDA.resolve()

    if BUNDLED_FFMPEG.is_file():
        return BUNDLED_FFMPEG.resolve()

    found = shutil.which("ffmpeg")
    if found:
        return Path(found)

    raise FileNotFoundError(
        f"找不到 ffmpeg。期望位置: {BUNDLED_FFMPEG_CUDA} / {BUNDLED_FFMPEG} 或系统 PATH。"
        f"可用 --ffmpeg 显式指定。"
    )


def probe_video_encoder(
    ffmpeg: Path,
    *,
    hw_accel: bool = False,
    video_quality: int = VIDEO_QUALITY_DEFAULT,
) -> tuple[str, list[str]]:
    """探测当前 ffmpeg 支持的视频编码器，返回 (name, codec_args)。

    hw_accel=True 时优先探测 GPU_ENCODER_CANDIDATES（nvenc/qsv/amf），
    找不到任何 GPU 编码器时自动降级到 VIDEO_ENCODER_CANDIDATES（CPU）。
    hw_accel=False 时只探测 CPU 候选。

    video_quality（1~5）会被转换为对应编码器的质量参数值注入 codec_args。
    结果按 (ffmpeg路径, hw_accel, video_quality) 缓存，避免重复调用。
    """
    cache_key = (str(ffmpeg), hw_accel, video_quality)
    if cache_key in _video_encoder_cache:
        return _video_encoder_cache[cache_key]

    proc = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-encoders"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        encoding="utf-8", errors="replace",
    )
    available = proc.stdout

    candidates = (GPU_ENCODER_CANDIDATES + VIDEO_ENCODER_CANDIDATES) if hw_accel \
                 else VIDEO_ENCODER_CANDIDATES

    for name, args in candidates:
        if re.search(rf"\b{re.escape(name)}\b", available):
            tuned_args = _apply_quality_to_args(name, args, video_quality)
            _video_encoder_cache[cache_key] = (name, tuned_args)
            return _video_encoder_cache[cache_key]

    raise RuntimeError(
        f"ffmpeg ({ffmpeg}) 不支持任何候选视频编码器。\n"
        f"  hw_accel={hw_accel} 时候选列表: "
        f"{[n for n, _ in candidates]}"
    )


def sanitize_filename(s: str, max_len: int = 30) -> str:
    s = _FILENAME_BAD.sub("_", s).strip()
    if len(s) > max_len:
        s = s[:max_len]
    return s or "_"


def clean_text_for_filename(text: str, max_len: int = 20) -> str:
    """从 text_excerpt 中提取首句（/ 之前的部分），适合做文件名片段。"""
    first = text.split(" / ")[0].strip()
    # 去空格、去控制符
    first = re.sub(r'[\s]+', '_', first)
    first = _FILENAME_BAD.sub("_", first).strip("_")
    if len(first) > max_len:
        first = first[:max_len]
    return first or "_"


def fmt_time_for_filename(sec: float) -> str:
    """0:01:07.350 → 00-01-07.350（文件名安全）。"""
    return seconds_to_ass_time(sec).replace(":", "-")


def fmt_duration(sec: float) -> str:
    if sec < 60:
        return f"{sec:.1f}s"
    m, s = divmod(sec, 60)
    return f"{int(m)}m{s:.1f}s"


# ============================================================
# normalized SRT → 桶（P1.4 新路径）
# ============================================================

def normalized_entry_to_clip(e: NormalizedEntry) -> Clip:
    """NormalizedEntry → Clip（source_kind 从 tags 推断）。"""
    if "MULTI" in e.tags:
        kind = "multi"
    else:
        kind = "single"
    return Clip(
        start=e.start,
        end=e.end,
        raw_speaker=e.speaker,
        text_excerpt=e.text[:60],
        full_text=e.text.replace("\n", " ").replace("\r", "").replace("\\N", " ").strip(),
        source_kind=kind,
        entry_idx=e.idx,
    )


def build_buckets_from_normalized(
    entries: list[NormalizedEntry],
    *,
    target_speakers: set[str] | None,
    include_unknown: bool,
) -> tuple[dict[str, SpeakerBucket], dict]:
    """从 normalized SRT entries 构建 canonical → SpeakerBucket。

    alias 已在 normalize 阶段固化，这里只做过滤 + 分桶。
    """
    buckets: dict[str, SpeakerBucket] = {}
    stats = {
        "total": len(entries),
        "kept": 0,
        "skipped_unknown": 0,
        "skipped_not_in_targets": 0,
    }

    def push(speaker: str, clip: Clip) -> None:
        buckets.setdefault(speaker, SpeakerBucket(canonical=speaker)).clips.append(clip)

    for e in entries:
        if e.speaker == SPEAKER_UNKNOWN:
            if include_unknown:
                push(SPEAKER_UNKNOWN, normalized_entry_to_clip(e))
                stats["kept"] += 1
            else:
                stats["skipped_unknown"] += 1
            continue
        if e.speaker == SPEAKER_NONSPEECH or e.speaker.startswith(SPEAKER_NONSPEECH + ":"):
            # 统一 [NONSPEECH] 与 [NONSPEECH:内联描述] 变体；与普通角色一样受 --speakers 过滤
            speaker = SPEAKER_NONSPEECH
        else:
            speaker = e.speaker
        if target_speakers is not None and speaker not in target_speakers:
            stats["skipped_not_in_targets"] += 1
            continue
        push(speaker, normalized_entry_to_clip(e))
        stats["kept"] += 1

    return buckets, stats


def drop_cross_speaker_overlap_entries(
    entries: list[NormalizedEntry],
    threshold_sec: float,
) -> tuple[list[NormalizedEntry], int]:
    """丢弃与其他说话人台词时间重叠超过 threshold_sec 的条目，返回 (保留条目, 丢弃数)。

    规则:
        - 只比较两个 speaker 都真实且不同（非 ? / NONSPEECH）的条目对
        - 重叠量 = min(end_a, end_b) - max(start_a, start_b)；> threshold_sec 即丢
          threshold=0 → 有任何重叠就丢
        - 同 speaker 的重叠不受影响（交给桶内重叠合并处理）
        - 同一多说话人 cue 展开的条目（共享 source_entries）不视为重叠
    """
    real = sorted(
        (e for e in entries if e.speaker not in (SPEAKER_UNKNOWN, SPEAKER_NONSPEECH)),
        key=lambda e: (e.start, e.end),
    )
    dropped: set[int] = set()

    for i, a in enumerate(real):
        if a.idx in dropped:
            continue
        for b in real[i + 1:]:
            if b.start >= a.end:
                break
            if b.idx in dropped or a.speaker == b.speaker:
                continue
            if set(a.source_entries) & set(b.source_entries):
                continue
            overlap = min(a.end, b.end) - max(a.start, b.start)
            if overlap > threshold_sec:
                dropped.add(a.idx)
                dropped.add(b.idx)
                break

    if not dropped:
        return entries, 0
    return [e for e in entries if e.idx not in dropped], len(dropped)


def merge_overlapping_clips(
    bucket: SpeakerBucket,
) -> dict[str, int]:
    """合并桶里时间重叠的片段，避免输出里同一段音频被切两遍。

    场景:
        SDH 字幕里相邻条目时间常常重叠（比如某行字幕滞留到下一行字幕开始之后），
        如果这两行都归到同一角色，concat 出来会重复同一段音频；听感像卡顿、回放。

    算法:
        - 桶内 clips 按 start 升序排序
        - 从左到右贪心扫描，若 cur.start < acc.end → 合并
          合并方式: acc.end = max(acc.end, cur.end)，被合并的 clip 元数据并入 acc
        - source_kind: 优先级 single > multi，保留更"权威"的来源
        - text_excerpt: 用 ' / ' 拼接两条文本（截断后）
        - raw_speaker: 用 ' / ' 拼接

    返回 {'before': N, 'after': M, 'merged': N-M} 统计。
    """
    if len(bucket.clips) <= 1:
        return {"before": len(bucket.clips), "after": len(bucket.clips), "merged": 0}

    sorted_clips = sorted(bucket.clips, key=lambda c: (c.start, c.end))
    out: list[Clip] = [sorted_clips[0]]

    PRIORITY = {"single": 2, "multi": 1}

    for cur in sorted_clips[1:]:
        acc = out[-1]
        if cur.start < acc.end:
            # 合并 cur 进 acc
            new_end = max(acc.end, cur.end)
            # 选更权威的 source_kind
            if PRIORITY.get(cur.source_kind, 0) > PRIORITY.get(acc.source_kind, 0):
                new_source = cur.source_kind
                new_raw = f"{cur.raw_speaker} / {acc.raw_speaker}"
            else:
                new_source = acc.source_kind
                new_raw = f"{acc.raw_speaker} / {cur.raw_speaker}"
            new_text = f"{acc.text_excerpt} / {cur.text_excerpt}"[:120]
            new_full = f"{acc.full_text} {cur.full_text}".strip()
            out[-1] = Clip(
                start=acc.start,
                end=new_end,
                raw_speaker=new_raw[:60],
                text_excerpt=new_text,
                full_text=new_full,
                source_kind=new_source,
                entry_idx=acc.entry_idx,  # 保留首条的 entry_idx
            )
        else:
            out.append(cur)

    before = len(bucket.clips)
    bucket.clips = out
    return {"before": before, "after": len(out), "merged": before - len(out)}


def merge_adjacent_clips(
    clips: list[Clip],
    *,
    merge_gap_sec: float = 2.0,
    max_dur_sec: float = 30.0,
) -> tuple[list[Clip], int]:
    """合并同角色相邻片段（非重叠、仅小间隙），用于 TTS 训练数据准备。

    按 start 排序后贪心扫描：
      - cur.start - acc.end ≤ merge_gap_sec → 合并进当前段
      - 合并后若超过 max_dur_sec → 在当前段结束，另起新段
      - 间隙过大 → 结束当前段，另起新段

    text_excerpt / raw_speaker 用 ' / ' 拼接。
    返回 (merged_clips, merged_count)。
    """
    if not clips:
        return [], 0

    sorted_clips = sorted(clips, key=lambda c: (c.start, c.end))
    out: list[Clip] = []
    acc = sorted_clips[0]
    merged_count = 0

    for cur in sorted_clips[1:]:
        gap = cur.start - acc.end
        would_exceed = (cur.end - acc.start) > max_dur_sec

        if gap <= merge_gap_sec and not would_exceed:
            # 合并 cur 进 acc
            new_end = max(acc.end, cur.end)
            new_text = f"{acc.text_excerpt} / {cur.text_excerpt}"[:120]
            new_raw = f"{acc.raw_speaker} / {cur.raw_speaker}"[:60]
            new_full = f"{acc.full_text} {cur.full_text}".strip()
            # source_kind 取更权威的
            PRIORITY = {"single": 2, "multi": 1}
            new_source = cur.source_kind if PRIORITY.get(cur.source_kind, 0) > PRIORITY.get(acc.source_kind, 0) else acc.source_kind
            acc = Clip(
                start=acc.start, end=new_end,
                raw_speaker=new_raw, text_excerpt=new_text,
                full_text=new_full,
                source_kind=new_source, entry_idx=acc.entry_idx,
            )
            merged_count += 1
        else:
            out.append(acc)
            acc = cur

    out.append(acc)
    return out, merged_count


# ============================================================
# ffmpeg
# ============================================================

def encode_args_for_kind(
    media_kind: str,
    ffmpeg: Path,
    *,
    audio_only: bool = False,
    audio_sample_rate: int = 0,
    hw_accel: bool = False,
    video_quality: int = VIDEO_QUALITY_DEFAULT,
) -> tuple[str, list[str]]:
    """返回 (输出扩展名, ffmpeg 编码参数列表)。

    audio_only=True  → 强制输出 WAV，忽略视频流（视频输入也只取音轨）。
    audio_sample_rate > 0 → 输出时重采样到指定采样率（Hz）。
    hw_accel=True    → 优先使用 GPU 编码器（nvenc/qsv/amf），找不到自动降级 CPU。
    video_quality    → 1~5，越大质量越高速度越慢，默认 2。
    """
    ar_args = ["-ar", str(audio_sample_rate)] if audio_sample_rate > 0 else []
    if audio_only or media_kind == "audio":
        return AUDIO_OUT_EXT, [*AUDIO_ACODEC, *ar_args]
    else:
        _name, vargs = probe_video_encoder(
            ffmpeg, hw_accel=hw_accel, video_quality=video_quality,
        )
        acodec = ["-c:a", "aac", "-b:a", "192k", *ar_args]
        return VIDEO_OUT_EXT, [*vargs, *acodec, *VIDEO_EXTRA]


def run_ffmpeg(cmd: list[str | Path]) -> None:
    """跑 ffmpeg；失败抛带 stderr 摘要的异常。"""
    cmd_str = [str(x) for x in cmd]
    proc = subprocess.run(
        cmd_str,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.splitlines()[-50:])
        raise RuntimeError(
            f"ffmpeg 失败 (exit {proc.returncode})\n"
            f"命令: {' '.join(cmd_str)}\n"
            f"stderr 末尾:\n{tail}"
        )


# 视频中间文件（CPU 路径）：ffv1 无损，内置，无需探测
_TMP_VIDEO_CODEC = ["-c:v", "ffv1", "-c:a", "pcm_s16le"]
_TMP_VIDEO_EXT = ".mkv"   # ffv1 必须用 Matroska 容器

# 视频中间文件（GPU/hw_accel 路径）：nvenc constqp，qp 值由 video_quality 决定
# 通过 _build_tmp_video_codec_gpu(quality) 动态生成，不再使用固定常量
_TMP_VIDEO_EXT_GPU = ".mp4"


def _extract_single_clip_to_file(
    ffmpeg: Path,
    media: Path,
    clip: Clip,
    out_path: Path,
    has_video: bool,
    codec_args: list[str],
    *,
    hw_accel: bool = False,
) -> None:
    """把单条 clip 从源文件提取为中间文件（内部函数）。

    每次只开 1 个 -i，提取完立刻释放解码上下文，内存占用恒为 O(1)。
    setpts/asetpts 重置 PTS，保证后续 concat demuxer 无缝拼接。
    """
    hwaccel_args = ["-hwaccel", "cuda"] if (hw_accel and has_video) else []
    # filter 内重置 PTS（去掉源文件时间戳偏移）
    if has_video:
        vf = "setpts=PTS-STARTPTS"
        af = "aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS"
        filter_args = ["-vf", vf, "-af", af]
    else:
        af = "aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS"
        filter_args = ["-af", af, "-vn"]

    cmd: list[str | Path] = [
        ffmpeg, "-hide_banner", "-loglevel", "error",
        *hwaccel_args,
        "-ss", f"{clip.start:.3f}",
        "-t",  f"{clip.duration:.3f}",
        "-i",  str(media),
        *filter_args,
        *codec_args,
        "-y", str(out_path),
    ]
    run_ffmpeg(cmd)


def merge_clips(
    ffmpeg: Path,
    media: Path,
    media_kind: str,
    clips: list[Clip],
    out_path: Path,
    tmp_dir: Path,
    *,
    audio_only: bool = False,
    audio_sample_rate: int = 0,
    hw_accel: bool = False,
    video_quality: int = VIDEO_QUALITY_DEFAULT,
) -> None:
    """切片并合并为单文件。

    audio_only=True  → 强制输出 WAV（视频输入也只取音轨）。
    audio_sample_rate > 0 → 输出重采样到指定采样率（Hz）。
    video_quality    → 1~5，控制视频编码质量，默认 2。

    两阶段流程：

    阶段 1 — 逐条提取到中间文件（内存 O(1)）：
      每条 clip 单独一次 ffmpeg 调用（1 个 -i），提取完立刻释放解码上下文。
      hw_accel=False（CPU 路径）:
        - 视频 → ffv1+pcm_s16le MKV（无损，CPU 编码）
        - 音频 → pcm_s16le WAV（无损）
      hw_accel=True（GPU 路径）:
        - 视频 → h264_nvenc constqp qp=<quality>+pcm_s16le MP4（GPU 编码，CPU 几乎不参与）
        - 音频 → pcm_s16le WAV（无损）
      PTS 在此阶段用 setpts/asetpts 重置为 0，保证 concat demuxer 可无缝拼接。

    阶段 2 — concat demuxer → 最终输出：
      CPU 路径：视频重编码（ffv1→h264），有损一次。
      GPU 路径：视频 stream copy（h264→h264，零损失），只编码音频（AAC，极轻）。
    """
    has_video = (media_kind == "video") and not audio_only
    n = len(clips)
    if n == 0:
        raise ValueError("merge_clips: 空 clips")

    _, final_codec = encode_args_for_kind(
        media_kind, ffmpeg, audio_only=audio_only,
        audio_sample_rate=audio_sample_rate, hw_accel=hw_accel,
        video_quality=video_quality,
    )

    # 中间文件格式选择
    if has_video:
        if hw_accel:
            # GPU 路径：nvenc constqp，qp 由 video_quality 决定，阶段 2 stream copy 视频
            tmp_ext = _TMP_VIDEO_EXT_GPU
            tmp_codec = _build_tmp_video_codec_gpu(video_quality)
            stage2_video_copy = True
        else:
            # CPU 路径：ffv1 无损
            tmp_ext = _TMP_VIDEO_EXT
            tmp_codec = _TMP_VIDEO_CODEC
            stage2_video_copy = False
    else:
        tmp_ext = ".wav"
        tmp_codec = ["-c:a", "pcm_s16le"]
        stage2_video_copy = False

    # 阶段 1：逐条提取
    clip_files: list[Path] = []
    try:
        for i, clip in enumerate(clips):
            clip_out = tmp_dir / f"_clip_{i:04d}{tmp_ext}"
            _extract_single_clip_to_file(
                ffmpeg, media, clip, clip_out,
                has_video, tmp_codec, hw_accel=hw_accel,
            )
            clip_files.append(clip_out)
            if (i + 1) % 20 == 0 or (i + 1) == n:
                print(f"  [{i+1}/{n}] 已提取...")

        # 阶段 2：concat demuxer → 最终输出
        print(f"  [concat {n} clips] → {out_path.name} ...")
        tmp_list = tmp_dir / "_concat_list.txt"
        # GPU 路径：中间文件已是 h264，视频直接 stream copy，只编 AAC 音频（极轻）
        # CPU 路径：ffv1 → h264 重编码
        if stage2_video_copy:
            stage2_codec = ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                            *VIDEO_EXTRA]
        else:
            stage2_codec = final_codec
        _merge_batches_to_output(
            ffmpeg, clip_files, out_path, tmp_list, stage2_codec,
        )
    finally:
        for f in clip_files:
            f.unlink(missing_ok=True)



def _merge_batches_to_output(
    ffmpeg: Path,
    batch_files: list[Path],
    out_path: Path,
    tmp_list: Path,
    codec_args: list[str],
) -> None:
    """把中间文件用 concat demuxer 合并为最终输出。

    中间文件由阶段 1 生成，PTS 已由 setpts 重置，concat demuxer 可直接拼接。
    codec_args 决定最终编码格式（含 -ar 重采样参数）：
    - 纯音频（WAV PCM）：['-c:a', 'pcm_s16le', ...]
    - 视频（ffv1/nvenc MKV）：h264 + aac，或 stream copy
    """
    # 写 ffconcat list 文件
    # 必须用绝对路径：ffmpeg 把 ffconcat 里的相对路径解析为相对于 list 文件所在目录，
    # 而非 CWD，会导致路径重复拼接。resolve() 转绝对路径后 as_posix() 保证跨平台兼容。
    lines = ["ffconcat version 1.0"]
    for f in batch_files:
        lines.append(f"file '{f.resolve().as_posix()}'")
    tmp_list.write_text("\n".join(lines) + "\n", encoding="utf-8")

    cmd: list[str | Path] = [
        ffmpeg, "-hide_banner", "-loglevel", "warning", "-stats",
        "-f", "concat", "-safe", "0", "-i", str(tmp_list),
    ]
    cmd.extend(codec_args)
    cmd.extend(["-y", str(out_path)])
    try:
        run_ffmpeg(cmd)
    finally:
        tmp_list.unlink(missing_ok=True)


def cut_single_clip(
    ffmpeg: Path,
    media: Path,
    media_kind: str,
    clip: Clip,
    out_path: Path,
    *,
    audio_only: bool = False,
    audio_sample_rate: int = 0,
    hw_accel: bool = False,
    video_quality: int = VIDEO_QUALITY_DEFAULT,
) -> None:
    """逐条切单个片段。"""
    _out_ext, codec_args = encode_args_for_kind(
        media_kind, ffmpeg, audio_only=audio_only,
        audio_sample_rate=audio_sample_rate, hw_accel=hw_accel,
        video_quality=video_quality,
    )
    has_video = (media_kind == "video") and not audio_only
    hwaccel_args = ["-hwaccel", "cuda"] if (hw_accel and has_video) else []
    # audio_only 时只取音轨
    map_args = ["-map", "0:a:0"] if audio_only and media_kind == "video" else []
    cmd: list[str | Path] = [
        ffmpeg, "-hide_banner", "-loglevel", "error",
        *hwaccel_args,
        "-ss", f"{clip.start:.3f}",
        "-to", f"{clip.end:.3f}",
        "-i", media,
        *map_args,
        *codec_args,
        "-y", out_path,
    ]
    run_ffmpeg(cmd)


# ============================================================
# 主处理
# ============================================================

def process_project(
    pf: ProjectFiles,
    *,
    speakers: list[str] | None,
    max_clips: int | None,
    shape: str,
    output_types: list[str],
    keep_unlabeled: bool,
    merge_overlap: bool,
    clip_merge_gap: float = 0.3,
    clip_max_dur: float = 30.0,
    clip_min_dur: float = 2.0,
    drop_cross_speaker_overlap: float | None = None,
    norm_srt: Path | None = None,
    overwrite: bool = False,
    output_root: Path = DEFAULT_OUTPUT_ROOT,
    ffmpeg: Path | None = None,
    audio_sample_rate: int = 0,
    hw_accel: bool = False,
    video_quality: int = VIDEO_QUALITY_DEFAULT,
    write_manifest: bool = True,
) -> dict:
    """处理一个项目；返回 report dict。"""
    print(f"\n{'='*60}")
    print(f"项目: {pf.project_name}")
    print(f"  媒体: {pf.media.name}  ({pf.media_kind})")
    print(f"  原字幕: {pf.subtitle.name if pf.subtitle else '(内封或未提供)'}")
    print(f"  别名: {pf.aliases.name if pf.aliases else '(none)'}")
    print(f"  输出类型: {' + '.join(output_types)}  形态: {shape}")
    if audio_sample_rate:
        print(f"  输出采样率: {audio_sample_rate}Hz")
    if "video" in output_types and pf.media_kind == "video":
        enc_name, _ = probe_video_encoder(
            ffmpeg, hw_accel=hw_accel, video_quality=video_quality,
        )
        print(f"  视频编码器: {enc_name} ({'hw_accel' if hw_accel else 'CPU'})"
              f"  质量档位: {video_quality}/5")
    print(f"{'='*60}")

    if "video" in output_types and pf.media_kind != "video":
        print(f"[!] 源媒体为 {pf.media_kind}，--output-type 含 video 不可用（无法输出视频）",
              file=sys.stderr)
        return {}

    do_combined = shape in ("merged", "both")
    do_individual = shape in ("clips", "both")

    target_set = set(speakers) if speakers else None

    # ---- 分桶：从 normalized SRT 读取 ----
    if norm_srt:
        norm_srt_path = Path(norm_srt)
    else:
        norm_srt_path = DEFAULT_INTERMEDIATE_ROOT / pf.project_name / "normalized.srt"
    if not norm_srt_path.exists():
        print(f"[!] 找不到归一化字幕: {norm_srt_path}")
        print("    请用 --srt 指定带 [speaker] 标签的 SRT，或先运行 normalize_sdh.py / normalize_mkv.py 生成归一化字幕。")
        return {}
    print(f"  切片输入: {norm_srt_path.name}")
    norm_entries = parse_srt(norm_srt_path)
    dropped_cross = 0
    if drop_cross_speaker_overlap is not None:
        norm_entries, dropped_cross = drop_cross_speaker_overlap_entries(
            norm_entries, drop_cross_speaker_overlap,
        )
        if dropped_cross:
            print(f"  交叉说话人重叠丢弃 {dropped_cross} 条"
                  f" (阈值 {drop_cross_speaker_overlap:g}s)")
    buckets, stats = build_buckets_from_normalized(
        norm_entries,
        target_speakers=target_set,
        include_unknown=keep_unlabeled,
    )
    stats["dropped_cross_speaker_overlap"] = dropped_cross
    print(f"\n字幕统计 (from normalized SRT):")
    print(f"  total entries:  {stats['total']}")
    print(f"  kept:           {stats['kept']}")
    print(f"  skipped ?:      {stats['skipped_unknown']}")
    print(f"  skipped not_in_targets: {stats['skipped_not_in_targets']}")

    # 桶内重叠合并
    merge_stats: dict[str, dict[str, int]] = {}
    if merge_overlap:
        for canonical, bucket in buckets.items():
            ms = merge_overlapping_clips(bucket)
            merge_stats[canonical] = ms

    if not buckets:
        print("\n[!] 没有任何片段命中目标角色，退出")
        return {
            "project": pf.project_name,
            "stats": stats,
            "config": {
                "speakers": speakers, "max_clips": max_clips, "shape": shape,
                "output_types": output_types, "keep_unlabeled": keep_unlabeled,
                "merge_overlap": merge_overlap, "audio_sample_rate": audio_sample_rate,
                "hw_accel": hw_accel, "video_quality": video_quality,
                "clip_merge_gap": clip_merge_gap, "clip_max_dur": clip_max_dur,
                "clip_min_dur": clip_min_dur,
                "drop_cross_speaker_overlap": drop_cross_speaker_overlap,
                "write_manifest": write_manifest,
            },
            "kinds": {kind: {"speakers": {}} for kind in output_types},
        }

    print(f"\n命中角色 ({len(buckets)}):")
    for canonical, b in sorted(buckets.items()):
        n = len(b.clips)
        used = min(n, max_clips) if max_clips else n
        ms = merge_stats.get(canonical)
        merge_note = f"  (overlap-merged {ms['merged']} → {ms['after']})" if ms and ms['merged'] else ""
        print(f"  {canonical:12s}  {n:>4d} clips "
              f"({b.from_single} single + {b.from_multi} multi)"
              f"{merge_note}  →  use {used}")

    # 输出根
    out_dir = output_root / pf.project_name
    out_dir.mkdir(parents=True, exist_ok=True)
    ext_by_kind = {
        kind: encode_args_for_kind(
            pf.media_kind, ffmpeg, audio_only=(kind == "audio"),
            audio_sample_rate=audio_sample_rate, hw_accel=hw_accel,
            video_quality=video_quality,
        )[0]
        for kind in output_types
    }

    speakers_report: dict[str, dict[str, dict]] = {}

    for canonical in sorted(buckets.keys()):
        bucket = buckets[canonical]
        all_clips = bucket.clips
        used_clips = all_clips[:max_clips] if max_clips else all_clips

        used_total_dur = sum(c.duration for c in used_clips)
        raw_variants_count: dict[str, int] = {}
        for c in used_clips:
            raw_variants_count[c.raw_speaker] = raw_variants_count.get(c.raw_speaker, 0) + 1

        # 剪辑层相邻合并：combined 和 individual 共用同一组 prepared_clips，
        # 且对所有输出类型一致，只算一次。过短过滤只用于 individual audio。
        prepared_clips = used_clips
        merged_count = 0
        if clip_merge_gap > 0:
            prepared_clips, merged_count = merge_adjacent_clips(
                used_clips, merge_gap_sec=clip_merge_gap, max_dur_sec=clip_max_dur,
            )

        per_kind: dict[str, dict] = {}
        for kind in output_types:
            audio_only = (kind == "audio")
            out_ext = ext_by_kind[kind]
            sp_dir = out_dir / canonical
            merged_file = out_dir / f"{canonical}__merged{out_ext}"

            # 1) 合并文件
            if do_combined:
                if merged_file.exists() and not overwrite:
                    print(f"\n[skip] {merged_file.name} 已存在 (用 --overwrite 覆盖)")
                else:
                    t0 = time.time()
                    note = f" (clip-merged {merged_count} → {len(prepared_clips)})" if merged_count else ""
                    print(f"\n[merge {kind}] {canonical}: {len(used_clips)} clips{note} → {merged_file.name} ...")
                    merge_clips(
                        ffmpeg, pf.media, pf.media_kind,
                        prepared_clips, merged_file, out_dir,
                        audio_only=audio_only,
                        audio_sample_rate=audio_sample_rate,
                        hw_accel=hw_accel,
                        video_quality=video_quality,
                    )
                    print(f"  done in {fmt_duration(time.time() - t0)}, "
                          f"output {merged_file.stat().st_size / 1e6:.1f} MB")

            # 2) 单条
            clips_to_cut = None
            manifest_file = None
            if do_individual:
                clips_to_cut = prepared_clips
                # 丢弃过短片段（仅 audio 类型时生效）。不依赖 clip_merge_gap。
                if clip_min_dur > 0 and audio_only:
                    before = len(clips_to_cut)
                    clips_to_cut = [c for c in clips_to_cut if c.duration >= clip_min_dur]
                    dropped = before - len(clips_to_cut)
                    if dropped:
                        print(f"  (丢弃 {dropped} 条 < {clip_min_dur}s 短片段)")
                sp_dir.mkdir(parents=True, exist_ok=True)
                manifest_name = (
                    "filelist_audio.txt" if audio_only else "filelist_video.txt"
                )
                manifest_path = sp_dir / manifest_name
                if not write_manifest and overwrite and manifest_path.exists():
                    manifest_path.unlink()
                note = f" (合并 {merged_count} 条 → {len(clips_to_cut)} 条)" if merged_count else ""
                print(f"\n[individual {kind}] {canonical}: 切 {len(clips_to_cut)} 条片段{note} ...")
                t0 = time.time()
                manifest_lines: list[str] = []
                for i, c in enumerate(clips_to_cut, 1):
                    fname = (
                        f"{i:04d}_{canonical}_"
                        f"{fmt_time_for_filename(c.start)}_"
                        f"{clean_text_for_filename(c.text_excerpt, 20)}{out_ext}"
                    )
                    fpath = sp_dir / fname
                    if fpath.exists() and not overwrite:
                        if write_manifest and c.full_text:
                            manifest_lines.append(f"{fname}|{canonical}|{c.full_text}")
                        continue
                    cut_single_clip(
                        ffmpeg, pf.media, pf.media_kind, c, fpath,
                        audio_only=audio_only,
                        audio_sample_rate=audio_sample_rate,
                        hw_accel=hw_accel,
                        video_quality=video_quality,
                    )
                    if write_manifest and c.full_text:
                        manifest_lines.append(f"{fname}|{canonical}|{c.full_text}")
                    if i % 10 == 0:
                        print(f"  {i}/{len(clips_to_cut)} ...")
                print(f"  done in {fmt_duration(time.time() - t0)}")

                # 写 TTS 标注文件
                if write_manifest:
                    manifest_path.write_text(
                        ("\n".join(manifest_lines) + "\n") if manifest_lines else "",
                        encoding="utf-8",
                    )
                    manifest_file = manifest_path.name
                    print(f"  [manifest] {manifest_path} ({len(manifest_lines)} 条)")

            per_kind[kind] = {
                "clips_total": len(all_clips),
                "clips_from_single": bucket.from_single,
                "clips_from_multi": bucket.from_multi,
                "clips_used_after_max": len(used_clips),
                "clips_after_merge": len(prepared_clips) if clip_merge_gap > 0 else None,
                "clips_after_min_dur": len(clips_to_cut) if (do_individual and audio_only and clip_min_dur > 0 and clips_to_cut is not None) else None,
                "overlap_merged_count": (merge_stats.get(canonical, {}) or {}).get("merged", 0),
                "total_duration_sec_used": round(used_total_dur, 3),
                "combined_file": merged_file.name if do_combined else None,
                "individual_dir": canonical if do_individual else None,
                "manifest_file": manifest_file,
                "raw_speaker_variants": raw_variants_count,
            }

        speakers_report[canonical] = per_kind

    return {
        "project": pf.project_name,
        "media": pf.media.name,
        "media_kind": pf.media_kind,
        "subtitle": pf.subtitle.name if pf.subtitle else None,
        "input_srt": str(norm_srt_path.resolve()),
        "aliases": pf.aliases.name if pf.aliases else None,
        "config": {
            "speakers": speakers,
            "max_clips": max_clips,
            "shape": shape,
            "output_types": output_types,
            "keep_unlabeled": keep_unlabeled,
            "merge_overlap": merge_overlap,
            "audio_sample_rate": audio_sample_rate,
            "hw_accel": hw_accel,
            "video_quality": video_quality,
            "clip_merge_gap": clip_merge_gap,
            "clip_max_dur": clip_max_dur,
            "clip_min_dur": clip_min_dur,
            "drop_cross_speaker_overlap": drop_cross_speaker_overlap,
            "write_manifest": write_manifest,
        },
        "stats": stats,
        "kinds": {
            kind: {"speakers": {c: sp[kind] for c, sp in speakers_report.items()}}
            for kind in output_types
        },
    }


# ============================================================
# CLI
# ============================================================

def parse_speakers_arg(s: str | None) -> list[str] | None:
    if not s:
        return None
    return [x.strip() for x in s.split(",") if x.strip()]


def main():
    ap = argparse.ArgumentParser(
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=__doc__,
    )
    ap.add_argument("project", nargs="?", default=None,
                    help="项目名（sub/input 下子目录）；与 --all 二选一")
    ap.add_argument("--all", action="store_true", help="处理 sub/input 下全部项目")
    ap.add_argument("--input", default=str(DEFAULT_INPUT_ROOT), help="input 根目录")
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT_ROOT), help="输出根目录")
    ap.add_argument("--media", default=None, help="显式指定媒体文件")
    ap.add_argument("--ffmpeg", default=None, help="显式指定 ffmpeg 路径")

    ap.add_argument("--speakers", default=None,
                    help="逗号分隔的 canonical 角色名（默认全部）")
    ap.add_argument("--max-clips", type=int, default=None,
                    help="每个角色最多取多少条（按字幕原顺序）")

    # 输出类型（必填）与形态
    ap.add_argument("--output-type", required=True,
                    choices=("audio", "video", "both"),
                    help="输出媒体类型：audio=WAV 纯音频 / video=含音轨 mp4 / both=两类都出")
    ap.add_argument("--shape", choices=("clips", "merged", "both"), default="both",
                    help="输出形态：clips=单条片段 / merged=拼合文件 / both=两类都出（默认 %(default)s）")
    ap.add_argument("--no-manifest", action="store_true",
                    help="不生成 TTS 标注文件（默认生成，视频输出为 filelist_video.txt，"
                         "音频输出为 filelist_audio.txt）")

    # 输出格式
    ap.add_argument("--audio-sample-rate", type=int, default=0,
                    metavar="HZ",
                    help="音频输出采样率（Hz）。0=保持源采样率（默认）。"
                         "TTS 常用值：24000（GPT-SoVITS）/ 44100（Style-Bert-VITS2）")
    ap.add_argument("--no-hw-accel", action="store_true",
                    help="禁用 GPU 硬件编码器，强制使用 CPU 软编码（libx264/mpeg4）。"
                         "默认开启硬件加速（nvenc/qsv/amf/h264_mf），找不到时自动降级。"
                         "仅 --output-type video 相关。")
    ap.add_argument("--video-quality", type=int, default=None,
                    choices=[1, 2, 3, 4, 5],
                    metavar="1-5",
                    help=(
                        "视频编码质量档位（1=最快/低质 ~ 5=最慢/高质，默认 %(default)s）。"
                        "仅 --output-type video 相关。"
                        "  档位→CRF: 1=28  2=23  3=18  4=12  5=0"
                    ))

    # 字幕筛选开关（作用于 normalized SRT）
    ap.add_argument("--keep-unlabeled", action="store_true",
                    help="把 [?] 未知行归到 ? 桶并切片（默认丢弃；normalized.srt 含 [?] 行时生效）")
    ap.add_argument("--no-merge-overlap", action="store_true",
                    help="关闭桶内重叠片段合并（默认开启，避免 SDH 字幕滞留导致同段音频切两次）")
    ap.add_argument("--srt", dest="norm_srt", default=None,
                    help="手动指定输入 SRT 路径（默认取 sub/intermediate/<project>/normalized.srt）")
    ap.add_argument("--clip-merge-gap", type=float, default=0.3,
                    help="同角色相邻片段间隔 ≤ N 秒时在剪辑前合并（TTS 推荐 0.3-0.5，默认 0.3）")
    ap.add_argument("--clip-max-dur", type=float, default=30.0,
                    help="合并后最大片段长度（秒），超过则在上一条边界拆分（默认 30）")
    ap.add_argument("--clip-min-dur", type=float, default=2.0,
                    help="合并后最小片段长度（秒），短于此值的直接丢弃（仅 --output-type audio 的 clips 生效，默认 2.0）")
    ap.add_argument("--drop-cross-speaker-overlap", dest="drop_cross_speaker_overlap",
                    type=float, default=None, metavar="SECONDS",
                    help="丢弃与其他说话人台词时间重叠超过 N 秒的条目（0=有任何重叠就丢；"
                         "默认不开启）。同 speaker 重叠不受影响；[?]/[NONSPEECH] 不参与判断；"
                         "同一多说话人 cue 展开的条目不算重叠")

    ap.add_argument("--overwrite", action="store_true",
                    help="覆盖已存在的输出文件（默认跳过）")

    args = ap.parse_args()

    if not args.project and not args.all:
        ap.error("必须指定项目名或 --all")
    if args.project and args.all:
        ap.error("--all 与项目名不能同时给")
    if args.drop_cross_speaker_overlap is not None and args.drop_cross_speaker_overlap < 0:
        ap.error("--drop-cross-speaker-overlap 不能为负数（0=有任何重叠就丢）")

    output_types = ["audio", "video"] if args.output_type == "both" else [args.output_type]
    merge_overlap = not args.no_merge_overlap
    hw_accel = not args.no_hw_accel
    video_quality = args.video_quality if args.video_quality is not None else VIDEO_QUALITY_DEFAULT
    if output_types == ["audio"]:
        if args.no_hw_accel:
            print("[!] 警告: --output-type audio 不需要视频编码器，--no-hw-accel 无效",
                  file=sys.stderr)
        if args.video_quality is not None:
            print("[!] 警告: --output-type audio 不需要视频编码，--video-quality 无效",
                  file=sys.stderr)

    try:
        ffmpeg = find_ffmpeg(args.ffmpeg)
    except FileNotFoundError as e:
        print(f"[!] {e}", file=sys.stderr)
        return 1
    print(f"ffmpeg: {ffmpeg}")
    # audio 类型不需要视频编码器，跳过探测
    if "video" in output_types:
        try:
            venc_name, _ = probe_video_encoder(
                ffmpeg, hw_accel=hw_accel, video_quality=video_quality,
            )
            print(f"video encoder: {venc_name}"
                  + (" (GPU/MF)" if hw_accel else " (CPU)")
                  + f"  quality: {video_quality}/5"
                  + f"  (CRF-equivalent: {_QUALITY_TO_CRF[video_quality]})")
        except RuntimeError as e:
            print(f"[!] {e}", file=sys.stderr)
            return 1

    input_root = Path(args.input)
    output_root = Path(args.output)
    speakers = parse_speakers_arg(args.speakers)

    # 决定要处理哪些项目
    if args.all:
        projects = list_projects(input_root)
        if not projects:
            print(f"[!] {input_root} 下没有项目")
            return 1
        names = [p.name for p in projects]
    else:
        names = [args.project]

    all_reports = []
    for name in names:
        try:
            pf = resolve_project(
                name, input_root=input_root,
                media=args.media,
                require_subtitle=False,
            )
        except ProjectIOError as e:
            print(f"[!] 跳过 {name}: {e}", file=sys.stderr)
            continue

        try:
            report = process_project(
                pf,
                speakers=speakers,
                max_clips=args.max_clips,
                shape=args.shape,
                output_types=output_types,
                keep_unlabeled=args.keep_unlabeled,
                merge_overlap=merge_overlap,
                clip_merge_gap=args.clip_merge_gap,
                clip_max_dur=args.clip_max_dur,
                clip_min_dur=args.clip_min_dur,
                drop_cross_speaker_overlap=args.drop_cross_speaker_overlap,
                norm_srt=Path(args.norm_srt) if args.norm_srt else None,
                overwrite=args.overwrite,
                output_root=output_root,
                ffmpeg=ffmpeg,
                audio_sample_rate=args.audio_sample_rate,
                hw_accel=hw_accel,
                video_quality=video_quality,
                write_manifest=not args.no_manifest,
            )
        except Exception as e:
            print(f"[!] 处理 {name} 时出错: {e}", file=sys.stderr)
            raise
        if report:
            all_reports.append(report)
            # 每个项目写自己的报告
            rp = output_root / pf.project_name / "extract_report.json"
            rp.parent.mkdir(parents=True, exist_ok=True)
            rp.write_text(
                json.dumps(report, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"\n[报告] {rp}")

    print(f"\n全部完成，处理 {len(all_reports)} 个项目")
    return 0


if __name__ == "__main__":
    sys.exit(main())
