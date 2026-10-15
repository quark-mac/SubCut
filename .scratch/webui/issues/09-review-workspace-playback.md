# 09: 逐句试听与校对工作区完善

Status: done
Blocked by: 04
Spec: [WebUI 字幕与说话人编辑器](../spec.md)

**What to build:** 用户搜索目标台词、调整面板、双击逐句试听或循环慢放，在视频上查看当前工作字幕，同时保持手动编辑选择不被播放过程打断。

## 上下文与修改范围

- 对应用户故事 15–17、23–28；依赖 04 的共享时间轴与选择/播放分离。
- 修改 WebUI 工作区布局、播放器控件、字幕叠加、右侧列表及测试。人物管理、波形等能力由各自任务扩展现有区域。

## Acceptance criteria

- [x] 保持深色中文三面板布局，上部面板宽度及上下分区高度可拖动调整；撤销/重做仍位于时间轴工具栏。
- [x] 右侧具有字幕/说话人页签；字幕列表支持文字搜索及按人物筛选，筛选改变显示不改变工作字幕或历史。
- [x] 普通单击暂停并定位；双击从起点播放到终点自动停止，提供当前字幕循环试听与明确的退出控制。
- [x] 提供时间跳转、播放/暂停、0.5～2 倍速；操作后播放头、实际画面与字幕高亮同步。
- [x] 视频叠加当前已提交工作字幕，可独立开关字幕和说话人名称；同时间多条字幕错开显示，使用当前标签。
- [x] 播放过程中高亮可变化，但右侧编辑选择不被抢走；文字提交后叠加与列表更新。
- [x] 输入框焦点、←/→ 导航、空格及 Esc 沿用既定语义；视图调整与播放控制不进入编辑历史。
- [x] 帮助内容可查到当前已实现的快捷键；已交付的菜单和工具操作能从工作区实际触发。

## Verification

1. 浏览器逐条双击、循环、调速、跳转并检查短句终点；播放中编辑另一条，确认选择与高亮分离。
2. 对多行及重叠字幕检查叠加、人物名称开关和文本更新；搜索/筛选后操作条目，确认实际工作字幕集合不变。
3. 调整面板并检查主要控件可用，运行回归与前端类型/构建检查，在 Comments 记录真实播放和布局观察。

## Comments

- 2026-10-16：唯一实现写入者在 `ticket-09` / `feat/webui-09` 开始；工作树干净，HEAD 与 `feat/webui` 均为 `e135abd`。测试边界沿用 spec 已确认的真实浏览器 UI、公共 HTTP 和实际媒体；使用现有 Python 与 Edge，逐片红→绿。

### 实现与红绿证据（2026-10-16）

所有命令在 `C:\Users\machi\AppData\Local\Temp\opencode\webui-worktrees\ticket-09` 执行：

```powershell
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm --prefix webui/frontend ci
npm --prefix webui/frontend run build
npm --prefix webui/frontend run test:browser -- review.spec.ts
```

- 安装成功，npm audit 0 vulnerabilities。每个实现片先运行新增的浏览器用例，再实现并 build 重跑。
- 搜索/人物筛选：红为找不到“搜索字幕”；绿为 1/1。过滤只影响列表，保留完整排序序号/选择/工程，时间中间被另一人物插入的两个过滤结果不能合并，Ctrl+M 也不执行。
- 逐句：`... run test:browser -- review.spec.ts -g 逐句` 红为双击后 video 仍 paused；实现后发现轨道 pointer capture 将双击重定向到容器，修正容器双击命中。绿为 2/2，包含短句精确停止于 1.350 秒、0.5× 循环跨多轮、退出、2× 轨道试听、6.200 秒跳转与高亮同步、非法时间拒绝。
- 叠加：`... -g '重叠多行|循环高亮'` 红为缺少 `[甲]` 标签；绿为 4/4。两条重叠字幕实际 bounding boxes 不相交、多行保持换行、人物/字幕开关独立；草稿不改变叠加，提交后正文和新标签一起更新，一步撤销恢复。循环试听第三条时 Ctrl 切换编辑第四条，跨完整循环输入/提交/自动保存不抢选择、也不改前三条。
- 布局：`... -g 三面板` 红为缺少 separator；实现后小桌面暴露 grid 隐式行的最小内容高度挤出播放控件，改为 `minmax(0, 1fr)` 行。绿为资源 +60 px、编辑 +50 px、时间轴 +70 px、Esc 恢复及菜单复位；1100×800 下播放/搜索/撤销可见。
- 帮助/菜单：`... -g 帮助` 红为帮助缺少 `↑ / ↓` 等快捷键；绿为 6/6。文件菜单实际导出文件包含菜单修改后的 `[甲]` 正文，编辑菜单撤销/重做、视图页签/叠加、替换入口与 Esc 帮助关闭均执行。
- 首次全量回归暴露新叠加开关“显示说话人名称”与旧表单字段“说话人名称”模糊无障碍定位重名；改用独立名称“叠加人物名称”，中止旧构建的失败批次后重新 build。
- 提交前 `git merge feat/webui` 返回 `Already up to date.`。随后 `npm --prefix webui/frontend run build` 与 `... run test:browser -- drag-timing.spec.ts review.spec.ts` **14/14 通过（1.0m）**；包括新增片尾循环跨越 ended、删除试听目标立即停止、撤销不自动重新播放。

### 实际浏览器观察

