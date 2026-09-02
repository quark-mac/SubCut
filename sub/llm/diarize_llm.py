"""
diarize_llm.py — Plan B：LLM 辅助说话人推断

用途：
  读取 normalized.srt，对以下条目调用 LLM 推断说话人：
    - speaker == "?"
    - "MULTI" in tags（全量）
  非 canonical speaker（先生/配信音声/男性/女性 等）跳过，保留原样。

输出：
  sub/intermediate/<project>/llm_corrected.srt   — 修正后的 SRT
  sub/intermediate/<project>/llm_audit.json       — 每条推断的 reason + confidence

用法：
  # dry-run：只打印 prompt，不调 API
  env\\python.exe sub\\llm\\diarize_llm.py "Cosmic Princess Kaguya" --dry-run

  # 小规模测试（前 N 批）
  env\\python.exe sub\\llm\\diarize_llm.py "Cosmic Princess Kaguya" --max-batches 2

  # 全量跑
  env\\python.exe sub\\llm\\diarize_llm.py "Cosmic Princess Kaguya"

配置（sub/llm/config.json）：
  base_url        OpenAI-compat API base URL
  model           模型名
  api_key_env     API key 的环境变量名（默认 LLM_API_KEY）
  batch_size      每批喂给 LLM 的目标条目数（默认 30）
  context_window  每个目标条目前后各取多少条已知 speaker 作上下文（默认 5）
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# --- Windows 控制台 UTF-8 ---
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# 自动加载 sub/llm/.env（简单的 KEY=VALUE 格式，不依赖 python-dotenv）
_ENV_FILE = Path(__file__).resolve().parent / ".env"
if _ENV_FILE.exists():
    for _line in _ENV_FILE.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            _k, _v = _k.strip(), _v.strip()
            if _k and _v and _k not in os.environ:
                os.environ[_k] = _v

# 把仓库根加入 sys.path，使 sub.* 模块可直接 import
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sub._srt_io import NormalizedEntry, parse_srt, write_srt, seconds_to_srt_time


# ============================================================
# 常量
# ============================================================

# canonical speaker 白名单（不含 ? / NONSPEECH，这两个也不是"已知"）
CANONICAL_SPEAKERS: frozenset[str] = frozenset({
    "Iroha", "Kaguya", "Yachiyo", "FUSHI",
    "Mikado", "Koto", "Mami", "Roka", "Noi", "Asahi", "Rai",
})

# 默认配置文件路径（相对仓库根）
DEFAULT_CONFIG_PATH = _REPO_ROOT / "sub" / "llm" / "config.json"

# intermediate 目录（相对仓库根）
INTERMEDIATE_ROOT = _REPO_ROOT / "sub" / "intermediate"


# ============================================================
# 配置
# ============================================================

@dataclass
class LLMConfig:
    base_url: str = "https://api.openai.com/v1"
    model: str = "gpt-4o-mini"
    api_key_env: str = "LLM_API_KEY"
    batch_size: int = 30
    context_window: int = 5

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "LLMConfig":
        return cls(
            base_url=d.get("base_url", cls.base_url),
            model=d.get("model", cls.model),
            api_key_env=d.get("api_key_env", cls.api_key_env),
            batch_size=int(d.get("batch_size", cls.batch_size)),
            context_window=int(d.get("context_window", cls.context_window)),
        )

    def get_api_key(self) -> str:
        key = os.environ.get(self.api_key_env, "")
        if not key:
            raise RuntimeError(
                f"未找到 API key。请设置环境变量 {self.api_key_env}。\n"
                f"  PowerShell: $env:{self.api_key_env} = 'sk-xxx'\n"
                f"  或创建 sub\\llm\\.env 文件（格式: {self.api_key_env}=sk-xxx）"
            )
        return key


def load_config(path: Path = DEFAULT_CONFIG_PATH) -> LLMConfig:
    """从 sub/llm/config.json 读取配置，缺失时用默认值。"""
    if not path.exists():
        print(f"[warn] 找不到 {path}，使用默认 LLM 配置", file=sys.stderr)
        return LLMConfig()
    raw = json.loads(path.read_text(encoding="utf-8"))
    return LLMConfig.from_dict(raw)


ROLE_EXTRA_COMPONENTS = frozenset({"story", "demographics", "visual_cues", "forms"})
DEFAULT_SELECTED_ROLE_EXTRAS = frozenset({"demographics"})


def load_role_descriptions(
    path: Path,
    detail: str = "baseline",
    extras: frozenset[str] = frozenset(),
) -> dict[str, Any]:
    """读取角色介绍 JSON；full 模式额外保留完整故事脉络。"""
    if not path.exists():
        print(f"[warn] 找不到角色介绍文件 {path}，LLM 将无角色背景信息", file=sys.stderr)
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if detail not in {"baseline", "selected", "full"}:
        raise ValueError(f"unsupported role detail: {detail}")
    unknown_extras = extras - ROLE_EXTRA_COMPONENTS
    if unknown_extras:
        raise ValueError(f"unsupported role extras: {sorted(unknown_extras)}")
    include_story = detail == "full" or "story" in extras
    return {
        k: v
        for k, v in raw.items()
        if not k.startswith("_")
        or k == "_speaker_identification_rules"
        or (include_story and k == "_story_context")
    }


# ============================================================
# 目标筛选
# ============================================================

def is_target(entry: NormalizedEntry) -> bool:
    """判断一条 entry 是否需要 LLM 审查。

    审查条件（满足任一）：
      - speaker == "?"
      - 包含 MULTI tag（不管 speaker 是否为 canonical）

    跳过条件（优先）：
      - speaker 是 NONSPEECH
      - 文本含 ♪ 标记（唱歌部分，声线与说话不同，对 TTS 无价值）
      - speaker 是非 canonical 且不含 MULTI — SDH 直接标注，最可靠
      - canonical speaker 且不含上述 tag — SDH 直接标注的 single，最可靠
    """
    if entry.speaker == "NONSPEECH":
        return False
    # 唱歌部分排除：♪ 标记表示歌词，声线与说话不同
    if "♪" in entry.text:
        return False
    if entry.speaker == "?":
        return True
    # MULTI 不管 speaker 是什么都要审查。
    if "MULTI" in entry.tags:
        return True
    if entry.speaker not in CANONICAL_SPEAKERS:
        return False
    return False


def collect_targets(entries: list[NormalizedEntry]) -> list[int]:
    """返回所有需要审查的 entry 在列表中的下标（0-based）。"""
    return [i for i, e in enumerate(entries) if is_target(e)]


# ============================================================
# 分批 + 上下文收集
# ============================================================

@dataclass
class Batch:
    """一批待审查条目 + 上下文。"""
    target_indices: list[int]          # entries 列表中的下标
    context_entries: list[NormalizedEntry]  # 上下文（含目标条目本身，按时间顺序）
    target_entry_indices_in_context: list[int]  # 目标条目在 context_entries 中的下标


def build_batches(
    entries: list[NormalizedEntry],
    target_indices: list[int],
    batch_size: int,
    context_window: int,
    max_context_entries: int = 200,
) -> list[Batch]:
    """把目标下标按 batch_size 分批，每批附带上下文。

    上下文规则：
      - 向前/后各取最多 context_window 条 entries（不限 speaker 类型）
      - 跨批次的上下文可能重叠，这是预期行为（让 LLM 看到连续对话）
      - 如果一批的 context 超过 max_context_entries，会在目标下标间隙处自动拆分
        （续跑时剩余目标可能稀疏分布，避免单批 prompt 过大）
    """
    batches: list[Batch] = []
    n = len(entries)

    def _emit_sub_batch(sub_targets: list[int]) -> None:
        if not sub_targets:
            return
        first_target = sub_targets[0]
        last_target = sub_targets[-1]
        ctx_start = max(0, first_target - context_window)
        ctx_end = min(n - 1, last_target + context_window)
        context_entries = entries[ctx_start: ctx_end + 1]
        target_in_ctx = [idx - ctx_start for idx in sub_targets]
        batches.append(Batch(
            target_indices=sub_targets,
            context_entries=context_entries,
            target_entry_indices_in_context=target_in_ctx,
        ))

    for batch_start in range(0, len(target_indices), batch_size):
        batch_targets = target_indices[batch_start: batch_start + batch_size]

        # 检查 context 是否过大（续跑场景：剩余目标稀疏分布）
        first = batch_targets[0]
        last = batch_targets[-1]
        total_ctx = (last - first) + 2 * context_window + 1

        if total_ctx <= max_context_entries:
            _emit_sub_batch(batch_targets)
            continue

        # context 过大 → 在目标间隙处拆分（间隙 > 2*context_window 则断开）
        gap_threshold = 2 * context_window
        sub: list[int] = [batch_targets[0]]
        for prev, curr in zip(batch_targets, batch_targets[1:]):
            if curr - prev > gap_threshold:
                _emit_sub_batch(sub)
                sub = [curr]
            else:
                sub.append(curr)
        _emit_sub_batch(sub)

    return batches


# ============================================================
# Prompt 渲染
# ============================================================

def _format_role_descriptions(
    role_desc: dict[str, Any],
    detail: str = "baseline",
    extras: frozenset[str] = frozenset(),
) -> str:
    """把角色介绍 dict 渲染成 prompt 里的文本段落。"""
    if not role_desc:
        return "（无角色介绍）"
    if detail not in {"baseline", "selected", "full"}:
        raise ValueError(f"unsupported role detail: {detail}")
    unknown_extras = extras - ROLE_EXTRA_COMPONENTS
    if unknown_extras:
        raise ValueError(f"unsupported role extras: {sorted(unknown_extras)}")
    if detail == "full":
        enabled_extras = ROLE_EXTRA_COMPONENTS
    elif detail == "selected":
        enabled_extras = DEFAULT_SELECTED_ROLE_EXTRAS | extras
    else:
        enabled_extras = extras
    lines: list[str] = []
    rules = role_desc.get("_speaker_identification_rules")
    if isinstance(rules, list) and rules:
        lines.append("【全局识别规则】" + "；".join(str(rule) for rule in rules if rule))
    story_context = role_desc.get("_story_context")
    if isinstance(story_context, dict) and story_context:
        story_parts = [f"{key}: {value}" for key, value in story_context.items() if value]
        if story_parts:
            lines.append(
                "【故事脉络 / context only（不可单独决定 speaker）】"
                + "；".join(story_parts)
            )

    def _format_value(value: Any) -> str:
        if isinstance(value, dict):
            return "；".join(f"{key}: {_format_value(item)}" for key, item in value.items())
        if isinstance(value, list):
            return "；".join(_format_value(item) for item in value)
        if value is None:
            return "unknown"
        return str(value)

    for name, info in role_desc.items():
        if str(name).startswith("_"):
            continue
        if not isinstance(info, dict):
            continue
        parts = [f"【{name}】"]
        if info.get("name_ja"):
            parts.append(f"日文名: {info['name_ja']}")
        if "demographics" in enabled_extras and "age" in info:
            parts.append(f"context only/年龄: {_format_value(info['age'])}")
        if "demographics" in enabled_extras and info.get("gender"):
            parts.append(f"context only/性别: {info['gender']}")
        if info.get("role"):
            parts.append(f"context only（不可单独决定 speaker）: {info['role']}")
        if info.get("first_person"):
            parts.append(f"第一人称: {info['first_person']}")
        if info.get("speech_style"):
            parts.append(f"speaker evidence/说话风格: {info['speech_style']}")
        if info.get("catchphrases"):
            parts.append(f"speaker evidence/口癖: {', '.join(info['catchphrases'])}")
        if info.get("address_others"):
            parts.append(f"speaker evidence/称呼: {info['address_others']}")
        appearance = info.get("appearance")
        if isinstance(appearance, dict):
            visual_parts: list[str] = []
            if appearance.get("summary"):
                visual_parts.append(str(appearance["summary"]))
            if appearance.get("avoid_mistakes"):
                visual_parts.append(
                    "易错提醒: " + "; ".join(map(str, appearance["avoid_mistakes"]))
                )
            if visual_parts:
                parts.append("visual evidence（弱证据）: " + " | ".join(visual_parts))
            if "visual_cues" in enabled_extras and appearance.get("visual_cues"):
                parts.append(
                    "additional visual evidence（弱证据）/视觉线索: "
                    + _format_value(appearance["visual_cues"])
                )
            if "forms" in enabled_extras and appearance.get("forms"):
                parts.append(
                    "additional visual evidence（弱证据）/形态: "
                    + _format_value(appearance["forms"])
                )
        if info.get("notes") and "请在此填入" not in str(info["notes"]):
            parts.append(f"context only（不可单独决定 speaker）: {info['notes']}")

        known_fields = {
            "name_ja", "age", "gender", "role", "first_person", "speech_style",
            "catchphrases", "address_others", "appearance", "notes",
        }
        lines.append("  " + " | ".join(parts))
    return "\n".join(lines)


def _format_entry_line(entry: NormalizedEntry, is_target: bool) -> str:
    """把一条 entry 渲染成 prompt 里的对话行。"""
    time_str = seconds_to_srt_time(entry.start)[:8]  # HH:MM:SS
    tags_str = (" " + " ".join(f"{{{t}}}" for t in entry.tags)) if entry.tags else ""
    # 多行文本折叠为单行（LLM 不需要看换行细节）
    text_oneline = entry.text.replace("\n", " / ")
    marker = "  ←" if is_target else ""
    return f"[{entry.idx}] {time_str} [{entry.speaker}]{tags_str} {text_oneline}{marker}"


def render_prompt(
    batch: Batch,
    canonical_speakers: frozenset[str] = CANONICAL_SPEAKERS,
    role_desc: dict[str, Any] | None = None,
) -> str:
    """生成发给 LLM 的完整 user 消息。

    role_desc 为 None 时跳过角色介绍（角色介绍已在 system prompt 中发送）。
    仍可通过传入 role_desc 在 dry-run 时查看完整 prompt。
    """
    target_set = set(batch.target_entry_indices_in_context)
    speaker_list = " / ".join(sorted(canonical_speakers)) + " / ?"

    role_text = _format_role_descriptions(role_desc) if role_desc else "（角色介绍请参考系统消息）"

    dialog_lines = []
    for i, entry in enumerate(batch.context_entries):
        dialog_lines.append(_format_entry_line(entry, i in target_set))
    dialog_text = "\n".join(dialog_lines)

    prompt = f"""以下是一段日语动画对话片段。标有 ← 的条目需要你判断说话人是否正确。

