# 方案 C：无障碍字幕驱动提取（首选方案）

## 实现状态（截至 2026-05-12）

| 阶段 | 状态 | 产物 |
|---|---|---|
| P1.0 设计文档 | ✅ 完成 | `sub/normalize_subtitle_design.md` |
| P1.1 SRT/JSONL I/O 层 | ✅ 完成 | `sub/_srt_io.py` |
| P1.2 normalize 算法 + CLI | ✅ 完成 | `sub/normalize.py` |
| P1.3 验证（Cosmic Princess Kaguya） | ✅ 完成 | `sub/intermediate/Cosmic Princess Kaguya/` |
| P1.4 extract_simple 消费 normalized SRT | ✅ 完成 | `sub/extract_simple.py` |
| P1.5 回归对比 | ✅ 完成 | canonical 角色时长 0 差异，clips 数差异仅来自合并时机不同 |
| P1.6 GPU 加速视频链路 | ✅ 完成 | NVDEC 解码 + nvenc constqp 中间文件 + 阶段2 stream copy |
| P1.7 视频质量档位 CLI 参数 | ✅ 完成 | `--video-quality 1-5`，统一映射到各编码器质量参数 |
| P2 LLM 补全 `[?]` 行 | ✅ 完成 | `sub/llm/diarize_llm.py`，`sub/llm/config.json`，`sub/input/<project>/role_descriptions.json` |
| P2.1 纯音频 TTS 相邻合并 | ✅ 完成 | `--clip-merge-gap` / `--clip-max-dur` CLI 参数 |
| P2.2 自定义 SRT 输入 | ✅ 完成 | `extract_simple.py` 支持 `--srt` 指定任意 SRT |
| VAD 边界精修 | 待做 | silero-vad |
| DNSMOS 质量评分 | 待做 | 可选 |

**当前可用的典型调用**：

```powershell
# Step 1: 归一化字幕
env\python.exe sub\normalize.py "Cosmic Princess Kaguya"

# Step 1.5（可选）: LLM 辅助修正 [?] 行（plan B）
env\python.exe sub\llm\diarize_llm.py "Cosmic Princess Kaguya"

# Step 2: 切片（用 LLM 修正后的 SRT，纯音频 + TTS 片段合并）
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" \
    --speakers Iroha,Kaguya --output-type audio --shape clips \
    --srt "sub\intermediate\Cosmic Princess Kaguya\llm_corrected.srt" \
    --clip-merge-gap 0.5

# Step 2（直接切，不用 LLM，只要拼合视频）
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" --speakers Iroha,Kaguya --output-type video --shape merged

# Step 2（调整质量）：档位 3 = qp/crf 18，比默认档位 2（qp/crf 23）更清晰
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" --speakers Iroha,Kaguya --output-type video --shape merged --video-quality 3

# Step 2（TTS 训练，只要音频）：
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" --speakers Iroha,Kaguya --output-type audio --shape clips --audio-sample-rate 24000
```

---

## 核心思路

**无障碍字幕（SDH / Closed Caption）自带说话人标注**，直接把"diarization 问题"
降级为"字幕对齐 + 音频切片"的工程问题。

```
传统:        音频 → diarization 模型 → SPK1/2/3 (易错)
方案 C:      音频 + 字幕(已有 speaker label) → 切片 → 按 speaker 归类 (直接用)
```

研究级问题 → 工程级问题。这是**目前最干净、最可靠**的 TTS 数据准备方案。

## 适用场景

- 你有完整影片 + 带说话人标注的字幕（无障碍字幕 / SDH / 角色版字幕）
- 字幕格式：SRT / ASS / VTT 都可以
- 字幕里说话人标注示例：

```
Kaguya: 待って、いろは！
[Iroha] やめて！
（かぐや）来ないで！
```

## 已知难点 + 解法

### 难点 1: 字幕时间戳不精确

无障碍字幕的时间戳是给观众看的，**起点偏早、终点偏晚**（让观众读完）。
直接按字幕时间切，会包含静音和相邻 turn 尾音。

**解法**: 用 silero-vad 在字幕窗口（±0.3s 扩展）内重新精确定位语音边界。

### 难点 2: 多人同时说话

字幕里两条时间重叠：
```
[00:01:23 - 00:01:25] Kaguya: 待って！
[00:01:23 - 00:01:25] Iroha:  やめて！
```

直接切会得到合声，对 TTS 训练**有毒**。

**解法（按工程量从低到高）**:

| 策略 | 方法 | 数据损失 | 推荐 |
|---|---|---|---|
| A | 检测时间重叠，全部丢弃 | ~10-30% | ⭐ TTS 业界标准做法 |
| B | A + pyannote overlap detection 二次验证 | ~15-40% | ⭐⭐ 最稳 |
| C | 用 SpeakerBeam 等 source separation 抽出目标 | 数据保留多 | ❌ 伪影伤 TTS |

### 难点 3: BGM 残留 / 音效 / 角色非语义发声

UVR 分离不可能 100% 干净，仍会有：
- BGM 残片
- 角色叹气、笑声、喘息
- 背景路人对白

