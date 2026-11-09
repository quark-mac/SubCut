# AGENTS.md

SubCut 用于字幕说话人标注、人工校对和角色素材导出。`Cosmic Princess Kaguya` 是验证数据集与操作示例。

## 按任务读取

开始任务时读 [docs/CURRENT.md](docs/CURRENT.md)，了解已实现能力和当前工作方向，再按需读取：

| 任务 | 文档 |
| --- | --- |
| 实现、验证、实验 | [开发约定](docs/development.md) |
| 编辑器、工程格式、播放、导入导出 | [WebUI 使用与验证](webui/README.md)、[设计](docs/design/webui.md) |
| 管理界面流程 | [第一版流程图](docs/README.md#管理界面第一版) |
| Diarize 推理、字幕对齐 | [voice/README.md](voice/README.md)、[算法依据](docs/design/voice/official_pipeline_research.md) |
| 字幕规范化 | [操作说明](docs/skills/normalize_subtitle.md)；MKV 另读 [轨道处理](docs/design/mkv_subtitle_editing.md) |
| 场景划分、Gemini | [场景设计](docs/design/scene_segmentation.md)、[提示词契约](docs/design/prompt.md) |
| Gold 评估 | [评估规则](docs/reference/evaluation.md) |
| 媒体切片 | [提取参数与规则](docs/skills/extract_simple.md) |
| 用户要求运行、引导或恢复已有流程 | [操作手册](docs/operator_workflow.md) |
| 使用 Matt skills | [项目适配](docs/agents/matt-skills.md) |
| 规格、任务、审查 | [本地任务约定](docs/agents/issue-tracker.md) |
| 领域术语、工程语义、设计决定 | [领域文档入口](docs/agents/domain.md) |

## 工作约定

- 同一工作树保持一个写入任务；并行实现使用独立工作树和分支。
- 每次改动围绕一个目标，沿用所在模块的结构与命名。
- 使用已有 Python 环境；需要不同依赖栈的模型在独立环境运行。
- 修改行为后执行对应模块的验证，记录实际结果。

## 数据与配置

- `env/`、`sub/input/`、`sub/intermediate/`、`webui/workspace/` 及自定义 workspace 承载本地环境或用户数据；删除、重命名、批量改写须获得明确同意。
- 私有配置位于 `sub/llm/config.json`、`sub/llm/gemini_config.json`、`sub/llm/.env`；共享文档和日志中使用脱敏信息。
- 清理历史实验或 `sub/output/` 大型导出时，先确认具体目录。
