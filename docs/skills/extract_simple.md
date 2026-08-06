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
              ┌────────────────────┼────────────────────┐
              │ --output-type      │                     │
              │ audio|video|both   │ (必填)              │
              └────┬───────────┬───┘                     │
              audio│           │video                    │
        ┌──────────▼────┐  ┌───▼──────────────┐          │
        │ 输出 .wav      │  │ 输出 .mp4         │          │
        │ PCM 16bit     │  │ h264 + AAC        │          │
        │ 可选重采样     │  │ 可选 GPU/CPU 编码  │          │
        └────────┬──────┘  └───┬──────────────┘          │
                 │             │                          │
                 └───────┬─────┘                          │
                         │ (both=两类都走此分支)            │
                         ▼                                │
              ┌──────────────────┼──────────────────┐    │
              │                  │                  │    │
     ┌────────▼────────┐ ┌───────▼────────┐        │    │
     │ --shape merged  │ │ --shape clips  │        │    │
     │ 跳过单条片段     │ │ 跳过拼合文件    │        │    │
     └────────┬────────┘ └───────┬────────┘        │    │
              │                  │                  │    │
         未跳过              未跳过                 │    │
              │                  │                  │    │
     ┌────────▼────────┐ ┌───────▼───────────────┐ │    │
     │ Iroha__merged    │ │ Iroha/                 │ │    │
     │ .mp4 或 .wav     │ │ 0001_Iroha_00_01_23_  │ │    │
     │                  │ │ ハア....wav           │ │    │
     │ (concat 所有片段) │ │                       │ │    │
     └─────────────────┘ │ 切前处理（按顺序）：    │ │    │
                         │                        │ │    │
                         │ ① --clip-merge-gap     │ │    │
                         │   相邻同角色间隔≤N秒    │ │    │
                         │   → 合并为长片段        │ │    │
                         │                        │ │    │
                         │ ② --clip-max-dur       │ │    │
                         │   合并后超N秒           │ │    │
                         │   → 在上条边界拆分      │ │    │
                         │                        │ │    │
                         │ ③ --clip-min-dur       │ │    │
                         │   片段 < N秒            │ │    │
                         │   → 丢弃 (仅audio类型) │ │    │
                         └────────────────────────┘ │    │

   注: --shape 必选其一值；--output-type 必填。both 会按两类型各跑一遍上述流程。
```

---

## CLI 参数全览

### 核心输出控制

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--speakers Iroha,Kaguya` | 全部 canonical 角色 | 仅切指定角色。逗号分隔，如 `Iroha,Kaguya,Yachiyo`。不传则切所有 canonical 角色（含 Asahi、Rai 等小角色） |
| `--output-type audio\|video\|both` | **必填** | 输出媒体类型。`audio`=WAV 纯音频（PCM 16bit，**TTS 训练用**）；`video`=MP4（音轨 AAC 192k + h264 视频）；`both`=两类都出（各自独立产物和 filelist） |
| `--shape clips\|merged\|both` | `both` | 输出形态。`clips`=仅单条片段；`merged`=仅 `<角色>__merged.*` 拼合文件（角色全部片段 concat，方便快速预览）；`both`=两类都出 |
| `--no-manifest` | 关闭（默认生成） | 不生成 TTS 标注文件（默认生成）。视频输出为 `filelist_video.txt`，音频输出为 `filelist_audio.txt`，按输出格式自动命名，互不覆盖。标注格式为 `文件名\|说话人\|完整文本`，GPT-SoVITS / Bert-VITS2 可直接喂入 |

### 片段合并与过滤（剪辑层）

