# 文档索引

项目：Cosmic Princess Kaguya 字幕驱动的多模态 speaker labeling

## 快速上手

- **[CURRENT.md](CURRENT.md)** — 当前稳定状态、Gold 基线、冻结决策、下一项任务。新对话先看这份。
- **[workflow.md](workflow.md)** — 完整操作流程、所有命令、关键概念。如果只看一份文档，看这份。
- **[development.md](development.md)** — 单写入者、多对话审查、实验目录和提交策略。
- 场景划分由 `scene_segmenter.py` 通过 `sub/llm/config.json` 调用 DeepSeek；脚本不再提供固定时长、字幕数或 gap 的机械分段模式。
- 人工编辑后的 `scene_segments.srt` 使用独立的 `scene_srt_to_json.py` 映射回 JSON。

## 设计说明

- **[design/pipeline_explorer.html](design/pipeline_explorer.html)** — 完整交互演示：DeepSeek 边界请求/refine、Python scene 组装、Gemini batching/媒体构造和 speaker 写回。
- **[design/scene_segmentation.md](design/scene_segmentation.md)** — DeepSeek 如何分批判断边界、两轮 refine、缓存恢复、校验与人工 SRT 回写。
- **[design/prompt.md](design/prompt.md)** — Gemini 收到的完整 prompt 结构、角色资料分层、判断规则。
- **[design/batching.md](design/batching.md)** — entry / scene / batch / compact video / context 的概念和关系。
- **[design/media_windows.html](design/media_windows.html)** — 可交互切换连续/compact 模式，直观看前后扩展、窗口合并和 compact 时间重映射。
- **[design/normalize_subtitle.md](design/normalize_subtitle.md)** — 字幕规范化流程。

## 经验和参考

- **[reference/lessons_learned.md](reference/lessons_learned.md)** — 试过什么、哪些有效、哪些不有效。
- **[reference/evaluation.md](reference/evaluation.md)** — Gold Set 标签规范、覆盖范围和 batching A/B 评估方案。
- **[reference/current_issues.md](reference/current_issues.md)** — 当前 Gemini/标准化问题、已实施改进和后续实验。
- **[reference/offmute-v2.md](reference/offmute-v2.md)** — 对 offmute-v2 的分析和迁移启发。

## 技能文档

- **[skills/normalize_subtitle.md](skills/normalize_subtitle.md)**
- **[skills/extract_simple.md](skills/extract_simple.md)**
- **[skills/build_speaker_aliases.md](skills/build_speaker_aliases.md)**
- **[skills/build_role_descriptions.md](skills/build_role_descriptions.md)**

## 归档

- **[future_plans/](future_plans/)** — 早期的 plan A/B/C 方案，已被当前多模态流程取代。
