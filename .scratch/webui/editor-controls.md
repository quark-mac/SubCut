# WebUI 精简控制与轨道可见性

Status: done
Blocked by: none

## 用户确认

- 长按普通说话人轨道标题进入拖拽排序，松开提交；单击仍选轨，Esc/取消不提交。
- Lucide 线性图标替换操作栏文字按钮，悬停名称、无障碍名称保留；精简重复说明。
- 视频移除浏览器原生 controls，由自有组件控制播放/定位/音量/全屏。
- 左栏仅呈现原片与导入字幕资源卡；左上角菜单集中媒体生成、缓存、资源信息及导出记录。
- 所有 UI 时间码显示 SRT `HH:MM:SS,mmm`，内部仍用整数毫秒。非法时间阻止提交。
- 各人物眼睛按钮可隐藏/显示，特殊轨也可隐藏。隐藏状态随工程保存/另存为，可撤销；隐藏字幕退出列表、总览、叠加、导航、选择及导出，恢复后数据完整。隐藏轨保留紧凑标题用于重新显示。
- 用户明确选择普通播放保持连续原片。隐藏字幕不静音原音频。正在试听的目标被隐藏时结束该次试听。
- 普通手动筛选仍只影响列表；隐藏是工程级可见性。保存始终保留所有字幕，导出只输出可见字幕。
- 全隐藏时导出为空，禁止向隐藏轨新增/批量分配，结构编辑只操作可见选择且保留其他数据。

## 范围与验证

- 基线 `a1b1b0b`，工作区干净。仅 WebUI 及相关文档、测试；模型 API 预算 0。
- 沿用已确认的浏览器 UI / HTTP 测试接缝，先写可观察的持久化隐藏/导出回归。
- 类型检查、构建、Python 编译、定向测试及最终 WebUI 全套回归；Standards / Spec 独立审查。

## 结果

- `Speaker.visible` 后端严格布尔字段，缺省 `true`；前端兼容旧快照。完整工程保存/复制保留所有条目，四种导出过滤隐藏人物。
- `TrackHeader` 实现 350 ms 长按、6 px 提前移动取消、指针捕获、边缘纵向滚动、松开一步历史以及 Esc/取消捕获恢复。打开时延续原数量排序视图，显式手动顺序保存后可用“工程轨序”恢复。
- `IconButton` / `IconToggle` 使用固定版本 `lucide-react@1.59.0`，保留 title 与 aria-label。主操作栏、人物操作和媒体配置改为图标；菜单/表单确认保留必要文字。
- `ProjectResources` 默认只显示原片与导入字幕卡片，左上设置菜单集中媒体任务与资源/导出信息。配置区隔离堆叠上下文，避免遮挡文件菜单。
- 移除 video 原生 controls，自有播放、速度、音量、静音、全屏与字幕开关。所有编辑/导航时间码统一 SRT 格式，非法输入阻止提交。
- 隐藏同步到列表、叠加、导航、选择、试听、吸附和结构编辑；上下换轨与拖动跳过隐藏目标。人物管理也保护隐藏源/目标，`?` 隐藏时不允许删除人物后转入该轨。
- README 与使用帮助已更新。最终截图：`webui/tests/evidence/editor-controls-workspace.jpg`。

## Standards

基于 `a1b1b0b` 的 WIP 审查：覆盖 `git diff HEAD` 与本任务未跟踪文件；提交范围为空不代表没有工作区改动。

独立只读审查：0 项文档规范违规，1 项启发式建议（可见人物判定在多处重复）。保留调用处简单的布尔筛选，并复用 `visibleEntries` 处理条目集合；未为几个短谓词扩展额外抽象。

## Spec

独立只读审查发现 2 项并均已修复、复核关闭：

1. 人物合并/删除绕过隐藏轨保护：模块边界与 UI 均增加源/目标校验，并覆盖隐藏 `?` 转入路径。
2. 已有多选隐藏中间人物后合并按钮未更新：合并候选 memo 增加 speakers 依赖。

