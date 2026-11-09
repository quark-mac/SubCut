# CLI 操作参考

本页记录已有命令行工具。当前产品进度和管理界面第一版范围见 [CURRENT.md](CURRENT.md)，执行与恢复流程见 [operator_workflow.md](operator_workflow.md)。命令在仓库根目录运行，Python 使用现有 `env\python.exe`。

## 字幕校对与声学标注

- 编辑器启动、导入和工程保存：[webui/README.md](../webui/README.md)。
- Diarize 推理、字幕对齐、映射与诊断：[voice/README.md](../voice/README.md)。
- 角色别名与 Gemini 资料：[别名说明](skills/build_speaker_aliases.md)、[角色资料说明](skills/build_role_descriptions.md)。

以下 DeepSeek / Gemini 流程用于已有多模态 CLI 的运行和实验。

## 1. 规范化字幕

```powershell
env\python.exe sub\normalize\normalize_sdh.py "Cosmic Princess Kaguya"
```

输出 `normalized.srt`、`normalized.jsonl`、`normalize_report.json`。显式人物标签按别名归一，未标注对白保留 `?`。已有同名输出会被重写，运行前核对目标文件。

ASS/SDH 规则见 [规范化说明](skills/normalize_subtitle.md)；MKV 字幕轨选择与 policy 见 [MKV 设计](design/mkv_subtitle_editing.md)。

## 2. 语义场景

先检查请求计划，再执行 DeepSeek 调用。`<scene-run>` 替换为本次独立输出目录，两步使用相同路径：

```powershell
env\python.exe sub\llm\scene_segmenter.py "Cosmic Princess Kaguya" --srt "sub/intermediate/Cosmic Princess Kaguya/normalized.srt" --llm-plan-only --output-dir "<scene-run>"

env\python.exe sub\llm\scene_segmenter.py "Cosmic Princess Kaguya" --srt "sub/intermediate/Cosmic Princess Kaguya/normalized.srt" --llm-window-entries 80 --llm-context-entries 20 --llm-refine --llm-refine-passes 2 --dump-llm-prompts --output-dir "<scene-run>"
```

DeepSeek 决定事件级语义边界；Python 组装场景并检查覆盖。refine 默认按 75 秒复核超长场景，按字幕条数细分为实验选项。场景标题用于编辑。

输出 `scene_segments.srt` 和 `scene_segments.json`。人工修改 scene SRT 后回写：

```powershell
env\python.exe sub\llm\scene_srt_to_json.py "Cosmic Princess Kaguya" "<scene-run>/scene_segments.srt"
```

回写时核对输入字幕版本与完整覆盖。参数、缓存和边界规则见 [scene_segmentation.md](design/scene_segmentation.md)。

## 3. Gemini 请求计划与媒体准备

`<scene-json>` 使用与所选字幕对应的场景文件；下面各输出占位符替换为独立运行目录。

请求计划检查，使用 CLI 默认分组参数：

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "Cosmic Princess Kaguya" --segments-json "<scene-json>" --compact-video --plan-only --max-segments 0 --output-dir "<plan-run>"
```

局部媒体准备，显式使用历史单场景实验的分组参数：

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "Cosmic Princess Kaguya" --segments-json "<scene-json>" --compact-video --segments-per-request 1 --max-request-scenes 1 --max-request-entries 0 --max-request-duration 0 --max-segments 8 --prepare-only --output-dir "<prepare-run>"
```

两条命令均不调用 Gemini；第二条生成 clips。检查目标条目、声音/画面、compact 时间映射及输出清单。

## 4. Gemini 标注

局部调用示例，分组参数与上一节媒体准备一致：

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "Cosmic Princess Kaguya" --segments-json "<scene-json>" --compact-video --segments-per-request 1 --max-request-scenes 1 --max-request-entries 0 --max-request-duration 0 --max-segments 8 --write-srt --dump-prompts --output-dir "<gemini-run>"
```

全片运行将 `--max-segments` 设为 `0`，使用新的输出目录。输入默认选择 `normalized.srt`，缺失时回退到 `llm_corrected.srt`；选择其他文件时显式传入 `--srt`。

既有行为约定：

- 每条字幕输出一个说话人；Gemini 输出契约排除 `OVERLAP`。
- `OTHER` 写回具体 `speaker_raw`；保留模型的 `?` 和 `NONSPEECH` 决定。
- `--explicit-anchor`、`--explicit-lock` 默认 `none`；`canonical/all` 用于已审核源标签的实验。
- SRT 默认输出干净的 `[Speaker] text`；`--keep-tags` 保留输入已有 tags。
- 角色资料默认 `--role-detail baseline`；`selected/full` 及额外组件用于实验。
- CLI 默认最多 2 个场景、30 条字幕、90 秒组成请求；上面的单场景参数来自历史实验。
- 局部运行要求干净的显式输出目录。已有 clips 的完整重建使用明确的 `--overwrite-clips`；该参数仅控制 clips。

标注输出 `results.jsonl`、`report.md` 和 `segment_labeled.srt`。检查缺失/重复条目、解析错误及重点人物。提示词和字段说明见 [prompt.md](design/prompt.md)，分组概念见 [batching.md](design/batching.md)。

## 5. 报告与评估

从已有结果重建报告：

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "Cosmic Princess Kaguya" --output-dir "<gemini-run>" --report-only
```

按时间与文本对齐当前 Gold：

```powershell
env\python.exe sub\llm\evaluate_gemini_gold.py "<gemini-run>/results.jsonl" "sub/intermediate/Cosmic Princess Kaguya/final_gold_set.srt" --final-srt "<gemini-run>/segment_labeled.srt" --output "<gemini-run>/gold_evaluation.md" --json-output "<gemini-run>/gold_evaluation.json"
```

以上两步均为本地操作。数据版本、重点角色及历史指标见 [evaluation.md](reference/evaluation.md)。

## 6. 角色素材切片

指定校对后的说话人 SRT 与媒体：

```powershell
env\python.exe sub\extract_simple.py "Cosmic Princess Kaguya" --srt "<reviewed.srt>" --media "<source-media>" --speakers "Iroha,Kaguya" --output-type audio --shape clips --output "<export-root>"
```

`--output-type` 选择 `audio/video/both`；`--shape` 选择 `clips/merged/both`。同角色片段合并、时长过滤、重叠处理、采样率和编码参数见 [extract_simple.md](skills/extract_simple.md)。

输出位于 `<export-root>/<project>/`。检查 `extract_report.json`、音视频文件清单及抽样片段。当前切片器以 SRT 为输入，管理界面的工程驱动导出正在设计。
