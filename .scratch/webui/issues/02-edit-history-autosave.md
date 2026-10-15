# 02: 可撤销编辑与可靠自动保存

Status: done
Blocked by: 01
Spec: [WebUI 字幕与说话人编辑器](../spec.md)

**What to build:** 用户在右侧编辑正文、毫秒起止时间和说话人归属，能够撤销/重做，看到准确的自动保存状态，并在保存失败后重试而不丢失编辑。

## 上下文与修改范围

- 对应用户故事 32、51–56、61；前置 01 提供工程闭环及公共测试入口。
- 修改 WebUI 编辑状态、表单、工程保存接口、持久化与相应测试。说话人归属使用开放标签；完整人物管理由后续任务提供。
- 保存对象是独立工程；条目和说话人稳定身份与显示名称、导出序号分离。

## Acceptance criteria

- [x] 正文、时间、归属可编辑；选择或输入普通说话人名称后得到有效引用，`?`、`NONSPEECH` 保持各自语义。
- [x] 无效正文或时间在对应字段给出原因，不提交无效工程；修改时间不推移其他字幕。
- [x] 时间轴工具栏提供撤销/重做按钮，Ctrl+Z / Ctrl+Shift+Z 有效；一次连续文字编辑算一步，时间和归属修改亦可恢复。
- [x] 保存不清空会话内历史；重开工程开始新历史；撤销后新编辑清除旧重做分支，无效或取消操作不制造历史步骤。
- [x] 文本输入状态下方向键、空格、删除与撤销优先处理文字；结束输入后整次修改可从工程历史撤销。保存/导出先提交有效输入，非法草稿明确阻止操作。
- [x] 编辑提交后短暂延迟自动保存，Ctrl+S 立即保存；状态区区分保存中、已保存、保存失败，已保存只对应确认落盘的版本。
- [x] 保存具备修订校验及原子写入；较早响应不能把较新编辑标为已保存或覆盖较新状态，版本冲突有明确结果。
- [x] 保存失败保留可编辑的当前状态并允许重试；磁盘保留最后完整版本，重试成功后重开得到最新结果。

## Verification

1. 浏览器中连续修改正文、时间和人物，逐步撤销/重做，验证输入焦点、保存后撤销以及重开历史重置。
2. 通过公共 HTTP 请求及可控故障验证修订冲突、延迟响应、保存失败和重试；检查磁盘状态与界面保存状态一致。
3. 运行前置任务建立的回归入口及改动相关构建/编译检查；将命令、结果和失败恢复证据记录到 Comments。

## Comments

- 2026-10-15：开始任务。工作目录 `C:\Users\machi\AppData\Local\Temp\opencode\webui-worktrees\ticket-02`，分支 `feat/webui-02`；HEAD、`feat/webui` 与 merge-base 均为 `4b9936c1ed5cb3111895696d80ce03a23a7cf7f0`，初始 `git status --short` 为空。前置 01 为 done。按规格已确认的测试边界执行 TDD：真实浏览器用户操作和公共 HTTP；允许在 HTTP/外部文件边界注入保存失败与响应延迟。测试使用自建素材和独立 workspace。

### 实现与 TDD 证据

- `useProjectSession.ts` 统一有效工程、会话内历史、650 ms 自动保存及串行修订写入。历史只恢复编辑内容，服务修订/导出登记不回退；回执只确认对应代次，较新工程内容和输入草稿保持可编辑。导出与保存共享队列并捕获触发时快照，避免写请求/回执乱序。
- 右侧表单支持选择已有标签或输入开放名称；创建人物和归属修改是一次可撤销提交，特殊标签身份保持。离开编辑区、应用、切换字幕、保存、导出均校验；字段有 `aria-invalid` 和可关联错误；取消/无效/原值提交不制造历史。
- 保存失败可重试；实际落盘但网络回执丢失时，重试通过 HTTP 读取核对原请求快照，仅匹配时确认修订，外部不同版本继续报告冲突。导出失败单独提示与重试。工程切换暂停待发送自动保存；关闭切换对话框恢复。
- 实际红 → 绿：HTTP 新人物保存最初因 `speakers` 未支持返回 422；特殊人物配置非法用例最初被接受；浏览器历史用例最初找不到撤销；离开编辑区自动保存最初没有 PUT；Esc 取消最初不恢复草稿；丢失成功回执后重试最初持续冲突；输入改回原值最初仍显示字段无效；确认离开工程后旧定时器最初仍写回；导出失败最初误显示保存失败。逐项新增测试后实现并转绿。
- 原生文本撤销用例先发现 Edge 对自动键入多个字符的撤销分组由浏览器决定，改为单字符输入验证原生撤销与工程历史隔离，不假定浏览器内部合并策略。

