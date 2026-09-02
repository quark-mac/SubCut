# P1 设计文档：归一化中间字幕（normalized SRT/JSONL）

> 版本：1.0
> 状态：已定稿（按用户5条决策确认）
> 对应项目方案 C 基础设施，为 batch 处理、视觉确认、跨项目复用和 LLM 补全提供中间表示层。

---

## 0. 总览

### 现状问题

当前 `extract_simple.py` 曾把 alias 映射、multi 展开、unlabeled 处理、桶内重叠合并混在一处，导致：

- 切片脚本同时承担 ETL + 编码，复杂度高
- 用户想改归属只能改 JSON / 重跑全流程，缺少可编辑的中间产物
- 未来 LLM（plan B）没有清晰输入接口
- 多源字幕格式（SRT/VTT 输入）只能在解析层加分支

### 解决方案

引入**归一化中间字幕**作为系统中轴，下游 `extract_simple.py` 只负责“分桶 → ffmpeg 切”。

### 核心契约

**1 条 = 1 段 × 1 角色 × 1 时间区间**。其中：

- alias 已固化（`[Kaguya]` 而非 `[かぐや]`）
- multi 已按 speaker block 展开为独立条目，未标记续行归到最近 speaker
- unlabeled 不推断 speaker，统一标 `[?]`，交给 Gemini
- 同 canonical 桶内已合并重叠
- nonspeech / 群体 / 路人等按规则过滤或保留

---

## 1. 输出规格

### 1.1 位置

```
sub/intermediate/<project>/
├── normalized.srt         ← 人类可读版（Aegisub 可直接打开）
├── normalized.jsonl       ← 机器可读版（每行一个 JSON 对象）
└── normalize_report.json    ← 本次 normalize 的统计与配置
```

### 1.2 时间精度

`HH:MM:SS,mmm`（毫秒）。源 ASS 厘秒 → 转毫秒低位补零。

---

## 2. SRT 格式

### 基本结构

```
<序号>
< HH:MM:SS,mmm --> HH:MM:SS,mmm >
[<speaker>] {<tag1>} {<tag2>} <台词文本>
```

### Speaker 规范

| 写法 | 含义 |
|---|---|
| `[Iroha]` | 已知归属（canonical 名） |
| `[Ayatsumugi Roka]` | 已知归属（全名 canonical） |
| `[?]` | 无显式 speaker 的对白，交给 Gemini 判断 |
| `[NONSPEECH]` | 非语音行（仅 `--keep-nonspeech` 时输出） |

### Metadata 标签

紧跟 `[speaker]` 之后，外层 `{}` 包裹，多个标签空格分隔：

| 标签 | 含义 | 出现条件 |
|---|---|---|
| `{MULTI}` | 来自 multi 行展开 | 原 ASS kind=multi |
| `{MERGED}` | 由 >=2 条原 entry 合并 | 无重叠则不出现 |

**不含来源索引**。溯源查 JSONL 的 `source_entries` 字段。

---

## 3. JSONL 格式

每行一个 `NormalizedEntry`：