这些参数同时影响拼合视频和单条片段。它们解决 "字幕太碎" 的问题：原始 SRT 每行 1-3 秒，TTS 训练需要 3-30 秒的连贯语音。

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--clip-merge-gap` | `0.3` | 同角色相邻片段间隔 ≤N 秒 → 合并为一段。`0`=不合并（每条字幕独立切）。`0.3-0.5`=合并句子间自然停顿。`1.0+`=激进合并，可能跨场景 |
| `--clip-max-dur` | `30` | 合并后单条片段最长为 N 秒。超限时在**原始条目标界处**断开，确保每段仍是完整台词 |
| `--clip-min-dur` | `2.0` | 短于 N 秒的片段直接丢弃。**仅 `--output-type audio` 的 clips 生效**（视频模式下不丢，保证拼合预览完整） |
| `--drop-cross-speaker-overlap` | 关闭 | 丢弃与其他说话人台词**时间重叠超过 N 秒**的条目（`0`=有任何重叠就丢）。用于清理同时发声导致音频不纯的片段（如 TTS 数据）。同 speaker 重叠不受影响（仍走桶内重叠合并）；`[?]`/`[NONSPEECH]` 不参与判断；同一多说话人 cue 展开的条目不算重叠 |

### 桶内重叠去重

SDH 字幕的特点：上一行字幕经常 "滞留" 到下一行开始之后才消失。如果不处理，concat 会重复同一段音频，听感像卡顿。

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--no-merge-overlap` | 关闭（**默认开启合并**） | 禁用桶内重叠合并。一般不要开，除非你确认字幕没有重叠滞留 |

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
| `--no-hw-accel` | 关闭（默认 GPU 编码） | 禁用 GPU 硬件编码（nvenc/qsv/amf），强制 CPU 的 libx264。仅 `--output-type` 含 video 时相关（纯音频无需视频编码器） |
| `--video-quality` | `2` | 视频编码质量 1~5（1=最快/低画质，5=最慢/高画质）。仅 `--output-type` 含 video 时相关 |
| `--overwrite` | 关闭（跳过已有文件） | 强制覆盖已存在的输出文件。不加此参数时，已存在文件直接跳过不重切 |
| `--max-clips` | 不限制 | 每角色最多取 N 条（按 SRT 中出场顺序）。用于快速测试 |
| `--keep-unlabeled` | 关闭 | 保留 `[?]` 未知说话人条目，归入 `?/` 目录。调试/手动检查用 |
| `--all` | — | 批量处理 `sub/input/` 下全部项目。与项目名二选一 |

> **NONSPEECH 处理**：输入 SRT 里的 `[NONSPEECH]` 行（含 `[NONSPEECH:内联描述]` 变体，统一归入 NONSPEECH 桶）与普通角色同规则——**受 `--speakers` 过滤**：选到才输出，不选则跳过（计入 skipped not_in_targets）。是否把 NONSPEECH 行写进输入，由 **normalize 层**的 `--keep-nonspeech` 决定（默认不保留，故 `normalized.srt` 通常不含该行；`--srt` 指定含该行的文件时生效）。

---

## 常见场景

### 场景 A：默认（视频 + 合并 + 单条）

```bash
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" --speakers Iroha,Kaguya
```

**产**：`Iroha__merged.mp4` + `Iroha/0001_*.mp4` ... 每条按字幕时间戳切。

---

### 场景 B：TTS 训练（音频单条 + 时长过滤）

```bash
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" \
    --srt llm_corrected.srt \
    --speakers Iroha,Kaguya,Yachiyo \
    --output-type audio --shape clips --audio-sample-rate 24000 \
    --clip-merge-gap 0.3 --clip-min-dur 3.0 --clip-max-dur 30 \
    --overwrite
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
    --output-type video --shape merged --overwrite
```

**产**：`Iroha__merged.mp4` / `Kaguya__merged.mp4` / `Yachiyo__merged.mp4`

---

### 场景 D：只单条视频 + 相邻合并

```bash
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" \
    --speakers Iroha \
    --output-type video --shape clips --clip-merge-gap 0.5 --overwrite
```

