# MKV 内封字幕编辑规范

本文规定 Agent 如何检查 MKV 内封字幕、制定可审计的编辑策略，并指导其编写确定性编辑脚本。目标是从复杂字幕轨中提取角色台词，生成可由 `scene_segmenter.py` 和 `gemini_segment_diarize.py` 直接消费的 normalized SRT。

本文不是通用字幕内容分类算法。不同字幕组、剧集和字幕格式必须先检查真实结构，再建立项目或模板专用 policy。

## 1. 职责边界

### Agent 负责

- 检查 MKV 中所有字幕轨及其 metadata。
- 抽样理解 Style、位置、语言、歌词、屏幕字和注释的实际语义。
- 比较多条轨道，选择候选来源并说明依据。
- 生成或审核显式编辑 policy。
- 指导编写最小、确定性的编辑脚本。
- 检查保留、删除和待复核条目的样本与统计。
- 在 normalized 结构变化后要求重建 scene timeline。

### 编辑脚本负责

- 调用 `ffprobe` 获取客观轨道信息。
- 按绝对 stream index 提取字幕，不猜测轨道。
- 完整解析源字幕结构。
- 严格执行经审核的 policy。
- 为每个删除或保留动作记录理由和来源。
- 生成 deterministic、可重复的 normalized SRT/JSONL。
- 执行结构校验并在未知情况出现时停止。

### 禁止事项

- 不根据 `default`、`language` 或第一条字幕轨自动决定生产来源。
- 不把“顶部”直接等同于屏幕字，也不把“底部”直接等同于角色对白。
- 不先把 ASS 转成 SRT 再分析；这会丢失 Style、Layer、位置和绘图信息。
- 不让 Agent 逐条自由改写整集字幕代替 policy。
- 不将推测性分类静默写入生产 `normalized.srt`。
- 不默认覆盖现有 normalized、scene 或 Gemini 结果。
- 不复用与新 normalized idx 不匹配的旧 scene JSON。

## 2. 推荐工作流

```text
MKV
  -> ffprobe 轨道清点
  -> 原格式提取所有候选文本字幕轨
  -> 结构分析和样本报告
  -> Agent/人工审核
  -> selection_policy.json
  -> 确定性编辑脚本
  -> candidate normalized.srt / normalized.jsonl / report
  -> 结构审查
  -> scene_segmenter 重建 scene timeline
  -> Gemini plan-only
  -> Gemini speaker labeling
```

流程分为四个强制 gate。

### Gate 1：轨道选择

在选择 stream 前，Agent 必须列出：

- stream index 和 subtitle-relative index；
- codec；
- language、title；
- default、forced、hearing-impaired 等 disposition；
- 事件数量和覆盖时间；
- 文本轨或图形轨；
- 前、中、后样本。

只有以下情况可自动采用候选：

- 用户显式指定；或
- 多轨比较已证明目标语言内容完全一致，并记录选择理由。

否则停止并请求用户选择。

### Gate 2：内容 policy

对 ASS，每个 Style 至少检查：

- 数量；
- alignment 和 Margin；
- Layer、Name、Effect 分布；
- `\an`、`\pos`、`\move`；
- `\p` drawing；
- karaoke override；
- 开头、中间、结尾样本；
- 与其他 Style 同时间出现的样本。

每个 Style 必须明确归入：

```text
keep_dialogue
drop_translation
drop_lyrics
drop_screen
drop_annotation
drop_title
drop_staff
review
```

未识别 Style 的默认动作必须是 `error`，不能默认保留或删除。

### Gate 3：候选 normalized 审查

脚本执行后，Agent 必须检查：

- 每种 keep/drop reason 的数量；
- 每种删除原因的代表样本；
- `review` 是否为 0，或是否已经人工处理；
- 是否还有目标外语言；
- 是否还有 drawing 坐标、karaoke、Staff、Note、Title；
- 是否出现空文本、非法时间、重复 idx；
- 是否有明显逐帧屏幕字碎片；
- 保留条目是否覆盖全片对白区间。

### Gate 4：下游同步

一旦 normalized 条目数、顺序、文本或时间发生变化：

1. 重新运行 `scene_segmenter.py`。
2. 重新生成 `scene_segments.json`。
3. Gemini 必须同时显式使用新 SRT 和新 scene JSON。
4. 先运行 `--plan-only`，确认 idx 全覆盖后才能调用 API。

## 3. 源格式策略

### ASS/SSA

第一版优先支持，当前脚本可执行 inspect、prepare 和 normalize。提取后必须保留：