**解法**: DNSMOS / UTMOS 质量评分过滤。

### 难点 4: 字幕角色名规范化

同一角色字幕里可能写法不一：`Kaguya` / `かぐや` / `カグヤ` / `[K]`

**解法**: 提供 `name_mapping.json` 配置，统一规范化。

### 难点 5: 片段时长不符合 TTS 训练要求

| TTS 框架 | 推荐单条时长 |
|---|---|
| GPT-SoVITS | 2-10 秒 |
| Bert-VITS2 | 3-10 秒 |
| F5-TTS | 5-15 秒 |
| Style-Bert-VITS2 | 3-10 秒 |

**解法**:
- 太短 (<2s) → 丢弃或合并相邻同角色片段
- 太长 (>15s) → 在字幕内部静音处切分

## 完整流水线

```
INPUT:
  - audio.wav (UVR 处理过的干声, 完整影片)
  - subtitle.ass / .srt / .vtt (带说话人标注)
  - name_mapping.json (角色名规范化, 可选)

STEP 1. 解析字幕
  - pysubs2 库支持 ASS/SRT/VTT
  - 提取 [(start, end, raw_speaker, text), ...]

STEP 2. 角色名规范化
  - 应用 name_mapping
  - "かぐや" / "Kaguya" / "[K]" → "Kaguya"

STEP 3. 重叠检测（字幕级）
  - 检测时间区间有交集的字幕条
  - 标记为 is_overlap_safe=False
  - 这些条目跳过切片

STEP 4. 边界精修（VAD）
  - 对每条单人字幕:
    - 在 [start-0.3s, end+0.3s] 窗口跑 silero-vad
    - 找出真正的 speech 起止点
    - 如果 VAD 检测不到语音 → 标记为低质量

STEP 5. 二次重叠验证（可选, pyannote overlap detection）
  - 用 pyannote segmentation 模型对每个字幕窗口判断
  - 如果模型输出 overlap 概率高 → 字幕没标但实际有重叠 → 丢弃

STEP 6. 切片
  - ffmpeg / pydub 切出 wav 片段
  - 16kHz / 24kHz / 44.1kHz 视 TTS 框架要求

STEP 7. 时长筛选
  - duration < 2s → 丢弃 (或合并相邻同角色)
  - duration > 15s → 内部静音切分

STEP 8. 质量评分（可选, DNSMOS）
  - 对每个片段算 MOS 预估值
  - < 3.0 → 标记 low quality
  - 3.0-4.0 → medium
  - > 4.0 → high

STEP 9. 按角色归类输出
  output/
    Kaguya/
      high_quality/
        001_00:01:23_<text_excerpt>.wav
        001_00:01:23_<text_excerpt>.lab    ← 文本同步导出
      medium/
      low/
    Iroha/
    Yachiyo/
    Fushi/
    _overlap_discarded/         ← 多人重叠的段, 单独存
    _too_short/                 ← 时长不达标
    _low_quality/               ← VAD 失败 / 质量分低
  metadata.csv                   ← 总清单

STEP 10. 报告
  - 每个角色总时长 / 片段数
  - 各种丢弃原因的统计
  - 给你直观的数据集概览
```

## 工具栈

| 任务 | 工具 | 备注 |
|---|---|---|
| 字幕解析 | `pysubs2` | 支持 ASS/SRT/VTT, pip 装 |
| 音频切片 | `pydub` + 项目自带 ffmpeg | 已有 |
| VAD | `silero-vad` | 轻量, pip 装 |
| 重叠检测 | `pyannote.audio 4.x` | 已装 |
| 质量评分 | `DNSMOS` (微软) | 需下载 ONNX 模型 |
| 元数据 | `csv` 标准库 | 不用装 |

## 输出目录结构（推荐）

```
output/
├── Kaguya/
│   ├── high_quality/
│   │   ├── 001.wav
│   │   ├── 001.lab        # 单行台词文本, TTS 训练直接用
│   │   ├── 002.wav
│   │   └── 002.lab
│   ├── medium/
│   └── low/
├── Iroha/
├── Yachiyo/
├── Fushi/
├── _overlap_discarded/
│   └── (按字幕原顺序, 命名带角色对)
├── _too_short/
├── _low_quality/
├── metadata.csv
└── extraction_report.json
```

`metadata.csv` 字段：
```csv
filename,speaker,start,end,duration,text,dnsmos,is_overlap_safe,quality_tier
Kaguya/high_quality/001.wav,Kaguya,83.2,85.7,2.5,"待って、いろは！",4.21,true,high
```

## 配置（diar_config.json 新增）

```json
"subtitle_extract": {
    "subtitle_path": "data/movie.ass",
    "audio_path": "data/movie_vocals.wav",
    "output_dir": "output/",
    "name_mapping_file": "name_mapping.json",

    "vad_extend_ms": 300,            // 字幕窗口前后扩展, 给 VAD 搜索空间
    "min_duration": 2.0,             // 最短保留时长 (秒)
    "max_duration": 15.0,            // 最长, 超过则切分
    "merge_short_adjacent": true,    // 太短的同角色相邻片段合并

    "use_overlap_detection": true,   // 用 pyannote 二次验证重叠
    "use_dnsmos": false,             // 是否启用质量评分 (需另装)

    "quality_thresholds": {
        "high": 4.0,
        "medium": 3.0
    },

    "output_sample_rate": 24000,     // GPT-SoVITS 推荐 24k
    "output_channels": 1
}
```

