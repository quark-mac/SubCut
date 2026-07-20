"""
gemini_video_verify.py — Gemini 多模态短视频说话人验证测试。

用途：
  1. 从 target_verify_ab_<speaker>.jsonl 中抽样候选条目。
  2. 用 ffmpeg 为每条字幕生成低清短视频窗口。
  3. 可选调用 Gemini 视频/音频理解模型判断目标字幕是否由目标角色说出。
  4. 输出 JSONL + Markdown 审核表，便于人工评估准确率和成本。

示例：
  # 只准备 10 条视频和清单，不调用 API
  env\python.exe sub\llm\gemini_video_verify.py "Cosmic Princess Kaguya" --target Iroha --max-items 10 --prepare-only

  # 填好 GEMINI_API_KEY 后调用 Gemini
  env\python.exe sub\llm\gemini_video_verify.py "Cosmic Princess Kaguya" --target Iroha --max-items 10
"""

from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sub._srt_io import seconds_to_srt_time
from sub.llm.diarize_llm import INTERMEDIATE_ROOT
from sub.project_io import resolve_project


DEFAULT_MODEL = "gemini-2.5-flash"
DEFAULT_CONFIG_PATH = _REPO_ROOT / "sub" / "llm" / "gemini_config.json"


def _load_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return raw if isinstance(raw, dict) else {}


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Gemini 多模态短视频说话人验证测试",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("project", help="项目名，对应 sub/input/<project>/")
    parser.add_argument("--target", required=True, help="目标角色，如 Iroha / Kaguya")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH, help="Gemini 配置 JSON 路径")
    parser.add_argument("--model", default=None, help=f"Gemini 模型名（默认 {DEFAULT_MODEL}）")
    parser.add_argument("--base-url", default=None, help="Gemini API base URL；中转站需要时填写")
    parser.add_argument("--api-key-env", default=None, help="Gemini API key 环境变量名")
    parser.add_argument("--input", type=Path, default=Path("sub/input"), help="项目输入根目录")
    parser.add_argument("--media", type=Path, default=None, help="显式指定源视频")
    parser.add_argument("--ffmpeg", type=Path, default=None, help="显式指定 ffmpeg 路径")
    parser.add_argument("--ab-jsonl", type=Path, default=None, help="A/B JSONL，默认 target_verify_ab_<target>.jsonl")
    parser.add_argument("--max-items", type=int, default=20, help="最多抽取 N 条（默认 20）")
    parser.add_argument("--seed", type=int, default=42, help="随机抽样种子（默认 42）")
    parser.add_argument(
        "--sample-mode",
        choices=("mixed", "conflict", "rejected", "accepted", "all"),
        default="mixed",
        help="抽样模式：mixed=优先覆盖冲突/拒绝/接受；conflict=文本两方案冲突；rejected=target_verify拒绝；accepted=两边同意目标；all=全量随机",
    )
    parser.add_argument("--pre-roll", type=float, default=1.5, help="字幕前扩展秒数（默认 1.5）")
    parser.add_argument("--post-roll", type=float, default=1.5, help="字幕后扩展秒数（默认 1.5）")
    parser.add_argument("--min-window", type=float, default=4.0, help="最短视频窗口秒数（默认 4）")
    parser.add_argument("--max-window", type=float, default=12.0, help="最长视频窗口秒数（默认 12）")
    parser.add_argument("--height", type=int, default=360, help="输出视频高度（默认 360）")
    parser.add_argument("--fps", type=int, default=6, help="输出视频帧率（默认 6）")
    parser.add_argument("--overwrite-clips", action="store_true", help="覆盖已生成短视频")
    parser.add_argument("--prepare-only", action="store_true", help="只生成短视频和清单，不调用 Gemini")
    parser.add_argument("--output-dir", type=Path, default=None, help="输出目录")
    return parser.parse_args()


def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value and key not in os.environ:
            os.environ[key] = value


def _resolve_ffmpeg(explicit: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit)
    candidates.extend([
        _REPO_ROOT / "env" / "Library" / "bin" / "ffmpeg_cuda.exe",
        _REPO_ROOT / "env" / "Library" / "bin" / "ffmpeg.exe",
        Path("ffmpeg"),
    ])
    for candidate in candidates:
        if candidate.name == "ffmpeg" or candidate.exists():
            return candidate
    raise FileNotFoundError("找不到 ffmpeg，请用 --ffmpeg 指定")


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _is_conflict(record: dict[str, Any]) -> bool:
    target = record.get("target")
    n_target = record.get("n_pick", {}).get("speaker") == target
    v_target = record.get("target_verify", {}).get("decision") == "yes_target"
    return n_target != v_target


