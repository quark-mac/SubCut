# 01: 最小工程校对闭环

Status: done
Blocked by: none
Spec: [WebUI 字幕与说话人编辑器](../spec.md)

**What to build:** 用户启动本地 WebUI，选择一份可直接播放的视频和普通 SRT，创建工程、播放定位、修改字幕正文、手动保存，重开工程后导出普通 SRT。首次交付即是一条真实可操作的校对流程。

## 上下文与修改范围

- 对应用户故事 1–4、6、13、32、56、58 的基础闭环。
- 在 WebUI 子系统建立 React + TypeScript 工作区、Python/FastAPI 本地服务、工程存储与测试入口。沿用统一字幕条目、原片时间轴和独立工程保存的决策。
- 使用临时工程目录和自建小型素材验证。实现范围为该子系统、配套测试与开发启动说明；现有生产工具通过已有格式契约衔接。

## Acceptance criteria

- [x] 记录可重复执行的依赖安装、服务启动、浏览器测试、HTTP 测试、前端类型检查与构建命令；浏览器实际连接本地服务。
- [x] 基本工作区呈现深色中文菜单、项目操作栏、左侧资源、中部播放器、右侧字幕列表/正文编辑区及底部时间轴区域。
- [x] 从用户选定的本地视频路径创建单视频单工作字幕工程；原片按路径引用，可播放并通过浏览器范围请求定位。
- [x] 普通 SRT 导入提供预览，完整保留正文与换行，归入未标注 `?`；错误提供条目、字段及原因，不部分创建工程。
- [x] 工程有格式版本、稳定工程/字幕/说话人身份、原媒体引用、字幕来源及当前工作字幕；内部时间为整数毫秒，来源序号不作为条目身份。
- [x] 编辑正文经过非空校验；时间满足原片范围内正时长，合法重叠保留。手动保存与重开恢复修改，菜单可列出并打开已建工程。
- [x] 导出普通 SRT 使用当前已提交状态，按开始、结束和稳定次序排序，连续编号，多行正文保留；产物在资源区可见。
- [x] 导入文件与原视频保持为来源；不支持的工程版本或缺失媒体明确报告，不以空内容覆盖原工程。
- [x] 公共 HTTP 请求能验证工程创建、读取、保存、字幕导入和导出；错误具有用户可理解的信息。

## Verification

1. 用短视频、含换行与时间重叠的普通 SRT，从浏览器完成创建、播放定位、改正文、保存、重开、导出，并读取实际产物比对。
2. 通过 HTTP 验证非法时间、空正文、格式错误、未知工程版本和缺失媒体；确认失败不留下半个可打开的工程或部分字幕。
3. 执行本任务建立的自动化入口、前端类型检查/构建和仓库规定的 Python 编译检查。在 Comments 记录实际命令、结果与浏览器观察。

## Comments

- 2026-10-15：开始实现；`feat/webui-01`、`feat/webui`、merge-base 均为 `17b1aa80931e0f3a81ebec11c35071d8383b467a`，初始 `git status --short` 为空。现有 `D:\whisper-diarization\env\python.exe` 为 Python 3.10.19；Node v24.16.0、npm 11.13.0，FFmpeg/FFprobe 已在 PATH。按规格已确认的公共 HTTP 与真实浏览器边界执行 TDD，测试只用自建素材和独立临时工作区。

### 2026-10-15 实现与 TDD 记录

- 新增独立 `webui/`：FastAPI 服务、版本化工程文档、原子创建/保存、修订冲突保护、普通 SRT 格式边界、Range 媒体读取、React/TypeScript 中文工作区、Windows 启动入口及测试。只修改本票、WebUI 代码/文档/测试；未写入生产素材或修改生产默认值。
- 红 → 绿的实际观察：首个 HTTP 用例因 backend 不存在失败；保存闭环因 PUT 返回 405 失败；范围读取因媒体路由 404 失败；浏览器闭环因 UI 不存在失败。逐个实现后转绿。
- 后续行为回归先失败再修复：重复选择当前字幕导致草稿回退；已存坏时间被接受；缺少 `entries` 的请求在错误处理器触发 500；带 BOM/CRLF 和多空分隔行的合法 SRT 被误拒绝。现在均有公共接口回归用例。
- 启动器实测暴露 Windows PowerShell 5.1 对无 BOM 中文脚本错误消息的编码解析问题，改为 ASCII 启动错误消息后成功。产品界面/业务错误仍为中文。

### 安装与验证命令（实际执行）

工作树根目录为 `C:\Users\machi\AppData\Local\Temp\opencode\webui-worktrees\ticket-01`。下列 Python 命令使用现有环境；npm 命令实际在其 `webui/frontend` 目录执行。

