# Matt Skills 项目适配

按当前会话实际提供的 skill 使用。上游流程在本项目采用以下约定。

## 文档分工

- `AGENTS.md`：通用工作约定及按任务触发的文档入口。
- `docs/CURRENT.md`：已实现能力、当前方向与数据基线。
- `docs/operator_workflow.md`：运行和恢复已有工具时的操作说明。
- `GLOSSARY.md` / `docs/adr/`：领域术语与设计决定，读取规则见 [domain.md](domain.md)。
- `.scratch/<feature>/`：规格、任务与执行记录，状态见 [issue-tracker.md](issue-tracker.md)。

使用 `writing-for-agents` 编辑文档：通用规则留在根入口，分支知识按需读取；一个事实保留一个权威来源，优先写清目标行为，删除过时状态和重复约束。

## 工作方式

- 明确任务直接执行；未决取舍需要用户判断时再用 `grilling`。
- 设计模块接口时用 `codebase-design`；术语和 ADR 工作用 `domain-modeling`。
- `code-review` 的 WIP 范围包含暂存、未暂存和相关未跟踪文件，规格来自本次任务实际引用的文档。
- `tdd`、`diagnosing-bugs` 使用能反映真实行为的样本；模型实验记录环境、模型、输入版本和缓存状态。
- 验证入口见 [development.md](../development.md)。Gold 采用时间/文本结构对齐；voice 使用当前官方推理流程和原片时间基准。
- 技能中的工具与命令按本机能力适配；提交、发布及付费调用遵循本次任务授权。

## 安装记录

上游：[mattpocock/skills](https://github.com/mattpocock/skills)。2026-10-02 安装基于 `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`；机器级详情位于 `~/.agents/matt-skills-install-record.json`，历史依赖分析见 [matt-skills-dependencies.md](matt-skills-dependencies.md)。

2026-10-15 已建立本地 tracker 和单领域文档约定。当前可用 skill 以会话发现列表为准。
