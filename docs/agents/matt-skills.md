# Matt Skills 项目适配

## 安装与初始化状态

- 上游：<https://github.com/mattpocock/skills>。
- 安装基线：`d81f3a183412e71a5b1e84ca21bc1a35eea03a60`（2026-09-29）。这是固定提交，不以合并标题认定正式 1.3 发布。
- 本机安装日期：2026-10-02。默认全局目录为当前用户的 `~/.agents/skills/<name>/`；逐项路径、文件 SHA-256 和安装历史见 `~/.agents/matt-skills-install-record.json`。
- 默认清单共 14 项：`diagnosing-bugs`、`research`、`tdd`、`code-review`、`implement`、`implement-spec`、`codebase-design`、`domain-modeling`、`grilling`、`grill-with-docs`、`handoff`、`writing-for-agents`、`retro`、`setup-matt-pocock-skills`。
- 2026-10-02 按用户后续要求补齐主流程：新增 `ask-matt`、`to-spec`、`to-tickets`，合计 17 项；原 14 项内容匹配并复用。关系类型和其余候选见 [依赖分析](matt-skills-dependencies.md)。
- 上游技能目录原样安装；本文件承载本项目的适配要求。
- 安装时没有运行项目初始化。当前未发现 `docs/agents/issue-tracker.md`；需要 tracker 的审查、规划或实现流程首次使用前，先完成必要初始化。缺少配置时不能宣称完整 Standards/Spec 审查条件已具备。
- 初始化优先复用当时已有 tracker 和文档约定；若没有，建议本地 Markdown tracker。创建外部 issue 按用户当次授权执行。

## 入口选择与授权

| 任务 | 入口 |
| --- | --- |
| 判断当前该用哪个技能、选哪条流程 | `ask-matt`；结合实际已安装清单推荐 |
| 临时澄清真正未决的取舍 | `grilling` |
| 澄清设计并记录术语、重要决定 | `grill-with-docs`，组合 `grilling` 与 `domain-modeling` |
| 将已讨论的方案整理成可实现规格 | `to-spec`；先核查 tracker、状态标签和测试接口约定 |
| 将规格或计划拆为带依赖的任务 | `to-tickets`；确认粒度和依赖，再写入已配置 tracker |
| 明确的修复或单模块功能 | `implement`；简单任务可直接执行 |
| 已有完整规格、任务依赖、接口和验收条件的大功能 | `implement-spec`，先核查代理工具、工作树及 Git 操作授权 |

普通明确任务直接执行；只有真正需要澄清或用户主动要求时才启动 grilling，不重复询问既有决策。`grill-with-docs` 维护术语表和 ADR，不是聊天全文归档，也不自动产出完整规格。

`implement-spec` 与 `implement` 是不同入口，前者不要求通过后者执行任务。已有规格和任务文件可直接使用；已补装的 `to-spec` / `to-tickets` 提供产出这些输入的主流程，不是执行现有规格的硬依赖。`improve-codebase-architecture`、`prototype`、`pr` 等分支入口仍按需选择。

`ask-matt` 是路由参考；它提到某技能不代表本机已安装，也不代表应立即启动该流程。推荐时先核查发现清单，并遵循本项目“明确任务直接执行”的约定。其 `/clear`、`/compact` 是宿主会话操作示例，不是待安装的技能。

首次运行 `to-spec` / `to-tickets` 前必须明确 tracker 和 `ready-for-agent` 等状态约定。上游 setup 在未安装 `triage` 时跳过独立标签文档，但这两个规划技能仍需要标签词汇；初始化时在 tracker 约定中明确所需状态即可，不必因此安装或运行完整 `triage`。当前补装没有执行这项初始化。

技能里的 commit、push、PR、发布等描述不构成额外授权。将来的任务按当次授权确定工作流；集成需要尚未授权的 Git 操作时，说明具体动作和已经验证的成果。只报告实际完成的步骤，不把未执行的集成称为完成。

## 项目事实与文档

- 项目事实和行为契约以 `AGENTS.md`、`docs/CURRENT.md`、相关设计与操作文档为准；开发纪律见 `docs/development.md`。通用技能不能覆盖这些约束。
- 新上游用 `GLOSSARY.md` 存领域术语，用 ADR 存设计决定。已有 `CONTEXT.md` 若包含状态、架构或操作信息，先识别内容和引用；必要时仅提取术语并保留原文链接，不因新命名约定整体重命名。
- `docs/skills/*.md` 是项目操作资料，不自动等价于可发现的 `SKILL.md` 包。按任务引用并保留，无需全部重新包装。

## 调试、测试与模型评估

- 调试先找能反映真实错误的小样本或最小复现。GPU 加载、远程 API、随机输出可能慢或不稳定；不要为满足通用技能的“秒级、确定性”要求，替换成与实际问题无关的测试。记录环境、模型版本、缓存状态和评测条件。
- Gold 对齐遵循 `docs/reference/evaluation.md` 的当前时间戳和文本对齐约定，不能简单按数组下标配对。核查当前基线，不把旧样本条数写死到测试中。字幕归一化、场景生成和模型标注的变更分别验证。
- 修改 voice 前读取 `docs/design/voice/implementation_handoff.md` 及 `AGENTS.md` 要求的全部 voice 设计文档，核查依赖版本和原始音频时间基准；通用重构建议不得覆盖其范围和验收约束。

## WIP 审查与集成验证

- 上游 `code-review` 的 `git diff <fixed-point>...HEAD` 不包含未提交改动。用户要求 WIP 审查时，另行覆盖 `git diff`、`git diff --cached` 和本次任务相关的未跟踪文件，并在报告说明实际范围。空的提交差异不代表工作区没有改动。
- `implement` 提交前的审查同样适用 WIP 要求；是否提交仍取决于用户授权。
- `implement-spec` 既要验证各任务，也要验证集成后的整体行为；单个代理测试通过不等于完整规格通过。任务都修改同一个核心脚本时优先顺序实现。
- 多工作树 Python 任务先确认现有 Conda 环境、工作目录和数据路径。遵循单写入者规则，避免多个代理覆盖同一 Gold 基线、模型输出或评测产物；不为每个工作树擅自重建 Python 环境。

## OpenCode 工具适配与跨设备交接

- 后台代理、Skill 调用和 Bash 示例须映射到当前 OpenCode 实际工具能力。能力缺失时明确说明，使用可行的顺序执行或 PowerShell 方式；不宣称完成未实际执行的步骤。
- 上游的 `/skill-name` 示例不保证是当前客户端支持的命令。按名称请求 AI 加载技能；遵循当前会话的权限及代理使用规则。
- `handoff` 默认写入当前机器的临时目录，正文可能只引用项目中的其他文件。跨设备时须一起复制 handoff 文件及其引用的必要项目文档，再从目标设备的 OpenCode 会话读取；临时文件和旧机器绝对路径不会自动迁移。

## 重启验收

完全退出并重启 OpenCode，在新会话确认 17 个技能均出现在可用技能清单。安装时核实的 OpenCode `1.18.30` 提供 `opencode debug skill`，可在项目目录运行以检查发现结果；后续版本先看 `opencode debug --help`。

CLI 发现检查通过与当前对话已刷新是两件事。必要时在新会话请求“仅加载 `codebase-design` 并确认名称，不开展设计或修改”，验证低副作用加载。不要为安装验收启动访谈、TDD、项目初始化、实现或 PR 流程。