=== 角色介绍 ===
{role_text}

=== 可选说话人 ===
{speaker_list}

=== 规则 ===
1. 优先从"可选说话人"中选择。如果上下文明确指向列表外的说话人（如 先生、観客），也可以输出该名称。
2. 如果无法判断，输出 "?"。
3. 对于标记 ← 的条目，根据上下文自由推断说话人，可以覆盖任何原 speaker（包括非主角条目和主角条目）。
4. 对于无明显角色特征的短台词（"うん"/"そう"/"えっ"/"はい" 等），如果上下文不足以判断，输出 "?"，confidence 标 "low"。
5. 如果原 speaker 已经正确，corrected_spk 填原值即可。

=== 对话 ===
{dialog_text}

=== 输出格式 ===
只输出 JSON 数组，不要有任何其他文字：
[
  {{
    "idx": <条目序号>,
    "original_spk": "<原 speaker>",
    "corrected_spk": "<推断 speaker>",
    "confidence": "high" | "mid" | "low",
    "reason": "<简短推断理由，日文或中文均可>"
  }},
  ...
]

只输出标有 ← 的条目，不输出上下文条目。"""

    return prompt


# ============================================================
# 主入口（Part 1 结束，Part 2 继续）
# ============================================================

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="LLM 辅助说话人推断（Plan B）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("project", help="项目名，对应 sub/input/<project>/")
    p.add_argument(
        "--dry-run", action="store_true",
        help="只打印 prompt，不调用 LLM API",
    )
    p.add_argument(
        "--max-batches", type=int, default=0,
        help="最多处理前 N 批（0=全量，默认 0）",
    )
    p.add_argument(
        "--config", type=Path, default=DEFAULT_CONFIG_PATH,
        help=f"LLM 配置文件路径（默认 {DEFAULT_CONFIG_PATH}）",
    )
    p.add_argument(
        "--role-desc", type=Path, default=None,
        help="角色介绍 JSON 路径（默认 sub/input/<project>/role_descriptions.json）",
    )
    p.add_argument(
        "--srt", type=Path, default=None,
        help="输入 SRT 路径（默认 sub/intermediate/<project>/normalized.srt）",
    )
    p.add_argument(
        "--no-resume", action="store_true",
        help="忽略已有的 llm_corrected.srt / llm_audit.json，从头开始",
    )
    return p.parse_args()


def _resolve_paths(args: argparse.Namespace) -> tuple[Path, Path, Path]:
    """返回 (input_srt, output_srt, audit_json)。"""
    intermediate_dir = INTERMEDIATE_ROOT / args.project
    if not intermediate_dir.is_dir():
        print(f"[error] 找不到 intermediate 目录: {intermediate_dir}", file=sys.stderr)
        sys.exit(1)

    input_srt = args.srt or (intermediate_dir / "normalized.srt")
    if not input_srt.exists():
        print(f"[error] 找不到输入 SRT: {input_srt}", file=sys.stderr)
        sys.exit(1)

    output_srt = intermediate_dir / "llm_corrected.srt"
    audit_json = intermediate_dir / "llm_audit.json"
    return input_srt, output_srt, audit_json


def _try_resume(
    output_srt: Path,
    audit_json: Path,
    original_entries: list[NormalizedEntry],
    no_resume: bool = False,
) -> tuple[list[NormalizedEntry], list[dict[str, Any]], frozenset[int]]:
    """尝试从上次中断处续跑。

    返回 (entries, existing_audit, audited_idxs)。
    - entries: 已应用上次修正后的条目列表（续跑起点）
    - existing_audit: 已完成的 audit 记录
    - audited_idxs: 已审查过的 entry.idx 集合
    """
    if no_resume:
        return original_entries, [], frozenset()

    if not output_srt.exists() or not audit_json.exists():
        print("[resume] 无已有输出，从头开始")
        return original_entries, [], frozenset()

    # 尝试加载上次的 audit
    try:
        existing_audit: list[dict[str, Any]] = json.loads(audit_json.read_text(encoding="utf-8"))
        if not isinstance(existing_audit, list):
            raise ValueError("audit 格式错误")
    except Exception:
        print("[resume] 无法解析已有 audit，从头开始", file=sys.stderr)
        return original_entries, [], frozenset()

    # 尝试加载上次的 corrected SRT
    try:
        entries = parse_srt(output_srt)
    except Exception:
        print("[resume] 无法解析已有 corrected SRT，从头开始", file=sys.stderr)
        return original_entries, [], frozenset()

    audited_idxs = frozenset({r["idx"] for r in existing_audit if isinstance(r, dict) and "idx" in r})
    if not audited_idxs:
        return original_entries, [], frozenset()

    print(f"[resume] 续跑模式：已审查 {len(audited_idxs)} 条，跳过已有结果")
    return entries, existing_audit, audited_idxs


# ============================================================
# Part 2：LLM 调用 + 响应解析 + 结果写入
# ============================================================

def _make_client(cfg: LLMConfig) -> Any:
    """创建 OpenAI-compat 客户端。懒加载 openai 包。"""
    try:
        import openai  # type: ignore
    except ImportError:
        print(
            "[error] 缺少 openai 包。请先安装：\n"
            "  env\\pip.exe install openai",
            file=sys.stderr,
        )
        sys.exit(1)
    return openai.OpenAI(
        base_url=cfg.base_url,
        api_key=cfg.get_api_key(),
    )


def call_llm(
    client: Any, model: str, prompt: str,
    *,
    system_prompt: str = "你是一个专业的日语动画角色识别助手。请严格按照用户要求的 JSON 格式输出，不要输出任何其他内容。",
    retries: int = 3,
) -> str:
    """调用 LLM，返回原始响应文本。失败时最多重试 retries 次。"""
    for attempt in range(1, retries + 1):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
            )
            return resp.choices[0].message.content or ""
        except Exception as exc:
            wait = 2 ** attempt
            print(
                f"[warn] LLM 调用失败（第 {attempt}/{retries} 次）: {exc}，"
                f"{wait}s 后重试…",
                file=sys.stderr,
            )
            if attempt < retries:
                time.sleep(wait)
            else:
                raise


def parse_llm_response(raw: str) -> list[dict[str, Any]]:
    """解析 LLM 返回的 JSON 数组。容错处理常见格式问题。

    返回 list[dict]，每个 dict 含：
      idx, original_spk, corrected_spk, confidence, reason
    解析失败时返回空列表并打印警告。
    """
    text = raw.strip()

    # 去掉 markdown 代码块包裹（```json ... ``` 或 ``` ... ```）
    if text.startswith("```"):
        lines = text.splitlines()
        # 去掉首行（```json 或 ```）和末行（```）
        inner = lines[1:] if lines[-1].strip() == "```" else lines[1:]
        if inner and inner[-1].strip() == "```":
            inner = inner[:-1]
        text = "\n".join(inner).strip()

    # 找第一个 [ 到最后一个 ]
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end <= start:
        print(f"[warn] LLM 响应中找不到 JSON 数组:\n{raw[:300]}", file=sys.stderr)
        return []

    json_text = text[start: end + 1]
    try:
        data = json.loads(json_text)
    except json.JSONDecodeError as exc:
        print(f"[warn] JSON 解析失败: {exc}\n原始响应:\n{raw[:300]}", file=sys.stderr)
        return []

    if not isinstance(data, list):
        print(f"[warn] LLM 响应不是数组: {type(data)}", file=sys.stderr)
        return []

    # 规范化每条记录
    result: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        try:
            result.append({
                "idx": int(item["idx"]),
                "original_spk": str(item.get("original_spk", "?")),
                "corrected_spk": str(item.get("corrected_spk", "?")),
                "confidence": str(item.get("confidence", "low")),
                "reason": str(item.get("reason", "")),
            })
        except (KeyError, ValueError, TypeError) as exc:
            print(f"[warn] 跳过格式错误的记录 {item}: {exc}", file=sys.stderr)
    return result


def apply_corrections(
    entries: list[NormalizedEntry],
    corrections: list[dict[str, Any]],
    target_idx_set: frozenset[int] | None = None,
) -> list[dict[str, Any]]:
    """把 LLM 推断结果写回 entries（原地修改）。

    返回 audit 记录列表（含 batch 内所有推断，包括未修改的）。
    修正校验规则：
      - 保持不变（corrected_spk == original_spk）→ 总是接受
      - 改为 canonical / ? / 任何值 → 接受（MULTI 可能本应标为非主角）
    如果提供了 target_idx_set，则只处理集合内的 idx，忽略 LLM 返回的上下文条目。
    """
    idx_to_pos: dict[int, int] = {e.idx: i for i, e in enumerate(entries)}
    target_set = target_idx_set  # None means accept all

    audit_records: list[dict[str, Any]] = []

    for corr in corrections:
        idx = corr["idx"]
        if target_set is not None and idx not in target_set:
            continue

        pos = idx_to_pos.get(idx)
        if pos is None:
            print(f"[warn] LLM 返回了不存在的 idx={idx}，跳过", file=sys.stderr)
            continue

        entry = entries[pos]
        corrected = corr["corrected_spk"]
        original = entry.speaker

        # 校验修正是否合法 — 接受所有 LLM 输出（不再拒绝非 canonical）
        valid = True

        changed = corrected != original
        if changed:
            entries[pos].speaker = corrected

        audit_records.append({
            **corr,
            "applied": changed,
            "final_spk": corrected,
            "start": round(entry.start, 3),
            "end": round(entry.end, 3),
            "text": entry.text,
            "tags": list(entry.tags),
        })

    return audit_records


def write_audit(records: list[dict[str, Any]], path: Path) -> None:
    """写 llm_audit.json（追加模式：如果文件已存在则合并）。"""
    existing: list[dict[str, Any]] = []
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            existing = []

    # 用 idx 去重：新记录覆盖旧记录
    merged: dict[int, dict[str, Any]] = {r["idx"]: r for r in existing}
    for r in records:
        merged[r["idx"]] = r

    path.write_text(
        json.dumps(list(merged.values()), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ============================================================
# 主入口
# ============================================================

if __name__ == "__main__":
    args = _parse_args()
    cfg = load_config(args.config)
    role_desc_path = args.role_desc or (_REPO_ROOT / "sub" / "input" / args.project / "role_descriptions.json")
    role_desc = load_role_descriptions(role_desc_path)
    input_srt, output_srt, audit_json = _resolve_paths(args)

    raw_entries = parse_srt(input_srt)
    # 尝试续跑：优先用上次的 corrected SRT 作为起点
    entries, existing_audit, audited_idxs = _try_resume(output_srt, audit_json, raw_entries, args.no_resume)
    all_audit: list[dict[str, Any]] = list(existing_audit)

    # 过滤已审查的目标
    raw_targets = collect_targets(entries)
    target_indices = [i for i in raw_targets if entries[i].idx not in audited_idxs]
    skipped_count = len(raw_targets) - len(target_indices)

    batches = build_batches(entries, target_indices, cfg.batch_size, cfg.context_window)

    print(f"项目       : {args.project}")
    print(f"输入 SRT   : {input_srt}")
    print(f"输出 SRT   : {output_srt}")
    print(f"audit JSON : {audit_json}")
    print(f"总条目     : {len(entries)}")
    print(f"目标条目   : {len(raw_targets)}")
    if skipped_count:
        print(f"  已审查   : {skipped_count} 条（续跑跳过）")
        print(f"  待处理   : {len(target_indices)} 条")
    print(f"批次数     : {len(batches)}  (batch_size={cfg.batch_size})")
    print(f"context    : ±{cfg.context_window} 条")
    print(f"模型       : {cfg.model}  ({cfg.base_url})")
    print()

    max_b = args.max_batches if args.max_batches > 0 else len(batches)

    if args.dry_run:
        # dry-run：只打印 prompt，不调 API
        for i, batch in enumerate(batches[:max_b]):
            print(f"{'=' * 60}")
            print(
                f"Batch {i + 1}/{min(max_b, len(batches))}  "
                f"目标条目 idx: {[entries[j].idx for j in batch.target_indices]}"
            )
            print()
            print(render_prompt(batch, role_desc=role_desc))
            print()
        print("[dry-run] 完成，未调用 LLM API")
        sys.exit(0)

    # 正式跑：调用 LLM
    client = _make_client(cfg)
    changed_count = 0

    # 角色介绍放入 system prompt（只发送一次，不随每批重复）
    _BASE_SYSTEM = "你是一个专业的日语动画角色识别助手。请严格按照用户要求的 JSON 格式输出，不要输出任何其他内容。"
    system_prompt = _BASE_SYSTEM + "\n\n" + _format_role_descriptions(role_desc)

    for i, batch in enumerate(batches[:max_b]):
        target_idxs_display = [entries[j].idx for j in batch.target_indices]
        print(
            f"[{i + 1}/{min(max_b, len(batches))}] "
            f"处理 {len(batch.target_indices)} 条  "
            f"idx={target_idxs_display[0]}~{target_idxs_display[-1]}",
            end="  ",
            flush=True,
        )

        prompt = render_prompt(batch)  # 角色介绍已在 system prompt，不重复发送

        try:
            raw = call_llm(client, cfg.model, prompt, system_prompt=system_prompt)
        except Exception as exc:
            print(f"\n[error] 批次 {i + 1} LLM 调用失败，跳过: {exc}", file=sys.stderr)
            # 失败也写盘：保留已完成的进度
            write_srt(entries, output_srt)
            write_audit(all_audit, audit_json)
            continue

        corrections = parse_llm_response(raw)
        if not corrections:
            print("(无有效响应，跳过)")
            # 无响应也写盘：保留已完成的进度
            write_srt(entries, output_srt)
            write_audit(all_audit, audit_json)
            continue

        target_idx_set = frozenset({entries[j].idx for j in batch.target_indices})
        audit_records = apply_corrections(entries, corrections, target_idx_set=target_idx_set)
        all_audit.extend(audit_records)

        batch_changed = sum(1 for r in audit_records if r.get("applied"))
        changed_count += batch_changed
        print(f"修正 {batch_changed}/{len(corrections)} 条")

        # 每批结束后增量写盘（中断后可续跑）
        write_srt(entries, output_srt)
        write_audit(all_audit, audit_json)

    # 写输出
    write_srt(entries, output_srt)
    write_audit(all_audit, audit_json)

    print()
    print(f"完成。共修正 {changed_count} 条说话人标注。")
    print(f"输出 SRT   : {output_srt}")
    print(f"audit JSON : {audit_json}")

    # 统计 confidence 分布
    conf_counts: dict[str, int] = {}
    for r in all_audit:
        c = r.get("confidence", "?")
        conf_counts[c] = conf_counts.get(c, 0) + 1
    if conf_counts:
        print("confidence 分布:", "  ".join(f"{k}={v}" for k, v in sorted(conf_counts.items())))
