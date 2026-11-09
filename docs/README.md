# SubCut 文档索引

SubCut 用于字幕说话人标注、人工校对和角色素材导出。`Cosmic Princess Kaguya` 是验证数据集和流程示例。

## 入口

- [当前状态](CURRENT.md)：已实现能力、管理界面方向、Kaguya 数据基线。
- [字幕编辑器](../webui/README.md)：安装、使用、工程格式与验证。
- [操作手册](operator_workflow.md)：运行、检查和恢复现有工具。
- [CLI 命令](workflow.md)：规范化、场景、Gemini、评估及切片。
- [开发约定](development.md)：工作树、验证、实验和交接。

## 管理界面第一版

单视频，调用现有人声分离工具，使用 MOSS + Diarize 生成可校对工程，人工校对后按需导出。当前为设计稿：

- [带字幕流程](design/flows/流程（带字幕）-v1.drawio)
- [不带字幕流程](design/flows/流程（不带字幕）-v1.drawio)

## 模块设计

- [WebUI](design/webui.md) · [领域术语](../GLOSSARY.md) · [设计决定](adr/)
- [Voice 使用与验证](../voice/README.md) · [官方推理依据](design/voice/official_pipeline_research.md) · [字幕对齐验证](design/voice/subtitle_export_results.md)
- [字幕规范化](design/normalize_subtitle.md) · [MKV 字幕轨处理](design/mkv_subtitle_editing.md)
- [DeepSeek 场景](design/scene_segmentation.md) · [Gemini 提示词](design/prompt.md) · [分批概念](design/batching.md)
- [流水线交互演示](design/pipeline_explorer.html) · [媒体窗口演示](design/media_windows.html)

## 参数与评估

- [规范化操作](skills/normalize_subtitle.md) · [切片导出](skills/extract_simple.md)
- [说话人别名](skills/build_speaker_aliases.md) · [角色资料](skills/build_role_descriptions.md)
- [Gold 评估与历史指标](reference/evaluation.md) · [角色资料 A/B](reference/role_component_ab.md)
- [已知标注问题](reference/current_issues.md) · [经验记录](reference/lessons_learned.md)
- [Voice 集成现状](reference/voice_backend.md) · [offmute-v2 参考](reference/offmute-v2.md)

## Agent 与历史资料

- [Matt skills 适配](agents/matt-skills.md) · [本地任务](agents/issue-tracker.md) · [领域文档规则](agents/domain.md)
- [早期方案](future_plans/) · [两阶段 voice 实验记录](design/voice/implementation_results.md)
