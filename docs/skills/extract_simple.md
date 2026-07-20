# extract_simple.py — 字幕驱动的角色片段提取/合并

## 概述

读取归一化 SRT（由 `normalize.py` 或 `diarize_llm.py` 生成），按角色分组，逐条从源媒体切片。
**不做 VAD、不做评分**，只按字幕时间戳精确切。

合并操作在剪辑层通过 `--clip-merge-gap` 完成，不影响字幕和下游 LLM 修正。

---

## 输出控制流程图

```
                        ┌──────────────────────┐
                        │   --speakers 过滤      │
                        │   命中角色 → 逐个处理    │
                        └──────────┬───────────┘
                                   │
                        ┌──────────▼───────────┐
                        │    --audio-only?      │
                        └───┬──────────────┬────┘
                       是   │              │  否
                   ┌───────▼───┐    ┌──────▼──────────┐
                   │ 输出 .wav  │    │ 输出 .mp4        │
                   │ PCM 16bit  │    │ h264_nvenc + AAC │
                   │ 可选重采样  │    │ 可选 GPU/CPU 编码 │
                   └─────┬─────┘    └────┬─────────────┘
                         │               │
                         └───────┬───────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
     ┌────────▼────────┐ ┌───────▼────────┐        │
     │  --no-combined   │ │ --no-individual │       │
     │  跳过拼接文件     │ │  跳过单条片段    │       │
     └────────┬────────┘ └───────┬────────┘        │
              │                  │                  │
         未跳过              未跳过                 │
              │                  │                  │
     ┌────────▼────────┐ ┌───────▼───────────────┐ │
     │ Iroha__merged    │ │ Iroha/                 │ │
     │ .mp4 或 .wav     │ │ 0001_Iroha_00_01_23_  │ │
     │                  │ │ ハア....wav           │ │
     │ (concat 所有片段) │ │                       │ │
     └─────────────────┘ │ 切前处理（按顺序）：    │ │
                         │                        │ │
                         │ ① --clip-merge-gap     │ │
                         │   相邻同角色间隔≤N秒    │ │
                         │   → 合并为长片段        │ │
                         │                        │ │
                         │ ② --clip-max-dur       │ │
                         │   合并后超N秒           │ │
                         │   → 在上条边界拆分      │ │
                         │                        │ │
                         │ ③ --clip-min-dur       │ │
                         │   片段 < N秒            │ │
                         │   → 丢弃 (仅audio_only)│ │
                         └────────────────────────┘ │

   注: --no-combined 和 --no-individual 不能同时给（无输出）
```

---

## CLI 参数全览

### 核心输出控制

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--speakers Iroha,Kaguya` | 全部 canonical 角色 | 仅切指定角色。逗号分隔，如 `Iroha,Kaguya,Yachiyo`。不传则切所有 canonical 角色（含 Asahi、Rai 等小角色） |
| `--audio-only` | 关闭 | 输出 `.wav` 纯音频（PCM 16bit），丢弃视频流。**TTS 训练必开**。不开则输出 `.mp4`（音轨 AAC 192k + h264 视频） |
| `--no-combined` | 关闭（默认生成） | 不生成 `<角色>__merged.*` 拼合文件。拼合文件是把某角色全部片段 concat 成单文件，方便快速预览 |
| `--no-individual` | 关闭（默认生成） | 不生成 `角色/0001_*.*` 单条片段。单条片段用于 TTS 训练、质量抽查。与 `--no-combined` 不能同时给 |
| `--no-manifest` | 关闭（默认生成） | 不生成 `filelist.txt` TTS 标注文件。标注格式为 `文件名\|说话人\|完整文本`，GPT-SoVITS / Bert-VITS2 可直接喂入 |

### 片段合并与过滤（剪辑层）

这些参数同时影响拼合视频和单条片段。它们解决 "字幕太碎" 的问题：原始 SRT 每行 1-3 秒，TTS 训练需要 3-30 秒的连贯语音。

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--clip-merge-gap` | `0.3` | 同角色相邻片段间隔 ≤N 秒 → 合并为一段。`0`=不合并（每条字幕独立切）。`0.3-0.5`=合并句子间自然停顿。`1.0+`=激进合并，可能跨场景 |
| `--clip-max-dur` | `30` | 合并后单条片段最长为 N 秒。超限时在**原始条目标界处**断开，确保每段仍是完整台词 |
| `--clip-min-dur` | `2.0` | 短于 N 秒的片段直接丢弃。**仅在 `--audio-only` 时生效**（视频模式下不丢，保证拼合预览完整） |