**产**：`Iroha/0001_*.mp4` ... 间隔 ≤0.5s 的相邻台词被合并为一段再切。

---

### 场景 E：全角色批量（LLM 修正后）

```bash
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" \
    --srt llm_corrected.srt \
    --speakers Iroha,Kaguya,Yachiyo,Mikado,Mami,Roka,Koto,Noi,Asahi,Rai \
    --output-type video --shape merged --overwrite
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

### 机制一：桶内重叠合并（`--no-merge-overlap`）

**位置**：构建 speaker bucket 之后、切分/拼合之前（`process_project()` 第 845 行）

```
所有 Iroha 条目按 start 排序 → 贪心扫描
  若 cur.start < acc.end → 合并
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
| `--no-merge-overlap` | 完全禁用此机制（慎用，会导致重复音频） |

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
| 合并条件 | `cur.start < acc.end` | `cur.start - acc.end ≤ gap` |
| 作用对象 | 桶内重叠/紧邻条目 | 桶内相邻非重叠条目 |
| 生效阶段 | 构建 bucket 后 | 角色输出前（combined / individual 共用） |
| 配合参数 | 无（仅开关 `--no-merge-overlap`） | `--clip-max-dur`, `--clip-min-dur` |
| max-dur 拆分 | 无 | 有（超限在上条边界断） |
| min-dur 丢弃 | 无 | 有（仅 `--output-type audio` 的 clips） |

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
clip_min_dur          过短丢弃（仅 --output-type audio 的 clips）
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
| `--output-type` 缺失 | **拒绝**，argparse 报错退出（必填） |
| 已存在文件 + 无 `--overwrite` | 跳过（保留已有） |
| `--output-type audio` + 视频源 | 只取音轨（`-map 0:a:0`），编码为 WAV PCM 16bit |
| `--output-type` 含 video + 音频源 | **拒绝**该项目（无法输出视频），继续后续项目 |
| `--keep-unlabeled` | `[?]` 条目归入 `?/` 目录 |
| 输入含 `[NONSPEECH]` 行 | 与普通角色同规则：`--speakers` 选到（或未指定 `--speakers`）才切片，否则计入 skipped not_in_targets |
| `--all` 某项目失败 | 当前项目 `raise`，**后续项目全部跳过** |
| 空 speaker 组（无命中角色） | 跳过，不报错 |
| `--clip-min-dur` + 视频类型 | 不丢弃（仅在 audio 类型生效） |
| `--drop-cross-speaker-overlap` + 同 speaker 重叠 | 不受影响（桶内重叠合并照常处理） |

---

## 输出目录结构

```
sub/output/<project>/
├── Iroha__merged.mp4          # 拼合视频（--shape clips 时不生成）
├── Iroha__merged.wav          # 拼合音频（--output-type 含 audio 时生成）
├── Iroha/                     # 单条片段（--shape merged 时不生成）
│   ├── 0001_Iroha_00_01_15_オッケー.mp4
│   ├── 0002_Iroha_00_01_17_イェーイ.wav
│   ├── filelist_video.txt    # TTS 标注（视频输出，除非 --no-manifest）
│   └── filelist_audio.txt    # TTS 标注（音频输出，除非 --no-manifest）
├── Kaguya__merged.mp4
├── Kaguya/
│   ├── ...
│   └── filelist_video.txt    # 音频输出时则为 filelist_audio.txt
├── ...
└── extract_report.json        # 统计报告（config 记录 output-types/shape，speakers 按 kind 分节）
```

> filelist 命名按输出格式区分：视频（mp4）→ `filelist_video.txt`，音频（WAV）→ `filelist_audio.txt`。同一角色目录里同时跑视频和音频时两者共存、互不覆盖。

## TTS 标注格式 (`filelist_video.txt` / `filelist_audio.txt`)

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

`--output-type audio` 模式不涉及视频编码，`--no-hw-accel` 无效（传了会打警告）。
