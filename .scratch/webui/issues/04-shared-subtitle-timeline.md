# 04: 共享字幕多轨时间轴

Status: done
Blocked by: 02
Spec: [WebUI 字幕与说话人编辑器](../spec.md)

**What to build:** 用户在同一原片时间轴上看到锁定视频轨、全部字幕总览和按归属分组的说话人轨，点击字幕定位画面、拖动播放头预览，并通过上下键修正单条字幕的说话人。

## 上下文与修改范围

- 对应用户故事 18–22、25–26、30、36、46、50；依赖 02 的编辑及历史接口。
- 修改 WebUI 时间轴、选择/播放联动和相应测试。使用现有基础导入及公开编辑接口建立多说话人夹具，不要求扩展格式任务已完成。
- 总览和说话人轨是同一条目的两个视图，视频轨使用原片时间且始终锁定。

## Acceptance criteria

- [x] 轨道自上而下为视频、字幕总览、普通说话人、未标注、非对白；普通轨初始按首次出现排序，列表和轨道人物颜色一致。
- [x] 总览与说话人轨共享稳定条目身份；编辑或选中某条后，另一视图与右侧编辑器同步，保存后不产生重复字幕。
- [x] 同轨和跨轨重叠均合法，同轨错层显示且每条可分别选中。
- [x] 普通单击选中、暂停并定位字幕起点；播放高亮与编辑选择分离，播放不会抢走正在编辑的条目。
- [x] 拖动播放头更新实际视频画面，时间刻度、字幕块与原片播放时间一致；视频轨不提供解锁、移动或裁剪操作。
- [x] 支持横向缩放、横向滚动及说话人轨纵向滚动，时间范围覆盖原片；缩放不改变条目时间或历史。
- [x] 单选 ↑/↓ 改到相邻说话人轨且时间不变；到边界时不执行，不循环，不把总览或视频作为归属。
- [x] 换轨可撤销、重做、保存重开；文本输入框中的方向键保持文字编辑行为。
- [x] ←/→ 选择上一/下一条，空格播放/暂停，Esc 清除选择或取消当前手势；播放和选择本身不进入编辑历史。

## Verification

1. 从基础工程准备至少三个普通说话人及两个特殊标签、同轨/跨轨重叠和相同时间条目，逐一验证选择、换轨、边界和持久化。
2. 在不同缩放和滚动位置点击字幕与拖动播放头，对照实际画面及时间字段；查看保存/导出条数确认双视图不复制数据。
3. 扩展浏览器回归并运行既有检查，记录原片定位、多视图一致性与键盘焦点的观察证据。

## Comments

- 2026-10-16：开始实现；唯一写入者，工作树 `ticket-04` / 分支 `feat/webui-04`。初始状态干净，HEAD、`feat/webui`、merge-base 均为 `06a8653cf9f242ff33a9aebe0b0047a92b1c2a9a`；前置 02 为 done。加载 TDD，沿用 spec 已确认的真实浏览器与公共 HTTP 测试边界；自建素材、Edge、测试端口 18761，保留既有 18762。`npm --prefix webui/frontend ci` 成功，26 packages / 0 vulnerabilities。

### 实现与实际红 → 绿

- `SourceTimeline.tsx` 以原媒体时长和整数毫秒统一刻度、字幕块和播放头坐标。缩放保留视窗中心时间，适合全片恢复零点；横纵滚动、固定人物名称和顶部刻度。最大缩放按时长/视窗宽度计算；刻度按可见范围生成，轨内布局仅随条目/人物/缩放重算。视频轨为只读展示。
- 时间轴只持有缩放、滚动和手势状态，列表/总览/人物轨共用工程条目及稳定 ID。单条换轨通过现有 `session.commit` 写入一步历史和自动保存，不修改时间/来源/其他条目。普通人物按 `order`，特殊轨固定底部；人物颜色用于标题、块和列表人物标签。
- 浏览器 TDD 每轮先单独添加测试并实际失败，再实现转绿：
  1. `-g 单条按轨道`（首轮直接运行整个仅有一项的 `timeline.spec.ts`）：↑ 后期望丙、实际仍为甲；新增相邻换轨及边界检查后通过。完整测试遍历丙→甲→乙→?→NONSPEECH，越界后撤销证明没有空历史，保存重开核对所有条目 ID/来源及未选条目。
  2. `-g 轨序配色`：列表颜色 `rgb(170,193,216)` 与甲轨块 `rgb(166,149,206)` 不一致；统一人物颜色后通过。真实点击同轨同时间两条及跨轨条目，校验错层可点击、共享修改、预览和实际 SRT 六条不重复。
  3. `-g 左右选择`：→ 后期望同时间下一条，实际仍为第一条；补全左右/空格/Esc 及轨道播放高亮后通过。播放期间聚焦的草稿保持不变，输入控件与对话框不会触发工程换轨；单纯导航不增加服务修订或历史。
  4. `-g 缩放和双向`：找不到“时间轴缩放”超时；实现共享坐标视窗、Pointer Capture 拖动/取消后通过。放大 2×、真实横向滚轮后拖到 6 秒，浏览器解码帧区别于 1 秒，且与随后点击 6 秒字幕得到的帧相同；Esc 恢复拖动前位置，纵向滚到特殊轨可选，适合全片恢复零水平偏移。
  5. `-g 片尾一毫秒`：7999–8000 ms 同轨块的点击中心被裁出轨道，`.app` 拦截点击而超时；修正块的最小 4 px 点击区、内部文字 padding 和片尾约束后通过。每条仍可分别点击、字段保持 7999/8000，越界拖动实际视频停在 0/8 秒。点击区不反写字幕时间。
