# Issue tracker: Local Markdown

本仓库的规格与实现任务记录在 `.scratch/`，使用本地文件路径作为任务引用。

## 文件约定

- 每个功能一个目录：`.scratch/<feature-slug>/`。
- 规格：`.scratch/<feature-slug>/spec.md`。
- 实现任务：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，
  从 `01` 编号，每个任务独立一个文件。
- WebUI 的 feature slug 为 `webui`，设计来源为 `docs/design/webui.md`。
- “发布到 tracker”表示创建或更新这些本地文件。
- “读取任务”表示读取给定路径；仅有编号时先在所属功能目录定位。
- 讨论与执行记录追加到任务末尾的 `## Comments`。
- 目录按首次写入需要创建；这些 Markdown 文件可纳入 Git 版本管理。

## 状态与依赖

规格和任务顶部使用 `Status:`：
- `draft`：规格或任务草稿。
- `needs-triage`：尚未明确处理方向。
- `needs-info`：缺少必要信息。
- `ready-for-agent`：描述和验收标准完整，适合代理执行。
- `ready-for-human`：下一步需要人处理。
- `in-progress`：正在执行。
- `done`：完成并通过规定验收。
- `wontfix`：决定不实施。

任务顶部使用 `Blocked by: none` 或同功能任务编号列表，
如 `Blocked by: 01, 02`；跨功能依赖使用仓库相对路径。
只有状态为 `ready-for-agent` 且所有前置任务均为 `done` 时才能开始。
开始时改为 `in-progress`；完成后记录验证结果，再改为 `done`。
规格的 `ready-for-agent` 表示可据此拆票，功能验收完成后才改为 `done`。

## 任务与验证约定

- 每个任务包含目标、规格引用、修改范围、依赖和可观察的验收条件。
- 明确通过哪个公共接口验证行为：UI 操作、HTTP API、CLI 或模块接口。
- 写明验证命令或人工检查步骤，以及需要的素材或夹具。
- 尚未建立的测试入口由首个相关任务建立，并记录实际运行方式。
- 开发纪律、验证要求及 WIP 审查覆盖遵循 `AGENTS.md`
  和 `docs/agents/matt-skills.md`。