### 桶内重叠去重

SDH 字幕的特点：上一行字幕经常 "滞留" 到下一行开始之后才消失。如果不处理，concat 会重复同一段音频，听感像卡顿。

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--no-merge-overlap` | 关闭（**默认开启合并**） | 禁用桶内重叠合并。一般不要开，除非你确认字幕没有重叠滞留 |
| `--overlap-gap` | `0` | 重叠合并的额外容差（秒）。`0`=只合真正时间重叠的片段。`0.5`=间隔 ≤0.5s 的也合。与 `--no-merge-overlap` 同时给时静默无效 |

### 路径覆盖

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--srt` | `sub/intermediate/<项目>/normalized.srt` | 指定输入的 SRT 字幕文件。用 LLM 修正后的 SRT 时传此参数，如 `--srt llm_corrected.srt` |
| `--input` | `sub/input` | 项目根目录。一般不用改 |
| `--output` | `sub/output` | 输出根目录。切片结果写入 `<output>/<项目名>/` 下 |
| `--media` | 自动探测 | 显式指定源媒体文件路径。自动探测会找 `.mp4/.mkv/.avi` |
| `--ffmpeg` | 自动探测 | 显式指定 ffmpeg 路径。自动探测优先级：`env/Library/bin/ffmpeg_cuda.exe` > `env/Library/bin/ffmpeg.exe` > 系统 PATH |

### 其他

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--audio-sample-rate` | `0`（保持源采样率） | 输出音频采样率（Hz）。TTS 常用：`24000`（GPT-SoVITS）、`44100`（Bert-VITS2） |
| `--no-hw-accel` | 关闭（默认 GPU 编码） | 禁用 GPU 硬件编码（nvenc/qsv/amf），强制 CPU 的 libx264。`--audio-only` 时无效（纯音频无需视频编码器） |
| `--video-quality` | `2` | 视频编码质量 1~5（1=最快/低画质，5=最慢/高画质）。`--audio-only` 时无效 |
| `--overwrite` | 关闭（跳过已有文件） | 强制覆盖已存在的输出文件。不加此参数时，已存在文件直接跳过不重切 |
| `--max-clips` | 不限制 | 每角色最多取 N 条（按 SRT 中出场顺序）。用于快速测试 |
| `--keep-unlabeled` | 关闭 | 保留 `[?]` 未知说话人条目，归入 `?/` 目录。调试/手动检查用 |
| `--keep-nonspeech` | 关闭 | 保留 `[NONSPEECH]` 条目，归入 `NONSPEECH/` 目录。一般不需要语音/音效片段 |
| `--all` | — | 批量处理 `sub/input/` 下全部项目。与项目名二选一 |

---

## 常见场景

### 场景 A：默认（视频 + 合并 + 单条）

```bash
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" --speakers Iroha,Kaguya
```

**产**：`Iroha__merged.mp4` + `Iroha/0001_*.mp4` ... 每条按字幕时间戳切。

---

### 场景 B：TTS 训练（音频 + 合并 + 时长过滤）

```bash
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" \
    --srt llm_corrected.srt \
    --speakers Iroha,Kaguya,Yachiyo \
    --audio-only --audio-sample-rate 24000 \
    --clip-merge-gap 0.3 --clip-min-dur 3.0 --clip-max-dur 30 \
    --no-combined --overwrite
```

**产**：`Iroha/0001_*.wav` ... 每个片段 3-30 秒，24000Hz。
- `--clip-merge-gap 0.3`：说话中 0.3s 内的停顿合并为一段
- `--clip-min-dur 3.0`：< 3s 片段丢弃（太短对 TTS 无价值）
- `--clip-max-dur 30`：> 30s 在最近的条目边界拆开（太长难训练）

| 角色 | 原始条目 | merge-gap 后 | min-dur 过滤后 |
|---|---|---|---|
| Iroha | 609 | ~477 组 | 141 条 |
| Yachiyo | 216 | ~170 组 | 79 条 |

---

### 场景 C：只拼合视频（不要单条）

```bash
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" \
    --speakers Iroha,Kaguya,Yachiyo \
    --no-individual --overwrite