```json
{"idx": 1, "start": 26.02, "end": 27.90, "speaker": "Yachiyo", "tags": [], "text": "今は昔", "source_entries": [0]}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `idx` | int | SRT 序号（1-based） |
| `start` / `end` | float | 秒，3 位小数 |
| `speaker` | str | canonical / `?` / `NONSPEECH` |
| `tags` | list[str] | `{MULTI, MERGED}` 子集 |
| `text` | str | 清洗后台词；多级行用 `\n` |
| `source_entries` | list[int] | 来自哪些原 ASS entry 索引（0-based）。MERGED 后可能 >1 |

**一一对应**：`normalized.srt` 与 `normalized.jsonl` 同 `idx` 同内容。

---

## 4. normalize_report.json 结构

```json
{
  "project": "Cosmic Princess Kaguya",
  "subtitle_source": "Japanese [SDH].ass",
  "aliases_source": "speaker_aliases.json",
  "effective_config": { "keep_unknown": true, "merge_overlap": false, ... },
  "stats": {
    "input_ass_total": 2655,
    "input_kind_counts": { "single": 703, "multi": 62, "nonspeech": 183, "unlabeled": 1707 },
    "alias_hit_singles": 517,
    "alias_miss_singles_kept_as_raw": 186,
    "multi_expanded_to": 124,
    "unlabeled_unknown": 1707,
    "unlabeled_dropped": 0,
    "nonspeech_kept": 0,
    "merged_overlap_pairs_per_speaker": {"Iroha": 18, "Kaguya": 40, ...},
    "output_entries_total": 1456,
    "output_speakers": {
      "Iroha": { "count": 548, "total_duration_sec": 1234.5 },
      "Kaguya": { "count": 484, "total_duration_sec": 1098.2 },
      "?": { "count": 198, "total_duration_sec": 521.3 },
      "NONSPEECH": { "count": 3, "total_duration_sec": 8.2 }
    }
  }
}
```

---

## 5. Normalize 算法

### Step 1: 解析 ASS

复用现有 `_subtitle_utils.parse_ass()` 得到含四类 kind 的 `list[SubtitleEntry]`。

### Step 2: 加载 aliases

复用现有 `_subtitle_utils.load_aliases()`。

### Step 3: 遍历 entries 生成 NormalizedClip

顺序遍历并直接映射：

- **single** (hit alias): `emit` (canonical, text, no tag).
- **single** (miss alias): `emit` (raw_normalized_text as speaker, text, no tag).
- **multi**: 对每个 part `emit` (canonical 或原 token, text, `{MULTI}`).
- **nonspeech**: 按配置丢弃或 `emit` (`NONSPEECH`, text, no tag).
- **unlabeled**: `emit` (`?`, text)，或在 `--no-keep-unknown` 时丢弃。normalize 不推断 speaker。

multi speaker block 规则：

- `(speaker)` 可以与台词同行，也可以独占一行。
- marker 后连续的无 marker 行归到最近 speaker。
- 至少两个清理后非空的 speaker block 才展开为 multi。
- 歌词或音效清理后为空的 block 不生成 speaker entry。
- 拆出的所有 part 共享源 cue 时间；normalize 不按文本长度猜测内部切点。
- `(彩葉・かぐや)` 等联合 speaker token 保持整体，不自动拆成两人。

### Step 4: 同 speaker 重叠合并

按 speaker 分组，每组按 start 排序。贪心合并 `cur.start < last.end + merge_gap_sec` 的条目：

- `end = max(a.end, b.end)`
- `tags = {MERGED} | a.tags | b.tags`
- `text = a_text + " / " + b_text`
- `source_entries = concat(a, b)`

跨 speaker 重叠不触碰。

### Step 5: 全局拍平排序

按 `(start_time, speaker)` 分配 1-based `idx`.

### Step 6: 输出

渲染 `normalized.srt` + `normalized.jsonl` + `normalize_report.json`.

---

## 6. CLI（normalize_sdh.py）

```
python sub/normalize/normalize_sdh.py "Cosmic Princess Kaguya"
    --keep-nonspeech             # 默认不保留
    --no-keep-unknown            # 默认保留未知；--no-keep-unknown 丢弃
    --merge-overlap              # 默认关闭
    --merge-gap-sec 0.1          # 默认 0.1，仅启用合并时生效
```

生效后的配置写入 `normalize_report.json`.

---

## 7. 下游改造方案（已实施）

### extract_simple.py 输入（当前状态）

- `normalized.srt` 存在 → 自动读取，唯一输入源
- 不存在 → 报错提示先跑 `sub/normalize/normalize_sdh.py`
- `--from-ass` / `--from-normalized` 旧 CLI 参数已删除（过渡期结束）

### build_buckets 简化（已实施）

```python
for entry in normalized_entries:
    if entry.speaker == "?"      and not config.include_unknown:    continue
    if entry.speaker == "NONSPEECH" and not config.include_nonspeech:  continue
    if config.target_speakers and entry.speaker not in config.target_speakers: continue
    buckets.setdefault(entry.speaker, []).append(entry)
```

仅 4 行，替换原约 150 行复杂四态大循环。

---

## 8. 不在 P1 范围

- LLM 补全 `[?]` 行（plan B / P2）
- SRT/VTT 作为输入源（架构已铺好，parser 不写）
- 跨集 speaker linking / VAD 精修 / GUI editor

---

## 9. 关键决策记录

| # | 决策项 | 用户选择（已全部确认） |
|---|---|---|
| 1 | unlabeled speaker 处理 | **不继承、不推断**。统一标 `[?]`，交给 Gemini。 |
| 2 | single 未命中 alias | **保留原 token**。输出 speaker 为 `normalize_speaker` 后的原始值。 |
| 3 | 配置加载 | **纯 CLI + report 写生效配置**。无独立配置文件。 |
| 4 | NONSPEECH 格式 | **保留文本括号**：`[NONSPEECH] (琵琶 の音)` |
| 5 | `\\N` 到 SRT | **真换行**。忠实保留 ASS 多级行。 |