def _select_records(records: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    rng = random.Random(args.seed)

    def take(pool: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
        if count <= 0 or not pool:
            return []
        if len(pool) <= count:
            return list(pool)
        return rng.sample(pool, count)

    conflict = [r for r in records if _is_conflict(r)]
    rejected = [r for r in records if r.get("target_verify", {}).get("decision") != "yes_target" and not _is_conflict(r)]
    accepted = [r for r in records if r.get("n_pick", {}).get("speaker") == args.target and r.get("target_verify", {}).get("decision") == "yes_target"]

    if args.sample_mode == "conflict":
        selected = take(conflict, args.max_items)
    elif args.sample_mode == "rejected":
        selected = take(rejected, args.max_items)
    elif args.sample_mode == "accepted":
        selected = take(accepted, args.max_items)
    elif args.sample_mode == "all":
        selected = take(records, args.max_items)
    else:
        # 优先覆盖最有信息量的冲突和拒绝样本，再用接受样本填满。
        n_conflict = min(len(conflict), max(1, args.max_items // 3))
        n_rejected = min(len(rejected), max(1, args.max_items // 3))
        selected = take(conflict, n_conflict) + take(rejected, n_rejected)
        selected += take(accepted, args.max_items - len(selected))

    selected.sort(key=lambda record: int(record.get("idx", 0)))
    return selected


def _clip_window(record: dict[str, Any], args: argparse.Namespace) -> tuple[float, float]:
    start = max(0.0, float(record["start"]) - args.pre_roll)
    end = float(record["end"]) + args.post_roll
    duration = end - start
    if duration < args.min_window:
        pad = (args.min_window - duration) / 2
        start = max(0.0, start - pad)
        end += pad
    elif duration > args.max_window:
        center = (float(record["start"]) + float(record["end"])) / 2
        start = max(0.0, center - args.max_window / 2)
        end = start + args.max_window
    return start, end


def _make_clip(
    ffmpeg: Path,
    media: Path,
    output: Path,
    start: float,
    end: float,
    args: argparse.Namespace,
) -> None:
    if output.exists() and not args.overwrite_clips:
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    vf = f"scale=-2:{args.height},fps={args.fps}"
    cmd = [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{start:.3f}",
        "-to", f"{end:.3f}",
        "-i", str(media),
        "-vf", vf,
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "30",
        "-c:a", "aac",
        "-ac", "1",
        "-b:a", "64k",
        "-movflags", "+faststart",
        str(output),
    ]
    subprocess.run(cmd, check=True)


def _prompt(record: dict[str, Any], target: str) -> str:
    text = str(record.get("text", "")).replace("\\N", "\n")
    time_text = f"{seconds_to_srt_time(float(record['start']))} --> {seconds_to_srt_time(float(record['end']))}"
    return f"""你会看到一段短视频，包含目标字幕附近的画面和音频。

目标角色：{target}
目标字幕时间：{time_text}
目标字幕：
{text}

请判断这句目标字幕对应的语音是否由目标角色 {target} 说出。

只允许输出 JSON 对象，不要输出其他文字：
{{
  "idx": {record.get('idx')},
  "decision": "yes_target" | "no_other_speaker" | "unclear" | "overlap" | "offscreen",
  "visible_evidence": "<画面证据，无法判断就写无法判断>",
  "audio_evidence": "<音频/语音证据，无法判断就写无法判断>",
  "reason": "<简短理由>"
}}

规则：
1. 优先结合视频画面和音频，不要只相信字幕已有 speaker 标签。
2. 如果证据不足，不要猜，输出 unclear。
3. 如果明显多人同时说话或不适合单角色 TTS，输出 overlap。
4. 如果目标角色不在画面但音频能明显判断，可以依据音频判断。
5. 如果目标字幕与视频音频无法对应，输出 unclear。"""


def _parse_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {"_parse_error": "no_json_object", "raw": raw}
    try:
        data = json.loads(text[start: end + 1])
    except json.JSONDecodeError as exc:
        return {"_parse_error": str(exc), "raw": raw}
    return data if isinstance(data, dict) else {"_parse_error": "not_object", "raw": raw}


def _make_gemini_client(api_key: str, base_url: str | None = None) -> Any:
    try:
        from google import genai  # type: ignore
    except ImportError:
        print(
            "[error] 缺少 google-genai 包。请安装：\n"
            "  env\\pip.exe install google-genai",
            file=sys.stderr,
        )
        raise
    if base_url:
        normalized = base_url.rstrip("/")
        api_version = "v1" if normalized.endswith("/v1") else None
        if api_version:
            normalized = normalized[:-3]
        http_options: dict[str, Any] = {"base_url": normalized}
        if api_version:
            http_options["api_version"] = api_version
        return genai.Client(api_key=api_key, http_options=http_options)
    return genai.Client(api_key=api_key)


def _extract_usage(response: Any) -> dict[str, Any]:
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return {}
    if hasattr(usage, "model_dump"):
        return usage.model_dump()
    if hasattr(usage, "to_json_dict"):
        return usage.to_json_dict()
    return {k: getattr(usage, k) for k in dir(usage) if k.endswith("token_count")}


def _call_gemini_inline(client: Any, model: str, video_path: Path, prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        from google.genai import types  # type: ignore
    except ImportError:
        from google import genai as types  # type: ignore

    video_part = types.Part.from_bytes(
        data=video_path.read_bytes(),
        mime_type="video/mp4",
    )
    response = client.models.generate_content(
        model=model,
        contents=[video_part, prompt],
    )
    text = getattr(response, "text", "") or ""
    return _parse_json_object(text), _extract_usage(response)


def _call_gemini(client: Any, model: str, video_path: Path, prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        uploaded = client.files.upload(file=str(video_path))
    except Exception as exc:
        print(f"  [upload fallback: inline video] {exc}", end="", flush=True)
        return _call_gemini_inline(client, model, video_path, prompt)

    try:
        # 文件处理可能需要等待，短视频通常很快。
        for _ in range(30):
            state = getattr(uploaded, "state", None)
            state_name = getattr(state, "name", state)
            if state_name in (None, "ACTIVE"):
                break
            if state_name == "FAILED":
                raise RuntimeError(f"Gemini file processing failed: {uploaded}")
            time.sleep(1)
            uploaded = client.files.get(name=uploaded.name)

        response = client.models.generate_content(
            model=model,
            contents=[uploaded, prompt],
        )
        text = getattr(response, "text", "") or ""
        return _parse_json_object(text), _extract_usage(response)
    finally:
        try:
            client.files.delete(name=uploaded.name)
        except Exception:
            pass


def _write_jsonl(records: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n", encoding="utf-8")


def _cell(value: Any, max_len: int = 90) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\r", " ").replace("\n", " / ").replace("|", "\\|")
    text = " ".join(text.split())
    if len(text) > max_len:
        return text[: max_len - 1] + "…"
    return text


def _write_markdown(records: list[dict[str, Any]], path: Path) -> None:
    target = records[0].get("target", "?") if records else "?"
    decisions: dict[str, int] = {}
    total_tokens = 0
    token_rows = 0
    for record in records:
        decision = record.get("gemini", {}).get("decision") or record.get("gemini", {}).get("_parse_error") or "pending"
        decisions[decision] = decisions.get(decision, 0) + 1
        usage = record.get("usage", {})
        count = usage.get("total_token_count") or usage.get("total_tokens")
        if isinstance(count, int):
            total_tokens += count
            token_rows += 1

    lines = [
        f"# Gemini Video Verify Report — {target}",
        "",
        f"- total: {len(records)}",
        "- decisions: " + ", ".join(f"{k}={v}" for k, v in sorted(decisions.items())),
    ]
    if token_rows:
        lines.append(f"- avg total tokens: {total_tokens / token_rows:.1f}")
    lines.extend([
        "",
        "| idx | time | text | text N pick | text verify | Gemini | clip | reason |",
        "|---:|---|---|---|---|---|---|---|",
    ])
    for record in records:
        gemini = record.get("gemini", {})
        reason = gemini.get("reason") or gemini.get("raw") or ""
        lines.append(
            "| "
            + " | ".join([
                _cell(record.get("idx"), 12),
                _cell(seconds_to_srt_time(float(record.get("start", 0)))[:12], 16),
                _cell(record.get("text"), 90),
                _cell(record.get("n_pick", {}).get("speaker"), 24),
                _cell(record.get("target_verify", {}).get("decision"), 24),
                _cell(gemini.get("decision") or gemini.get("_parse_error") or "pending", 28),
                _cell(record.get("clip"), 80),
                _cell(reason, 120),
            ])
            + " |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    args = _parse_args()
    _load_dotenv()
    cfg = _load_config(args.config)

    model = args.model or cfg.get("model") or DEFAULT_MODEL
    base_url = args.base_url or cfg.get("base_url") or None
    api_key_env = args.api_key_env or cfg.get("api_key_env") or "GEMINI_API_KEY"

    project = resolve_project(args.project, input_root=args.input, media=args.media)
    media = project.media
    if project.media_kind != "video":
        print(f"[error] 源媒体不是视频: {media}", file=sys.stderr)
        return 1

    ab_jsonl = args.ab_jsonl or (INTERMEDIATE_ROOT / args.project / f"target_verify_ab_{args.target}.jsonl")
    if not ab_jsonl.exists():
        print(f"[error] 找不到 A/B JSONL: {ab_jsonl}", file=sys.stderr)
        return 1

    output_dir = args.output_dir or (INTERMEDIATE_ROOT / args.project / "gemini_video_verify" / args.target)
    clips_dir = output_dir / "clips"
    result_jsonl = output_dir / "results.jsonl"
    report_md = output_dir / "report.md"

    ffmpeg = _resolve_ffmpeg(args.ffmpeg)
    records = _select_records(_read_jsonl(ab_jsonl), args)
    if not records:
        print("[error] 没有可测试样本", file=sys.stderr)
        return 1

    print(f"项目       : {args.project}")
    print(f"目标角色   : {args.target}")
    print(f"源视频     : {media}")
    print(f"A/B JSONL  : {ab_jsonl}")
    print(f"样本数     : {len(records)} ({args.sample_mode})")
    print(f"模型       : {model}")
    print(f"base_url   : {base_url or '(default Gemini API)'}")
    print(f"输出目录   : {output_dir}")
    print()

    output_records: list[dict[str, Any]] = []
    for count, record in enumerate(records, start=1):
        idx = int(record["idx"])
        start, end = _clip_window(record, args)
        clip = clips_dir / f"{idx:04d}_{args.target}_{start:.2f}_{end:.2f}.mp4"
        print(f"[{count}/{len(records)}] idx={idx} clip {start:.2f}-{end:.2f}s", end="", flush=True)
        try:
            _make_clip(ffmpeg, media, clip, start, end, args)
        except subprocess.CalledProcessError as exc:
            print(f"  [ffmpeg error] {exc}")
            out = {**record, "target": args.target, "clip": str(clip), "gemini": {"_error": "ffmpeg_failed"}}
            output_records.append(out)
            _write_jsonl(output_records, result_jsonl)
            _write_markdown(output_records, report_md)
            continue

        out = {**record, "target": args.target, "clip": str(clip), "clip_start": round(start, 3), "clip_end": round(end, 3)}
        if args.prepare_only:
            out["gemini"] = {"decision": "pending"}
            print("  prepared")
        else:
            api_key = os.environ.get(api_key_env, "")
            if not api_key:
                print(f"\n[error] 未设置 {api_key_env}。可写入 sub\\llm\\.env：{api_key_env}=...", file=sys.stderr)
                return 1
            client = _make_gemini_client(api_key, base_url=base_url)
            try:
                gemini, usage = _call_gemini(client, model, clip, _prompt(record, args.target))
                out["gemini"] = gemini
                out["usage"] = usage
                print(f"  gemini={gemini.get('decision') or gemini.get('_parse_error')}")
            except Exception as exc:
                out["gemini"] = {"_error": str(exc)}
                print(f"  [gemini error] {exc}")

        output_records.append(out)
        _write_jsonl(output_records, result_jsonl)
        _write_markdown(output_records, report_md)

    print()
    print(f"完成。JSONL: {result_jsonl}")
    print(f"报告: {report_md}")
    print(f"短视频: {clips_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
