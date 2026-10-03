# 操作流程

> 最后更新：2026-07-19
> 当前模型：DeepSeek 文字 LLM + `gemini-3.5-flash` via `api.dawclaudecode.com/v1`

## 目标

为 `Cosmic Princess Kaguya` 全片字幕标注实际说话人。输出干净 SRT `[Speaker] text`，支持后续按角色导出片段。

## 完整流程

2026-10-03 基线更新：normalized 已重生为 2101 条；唯一 Gold 为 `final_gold_set.srt`（2085 条）。现存 scene JSON 与 Gemini 输出属于旧输入，先重建 scene 才能继续标注。下文 2106 条、164 scene 和 91.30% 统计均为历史运行记录，当前状态以 `CURRENT.md` 为准。

```text
源字幕 + 源视频
  -> normalize/normalize_sdh.py  → normalized.srt / normalized.jsonl
  -> scene_segmenter.py  → scene_segments_llm.srt / .json
  -> [可选] 字幕软件调整 scene 边界
  -> [可选] scene_srt_to_json.py  → 人工时间线重新生成 JSON
  -> gemini_segment_diarize.py  → results.jsonl + report.md + segment_labeled.srt
  -> extract_simple.py  → 按角色导出片段
```

## 环境

```powershell
env\python.exe
```

## 步骤

### 1. 规范化字幕

```powershell
env\python.exe sub\normalize\normalize_sdh.py "Cosmic Princess Kaguya"
```

显式 speaker 标签会保留并做 alias 归一化；无 speaker 标签的对白统一输出为 `[?]`，不再根据前后字幕继承，由 Gemini 逐条判断实际 speaker。

输出：

```text
sub/intermediate/Cosmic Princess Kaguya/normalized.srt
sub/intermediate/Cosmic Princess Kaguya/normalized.jsonl
```

### 2. 生成 LLM Scene Timeline（推荐）

```powershell
env\python.exe sub\llm\scene_segmenter.py "Cosmic Princess Kaguya" --llm-window-entries 80 --llm-context-entries 20 --llm-refine --llm-refine-passes 2 --dump-llm-prompts
```

输出：

```text
sub/intermediate/Cosmic Princess Kaguya/scene_segments_llm/scene_segments.srt
sub/intermediate/Cosmic Princess Kaguya/scene_segments_llm/scene_segments.json
```

LLM 使用 `sub/llm/config.json` 的 DeepSeek 配置。模型只判断候选字幕之后是否是自然语义边界，Python 负责按 idx 重新组装完整 scene，并校验每条目标字幕恰好覆盖一次。`--llm-window-entries` 是单次请求中的候选边界数量，不是强制 scene 大小。整部电影不会放入同一个上下文；每批只发送本批候选及前后少量上下文。

完整实现说明见 [design/scene_segmentation.md](design/scene_segmentation.md)，包括：

- 每个候选边界如何只归一个请求负责
- 请求窗口前后上下文如何衔接
- 越权 `after_idx` 为什么会被忽略
- 两轮 refine 如何添加和删除边界
- prompt/response 缓存和断点续跑
- 覆盖校验与超长 scene 告警

全片运行前可只检查请求规划，不调用 API：

```powershell
env\python.exe sub\llm\scene_segmenter.py "Cosmic Princess Kaguya" --llm-plan-only
```

当前全片 2106 条目标字幕会拆成 27 个独立请求；单批 prompt 约 4,172 到 10,535 个字符，远低于常见 DeepSeek 上下文限制。`--llm-max-prompt-chars 50000` 会在字幕异常长时自动继续拆批。

`--warn-scene-seconds 120` 只报告异常长的 scene，不会自动改变 DeepSeek 生成的边界。

可加 `--llm-refine` 进行第二遍局部复核：只重审超长、极短、单条和第一遍可疑 scene，并允许删除第一遍的错误切点。默认迭代两轮。scene 以语义完整和约 20-75 秒为目标，字幕条数不作为切分依据。

默认输出到 `scene_segments_llm` 目录。`--dump-llm-prompts` 会保留每批实际 prompt 和原始响应，方便检查边界理由。

如需人工调整 scene 边界，用字幕软件编辑 `scene_segments.srt`，然后：

```powershell
env\python.exe sub\llm\scene_srt_to_json.py "Cosmic Princess Kaguya" "sub/intermediate/Cosmic Princess Kaguya/scene_segments_llm/scene_segments.srt"
```

转换脚本按每条原字幕的时间中点归属 scene。默认要求每条目标字幕恰好落入一个 scene，并拒绝重复覆盖、遗漏字幕、空 scene、重复 scene_id 和时间逆序。局部测试时间线可加 `--allow-partial`。