```powershell
& 'D:\whisper-diarization\env\python.exe' -m pip install -r webui/requirements.txt
# 成功：新增 fastapi 0.115.12、uvicorn 0.34.2、starlette 0.46.2；复用 httpx 0.28.1/pydantic 2.12.4。
npm install
# 成功，锁文件已提交。Vite 更新为 7.3.7 后 npm audit 为 0 vulnerabilities。
```

Playwright Chromium 下载两次超时；改用本机已有 Edge `155.0.4283.45`（Chromium），不是用 mock 替代浏览器。`WEBUI_BROWSER` 可指定其它已安装 channel，默认 Windows 使用 msedge。可重复安装命令 `npm ci`、启动和测试全套说明见 [webui/README.md](../../../webui/README.md)。

完成前实际执行 `git merge feat/webui`，结果 `Already up to date.`；最新集成 tip 仍为 `17b1aa80931e0f3a81ebec11c35071d8383b467a`。合并后最终验证：

```powershell
& 'D:\whisper-diarization\env\python.exe' -m unittest webui.tests.test_http -v
# Ran 9 tests in 2.341s — OK。每次启动真实 Uvicorn/HTTP，独立临时工程目录。
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& 'D:\whisper-diarization\env\python.exe' -m py_compile $Files.FullName
# 10 个 Python 文件编译通过。

# cwd: <工作树>/webui/frontend
npm run typecheck
# tsc --noEmit 通过。
npm run build
# Vite 7.3.7 构建通过，30 modules；JS 200.37 kB / gzip 64.02 kB。
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
npm run test:browser
# 3 passed (4.9s)，真实 Edge + 本地 FastAPI，自动测试端口 18761 随测试退出。
```

- HTTP 9 项覆盖：预览/创建/列表/重开与稳定身份、保存/导出实际文件与来源不变、原片字节范围 206/416、非法导入不部分创建、非法编辑/旧修订不覆盖、未知版本/媒体缺失不覆盖、损坏工程、畸形请求字段错误、Windows 普通 SRT 换行/BOM/多空行。
- 浏览器 3 项覆盖：创建预览、实际播放进度和定位、正文/时间保存重开、聚焦输入后直接导出实际 SRT；共享视图与重复选择；无效正文/越界时间阻止操作并定位字段、保存失败保留草稿及 Ctrl+S 重试。只有故障恢复用例在 HTTP 边界注入一次 500，其余真实服务参与。

### 额外真实浏览器检查与产物

- 通过 `webui/start.ps1` 在 18762 启动服务，自动找到主工作树现有 Python 环境；随后通过 `webui/start.cmd` 重启到最终代码，同端口健康检查成功。两种 Windows 入口均实际运行（使用 `-NoBrowser`，浏览器由 OpenChamber 实际打开）。
- OpenChamber 浏览器在 1440×900 桌面布局检查深色中文菜单、资源/播放器/编辑器与底部轨道，成功预览并创建“任务01人工验收”。原片画面可见，点击条目定位到 `00:00:01.000`，播放观察到 `00:00:06.541`。真实媒体请求在服务日志为 `206 Partial Content`。
- 编辑为 `人工验收修改\n第二行保留`，手动保存；在新浏览器页面通过“文件 → 打开工程…”恢复相同内容，再导出。实际文件已用文件读取工具核对：连续编号 1–3、多行保留、重叠保留、同时间稳定排序。
- 演示工程 ID：`d18ac09a-1520-4a16-b084-03a8a7ec15db`；导出文件：`C:\Users\machi\AppData\Local\Temp\opencode\webui-01-demo\projects\d18ac09a-1520-4a16-b084-03a8a7ec15db\exports\6ee534e9-8b6b-44db-a912-4b175771d3bc.srt`。
- 界面证据：[ticket-01-workspace.jpg](../../../webui/tests/evidence/ticket-01-workspace.jpg)。素材是本票生成的 8 秒 320×180/24fps H.264/AAC 小视频及 3 条 SRT，没有调用生产流程或付费 API。
- 保留可检查的演示服务：`http://127.0.0.1:18762`，当前 Python PID **36112**；workspace 为 `C:\Users\machi\AppData\Local\Temp\opencode\webui-01-demo\projects`。停止方式 `Stop-Process -Id 36112`。自动测试服务 18761 已停止。

### 后续票交接

- 测试入口：`python -m unittest webui.tests.test_http -v`；前端 `npm run typecheck` / `npm run build` / `npm run test:browser`（设置 `WEBUI_PYTHON`）。具体路由、请求/响应与工程 schema 入口见 `webui/README.md` 的“下一票接口”和运行服务的 `/docs`。
- 编辑状态以 `Entry.id` 统一引用；毫秒时间、`sources[].subtitle_id/index` 与导出序号分离。`PUT /api/projects/{id}` 当前接收 `{revision, name, entries}`；`POST .../exports` 接收 `{revision}` 并返回实际文件和更新后的工程。
- 本票所有验收项通过，Status 更新为 done；工作树保留、未推送。后续完整格式、历史、自动保存及媒体生成按对应票串行扩展。
