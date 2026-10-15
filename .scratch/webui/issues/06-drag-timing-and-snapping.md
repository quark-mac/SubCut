# 06: 字幕拖动、边界调整与吸附

Status: done
Blocked by: 04
Spec: [WebUI 字幕与说话人编辑器](../spec.md)

**What to build:** 用户从总览或说话人轨拖动字幕调整时间和归属，拉动边缘修正时长，选择是否吸附到播放头或其他字幕边界；一次手势可一步撤销。

## 上下文与修改范围

- 对应用户故事 31–32、35–37、45、52；依赖 04 的坐标、共享条目和历史联动。
- 修改 WebUI 时间轴手势、编辑提交、校验与相应测试。此任务先完成单条字幕的可用鼠标编辑。
- 原片时间与毫秒精度是数据基准，屏幕像素及缩放只是交互表示。

## Acceptance criteria

- [x] 横向拖动改变起止时间并保持时长；边缘拖动改变开始或结束，保持媒体范围内的正时长。
- [x] 纵向拖动改变说话人且时间不变；斜向拖动同时改变时间和归属，作为一次提交和一步历史。
- [x] 从总览与说话人视图操作的是同一条目，释放后右侧、另一视图及保存结果一致；拖向总览不清空归属。
- [x] 时间边界限制在媒体范围内；合法重叠保留，其他条目不被自动移动、裁剪或删除。
- [x] 吸附按钮可开关，目标为播放头及字幕边界；关闭后可自由微调并在时间字段看到毫秒结果。
- [x] 在不同缩放和滚动位置，拖动结果与刻度一致；未命中有效归属目标不能写入无效说话人引用。
- [x] 一次完整拖动仅产生一步撤销，拖动预览不反复持久保存中间状态；Esc 取消回到手势前状态且不增加历史。
- [x] 有效提交触发已有自动保存，撤销/重做和重开工程保持一致。

## Verification

1. 浏览器分别执行横向、纵向、斜向及两端边界拖动，在至少两个缩放等级和滚动位置比较实际时间与归属。
2. 测试吸附开关、片头片尾、最小时长、重叠及 Esc 取消；保存前后检查未选中字幕未变化。
3. 每种手势用一次撤销恢复，重做后保存重开；运行相关回归与构建检查并记录证据。

## Comments

- 2026-10-16：开始实现，唯一可写实现代理；工作树 `ticket-06`、分支 `feat/webui-06` 初始干净，HEAD / merge-base / `feat/webui` 均为 `9d9266706eaeee3ebf7a3529f3ef597d36adc4a0`。前置 04 为 done。已加载 TDD，测试沿用 spec 已确认的真实浏览器操作与公共 HTTP 工程接口；不增加私有状态测试。`npm --prefix webui/frontend ci` 成功（26 packages，0 vulnerabilities）。使用既有 Python、Edge、独立 18761 测试服务，保留 18762 演示。

### 实现与红 → 绿