- `[Script Info]` 中的 PlayRes；
- Style 定义；
- Event type；
- Layer；
- Start/End；
- Style；
- Name；
- MarginL/R/V；
- Effect；
- 原始 Text 和 override tags。

过滤前不得调用当前会删除 override 的简化 parser。只有确定事件被保留后，才把可见文本转换成 normalized 文本。

### 普通 SRT

当前脚本可发现并提取 SubRip，但不允许 prepare/normalize。后续需要独立的 raw SRT parser。不能使用 `sub._srt_io.parse_srt()` 读取普通内封 SRT，因为该函数要求正文已经满足 `[speaker] text` 的 normalized 合同。

SRT 缺少 Style/Layer/位置结构，第一版只能依赖：

- 轨道 metadata；
- cue 文本；
- HTML tag；
- 多行结构；
- 时间重叠与配对；
- Agent 抽样确认的模板规则。

无法高置信区分的 cue 必须进入 review，不得自动删除。

### PGS/DVD/DVB 图形字幕

只探测和报告，不直接进入文本 normalization。未来路径必须是：

```text
bitmap + timestamp
  -> OCR candidate
  -> 人工修订
  -> reviewed text events
  -> normalized output
```

未经审核的 OCR 不得直接写入 Gemini 输入。

## 4. 分类原则

### 双语字幕

优先级从高到低：

1. 经审核的语言 Style。
2. 同时间、不同 Style 的稳定语言配对。
3. 经审核的同 event 行序模板。
4. Unicode 语言提示，仅用于 review 排序。

禁止仅凭 Unicode 删除汉字文本，因为日语同样含汉字。

### 顶部对白

顶部位置是 review 信号，不是删除条件。以下内容都可能在顶部：

- 为避让底部字幕或画面元素的正常对白；
- 同时发声的第二角色；
- 旁白或画外音；
- 手机、直播、电视中的可听对白。

只有 Style 或模板已经被审核为非对白时，才能确定性删除。

### 屏幕字

可使用以下组合证据：

- 经审核为 `Screen/Sign/Title` 的 Style；
- `\pos`、`\move`、非常规 alignment；
- drawing mode；
- 与正常对白同时出现；
- 大量几十毫秒连续事件；
- 菜单、短信、招牌、UI 等文本样本。

单个位置标签不足以自动删除。

### 歌词

优先使用：

- 经审核的 OP/ED/Lyrics Style；
- karaoke override；
- 稳定的歌词时间区间；
- 音乐符号。

不能只检查 `♪`。无符号歌词很常见，带音乐符号的角色唱词也可能需要保留。歌词与对白混在同一 cue 时必须进入 review 或按经审核的模板拆分。

### 注释、标题和 Staff

经审核的 `Note/Ruby/Title/Staff` Style 可确定性删除。ASS `Comment:` event 默认不进入 normalized，但必须计入报告。

## 5. Policy 合同

建议每个字幕模板维护一个显式 JSON policy：

```json
{
  "schema_version": 1,
  "source": {
    "stream_index": 2,
    "expected_codec": "ass",
    "expected_title": "chs_jp"
  },
  "event_types": {
    "Dialogue": "process",
    "Comment": "drop_comment"
  },
  "styles": {
    "Text - JP": "keep_dialogue",
    "Text - JP - UP": "keep_dialogue",
    "Text - CN": "drop_translation",
    "Text - CN - UP": "drop_translation",
    "Screen": "drop_screen",
    "ED - JP": "drop_lyrics",
    "ED - CN": "drop_translation",
    "Ruby": "drop_annotation",
    "Note": "drop_annotation",
    "Staff": "drop_staff",
    "Title": "drop_title"
  },
  "unknown_style": "error",
  "expected": {
    "kept_events": 377,
    "review_events": 0
  }
}
```

Policy 必须包含：

- schema version；
- 绝对 stream index；
- 预期 codec/title；
- 每个已知 Style 的动作；
- unknown Style 的动作；
- 经审核基线的关键计数。

脚本遇到以下情况必须硬失败：

- stream metadata 与 policy 不符；
- 新 Style 出现；
- expected count 不符；
- 保留事件仍含 drawing；
- `review_events > 0` 且未显式批准；
- 字幕严格 UTF-8 解码失败或包含 U+FFFD；
- 输出结构校验失败。

## 6. Agent 编写编辑脚本的规范

Agent 接到“为某个 MKV 编写字幕编辑脚本”任务时，必须按以下顺序执行。

### 6.1 先检查，不先写代码