- 每轮运行前按需 build，使用真实 Edge + FastAPI + 自建 H.264/AAC 原片；测试没有读取 React 私有状态或替代媒体调用。

### 最终命令与结果

以下命令均在 `C:\Users\machi\AppData\Local\Temp\opencode\webui-worktrees\ticket-04` 显式 workdir 执行：

```powershell
git merge feat/webui
# Already up to date. 最终验证前再次执行；集成仍为 06a8653。
npm --prefix webui/frontend run typecheck
# tsc --noEmit 通过。
npm --prefix webui/frontend run build
# Vite 7.3.7，32 modules，JS 212.72 kB / gzip 68.36 kB，通过。
$env:WEBUI_PYTHON='D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER='msedge'
npm --prefix webui/frontend run test:browser
# 20 passed (25.7s)：editing 11 + exchange 4 + timeline 5，端口 18761。
& 'D:\whisper-diarization\env\python.exe' -m unittest webui.tests.test_http -v
# Ran 20 tests in 6.201s — OK，无跳过；既有格式/保存/并发/原子替换失败/媒体回归全通过。
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& 'D:\whisper-diarization\env\python.exe' -m py_compile $Files.FullName
# 11 个文件通过；本票无 Python 源码改动。
git diff --check
# 通过。
```

- 最终 `.last-run.json` 为 `passed`、`failedTests: []`。自审覆盖全部 tracked diff 及新增 `SourceTimeline.tsx` / `timeline.spec.ts` / 验收截图；范围仅 `webui/` 与本票。安装未修改依赖清单/锁文件。

### 可视验收、HTTP 与服务

- 额外启动 `webui.tests.serve --port 18761 --root C:\Users\machi\AppData\Local\Temp\opencode\webui-04-acceptance`，通过公共 POST 建六条多轨工程，再在 OpenChamber 真实浏览器页执行文件菜单重开、点击总览同时间条目、输入正文、应用修改、导出、点击人物轨同条目。实际查看了两张截图：[总览错层与原片定位](../../../webui/tests/evidence/ticket-04-shared-timeline.jpg)、[人物轨共享修改与保存](../../../webui/tests/evidence/ticket-04-speaker-track-saved.jpg)。第二张显示正确的 1000/4000 ms、原片 1 秒画面、同时叠加的两条字幕、人物轨选中边框及播放底线；两个视图没有独立编辑副本。
- 工程 `d30daaf4-3d65-4b1d-a81a-2d2461b73135` 最终修订 3、六条；服务真实返回创建 201、读取 200、媒体 206、保存 200、导出 201。实际读取导出 `C:\Users\machi\AppData\Local\Temp\opencode\webui-04-acceptance\projects\d30daaf4-3d65-4b1d-a81a-2d2461b73135\exports\77b2de71-eade-413e-b22a-9f72954efbcb.srt`，连续六条，第 2 条 `[甲] 浏览器验收：同条目共享修改`，原时间与重叠均保留。
- 自动测试服务已退出；额外验收服务 **18761 / PID 22100** 核实独有命令后主动停止，素材/工程/导出保留。最终 18761 无监听；既有 **18762 / PID 36112** 保持运行，未操作其工程。浏览器工具生成的两张截图移入上述 `webui/tests/evidence/` 后移除本次产生的 `.openchamber/` 临时副本。
- 本票全部验收完成，标记 done。已在任务分支执行 `git merge feat/webui` 并验证，未合入集成分支、未推送、未创建其他代理；任务工作树保留。
