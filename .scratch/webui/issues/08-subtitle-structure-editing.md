# 08: 新增、拆分与合并字幕

Status: done
Blocked by: 03, 07
Spec: [WebUI 字幕与说话人编辑器](../spec.md)

**What to build:** 用户在播放头补字幕、拆分长句、合并连续短句；两段拆分结果先复制全文，跨人物合并由用户明确归属，整个过程可撤销并保留来源关系。

## 上下文与修改范围

- 对应用户故事 33、38–40、51–52；03 提供结构化来源及导出，07 提供可靠的连续多选和批量历史。
- 修改 WebUI 结构编辑操作、工具栏/快捷键、有效性校验与测试。字幕序号是导出表示，不是稳定身份。

## Acceptance criteria

- [x] 新增从播放头开始，默认 2 秒，临近片尾缩短；采用当前明确轨道，否则归到 `?`，输入非空正文后才提交。
- [x] 位于媒体终点时不能新增零时长条目；取消新增不保存空正文、不生成历史，新增不虚构源条目关联。
- [x] 拆分按钮与 Ctrl+B 只对单条选中字幕生效，播放头严格位于内部；两条时间相邻、复制原全文和说话人，并继承来源及元标签。
- [x] 合并按钮与 Ctrl+M 仅接受全体工作字幕时间排序中连续选中的条目；最早开始、最晚结束，正文按顺序换行，允许覆盖原空隙。
- [x] 相同说话人可直接合并；跨说话人必须明确结果标签，取消选择不改变条目或历史。
- [x] 合并保留参与条目的来源关系和元标签；条目身份、当前编号与来源索引保持区别，撤销能恢复原身份、内容、归属及来源。
- [x] 每次新增、拆分或合并作为一个编辑操作；总览、人物轨、列表同步，保存重开及四种导出反映同一结果。
- [x] 导出排序和重新编号不改写原来源索引，MOSS 导出段 ID 仍唯一；拆分复制全文不被额外算法擅自改成按时间猜字。

## Verification

1. 通过浏览器分别在片头、普通位置及片尾新增；在端点和内部尝试拆分，并核对两段的全文及时间。
2. 测试连续/不连续多选、同人/跨人、重叠/间隙合并，确认无效操作不改状态，撤销恢复全部原条目。
3. 导入带标签和来源的 JSONL 后执行结构编辑、保存重开并导出；用公共接口和实际产物检查来源、排序、身份及元标签，运行相关回归并记录结果。

## Comments

- 2026-10-16 开始：`feat/webui-08` 工作树干净，HEAD 与集成 `D:\whisper-diarization` / `feat/webui` 同为 `3bfd026`；03、07 已 done。唯一实现写入者，范围 WebUI、配套文档和本票。
- 沿用规格 Testing Decisions 已确认的边界：真实 Edge 用户操作 + 公开 HTTP 工程/保存/导出 + 实际输出文件；不测试组件私有状态。按新增、拆分、合并纵向红绿实现，保留可复跑验收。

### 实现与红 → 绿

- `npm --prefix webui/frontend ci`：26 packages，0 vulnerabilities。环境固定 `WEBUI_PYTHON=D:\whisper-diarization\env\python.exe`、`WEBUI_BROWSER=msedge`；所有 shell 明确 ticket-08 工作目录，patch 使用绝对路径。
- 新增切片：先运行 `npm --prefix webui/frontend run test:browser -- structure.spec.ts`，真实失败为缺少“新增字幕”。新增原生模态对话框、实际播放头捕获、非空提交、默认 2 秒/片尾夹取、空来源和一次历史后 **1 passed**。补充普通/片尾/终点检查通过。
- 拆分切片：同一命令 **2 passed / 1 failed**，失败为缺少“拆分字幕”。实现单选严格内部验证、两条新 UUID、全文/来源/元标签复制、Ctrl+B 与单次快照后 **3 passed**。核对端点/多选/文本焦点不执行，撤销完整恢复原 UUID，重做保持两个结果身份。
- 合并切片：`... test:browser -- structure.spec.ts -g '合并'` **2 failed**（缺少合并按钮、跨人对话框）。实现 `mergeSelection(project, ids)` 从完整工作字幕判连续，按最早开始/最晚结束/全文换行合并；同人直接、跨人必须明确目标后 **5 passed**。取消目标选择及 Esc 不写历史、不清重做分支。
- 完整产物和嵌套重叠补充：`... test:browser -- structure.spec.ts` **7 passed**。包括新增→拆分→跨人合并→保存重开→UI 四格式导出、读取实际文件与 HTTP 下载逐项核对。同时间排序、嵌套取 max end、同人物轨被另一人物插入以及两段拆分间插入重叠条目均使用全体工作集连续性。
- 显式轨道切片：`... test:browser -- structure.spec.ts -g '明确点击'` 先因缺少人物轨标题选择按钮失败；标题变为可选择（空轨也可）、与工具栏目标同步后 **1 passed**。总览/视频清空明确目标；没有明确轨道时使用 `?`，不从字幕选择猜人。
- MOSS 补充：`... test:browser -- structure.spec.ts -g 'MOSS 重复'` **1 passed**。重复源 ID 拆分后每段保留，重新合并仍保留两份来源关联，正文保持两段完整换行；两步撤销完整恢复、重做 ID 不变；实际 MOSS 输出 UUID 唯一，JSONL 原来源索引为空。
- 每次实现修改后先运行 `npm --prefix webui/frontend run build` 再验证真实生产构建。没有组件内部测试或 mock；没有修改后端 schema 或生产路径。合并元标签按首次出现合为集合，来源关联按参与顺序拼接且不去重，现有历史/保存/四格式导出边界直接复用。