1. 用 `ffprobe -of json` 获取所有流。
2. 将候选文本字幕提取到唯一的临时或 candidate 目录。
3. 计算输入 MKV 和提取字幕的 SHA-256。
4. 统计所有 Style 和 event type。
5. 比较多字幕轨的目标语言事件。
6. 向用户报告建议 policy；有歧义时先询问。

### 6.2 写最小实现

推荐入口：

```text
sub/normalize/normalize_mkv.py
```

内部可以拆分 parser/helper，但不应为 ASS 和 SRT 建立两个用户入口。第一版只实现真实样本所需能力，不预先实现 OCR 或通用语义分类。

当前 `sub/normalize/normalize_mkv.py` 支持以下分阶段运行：

```text
inspect   -> manifest/report，不生成 normalized
prepare   -> 根据 policy 生成候选事件
normalize -> 生成 normalized SRT/JSONL/report
```

ASS inspect 示例：

```powershell
env\python.exe sub\normalize\normalize_mkv.py inspect `
  "sub\input\<project>\<video>.mkv" `
  --output-dir "sub\intermediate\<project>\mkv_subtitle_candidate_v1\inspect"
```

执行经审核 policy：

```powershell
env\python.exe sub\normalize\normalize_mkv.py prepare `
  --manifest "sub\intermediate\<project>\mkv_subtitle_candidate_v1\inspect\manifest.json" `
  --policy "sub\normalize\policies\<policy>.json" `
  --output-dir "sub\intermediate\<project>\mkv_subtitle_candidate_v1\prepare"
```

生成 normalized candidate：

```powershell
env\python.exe sub\normalize\normalize_mkv.py normalize `
  --prepared "sub\intermediate\<project>\mkv_subtitle_candidate_v1\prepare\prepared_events.jsonl" `
  --output-dir "sub\intermediate\<project>\mkv_subtitle_candidate_v1\normalized"
```

默认命令应是只读 inspect 或要求显式子命令。`normalize` 必须要求：

- `--stream-index` 或已审核 policy；
- 独立 `--output-dir`；
- 目标目录不存在或为空。

### 6.3 不复制现有合同

编辑脚本应复用：

- `sub._srt_io.NormalizedEntry`；
- `sub._srt_io.write_srt()`；
- `sub._srt_io.write_jsonl()`；
- 可复用时调用 `sub.normalize.normalize_sdh.normalize_entries()`。

普通非 SDH 字幕没有 speaker 标记时，可以直接构造 `NormalizedEntry`，speaker 为 `?`。不要伪造 speaker，也不要使用继承。

### 6.4 Provenance

每个 normalized entry 的 `source_entries` 保存选定字幕轨中的 0-based source event index。完整 provenance 另存 manifest，至少包含：

- MKV path/hash；
- stream index/codec/title/language；
- 提取文件 path/hash；
- policy path/hash；
- ffmpeg/ffprobe 版本和命令；
- 每个 source event 的 action/reason；
- 输出文件 path/hash。

不要把 `TRACK_2`、`SCREEN`、`LANG_JP` 等来源信息加入 normalized `{TAG}`。当前 metadata tag 合同只保留 `MULTI` 和 `MERGED`。

## 7. Gemini 输入合同

`gemini_segment_diarize.py` 使用 `sub._srt_io.parse_srt()` 读取输入。因此编辑脚本必须输出 normalized SRT，而不是普通 SRT。

Gemini 的项目解析允许 MKV-only 输入：显式 `--srt` 提供 normalized candidate 时，`resolve_project(require_subtitle=False)` 只要求源媒体，不要求项目目录中另有外挂字幕。需要源字幕的 normalization/extraction 调用方仍使用默认严格模式。

### 7.1 SRT 格式

```srt
1
00:00:09,680 --> 00:00:14,910
[?] 高校生のカップルは　一年以内に七割が破局するという

2
00:00:15,470 --> 00:00:19,790
[?] 卒業後まで含めたら　ほとんどが別れるにもかからわず
```

强制要求：

- UTF-8；
- idx 从 1 开始连续且唯一；
- 时间格式为 `HH:MM:SS,mmm`；
- `start >= 0`；
- `end >= start`；
- 第一正文行必须以 `[speaker]` 开头；
- 未知 speaker 使用 `[?]`；
- 非台词不应进入候选；如确需保留则使用 `[NONSPEECH]`；
- 文本非空；
- ASS `\N` 转为真正换行；
- 不保留 ASS override、HTML、drawing 坐标或语言翻译副本；
- 不添加合同外 `{TAG}`。

### 7.2 JSONL 同步

每行结构：

```json
{"idx": 1, "start": 9.68, "end": 14.91, "speaker": "?", "tags": [], "text": "高校生のカップルは　一年以内に七割が破局するという", "source_entries": [0]}
```

SRT 与 JSONL 的 `idx/start/end/speaker/tags/text` 必须完全同步。

### 7.3 Scene 配对要求

Gemini 正常运行必须提供 scene JSON，scene 通过 `start_idx/end_idx` 查找 normalized entries。因此新输出不得配旧 scene JSON。

正确顺序：

```powershell
env\python.exe sub\llm\scene_segmenter.py "<project>" `
  --srt "<candidate>/normalized.srt" `
  --llm-plan-only
