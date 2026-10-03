# Matt Skills 依赖与补装分析

核查日期：2026-10-02。来源固定为 `mattpocock/skills@d81f3a183412e71a5b1e84ca21bc1a35eea03a60`；依据完整目录、技能正文及随包参考文档，不仅依据 README 摘要。

## 结论与安装结果

- 该提交有 37 个 `SKILL.md`：Engineering 20 个、Productivity 7 个、Misc 4 个、In-progress 6 个。后两组不是默认工程技能的依赖集合。
- 初始 14 项覆盖了所选技能的调用依赖，但没有覆盖从讨论到规格、拆票、实现的全部主流程入口。
- `implement*` 只有 `implement` 和 `implement-spec` 两项，初始安装已包括两者。本次校验匹配，直接复用。
- 本次新增 `ask-matt`、`to-spec`、`to-tickets`，合计 17 项、48 个文件（新增 7 个文件）。固定提交、普通目录安装和完整内容校验规则沿用初装。
- 全局目录：当前用户 `~/.agents/skills/`。逐项状态、SHA-256、旧安装记录备份及历史见 `~/.agents/matt-skills-install-record.json`。

## 依赖关系的四种含义

1. **调用依赖**：正文要求加载另一个 skill；有些只在条件满足时调用。
2. **输入产物关系**：下游使用上游生成的规格或任务；用户已有同类产物时可以绕过上游。
3. **配置前置条件**：tracker、状态词汇、Git 工作树或工具能力；安装一个技能不等于完成配置。
4. **路由推荐**：导航说明“遇到这种情况可用 X”；不等于所有被提及技能都是安装依赖。

`ask-matt` 主要属于第 4 类。它没有逐个调用全部推荐技能的执行步骤，不要求把整仓库装齐。`/clear`、`/compact` 是宿主命令示例，不是技能包。

## 主流程：产物关系

```text
ask-matt：选择合适入口
    ↓ 按需要选择，不强制逐步执行
grill-with-docs：澄清未决问题、记录术语/决定
    ↓ 已有讨论可直接进入
to-spec：规格
    ↓
to-tickets：带阻塞关系和验收条件的任务
    ├─ implement：逐任务实现
    └─ implement-spec：按任务图编排整个规格
         ↓
       tdd / code-review
         ↓
       retro（按需）
```

小任务可直接进入 `implement`；已有规格和任务图可直接进入 `implement-spec`。`implement-spec` 的 implementer 子代理调用 `tdd`，并不是调用 `implement` 技能。两种实现入口都已安装。

`to-spec` 正文要求从既有讨论综合规格，不启动完整需求访谈；它仍有确认测试接口的步骤。README 中“quizzes you about modules”的概述不应覆盖正文流程。

## 已安装技能的实际调用与配置关系

| 技能 | 调用、引用或前置条件 | 判断 |
| --- | --- | --- |
| `ask-matt` | 主流程及可选分支的导航；随包 `PHASE-BOUNDARIES.md` | 路由，不将所有提及名称当硬依赖 |
| `grill-with-docs` | 调用 `grilling`、`domain-modeling` | 两项均已安装 |
| `implement` | 尽可能用 `tdd`，完成后调用 `code-review` | 两项均已安装 |
| `implement-spec` | 各 implementer 调用 `tdd`；集成分支调用 `code-review` | 两项均已安装；另需 tracker、任务图、工作树和集成验证 |
| `tdd` | 接口形状未定时调用 `codebase-design`；将重构/审查职责指向 `code-review` | 条件调用与职责引用；不能说每次 TDD 都自动调用审查 |
| `retro` | 调用 `writing-for-agents` | 已安装 |
| `to-spec`、`to-tickets` | 缺少 tracker 或标签约定时指向 `setup-matt-pocock-skills` | setup 已安装，项目初始化未运行 |
| `code-review` | 需要 `docs/agents/issue-tracker.md`，缺失时指向 setup | 属于运行前置；WIP 补充规则见项目适配文档 |
| `setup-matt-pocock-skills` | 条件检查是否安装 `triage`；使用自身 tracker/domain 模板 | `triage` 是可选检测，不是 setup 的硬依赖 |
| `diagnosing-bugs` | 使用随包 `scripts/hitl-loop.template.sh` 的人工反馈回路选项 | 是包内文件，不是另一个 skill；没有要求加载架构巡检技能 |
| `research`、`grilling` | 正文包含子代理操作 | 是宿主能力要求，不是额外 skill 包 |
| `domain-modeling`、`codebase-design`、`writing-for-agents` | 使用各自随包参考资料 | 资料已完整安装 |
| `handoff` | 按任务推荐下一会话加载的技能 | 无固定额外 skill 清单；跨设备规则见项目适配文档 |