```

**产**：`Iroha__merged.mp4` / `Kaguya__merged.mp4` / `Yachiyo__merged.mp4`

---

### 场景 D：只单条视频 + 相邻合并

```bash
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" \
    --speakers Iroha \
    --no-combined --clip-merge-gap 0.5 --overwrite
```

**产**：`Iroha/0001_*.mp4` ... 间隔 ≤0.5s 的相邻台词被合并为一段再切。

---

### 场景 E：全角色批量（LLM 修正后）

```bash
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" \
    --srt llm_corrected.srt \
    --speakers Iroha,Kaguya,Yachiyo,Mikado,Mami,Roka,Koto,Noi,Asahi,Rai \
    --no-individual --overwrite
```

示例输出（本次实测）：

| 角色 | 条目 | 合并 MP4 |
|---|---|---|
| Iroha | 609 | 494 MB |
| Kaguya | 567 | 634 MB |
| Yachiyo | 216 | 387 MB |
| Mikado | 104 | 144 MB |
| Koto | 43 | 71 MB |
| Mami | 57 | 58 MB |
| Roka | 49 | 49 MB |
| Noi | 22 | 22 MB |
| Asahi | 8 | 7 MB |
| Rai | 6 | 3 MB |

---

## 两种合并机制

`extract_simple.py` 有**两个独立**的合并阶段，解决不同问题：

### 机制一：桶内重叠合并（`--overlap-gap` / `--no-merge-overlap`）

**位置**：构建 speaker bucket 之后、切分/拼合之前（`process_project()` 第 842 行）

```
所有 Iroha 条目按 start 排序 → 贪心扫描
  若 cur.start < acc.end + merge_gap_sec → 合并
```

**解决的问题**：SDH 字幕中相邻条目时间常有重叠（上一行字幕滞留到下一行开始之后）。如果两条重叠的字幕都归同一角色，concat 出来会重复同一段音频，听感像卡顿。

**示例**：
```
条目 A: [00:05 → 00:10] Iroha "こんにちは"
条目 B: [00:08 → 00:12] Iroha "元気ですか"
             ↑ 重叠 2s

不合并 → concat 后 00:05-00:08 的音频出现两次
合并   → 变成一条 [00:05 → 00:12]，音频无重复
```

**参数效果**：
| 命令 | 效果 |
|---|---|
| （默认） | 只合真重叠（cur.start < acc.end） |
| `--overlap-gap 0.5` | 间隔 ≤0.5s 的也合（几乎相邻的也视为重叠） |
| `--no-merge-overlap` | 完全禁用此机制（慎用，会导致重复音频） |

> **注意**：`--no-merge-overlap` 和 `--overlap-gap` 同时给时，gap 被静默忽略（合并循环已跳过）。

---

### 机制二：剪辑层相邻合并（`--clip-merge-gap` / `--clip-max-dur`）

**位置**：按角色准备输出片段时执行，拼合文件和单条片段共用同一组 `prepared_clips`。

```
所有 Iroha 条目按 start 排序 → 贪心扫描
  若 cur.start - acc.end ≤ clip-merge-gap 且不超 max-dur → 合并
  若合并后超 max-dur → 在上条边界断开，另起新段
```

**解决的问题**：TTS 训练需要适量长度的音频（3-30s），原始字幕条目多为 1-3s 的短句。把同一角色相邻的短句粘成更长片段。

**示例**：
```
条目 A: [00:05 → 00:07] Iroha "こんにちは"
条目 B: [00:08 → 00:10] Iroha "元気ですか"   gap=1s
条目 C: [00:11 → 00:13] Iroha "ありがとう"   gap=1s

