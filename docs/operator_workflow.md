# Operator Workflow

本手册供“流程操作 agent”使用：带着用户运行现有生产流程、检查产物、恢复中断任务，并在每个高风险步骤前停下来确认。

它不是开发规范，也不授权 agent 修改 Python、prompt、生产默认或 Gold Set。代码修改仍遵循 `AGENTS.md`、`docs/CURRENT.md` 和 `docs/development.md`。

## 角色边界

操作 agent 可以：

- 读取项目文件、配置是否存在、已有产物和报告。
- 运行只读检查、`--llm-plan-only`、`--plan-only`、`--prepare-only` 和 `--report-only`。
- 在用户确认后运行付费 API、覆盖可再生输出或导出媒体。
- 解释报告并建议下一步。

操作 agent 不可以：

- 修改 `.py`、prompt、配置默认值、Gold Set、scene 算法或评估算法。
- 在未确认时调用 DeepSeek/Gemini API。
- 在未确认时覆盖、删除或混用已有结果目录。
- 把局部 Gemini 结果追加到全片结果目录。
- 遇到实现缺陷时顺手修代码。

发现代码问题时，停止当前阶段并输出“编程 agent 交接包”，格式见文末。

## 一次只做一步

每次回复都按下面顺序工作：

1. 说明当前阶段和已发现的输入/产物。
2. 展示下一条准备运行的完整命令。
3. 标明命令是否调用 API、覆盖文件、生成大文件。
4. 需要确认时停下来询问，不预先执行。
5. 执行后展示关键统计，不直接跳到下一阶段。
6. 让用户选择继续、检查、人工编辑、重跑或停止。

不要一次性跑完整条流水线。

## 启动问询

开始时最多询问以下信息；能从文件系统确认的不要重复问用户：

```text
项目名（默认可检查 Cosmic Princess Kaguya）
目标阶段：normalize / scene / Gemini / evaluation / extraction / resume
是否允许本轮调用付费 API
是否允许覆盖可再生输出
若做 extraction：角色、output-type、shape
```

随后报告当前 baseline commit：

```powershell
git rev-parse --short HEAD
git status --short
```

如果工作区有未提交代码改动，仅报告，不自行整理或提交；操作流程可以继续使用明确的当前 commit，但付费实验必须记录工作区是否 dirty。

## Stage 0：预检

### 0.1 必需输入

检查：

```text
env/python.exe
sub/input/<project>/
源媒体文件
源字幕文件
sub/input/<project>/speaker_aliases.json
sub/input/<project>/role_descriptions.json
```

DeepSeek/Gemini 阶段还需检查配置文件是否存在，但不要显示其中的密钥：

```text
sub/llm/config.json
sub/llm/gemini_config.json
sub/llm/.env
```

缺少 aliases 或 role descriptions 时，不猜测内容；转到对应技能文档：

- `docs/skills/build_speaker_aliases.md`
- `docs/skills/build_role_descriptions.md`

### 0.2 已有产物

检查但不要删除：

```text
sub/intermediate/<project>/normalized.srt
sub/intermediate/<project>/normalize_report.json
sub/intermediate/<project>/scene_segments_llm/scene_segments.srt
sub/intermediate/<project>/scene_segments_llm/scene_segments.json
sub/intermediate/<project>/*/results.jsonl
sub/intermediate/<project>/*/report.md
sub/intermediate/<project>/*/segment_labeled.srt
sub/output/<project>/
```

如果目标产物已存在，先询问用户是复用、检查、写入新目录还是覆盖。优先使用新目录；不要默认覆盖。

## Stage 1：Normalize

如果 `normalized.srt` 已存在且用户没有明确要求重跑，默认复用现有产物。

计划命令：

```powershell
env\python.exe sub\normalize\normalize_sdh.py "<project>"
```

该命令不调用 API，但会覆盖：

```text
normalized.srt
normalized.jsonl
normalize_report.json
```

若这些文件已存在，运行前必须确认覆盖。Gold Set 和人工编辑字幕不应作为 normalize 输出目标。

运行后停下来检查 `normalize_report.json`：

- `alias_hit_singles` / `alias_miss_singles`
- `multi_entries` / `multi_parts_emitted`
- `unlabeled_unknown`
- `empty_speech_dropped`
- `nonspeech_kept` / `nonspeech_dropped`
- `output_entries_total`

再抽查：

- multi speaker block 是否拆成独立 `{MULTI}` entry。
- marker 独占行时台词归属是否正确。
- 是否出现空文本、异常 speaker 或控制字符。
- `[?]` 数量是否符合预期。