### 3. 准备检查（不调用 Gemini）

Gemini 正常处理必须显式传入 `--segments-json`。脚本不再按时长、字幕数或间隔自行生成 scene，也不再提供分段 preset。`--report-only` 只读取已有结果，不需要 scene JSON。

使用 `--start-idx`、`--end-idx` 或 `--max-segments > 0` 属于局部运行，必须显式提供新的干净 `--output-dir`。目录可以不存在、为空，或只有 `plan.md`；不能已有 `results.jsonl`、`report.md`、`segment_labeled.srt`、Prompt 文件或 clips。`--overwrite-clips` 不能绕过局部运行保护，因为它无法合并已有的局部/全片结果。

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "Cosmic Princess Kaguya" --segments-json "sub/intermediate/Cosmic Princess Kaguya/scene_segments_llm/scene_segments.json" --compact-video --segments-per-request 1 --max-request-scenes 1 --max-request-entries 0 --max-request-duration 0 --max-segments 8 --prepare-only --output-dir "sub/intermediate/Cosmic Princess Kaguya/prepare_test_v2"
```

检查 `results.jsonl` 和生成的 clips，确认：

- 每条目标 idx 都有 compact 映射
- clip 时长合理
- 没有重复对白

### 4. 小范围真实测试

局部运行始终使用新的干净 `--output-dir`。全片运行如果发现 `output_dir/clips` 中已有 MP4，也会在生成媒体或调用 API 前停止；只有确认要重新生成完整运行的 clips 时才传 `--overwrite-clips`。`--plan-only` 和 `--report-only` 不读取 clips，不受这些检查影响。

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "Cosmic Princess Kaguya" --segments-json "sub/intermediate/Cosmic Princess Kaguya/scene_segments_llm/scene_segments.json" --compact-video --segments-per-request 1 --max-request-scenes 1 --max-request-entries 0 --max-request-duration 0 --max-segments 8 --write-srt --output-dir "sub/intermediate/Cosmic Princess Kaguya/gemini_test_v2"
```

### 5. 全片

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "Cosmic Princess Kaguya" --segments-json "sub/intermediate/Cosmic Princess Kaguya/scene_segments_llm/scene_segments.json" --compact-video --segments-per-request 1 --max-request-scenes 1 --max-request-entries 0 --max-request-duration 0 --max-segments 0 --write-srt --dump-prompts --output-dir "sub/intermediate/Cosmic Princess Kaguya/gemini_single_scene_full"
```

最新全片结果：

```text
scene: 164
Gemini requests: 164
target/model results: 2106 / 2106
missing/duplicate/parse errors: 0
Gold accuracy: 91.30%
```

当前最佳测得结果使用显式 `1 scene/request` 参数。CLI 代码默认仍是最多 2 scene、30 entries、90 秒；尚未提升为默认，因为 single-scene 全片同时包含 prompt、输入源和输出契约变化，不是纯 grouping A/B。生产复现当前 91.30% 基线时使用上面的显式单 scene 命令。

### 6. 导出角色片段

```powershell
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" --speakers Iroha --output-type audio --shape clips
```

## 人工校对

### Gold Set 状态

`final_gold_set.srt` 是唯一金标准，包含 speaker、时间轴、合并/拆分修正。它有 2085 条，当前 normalized 有 2101 条，因此评估必须按时间和文本对齐。

旧双 scene 基线：

```text
总体 accuracy: 88.40%
canonical accuracy: 89.84%
Iroha/Kaguya/Yachiyo/FUSHI: 92.17%
```

当前单 scene 基线：

```text
总体 accuracy: 91.30%
canonical accuracy: 91.57%
Iroha/Kaguya/Yachiyo/FUSHI: 92.03%
```

旧 `human.srt` 只能作为粗略参考：

- 缺少源字幕 `idx=1879`
- 存在旧版跨 speaker 继承错误
- 使用 `女の子`、`赤ちゃん`、`2人`、`?` 等描述性标签
- 部分音乐、音效和台词混在同一个 speaker 字段

后续 batching、prompt 和模型 A/B 以 `final_gold_set.srt` 为正式语义基准。详细规范和回归结果见 [reference/evaluation.md](reference/evaluation.md)。

### 用 report.md

```text
output_dir/report.md
```

报告并列显示每条字幕的 SRT speaker、Gemini speaker、最终 speaker 和 reason。重点检查：

- speaker 与 SRT 不一致的行
- OTHER / NONSPEECH / ?
- 短语气词
- 多人对话
- Yachiyo 旁白附近的主角反应

### 用 segment_labeled.srt

在字幕软件或播放器中对照原视频看。

## 重新生成报告（不重新调 Gemini）

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "Cosmic Princess Kaguya" --output-dir "output_dir" --report-only
```