回归用例直接验证已有选择不变时隐藏/恢复、隐藏人物管理目标、持久化字幕完整。复核未发现剩余确定性规格缺陷。

审查合计：Standards 0 违规 / 1 非阻塞建议；Spec 2 已修复 / 0 未解决。

## 验证（2026-10-19）

- `npm --prefix webui/frontend run build`：TypeScript 检查与 Vite 构建通过。
- `env\python.exe -m py_compile webui/backend/models.py webui/backend/formats.py webui/tests/test_http.py`：通过。
- Python 完整 46 项：首次 44 通过，2 项旧断言缺少新增默认 `visible: true`；更新断言明确验证缺省兼容后，两项复跑通过。没有改动测试输入来绕过旧格式读取。
- 浏览器完整 99 项：97 通过；两处失败分别为批量时间旧毫秒断言与资源面板遮挡文件菜单。已更新 SRT 断言并修复 CSS 层级。
- 最新构建执行 `editor-controls.spec.ts multiselect.spec.ts review.spec.ts speakers.spec.ts`：**36/36 通过**（Playwright 文件正则同时匹配 `preview.spec.ts`）。包含全部 6 项新增用例、两处完整回归失败、人物管理与预览媒体回归。
- 新用例额外验证真实全屏/播放/音量控制、28 人物长按跨视窗滚动、按住时不写盘及释放后轨序完整保存。
- 合计 **101 项不同浏览器用例、46 项不同 Python 用例**经完整运行与相关修复回归全部覆盖通过；不是最终一次 101/101 或 46/46 的单次完整运行。
- OpenChamber 浏览器实际创建自建样本工程并打开资源菜单；截图由真实 Edge 用例保存。没有调用模型 API。
- 历史证据在执行前备份，生成后恢复原字节与清理状态，仅新增本任务截图。
- 当时的本机日志与完整失败 trace 位于 `C:/Users/machi/AppData/Local/Temp/opencode/webui-editor-controls-{browser-full.log,python-full.log,full-results,targeted-results,generated-evidence}`；2026-10-20 清理时已移除。当前保留本节结果摘要与已提交界面截图，无法再从该临时路径读取原始日志。

## Retro 与维护（2026-10-20）

维护基线 `1a60a27`。按用户要求清理测试垃圾并改进现有文档；删除范围见 [证据索引](../../webui/tests/evidence/README.md)。约 805 MiB 的合成媒体、测试工程和临时产物已移除。

按影响排序的发现与处理：

1. **自动检查未接入**：已有 build / unittest，但没有 CI 或启用的 Git hook。新增 `.github/workflows/webui-checks.yml`，接入 TypeScript/Vite、Python 编译及 Linux HTTP/媒体测试；Windows 专属及浏览器行为继续本机验证。
2. **历史证据被测试覆盖**：多个 spec 直接写 `tests/evidence/`。README 已明确备份、分开归档、逐项恢复和清理步骤；后续应将自动产物统一改为 Playwright `testInfo.outputPath()`，通过显式归档更新精选证据。本次尚未改测试输出代码。
3. **入口与文档漂移**：根 AGENTS 增加 WebUI 导航指针；README 用测试索引替换验收流水，补充精确正则选例、缓存位置和清理语义；修正“隐藏只影响导出”及合并连续性的旧说明。

本轮验证：

- 前端 build（含 TypeScript）：通过；Lucide 两处 `use client` 指令被 Vite 忽略的提示仍存在。
- Python 编译：修正不存在的 `webui/__init__.py` 路径后通过。
- `env\python.exe -m unittest discover -s webui/tests -p 'test_*.py' -v`：Windows 本机 **46/46 一次完整通过**，约 49 秒。
- 精确文件参数 `[/\\]review\.spec\.ts$` 配合 `--list`：仅列出 `review.spec.ts` 的 7 项，没有误匹配 preview；本轮未执行浏览器行为回归。
- 工作流 YAML 经 Prettier 解析检查通过；本地文档链接目标、`git diff --check` 通过。Linux GitHub runner 尚未实际运行。
