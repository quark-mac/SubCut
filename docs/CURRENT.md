# 当前项目状态

更新：2026-11-09。代码参照 `75c3454`（`feat/webui`）；验证记录见各模块文档。

## 已有能力

- **字幕编辑器**：可导入 SRT、normalized JSONL、MOSS JSON，编辑文字、时间和说话人，支持拆分合并、撤销重做、自动保存、轨道管理及字幕导出。播放预览、波形和缩略图已有后台生成任务。入口：[webui/README.md](../webui/README.md)。
- **Diarize**：`voice/diarize_audio.py` 调用官方推理流程；`export_speaker.py` 将匿名分段关联到字幕，`workflow.py` 串联两步并输出诊断与映射文件。已有短片验证，详见 [验证记录](design/voice/subtitle_export_results.md)。
- **命令行工具**：已有字幕规范化、DeepSeek 场景划分、Gemini 标注、Gold 评估和 SRT 驱动的角色切片工具。多模态模块仍待完善，命令见 [workflow.md](workflow.md)。
- **MOSS**：本地有独立检出，编辑器已支持其字幕交换格式；自动调用与工程生成属于待集成工作。

## 当前方向：单视频管理界面

第一版范围已确认，处于流程设计阶段：

1. 管理界面调用用户已有的人声分离工具。
2. 使用 MOSS 和 Diarize 生成匿名说话人结果；有字幕时使用源字幕基线，无字幕时由 MOSS 建立基线。
3. 对齐两路结果，生成可校对工程并保留候选与冲突标记。
4. 用户在现有编辑器中校对并保存，再按需导出素材。

自动处理的终点是生成编辑工程。角色名称由人工确认；多模态识别留待后续接入。

预期交付格式：纯人声 WAV、原音轨视频片段、人声音轨视频片段、说话人 SRT 和 JSONL。

流程图：[带字幕](design/flows/流程（带字幕）-v1.drawio) · [不带字幕](design/flows/流程（不带字幕）-v1.drawio)。

下一步细化人声分离工具接口、MOSS/Diarize 对齐规则、工程交接和工程驱动的切片导出。

## Kaguya 数据基线

2026-10-03 确认的本地输入：

- `sub/intermediate/Cosmic Princess Kaguya/normalized.srt` / JSONL：2101 条，其中 1270 条未标注，INHERITED 标签为 0。
- `sub/intermediate/Cosmic Princess Kaguya/final_gold_set.srt`：2085 条，含人工时间轴修正、拆分和合并；评估按时间与文本对齐。
- `baseline_confirmation.json` 记录输入/代码哈希及当次结构校验。

旧场景和 Gemini 全片结果对应此前的 2106 条输入。恢复该流程时，先针对所选字幕重新生成场景并检查请求计划。

历史单场景运行的 91.30% 准确率使用旧版 2104 条 Gold；当前 Gold 上的复测待安排。历史指标与方法见 [评估文档](reference/evaluation.md)，问题记录见 [current_issues.md](reference/current_issues.md)。