```

确认计划后生成新的 scene timeline，再运行：

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "<project>" `
  --srt "<candidate>/normalized.srt" `
  --segments-json "<candidate-scene>/scene_segments.json" `
  --compact-video `
  --plan-only `
  --max-segments 0 `
  --output-dir "<unique-plan-dir>"
```

计划检查必须确认：

- 所有目标 idx 都被 scene 覆盖；
- 没有重复 idx；
- 没有 scene 引用不存在的 idx；
- Gemini target entry 数与 candidate 中的对白条目数一致；
- compact map 覆盖所有目标条目。

## 8. 验证清单

编辑脚本至少实现或调用以下验证：

```text
[ ] 输入 MKV hash 与 manifest 一致
[ ] stream metadata 与 policy 一致
[ ] 未知 Style 为 0
[ ] review events 为 0
[ ] source event action 覆盖率为 100%
[ ] 保留文本不含 U+FFFD
[ ] 保留文本不含 ASS drawing/override
[ ] 不含目标外语言 Style
[ ] 不含 OP/ED/Staff/Title/Note/Screen Style
[ ] normalized idx 连续且唯一
[ ] start/end 合法且有序
[ ] text 非空
[ ] speaker 非空，默认 ?
[ ] tags 只属于允许集合
[ ] SRT 可由 sub._srt_io.parse_srt() 回读
[ ] SRT/JSONL 字段完全一致
[ ] 输出目录独立，未覆盖生产产物
[ ] scene 使用同一份 normalized 重建
[ ] Gemini plan-only 通过
```

## 9. 当前测试样本基线

样本：

```text
sub/input/too many losing heroines/
[KitaujiSub] Make Heroine ga Oosugiru! [01][WebRip][HEVC_AAC][CHS_JP&CHT_JP].mkv
```

已审计事实：

- stream 2：ASS，title=`chs_jp`，default；
- stream 3：ASS，title=`cht_jp`；
- 两轨 `Text - JP` 361 条完全一致；
- 两轨 `Text - JP - UP` 16 条完全一致；
- 每个 JP 对白时间组都有对应 CN 事件；
- `Text - JP - UP` 是正常顶部角色对白，必须保留；
- `Screen` 含逐帧移动文本和 drawing，必须删除；
- `ED - JP/CN` 是歌词；
- `Ruby/Note/Staff/Title` 不是角色对白；
- 角色对白候选共 377 条；
- 对白事件没有 speaker name，应输出 `[?]`。

推荐 policy：

```text
keep: Text - JP, Text - JP - UP
drop: Text - CN, Text - CN - UP, Screen, ED - JP, ED - CN,
      Ruby, Note, Staff, Title, Comment
unknown_style: error
expected_kept_events: 377
```

当前已审核 policy 文件：

```text
sub/normalize/policies/kitauji_makeine_ep01_ja.json
```

该 policy 含第 1 集专属的 expected count，不能不经检查直接用于其他集。

当前 candidate 输出：

```text
sub/intermediate/too many losing heroines/mkv_subtitle_candidate_v2/
  inspect/     # manifest、报告和两个原始 ASS 轨
  prepare/     # 逐 source event action 和 377 条候选对白
  normalized/  # Gemini-compatible normalized.srt/jsonl/report
```

这份规则只适用于已经验证过的北宇治字幕组模板。处理下一集时仍需检查 Style 集合和关键计数；处理其他字幕组时必须重新建立 policy。

## 10. 完成定义

只有同时满足以下条件，MKV 字幕编辑任务才算完成：

1. 原始轨道和选择理由可追溯。
2. 所有 source events 都有明确 action/reason。
3. 未知和 review 项已清零或得到用户批准。
4. normalized SRT/JSONL 满足 Gemini 输入合同。
5. 输出使用独立 candidate 目录。
6. scene timeline 已基于该 candidate 重建。
7. Gemini `--plan-only` 已验证 idx 和媒体映射。
8. 未经用户明确批准，没有覆盖生产结果或调用付费 API。