--clip-merge-gap 0.5 → 都不合并（gap 太大）
--clip-merge-gap 2.0 → 合并为 [00:05 → 00:13]（gap 在容忍范围内）
```

---

### 两种机制的差异对比

| | 桶内重叠合并 | 剪辑层相邻合并 |
|---|---|---|
| 触发条件 | 默认启用，`--no-merge-overlap` 禁用 | `--clip-merge-gap > 0` |
| 合并条件 | `cur.start < acc.end + gap` | `cur.start - acc.end ≤ gap` |
| 作用对象 | 桶内重叠/紧邻条目 | 桶内相邻非重叠条目 |
| 生效阶段 | 构建 bucket 后 | 角色输出前（combined / individual 共用） |
| 配合参数 | `--overlap-gap` | `--clip-max-dur`, `--clip-min-dur` |
| max-dur 拆分 | 无 | 有（超限在上条边界断） |
| min-dur 丢弃 | 无 | 有（仅 `--audio-only`） |

---

## 处理流水线

```
build_buckets()       按 speaker 分组
    │
    ▼
merge_overlapping     桶内重叠合并（默认开启）
    │
    ▼
merge_adjacent        剪辑层相邻合并（--clip-merge-gap > 0）
    │
    ▼
clip_max_dur          超长拆分（在原始条目边界断）
    │
    ▼
clip_min_dur          过短丢弃（仅 --audio-only）
    │
    ▼
切单条 / 拼合文件      输出到 output/<project>/
```

---

## `--clip-merge-gap` 选择指南

| 值 | 适用场景 | 效果 |
|---|---|---|
| `0` | 不合并，保留原始切分 | 每条字幕独立一个文件 |
| `0.2` | 紧接台词（同一口气） | 几乎仅合并无间隙的对话 |
| `0.3 ~ 0.5` | **默认值 / TTS 推荐** | 合并句子间自然停顿，不跨场景 |
| `1.0+` | 长段独白 | 可能合并不同上下文的台词 |

---

## 边界行为

| 场景 | 行为 |
|---|---|
| `--no-combined --no-individual` | **拒绝**，报错退出 |
| 已存在文件 + 无 `--overwrite` | 跳过（保留已有） |
| `--audio-only` + 视频源 | 只取音轨（`-map 0:a:0`），编码为 WAV PCM 16bit |
| `--keep-unlabeled` | `[?]` 条目归入 `?/` 目录 |
| `--keep-nonspeech` | `[NONSPEECH]` 条目归入 `NONSPEECH/` 目录 |
| `--no-merge-overlap` + `--overlap-gap` | gap 静默无效（合并循环跳过） |
| `--all` 某项目失败 | 当前项目 `raise`，**后续项目全部跳过** |
| 空 speaker 组（无命中角色） | 跳过，不报错 |
| `--clip-min-dur` + 视频模式 | 不丢弃（仅在 `--audio-only` 生效） |

---

## 输出目录结构

```
sub/output/<project>/
├── Iroha__merged.mp4          # 拼合视频（除非 --no-combined）
├── Iroha/                     # 单条片段（除非 --no-individual）
│   ├── 0001_Iroha_00_01_15_オッケー.mp4
│   ├── 0002_Iroha_00_01_17_イェーイ.mp4
│   ├── filelist.txt           # TTS 标注（除非 --no-manifest）
│   └── ...
├── Kaguya__merged.mp4
├── Kaguya/
│   ├── ...
│   └── filelist.txt
├── ...
└── extract_report.json        # 统计报告
```

## TTS 标注格式 (`filelist.txt`)

每个角色目录下自动生成，格式为 GPT-SoVITS / Bert-VITS2 兼容：

```
文件名|说话人|完整文本
```

示例：
```
0001_Iroha_00_03_35_ハア....wav|Iroha|ハア…彩葉は超ムリ限界ギリなのでした
0002_Iroha_00_05_10_そんな....wav|Iroha|そんな めちゃ頑張り彩葉の いつもどおりの ある日の…
```

- 文本中的换行符（`\n`）和 ASS 换行标记（`\N`）均已替换为空格
- 合并后的片段文本用空格拼接
- 用 `--no-manifest` 可跳过生成

---

## 硬件编码

默认启用 GPU 硬件加速，按优先级探测：
1. `h264_nvenc`（NVIDIA）
2. `h264_qsv`（Intel QSV）
3. `h264_amf`（AMD）
4. `h264_mf`（Windows Media Foundation）
5. 退化到 `libx264`（CPU）

`--audio-only` 模式不涉及视频编码，`--no-hw-accel` 无效。