- `SourceTimeline.tsx` 使用 Pointer Capture、原片毫秒坐标和独立临时手势；开始时提交已有有效表单、暂停播放但保留吸附播放头。横拖保时长，纵拖只改人物，斜拖一次提交两者；总览/锁定视频/轨外保留原归属。resize 两端分别限制到合法整数时间，最短 1 ms；不改变未选条目。预览不调用 `session.commit`，释放才通过 App 提交完整操作。轨道高度在手势中不重排，避免换轨目标随预览跳动。
- 吸附默认开启，8 屏幕像素内从播放头和其他字幕边界选择最近的合法对齐；排除自身，纯纵拖不吸附时间，命中显示虚线。手势中滚轮也重新计算预览；Esc/取消/丢失捕获撤销临时状态，不增加历史。既有保存队列、修订与重开契约复用。
- 新增 `webui/frontend/tests/drag-timing.spec.ts`；真实 Edge pointer/滚轮/按键，公共 GET 核对完整工程，不读取组件内部状态。每轮新增行为先执行失败，再实现并 build 后执行转绿：
  1. `-g 横拖`（最初运行仅含该测试的整个文件）：按住后找不到时间字段，未有拖动；实现后 2000–3000 ms 预览超过 850 ms，GET 仍与原工程完全一致，释放自动保存、一步撤销/重做、重开通过。
  2. `-g 纵拖`：期望乙、实际甲；新增真实坐标命中人物轨后转绿。覆盖斜拖 1500–2500 ms + 丙，以及拖回总览/视频不改归属、不增加空历史，全部未选条目保持原值。
  3. `-g '两端 resize'`：找不到开始边界手柄；加入两端手柄后转绿。8 个场景覆盖两端正常调整、互相越过时的 1 ms 下限、片头片尾和整体移动边界，每个场景核对完整工程及撤销/重做。
  4. `-g 吸附可`：找不到吸附按钮；实现后转绿。播放头 2750 ms、字幕开始 1500/3500 ms 均能对齐；关闭后保存 2480–3480 ms，保持一秒时长。
  5. `-g 'Esc|缩放横纵'`：Esc 取消与重做分支测试直接通过已有取消实现；缩放测试先修正测试定位（真实 hover 避开 sticky 刻度），随后实际暴露按住滚轮后预览仍停在 5100 ms。增加 scroll 时重新计算手势后转绿；2×/8×、横纵滚动与固定 pointer 下滚轮预览通过。
  6. `-g 高倍率`：8× 屏幕阈值和 1 ms 调整通过，但 4 px 极短块中部实际命中了结束手柄，整体移动仍停在 7999 ms。根据浏览器实际 hit target 修正极窄块的手柄排布（开始在顶部、结束在底部，中部保留移动），完整测试转绿；极短块及两端均保持真实毫秒，并可保存重开。
- 上述每轮实际命令统一使用 `$env:WEBUI_PYTHON='D:\whisper-diarization\env\python.exe'; $env:WEBUI_BROWSER='msedge'`，`npm --prefix webui/frontend run build` 后运行 `npm --prefix webui/frontend run test:browser -- drag-timing.spec.ts` 或所列 `-g`。前 6 项完成时已有全量浏览器 32/32、HTTP 21/21 通过；最终集成同步和完整复验见下方完成记录。

### 完成与集成基线复验

- 实现提交：`48036e4`（`feat(webui): add atomic subtitle drag resize and snapping`）。在 `ticket-06` / `feat/webui-06` 执行 `git merge feat/webui`，输出 `Already up to date.`；集成分支与 merge-base 均为 `9d9266706eaeee3ebf7a3529f3ef597d36adc4a0`。随后执行以下最终验证，未将任务合入集成、未推送。
- `npm --prefix webui/frontend run typecheck`：通过。
- `npm --prefix webui/frontend run build`：通过，Vite 33 modules。
- `$env:WEBUI_PYTHON='D:\whisper-diarization\env\python.exe'; $env:WEBUI_BROWSER='msedge'; npm --prefix webui/frontend run test:browser`：**33/33 passed**（约 1.6 分钟）；其中本票 7 项真实 pointer 测试全部通过，既有 editing / exchange / speakers / timeline 全部通过。
- `& 'D:\whisper-diarization\env\python.exe' -m unittest webui.tests.test_http -v`：**21/21 OK**（6.203 秒）。
- `$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }; & 'D:\whisper-diarization\env\python.exe' -m py_compile $Files.FullName`：通过；本票未改 Python。
- `git diff --check`：通过。自行检查本票完整已提交实现及测试、文档，确认只修改 `webui/` 与本票；既有 speaker 截图被回归自动生成，恢复为原版本，不纳入本票提交。
- 成功截图 `webui/tests/evidence/ticket-06-drag-timing.jpg` 已读取核看：原片 2 秒、右侧 2000–3000 ms、总览与甲轨同条目、重叠保留、重开后无历史，保存状态一致。README 记录拖动、极窄手柄、吸附阈值及公共回调契约。
- 服务检查：`Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 18761,18762 } | Select-Object LocalAddress,LocalPort,OwningProcess` 仅返回 `127.0.0.1:18762` / PID `36112`；**18761 已释放，18762 演示保留**。任务工作树保留。