### 完成与集成基线复验

- 实现提交 **`3465e59`**（`feat(webui): add subtitle creation splitting and merging`）。随后在任务工作树执行 **`git merge feat/webui`**，返回 `Already up to date.`；merge-base 与只读核对的集成 HEAD 均为 `3bfd0267554a343b00606b561ed16741b543677d`，集成工作树干净。没有向集成分支合并，没有推送，没有启动其他代理。
- 同步集成基线后在 `C:\Users\machi\AppData\Local\Temp\opencode\webui-worktrees\ticket-08` 完整执行：

```powershell
npm --prefix webui/frontend run typecheck
# tsc --noEmit 通过（含 tests）。
npm --prefix webui/frontend run build
# Vite 7.3.7，38 modules，JS 234.54 kB / gzip 74.76 kB。
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm --prefix webui/frontend run test:browser
# 53/53 passed (2.9m)：本票 9 项 + 全部既有 44 项，无跳过。
& 'D:\whisper-diarization\env\python.exe' -m unittest webui.tests.test_http -v
# 21/21 OK (6.162s)，真实 HTTP / FFmpeg 自建素材 / 实际输出，无跳过。
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& 'D:\whisper-diarization\env\python.exe' -m py_compile $Files.FullName
# 11 个 WebUI Python 文件通过；本票无 Python 源码修改。
git diff --check
# 通过。
```

- 已读取 `webui/frontend/test-results/.last-run.json`：`status: passed`、`failedTests: []`。已自行核对提交差异、三个新实现文件、测试、README 与本票，改动只在授权范围。旧 05/06/07 截图由回归自动生成，已复制到 `webui/frontend/test-results/ticket-08-regression-*.jpg` 后仅恢复这三张已跟踪截图；本票保留新的 08 截图。
- 已实际查看 `webui/tests/evidence/ticket-08-structure-editing.jpg`：工程已保存、共 5 条；总览显示片头新增、两段完整长句与未选同时间条目；选中跨人合并结果为 `4000–7000 ms`、`?`、两行“间隙之后 / 后句”，预览在原片 4 秒显示同一正文。
- 最终四格式闭环工程：`f7f5cb49-99c1-431c-9582-f1422d1af781`，保留在 `webui/frontend/.test-workspace/projects/`。实际输出清单 `webui/frontend/.test-workspace/ticket-08-artifacts.json` 已读取，并逐个读取其五份文件（四格式 + 显式元标签 SRT）：SRT / JSONL 连续编号 1–5；两段拆分均为全文、各自保留 `[9,9,2]`；新增来源 `[]`；合并来源 `[8,0,70]` 且元标签 `MULTI/CUSTOM/MERGED`；MOSS 五字段、五个独立 UUID，来源输入文件保持原文。浏览器还验证公开下载与实际文件逐字一致。
- 端口检查：`Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 18761,18762 } | Select-Object LocalAddress,LocalPort,OwningProcess` 只返回 **127.0.0.1:18762 / PID 36112**。**18761 测试服务已退出，18762 原演示保留**。任务 worktree 保留。