任何结构问题都不要继续生成 scene，因为 normalized idx 可能变化。

详细规范：`docs/skills/normalize_subtitle.md`、`docs/design/normalize_subtitle.md`。

## Stage 2：Scene Timeline

### 2.1 免费计划检查

先运行，不调用 API：

```powershell
env\python.exe sub\llm\scene_segmenter.py "<project>" --llm-plan-only
```

向用户报告请求数量、窗口大小和是否有异常 prompt 大小。

### 2.2 DeepSeek API 调用

推荐生产命令：

```powershell
env\python.exe sub\llm\scene_segmenter.py "<project>" --llm-window-entries 80 --llm-context-entries 20 --llm-refine --llm-refine-passes 2 --dump-llm-prompts
```

这是付费 API 调用。执行前必须明确询问：

```text
是否现在调用 DeepSeek，并允许写入 scene_segments_llm 目录？
```

运行后检查：

```text
scene_segments_llm/scene_segments.srt
scene_segments_llm/scene_segments.json
```

重点确认：

- normalized 目标 idx 全覆盖、无重复。
- scene 时间有序、无空 scene。
- 极短/单条/超长 scene 已被 refine 或明确保留。
- 标题只用于编辑，不作为 Gemini speaker 证据。

### 2.3 人工编辑 scene

用户可在字幕软件中编辑 `scene_segments.srt`。回写前展示：

```powershell
env\python.exe sub\llm\scene_srt_to_json.py "<project>" "sub/intermediate/<project>/scene_segments_llm/scene_segments.srt"
```

正常全片时间线不要加 `--allow-partial`。转换失败时保留原 scene JSON，不自行放宽校验。

## Stage 3：Gemini 计划与媒体准备

正常处理必须显式指定 `--segments-json`。

### 3.1 免费 request plan

使用新的干净输出目录：

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "<project>" --segments-json "sub/intermediate/<project>/scene_segments_llm/scene_segments.json" --compact-video --plan-only --max-segments 0 --output-dir "sub/intermediate/<project>/gemini_plan_check"
```

该命令不调用 API、不生成 clips。检查 request 数、scene 数、entry 数、compact 时长和 idx 覆盖。

### 3.2 免费 prepare-only

媒体构造变化或首次运行时，先做局部准备：

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "<project>" --segments-json "sub/intermediate/<project>/scene_segments_llm/scene_segments.json" --compact-video --segments-per-request 1 --max-request-scenes 1 --max-request-entries 0 --max-request-duration 0 --max-segments 8 --prepare-only --output-dir "sub/intermediate/<project>/prepare_test_<unique>"
```

局部运行的 `--output-dir` 必须是新的干净目录。检查：

- clips 可播放。
- 每个目标 idx 有 compact 映射。
- 无重复对白、异常空白或错位声音。
- `plan.md` 与媒体数量一致。

已有 clips 时不要自动加 `--overwrite-clips`。先让用户选择新目录或完整重新生成。

## Stage 4：Gemini 付费运行

### 4.1 小范围真实测试

命令模板：

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "<project>" --segments-json "sub/intermediate/<project>/scene_segments_llm/scene_segments.json" --compact-video --segments-per-request 1 --max-request-scenes 1 --max-request-entries 0 --max-request-duration 0 --max-segments 8 --write-srt --dump-prompts --output-dir "sub/intermediate/<project>/gemini_test_<unique>"
```

这是付费 API 调用。执行前展示模型、请求数、输出目录，并询问确认。

运行后检查：

- target/results 数是否一致。
- missing / duplicate / unexpected idx 是否为 0。
- parse error 是否为 0。
- 是否出现被禁止的 `OVERLAP`。
- `OTHER` 是否有具体 `speaker_raw`。
- report 中短语气词、多人对话和 NONSPEECH 是否合理。

### 4.2 全片

仅在小范围测试通过并得到用户确认后执行：

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "<project>" --segments-json "sub/intermediate/<project>/scene_segments_llm/scene_segments.json" --compact-video --segments-per-request 1 --max-request-scenes 1 --max-request-entries 0 --max-request-duration 0 --max-segments 0 --write-srt --dump-prompts --output-dir "sub/intermediate/<project>/gemini_single_scene_full_<unique>"
```

不要复用局部测试目录。默认使用新目录，不主动覆盖历史全片结果。

当前生产冻结项：

- 不输出 `OVERLAP`。
- `--explicit-anchor none`。
- `--explicit-lock none`。
- 正常输入是 `normalized.srt`。
- `OTHER` 写回 `speaker_raw`。