- Edge 自动化采用真实 8 秒 H.264/AAC 测试视频（画面自带原片时间/帧数）、真实服务与 HTTP 保存文档，没有替代媒体时钟。默认 1440×1000，另测 1100×800。
- OpenChamber 浏览器另在 `http://127.0.0.1:18762` 打开“任务09 校对试听验收”，工程 `3f987146-fc1c-45a1-ade7-ea2bd3155d31`。实际单击、跳转 1.2 秒，看到画面时间 1.167 秒（24 fps 的对应解码帧）、播放头 1.200 秒、两条多行/人物叠加错位；第一条保持编辑选择，重叠条目同时高亮。启动循环后观察“暂停 / 循环试听中”及原片短句范围，点击“退出试听”停止。
- 实际截图已检查：`webui/tests/evidence/ticket-09-review-workspace.jpg`。三面板、搜索、重叠字幕、全部试听控件及时间轴撤销/重做可见；右侧长编辑表单独立滚动。OpenChamber capture 为 1440×900 桌面（设备像素截图 2160×1350）。
- 手动服务从本 worktree 运行，独立素材/工程根为 `C:\Users\machi\AppData\Local\Temp\opencode\webui-09-demo`；此前 18762 的已识别 WebUI 演示进程已停止并由此服务接替，旧工程数据保留。

### 验证命令

```powershell
& $env:WEBUI_PYTHON -m unittest webui.tests.test_http -v
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& $env:WEBUI_PYTHON -m py_compile $Files.FullName
npm --prefix webui/frontend run typecheck
npm --prefix webui/frontend run build
npm --prefix webui/frontend run test:browser
```

- HTTP 全套 **21/21 通过（6.249s）**；所有 WebUI Python 文件编译与前端 typecheck/build 通过。
- 合并集成基线后的最终真实 Edge 全套 **60/60 通过（3.2m）**，包括 7 个本票用例、9 个结构编辑用例与全部编辑/导入导出/人物/多选/拖动/原片帧同步回归。检查 WIP tracked diff 与新增文件，范围仅 WebUI、README、本票及本票截图；旧票截图由本轮测试再生，恢复到 HEAD，保留既有证据。
- `18761` 已由测试框架释放；`18762` 保留本 worktree 的演示服务（验收时 PID **7544**），健康检查正常。运行命令：`& 'D:\whisper-diarization\env\python.exe' -m webui.tests.serve --port 18762 --root 'C:\Users\machi\AppData\Local\Temp\opencode\webui-09-demo'`。
- 最终状态 `done`，全部验收勾选；提交位于 `feat/webui-09`，保留 worktree，由集成会话后续处理合入。

### 2026-10-16 集成验收

- 合并前确认集成目录 `D:\whisper-diarization` 的 `feat/webui` 为 `e135abd2beb7e72accedb87a6ffdb1694edfc393`；任务工作树 `C:\Users\machi\AppData\Local\Temp\opencode\webui-worktrees\ticket-09` 的 `feat/webui-09` 为 `b777a56f9328f10317ded0acc7813a93183d2eb1`。两个工作树均干净，票为 done，差异仅涉及 WebUI 前端、测试、文档与本票；`git diff --check e135abd b777a56` 通过。
- 已实际读取 Comments、已提交工作区截图和任务工作树 `.last-run.json`（passed）。在集成目录执行 `git merge --ff-only feat/webui-09`，成功从 `e135abd` 快进至 `b777a56`。依赖清单及锁文件未变，复用已有前端依赖和指定 Python 环境。
- 以下命令均在 `D:\whisper-diarization` 实际执行，全部通过：

```powershell
& 'D:\whisper-diarization\env\python.exe' -m unittest webui.tests.test_http -v
# Ran 21 tests in 5.835s — OK，无跳过。
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& 'D:\whisper-diarization\env\python.exe' -m py_compile $Files.FullName
# 11 个 Python 文件编译通过；本票无 Python 源码改动。
npm --prefix webui/frontend run typecheck
# tsc --noEmit 通过。
npm --prefix webui/frontend run build
# Vite 7.3.7；41 modules；JS 244.43 kB / gzip 78.36 kB。
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm --prefix webui/frontend run test:browser
# 60 passed (3.3m)，无跳过：review 7 + 既有 53 项。
# 真实 Edge + 集成目录生产构建 + 本地 FastAPI。
```

- 本票七项覆盖短句双击终点停止、慢放循环/退出/跳转、搜索筛选与全体连续性、重叠多行和标签开关、编辑选择与试听分离、三面板拖动/取消/复位、小桌面布局、帮助/菜单实际操作，以及片尾循环和删除试听目标。既有浏览器五十三项及 HTTP 二十一项全部通过，集成 `.last-run.json` 为 passed。
- 回归自动重写的 05/06/07/08 四张截图已复制到被忽略的 `webui/frontend/test-results/ticket-09-integration-{speaker-management,drag-timing,batch-editing,structure-editing}.jpg`，随后仅恢复这四张已跟踪截图到合并提交版本；09 已提交截图未被测试改写。测试工程与产物保留。
- 演示服务来源已核查：本票先前记录说明旧 18762 演示被任务 09 服务接替。实际 `Win32_Process` 显示 PID **7544**、父进程 **34248**、创建时间 **2026-10-16 03:49:23**，可执行文件 `D:\whisper-diarization\env\python.exe`，命令 `-m webui.tests.serve --port 18762 --root C:\Users\machi\AppData\Local\Temp\opencode\webui-09-demo`；父 PowerShell 命令与此一致，旧 PID 36112 未返回进程。按票记录该服务从 ticket-09 工作树启动，实际命令和数据根与记录相符。本次未停止、重启或修改其工程。
- 测试前确认 18761 空闲，测试后确认服务已退出；18762 始终由 PID 7544 监听，前后 `/api/health` 均返回 `{"status":"ok"}`。恢复测试产物后工作树干净，再仅追加本段并独立提交。未启动其他代理，未推送，保留全部工作树。