### 实际命令与结果

所有 shell 显式指定工作目录；Python 与 Git 命令在本工作树根目录，npm 在 `webui/frontend`。使用现有 Python 环境，无其它代理写入。

```powershell
npm ci
# added 26 packages；0 vulnerabilities。
git merge feat/webui
# Already up to date. 集成 tip 仍为 4b9936c。

& 'D:\whisper-diarization\env\python.exe' -m unittest webui.tests.test_http -v
# Ran 13 tests in 2.598s — OK。
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& 'D:\whisper-diarization\env\python.exe' -m py_compile $Files.FullName
# 11 个 Python 文件通过。
npm run typecheck
# tsc --noEmit 通过。
npm run build
# Vite 7.3.7；31 modules；JS 205.35 kB / gzip 65.70 kB；通过。
$env:WEBUI_PYTHON='D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER='msedge'
npm run test:browser
# 11 passed (14.7s)。真实 Edge + 生产前端构建 + FastAPI，端口 18761。
```

- HTTP 13 项包含前票全部回归，新增开放人物/稳定身份、非法人物配置、并发保存一个成功一个 409，以及真实 Windows 共享锁造成 `os.replace` 失败。失败返回 HTTP 500/storage_error，磁盘旧文档字节完全不变、临时文件清理，解除锁后重试修订为 2 且 HTTP/磁盘一致。
- 浏览器 11 项覆盖前票闭环及历史/重开/焦点/取消/分支、自动保存、保存期间可编辑、旧回执不确认新草稿、丢失回执重试重开、延迟 A/B 写入后导出 B 而最终保存 C、外部修订冲突保留页面、切换取消定时器、导出失败区分与重试。延迟场景在 HTTP 边界扣留真实服务回执，验证后续请求排队，最终磁盘为 C、导出文件为 B，修订为 5。

### 可视验收与服务状态

- 额外以真实 Edge **155.0.4283.45**、1440×1000 运行保存/历史/开放归属/导出检查，读取实际 SRT 断言 1200–4000 ms、多行正文，并捕获 [ticket-02-history-autosave.jpg](../../../webui/tests/evidence/ticket-02-history-autosave.jpg)。已读取截图检查实际布局、原片画面、已保存状态、工具栏撤销/重做、归属和导出资源。页面 JS 错误数组为空，媒体请求为 206。
- 工程 ID `6f3acb2c-245c-4f40-9726-f3d6cba1f20d`；文件 `C:\Users\machi\AppData\Local\Temp\opencode\webui-02-acceptance\projects\6f3acb2c-245c-4f40-9726-f3d6cba1f20d\exports\e27cebdb-7b24-4e0b-b3e8-c371023bac82.srt` 保留可检查。
- OpenChamber 浏览器打开了 18761，但其标签工具对返回的 tabId 报不存在，故额外可视验收使用 Playwright 驱动真实 Edge 并保存截图，未把工具失败视作验收成功。
- 自动测试服务随测试退出；额外验收服务 18761（PID 2824）已确认命令并主动停止，保留素材和工程。原有 **18762 / PID 36112** 演示服务保持运行，未操作其工程。

### 后续接口

- `PUT /api/projects/{id}` 新增可选完整 `speakers` 配置，与 `entries` 原子保存；省略仍兼容旧调用。验证唯一身份/名称、颜色/顺序、特殊轨固定身份语义及有效条目引用。其它路由保持已有接口。
- `useProjectSession` 的 `commit` 接收一次完整不可变有效编辑，后续结构/批量/人物操作在完成时调用一次即可进入历史和自动保存；`App.tsx` 负责草稿校验与选择。`persist` 负责统一保存/导出修订队列，禁止后续界面另行直接覆盖工程回执。详细约定见 [webui/README.md](../../../webui/README.md)。
- 全部验收通过后标记 done。仅本票、`webui/` 代码/测试/文档有改动；工作树保留，不推送、不合入集成，由下一合并代理执行集成验收。