`ask-matt` 把难以测试的调试结果导向架构巡检；这属于路线建议，不能反向认定 `diagnosing-bugs` 正文缺少硬依赖。

## 其余 10 个正式技能：建议及依赖

| 尚未安装 | 实际用途与关系 | 本项目建议 |
| --- | --- | --- |
| `improve-codebase-architecture` | 调用 `codebase-design`；选中候选后调用 `grilling`，形成领域决定时调用 `domain-modeling` | 下一批优先候选；三个依赖均已安装。用于调查接口和测试边界，不能跨越单子系统约束直接重构 |
| `prototype` | 自带 `LOGIC.md` / `UI.md`；无固定额外 skill 调用 | 按需候选。适合字幕状态机、编辑界面的交互验证；不是音频模型实验或 Gold 评测工具 |
| `pr` | 提供 PR 正文模板；`show-me` 位于 credits 来源元数据 | 有 PR 工作流时补；`show-me` 是署名来源，不是需要另装的依赖 |
| `wayfinder` | 调用 `grilling`、`domain-modeling`；研究票用 `research`，原型票用 `prototype`；需 tracker | 超大且方向未明的跨会话规划才用；若安装并需完整支持各类票，应同时补 `prototype`。不是 `implement-spec` 前置 |
| `triage` | 处理外部原始请求；需 tracker/标签；必要时调用 `grilling`、`domain-modeling` | 有外部 issue/PR 积压时补。`to-tickets` 生成的任务已是 ready-for-agent，不必再 triage |
| `grill-me` | 薄包装，仅调用 `grilling` | 可选便捷入口；现有 `grilling` 和 `grill-with-docs` 已覆盖采访能力 |
| `to-questionnaire` | 给其他决策者生成问卷；正文自带提问和模板 | 依赖他人异步反馈时补；没有必须安装 `grilling` 的显式调用 |
| `wait-what` | 重述难懂的上一条回复，利用已有领域词汇 | 可选沟通便利，不补充实现链能力 |
| `teach` | 有状态、多会话教学；自带教学模板 | 与当前工程安装目的关联较低 |
| `wizard` | 生成需要人工操作的交互 Bash 向导 | 真有人工配置流程时再选，并核查 Windows 执行方式；不是 Conda/CUDA 安装专用技能 |

`wayfinder` 的决策票与 `to-tickets` 的实现票用途不同：前者厘清方向，后者定义可验收的实现片段。规划清晰的功能不需要绕经 `wayfinder`。

## 项目配置待办

继续遵循 [matt-skills.md](matt-skills.md)。这次补装没有运行 setup、访谈、功能实现或 PR 流程。

首次运行 tracker 相关流程前，明确本地或已有 tracker、规格/任务位置、状态含义以及完成方式。尤其要解决一个上游组合细节：setup 在未安装 `triage` 时跳过独立 triage 标签文档，但 `to-spec` / `to-tickets` 仍要求标签词汇。使用本地 tracker 时可在其约定中明确 `ready-for-agent` 等状态，无须为此额外安装 `triage`。

上游的 `disable-model-invocation` 和斜杠命令写法表达其入口意图；OpenCode 能发现技能，不等于实现了其他宿主的全部调用限制。按用户选择与当前工具能力使用，保留 Git 操作授权和项目验收门槛。

## 一手来源

- [固定提交 README 与技能清单](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/README.md)
- [ask-matt 完整流程图解正文](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/ask-matt/SKILL.md)
- [implement-spec 调用步骤](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/implement-spec/SKILL.md)
- [to-spec 正文](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/to-spec/SKILL.md)
- [to-tickets 正文](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/to-tickets/SKILL.md)
- [setup 的 tracker / triage 条件](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/setup-matt-pocock-skills/SKILL.md)
