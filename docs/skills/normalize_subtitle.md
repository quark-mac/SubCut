# Skill：归一化字幕中间层（normalize_subtitle）

> 目的：把项目的 ASS 字幕转换为统一的 `normalized.srt` / `normalized.jsonl` 中间产物，
> 供下游 Gemini 标注、`extract_simple.py` 切片和用户手动审核使用。
>
> 详细规约见 `sub/normalize_subtitle_design.md`。

## 何时触发这个 skill

满足以下**全部**条件时执行：

1. 项目已有 `speaker_aliases.json`（若没有，先跑 `build_speaker_aliases` skill）
2. 用户想切片，或想审核字幕归属，或想修正 `[?]` 未知行
3. `sub/intermediate/<project>/normalized.srt` **不存在**，或用户要求重新生成

已有 `normalized.srt` 且用户没有要求重跑时，**不要**重新 normalize——直接用现有产物。

## 前置条件

- `sub/input/<project>/speaker_aliases.json` 存在
- `env/python.exe` 可用
- 终端能输出 UTF-8（脚本内已 `sys.stdout.reconfigure`，控制台乱码以报告文件为准）

## 工作流（3 步）

### Step 1 — 跑 normalize.py

```powershell
env\python.exe sub\normalize.py "<project_name>"
```

默认参数即可覆盖大多数场景。常用覆盖：

| 场景 | 参数 |
|---|---|
| 保留未知行（用于 LLM 补全） | （默认已保留，`[?]` 行会输出） |
| 丢弃未知行（只要已知角色） | `--no-keep-unknown` |
| 保留音效行 | `--keep-nonspeech` |
| 启用桶内重叠合并 | `--merge-overlap` |

输出到 `sub/intermediate/<project>/`：

```
normalized.srt          ← 人类可读，Aegisub 可直接打开
normalized.jsonl        ← 机器可读，含 source_entries 溯源
normalize_report.json   ← 统计 + 生效配置
```

### Step 2 — 读 normalize_report.json 确认统计

```
Read: sub/intermediate/<project>/normalize_report.json
```

重点检查：

- `alias_hit_singles`：alias 命中数，应与 `inspect_report.txt` 里的 single 数接近
- `alias_miss_singles`：未命中数，若偏高说明 aliases 有遗漏变体
- `unlabeled_unknown`：无显式 speaker、保留为 `[?]` 的条目数
- `merged_overlap_pairs_per_speaker`：各角色桶内合并次数，正常范围 0-60

### Step 3 — 抽查关键条目

用 Python 脚本快速验证几个已知条目：

```powershell
env\python.exe -c "
import sys; sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, 'sub')
from _srt_io import parse_jsonl
jl = parse_jsonl('sub/intermediate/<project>/normalized.jsonl')
# 打印前 20 条
for e in jl[:20]:
    print(f'  {e.idx:>4d} [{e.start:.2f}-{e.end:.2f}] {e.speaker} {e.tags} | {e.text[:50]!r}')
"
```

验证要点：

- 已知 multi 行是否展开为两条独立 entry（同时间段，不同 speaker，各带 `{MULTI}`）
- speaker marker 独占一行时，后续文本是否归到正确 speaker
- normalized 中不应存在空文本 entry
- 文本里**不应有** `\u200e`（LRM）等控制字符
- `[?]` 条目数量是否合理

## 产物说明

### normalized.srt 格式

```
1
00:00:26,020 --> 00:00:27,900
[Yachiyo] 今は昔

2
00:01:00,123 --> 00:01:03,456
[Iroha] {MULTI} うぅ~

3
00:01:00,123 --> 00:01:03,660
[Kaguya] {MULTI} {MERGED} だって / だって
つまんないんだもん
```

- `[speaker]`：canonical 名 / `?` / `NONSPEECH`
- `{TAG}`：`MULTI`（multi 展开）/ `MERGED`（桶内合并）
- 多行文本：真换行（ASS `\N` 已展开）

### normalized.jsonl 格式

每行一个 JSON 对象，含 `source_entries`（0-based ASS entry 索引）用于溯源：

```json
{"idx": 3, "start": 60.123, "end": 63.66, "speaker": "Kaguya", "tags": ["MULTI", "MERGED"], "text": "だって / だって\nつまんないんだもん", "source_entries": [411, 412]}
```

## 下游使用

normalize 完成后，`extract_simple.py` 会**自动检测**并使用 `normalized.srt`：

```powershell
# 自动用 normalized.srt（只要拼合视频）
env\python.exe sub\extract_simple.py "<project>" --speakers Iroha,Kaguya --output-type video --shape merged

# 用 LLM 修正后的 SRT（纯音频单条）
env\python.exe sub\extract_simple.py "<project>" --speakers Iroha,Kaguya --output-type audio --shape clips \
    --srt "sub\intermediate\<project>\llm_corrected.srt"

# TTS 训练：纯音频 + 相邻合并（推荐）
env\python.exe sub\extract_simple.py "<project>" --speakers Iroha,Kaguya --output-type audio --shape clips \
    --srt "sub\intermediate\<project>\llm_corrected.srt" \
    --clip-merge-gap 0.5

# 调整视频质量
env\python.exe sub\extract_simple.py "<project>" --speakers Iroha,Kaguya --output-type video --shape merged --video-quality 3
```

## 手动 / LLM 修正归属

`normalized.srt` 是普通文本，可以直接编辑：

- 把 `[?]` 改成 `[Iroha]`（修正无显式 speaker 的行）
- 把 `[女の子]` 改成 `[Kaguya]`（修正 alias 未命中行）
- 修改时间戳（精修边界）

编辑后**不需要**重跑 normalize，直接跑 `extract_simple.py` 即可。
若要同步 JSONL，重跑 normalize 会覆盖手动修改——手动修改后建议只用 SRT 路径。

生产流程由 `gemini_segment_diarize.py` 对全部字幕逐条输出 speaker；`[?]` 只是 normalize 阶段没有显式 speaker 的占位符。

## 常见问题

**Q: `alias_miss_singles` 偏高怎么办？**

跑 `inspect_speakers.py` 查看未命中的 token，补充到 `speaker_aliases.json`，再重跑 normalize。

**Q: `[?]` 条目太多怎么办？**

这是预期行为：无显式 speaker 的对白统一保留为 `[?]`，由 Gemini 结合视频和音频标注。

**Q: 重跑 normalize 会覆盖手动修改吗？**

会。手动修改 SRT 后，不要再跑 normalize（除非你想从头重来）。

**Q: normalized.srt 里有 `{MERGED}` 但我想看原始两条怎么办？**

查 `normalized.jsonl` 里对应 idx 的 `source_entries` 字段，找到原始 ASS entry 索引，再查原始字幕文件。

## 一句话总结

跑 `normalize.py` → 读 report 确认统计 → 抽查几条关键 entry → 有问题补 aliases 或调参数重跑 → 下游 `extract_simple.py` 自动消费。