## 保存 prompt 用于诊断

```powershell
--dump-prompts
```

每个 batch 会保存 `prompt_batchXXXX.txt`。不影响模型输入内容。

## 核心参数

| 参数 | 建议值 | 说明 |
|---:|---:|---|
| `--llm-window-entries 80` | 80 | 每批让 DeepSeek 判断的候选边界数 |
| `--llm-context-entries 20` | 20 | 候选边界前后附加的字幕上下文 |
| `--llm-max-prompt-chars 50000` | 50000 | 单批字符安全上限，超出自动拆批 |
| `--llm-plan-only` | off | 只报告全片请求规模，不调用 API |
| `--warn-scene-seconds 120` | 120 | 超长 scene 只告警，不自动拆分 |
| `--llm-refine` | off | 二次局部复核异常 scene |
| `--llm-refine-passes 2` | 2 | 二次复核迭代轮数 |
| `--llm-refine-max-seconds 75` | 75 | 超过该时长的 scene 进入语义重审 |
| `--llm-refine-max-entries 0` | 0 | 默认不按字幕数细分；实验性参数 |
| `--dump-llm-prompts` | off | 保存场景边界 prompt 和原始响应 |
| `--segments-json PATH` | 正常处理必填 | DeepSeek 生成或人工回写的 scene JSON；`--report-only` 可省略 |
| `--context-before 15` | 15 | 前文秒数，不作为目标 |
| `--compact-video` | on | 剪掉空白，保留有声窗口 |
| `--segments-per-request 2` | 2 | CLI 默认；复现当前最佳基线时显式传 1 |
| `--max-request-duration 90` | 90 | CLI 默认；single-scene 基线显式传 0 |
| `--max-request-entries 30` | 30 | CLI 默认；single-scene 基线显式传 0 |
| `--max-request-scenes 2` | 2 | CLI 默认；single-scene 基线显式传 1 |
| `--max-segments N` | 按需 | 限制 scene 数；`0`=全片，`N>0` 属于局部运行并要求干净输出目录 |
| `--write-srt` | on | 输出 segment_labeled.srt |
| `--keep-tags` | off | 仅保留输入字幕原有 tags；不新增 `MM_REVIEW`、`MM_UNCLEAR` 或 `MM_VERIFIED` |
| `--overwrite-clips` | 按需 | 允许完整运行重新生成已有 clips；不能绕过局部运行的干净目录要求 |
| `--prepare-only` | off | 只生成视频不调 API |
| `--dump-prompts` | off | 保存每个 batch 的文字 prompt |
| `--report-only` | off | 从已有 JSONL 重生成报告 |
| `--include-current-speaker` | off | 调试用：把全部 SRT speaker/tags 发给 Gemini，默认关闭 |
| `--explicit-anchor none` | none | 默认不向 Prompt 发送锁定标签；可选 canonical/all 做实验 |
| `--explicit-lock none` | none | 默认完全采用 Gemini 写回；可选 canonical/all 保留源标签 |

## 实验参数（默认关闭）

| 参数 | 说明 |
|---:|---|
| `--speakers "Iroha,Yachiyo,Kaguya"` | 限制 canonical speaker 为三人 |
| `--use-speaker-images` | 附加 SPKS 目录下的角色参考图 |
| `--use-speaker-audio` | 附加三角色语音参考（需配合 `--speakers`） |

## 关键概念

详见 [design/batching.md](design/batching.md)。

- **entry**：一条字幕，有唯一 `idx`、原始时间、文本
- **scene**：一组 entry 组成的人工可编辑段落
- **batch**：一次 Gemini 请求，可包含多个 scene
- **compact video**：把 batch 内有声窗口拼接成的短视频
- **context**：batch 第一条 target 前的字幕，不要求 Gemini 输出
- **compact map**：每个 idx 在 compact video 中的时间位置

Gemini 只收到：

```text
idx + compact time + text
```

原始时间只保留在本地 results.jsonl 和报告里，用于人工校对。

## 当前全片数据

```text
entries: 2106
DeepSeek semantic scenes: 164
预算细分实验: 169 scenes，Gold 准确率下降，未采用
当前单 scene Gemini results: 2106
```

最新 scene JSON：

```text
sub/intermediate/Cosmic Princess Kaguya/scene_segments_llm/scene_segments.json
```

最新全片 Gemini 输出：

```text
sub/intermediate/Cosmic Princess Kaguya/gemini_single_scene_full/
```