`name_mapping.json` 示例：
```json
{
    "kaguya": "Kaguya",
    "かぐや": "Kaguya",
    "カグヤ": "Kaguya",
    "[K]": "Kaguya",
    "iroha": "Iroha",
    "いろは": "Iroha",
    "[I]": "Iroha"
}
```

## 优点

- **准确率最高**——靠人工标注的字幕作 ground truth
- **跳过 diarization 不稳定环节**
- **可重复、可解释**——每条切片都能追溯到字幕第几条
- **数据干净**——多重过滤保证 TTS 训练质量
- **跨集泛化好**——只要字幕格式一致，多集音频可以批量处理
- **完全离线**

## 缺点

- **依赖字幕**——没有就用不了
- **字幕错误传递**——字幕标错的会跟着错
- **重叠段大量丢失**——如果番剧重叠对话多，损失数据
- **需要规范化角色名**——多语种 / 多写法时要配置

## 风险

| 风险 | 缓解 |
|---|---|
| 字幕时间戳不准 | VAD 精修 |
| 字幕漏标重叠 | pyannote overlap detection 二次验证 |
| 字幕角色名错 | 抽样审听验证 |
| BGM 残留 | UVR 上游处理 + DNSMOS 下游过滤 |
| 同角色多声优 (回忆童年版/老年版) | 角色名手动细分: Kaguya_young / Kaguya_adult |

## 实施步骤（如果选这个方向）

### 阶段 0: 数据准备（你来做）

1. UVR 处理完整影片 → `data/movie_vocals.wav`
2. 拿到字幕文件 → `data/movie.ass`
3. 抽样查看字幕角色名格式，写 `name_mapping.json`
4. 列出主要角色清单

### 阶段 1: 脚本框架（建议工作量 1-2 天）

新文件：
- `extract_speaker_clips.py` - 主脚本
- `subtitle_parser.py` - 字幕解析（pysubs2 包装）
- `vad_refiner.py` - silero-vad 边界精修
- `quality_scorer.py` - DNSMOS 质量评分（可选）

### 阶段 2: 在 ts_vocals_noreverb.wav 上验证

先在已有的小片段上测：
1. 准备这段对应的字幕（如果有）
2. 跑流水线，对比输出
3. 调阈值

### 阶段 3: 完整影片处理

跑完后人工抽听：
- 每个角色目录抽 5-10 段
- 检查是否有错归
- 必要时调字幕角色名映射

### 阶段 4: 喂 TTS 框架训练

每个角色目录直接：
```
GPT-SoVITS 训练:
  audio_dir = output/Kaguya/high_quality/
  text_format = filelist with .lab files
```

## 与其他方案的关系

```
方案 C (字幕驱动) ←─ 主流程
   ↓
   重叠段或字幕缺失段
   ↓
方案 A (enrollment) ←─ 兜底，给重叠段做 target speaker extraction
方案 B (LLM)        ←─ 兜底，对字幕缺失或角色名混乱的段做推断
```

## 业界参考

- **Emilia-Pipe**（Amphion / 网易+港中文 2024）
  - 网易在 Emilia 数据集（10万小时多语种 TTS）的 preprocessing
  - 论文里专门讨论字幕驱动 vs 自动 diarization 的取舍
  - **结论：有字幕优先用字幕**，自动 diarization 是 fallback

- **GPT-SoVITS / Bert-VITS2 社区数据准备教程**
  - B 站 / GitHub 上一堆教程，主流程都是：UVR → audio-slicer → 人工分类
  - 高级用户：UVR → 字幕驱动切片 → 直接训练

- **学术论文**
  - "Speaker Aware Audio Subset Selection for Text-to-Speech" 类论文
  - 多数承认人工标注字幕是上限基准

## 何时选 C

**几乎所有情况下都应该首选 C，只要你能拿到字幕。**

只有以下情况才考虑其他方案：
- 完全没有字幕 → 方案 A 或 B
- 字幕有台词但没说话人标注 → 方案 B
- 字幕角色覆盖不全（次要角色没标） → 主用 C，用 A/B 兜次要角色

## 后续工程优化方向（写完基础脚本后再考虑）

1. **增量处理**: 多集影片支持断点续传
2. **跨集 speaker linking**: 跨集做 embedding 二次聚类，验证字幕角色名一致性
3. **GUI 审听工具**: 简单的 web 界面快速听片段、改归属
4. **训练数据集打包**: 直接生成 GPT-SoVITS / Bert-VITS2 要的 filelist 格式
5. **统计仪表盘**: 每个角色的时长分布、情绪分布、长度分布

## 一句话总结

**有字幕优先用字幕。任何自动 diarization 都不如人工标注的字幕准。**