不要因为用户随口要求“更准确”就改变这些默认；应转为专门 A/B 开发任务。

## Stage 5：报告与评估

### 5.1 重建报告（免费）

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "<project>" --output-dir "<gemini-output-dir>" --report-only
```

该命令只读 `results.jsonl` 并重建 `report.md`，不调用 API。

### 5.2 Gold 评估（免费）

```powershell
env\python.exe sub\llm\evaluate_gemini_gold.py "<gemini-output-dir>/results.jsonl" "sub/intermediate/<project>/final_gold_set.srt" --final-srt "<gemini-output-dir>/segment_labeled.srt" --output "<gemini-output-dir>/gold_evaluation.md" --json-output "<gemini-output-dir>/gold_evaluation.json"
```

Gold Set 有结构性合并/拆分，禁止按 idx 直接比较。评估后报告：

- overall / canonical / main-character accuracy
- Mami/Roka、Koto/オタ公、FUSHI
- OTHER、NONSPEECH、多人组合标签
- missing / duplicate / parse errors
- 与 `docs/CURRENT.md` 当前基线的差异

不得只凭局部样本宣称生产准确率提升。

## Stage 6：Extraction

先询问：

```text
输入 SRT：normalized / Gold / Gemini final
角色列表
--output-type：audio / video / both
--shape：clips / merged / both
是否覆盖已有输出
是否丢弃跨 speaker 重叠
```

基础模板：

```powershell
env\python.exe sub\extract_simple.py "<project>" --speakers "Iroha,Kaguya" --output-type audio --shape clips
```

TTS 示例：

```powershell
env\python.exe sub\extract_simple.py "<project>" --speakers "Iroha,Kaguya" --output-type audio --shape clips --audio-sample-rate 24000 --clip-merge-gap 0.3 --clip-min-dur 3 --clip-max-dur 30 --drop-cross-speaker-overlap 0
```

视频默认有损重编码；音轨为 AAC 192k。WAV 为 PCM 16bit。NVIDIA/NVENC 曾发生驱动蓝屏，用户需要稳定优先时建议显式 `--no-hw-accel`，但不要替用户永久改变脚本默认。

运行后检查：

- `extract_report.json` 中角色、clips 和 dropped 统计。
- `filelist_audio.txt` / `filelist_video.txt` 行数。
- 是否有 0 字节文件。
- 拼合文件和抽样单条能否被 ffprobe 读取。

删除或清空 `sub/output/` 的大文件前必须确认精确目录。

详细参数：`docs/skills/extract_simple.md`。

## Resume 决策表

| 发现 | 操作 |
|---|---|
| 已有 normalized，无明确重跑要求 | 复用，先读 report |
| scene JSON 与 normalized idx 不匹配 | 停止，重新生成 scene |
| 只有 scene SRT 被人工编辑 | 运行 scene_srt_to_json |
| Gemini 局部目录已有结果 | 新建目录，不追加 |
| 全片目录已有 clips | 优先新建目录；覆盖必须确认 |
| 只有 results.jsonl，缺 report | `--report-only` |
| 结果齐全但未评估 | 运行 Gold evaluation |
| extraction 已有目标文件 | 默认跳过；覆盖必须确认 |
| 工作区 dirty | 报告状态，不自行提交或还原 |

## 必须停下来的情况

- normalize 输出结构错误、idx 不连续或空文本异常。
- scene 覆盖重复、遗漏或转换校验失败。
- Gemini plan 出现目标 idx 缺失/重复。
- API 返回结构变化、解析错误或出现 `OVERLAP`。
- 需要修改 prompt、模型默认、scene 算法、normalize 规则或评估规则。
- 用户要求删除受保护输入、中间产物、Gold Set 或私有配置。
- 代码与文档命令不一致，无法确认哪个是生产契约。

## 编程 Agent 交接包

停止操作并输出：

```text
baseline commit:
subsystem:
stage:
command:
input files:
output directory:
expected behavior:
actual behavior:
error/log excerpt:
reproduction without API:
files that may need changes:
files that must not change:
```

不要在交接包中擅自提出生产默认变更；只描述可复现事实和用户目标。

## 相关文档

- 当前契约：`docs/CURRENT.md`
- 命令参考：`docs/workflow.md`
- 开发纪律：`docs/development.md`
- Scene：`docs/design/scene_segmentation.md`
- Gemini prompt 契约：`docs/design/prompt.md`
- Gold 评估：`docs/reference/evaluation.md`
- Normalize：`docs/skills/normalize_subtitle.md`
- Extraction：`docs/skills/extract_simple.md`
