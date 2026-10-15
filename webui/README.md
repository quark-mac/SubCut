# 本机字幕校对 WebUI

任务 01 提供可操作的最小闭环：普通 SRT 预览 → 创建工程 → 原片播放定位 → 正文/整数毫秒时间/现有归属编辑 → 手动保存 → 菜单重开 → 普通 SRT 导出。深色中文工作区包括资源区、播放器、字幕列表与编辑器、锁定视频轨、字幕总览及说话人轨。

## 安装

需要现有 Python 3.10+、Node.js 22.12+（本次使用 24.16）、npm，以及 PATH 中的 FFmpeg/ffprobe。使用已有 Python 环境；以下 PowerShell 命令在**当前 checkout 根目录**执行，Python 路径按本机环境调整：

```powershell
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
& $env:WEBUI_PYTHON --version
ffprobe -version
ffmpeg -version
& $env:WEBUI_PYTHON -m pip install -r webui/requirements.txt
npm --prefix webui/frontend ci
npm --prefix webui/frontend run build
```

安装完成后双击 `webui/start.cmd`。也可从任意目录运行绝对路径的 `webui/start.ps1`：

```powershell
.\webui\start.ps1 -Python $env:WEBUI_PYTHON
# 自定义工程目录/端口，不自动打开浏览器：
.\webui\start.ps1 -Python $env:WEBUI_PYTHON -Port 8765 -Workspace 'C:\MyEditingProjects' -NoBrowser
```

启动器默认从当前 checkout 的 `env/python.exe` 查找，再查 Git 主工作树的现有环境。服务只监听 `127.0.0.1`，默认 <http://127.0.0.1:8765>，控制台 Ctrl+C 关闭服务。启动前检查 ffprobe 和已构建前端。`WEBUI_WORKSPACE` 或 `--workspace` 指定数据目录；默认 `webui/workspace/<工程 UUID>/project.json`。应用使用单进程服务；不要用多个服务进程同时写同一 workspace。

## 使用

1. 点击“新建工程”，输入本机视频和 UTF-8 普通 SRT 的**绝对路径**（无外层引号），解析预览，确认后创建。普通模式不猜测人物，方括号、冒号和真实换行按正文保留，归入 `?`。
2. 本票直接播放浏览器兼容原片，建议 H.264/AAC MP4。视频按原路径引用，选择字幕暂停并定位起点，原生播放器支持播放/拖动定位。原片范围读取返回 `206`。视频解码失败会提示。
3. 右侧编辑正文、起止毫秒和现有说话人归属。点击“应用修改”、切换条目、保存或导出会校验并提交当前输入。非法输入不会用旧值冒充新编辑。重叠条目独立保留，轨内错层展示。
4. “保存工程”或 Ctrl+S 手动落盘，成功显示“已保存”。刷新后从“文件 → 打开工程…”重开。未保存的关闭/切换有提示。任务 01 尚无自动保存、撤销和结构编辑。
5. “导出普通 SRT”先提交并保存有效输入，再导出该修订的快照，按开始、结束和稳定条目顺序排序、连续编号。资源区显示实际文件绝对路径及下载链接。源 SRT 与视频始终保留。

工程文件保存稳定的工程/字幕/说话人身份、格式版本、媒体路径/时长、字幕来源及来源序号、当前工作字幕、已有元标签及导出记录。SRT 导出序号与条目身份、来源序号相互独立。未知版本和损坏工程会明确报错并保留文件；原片缺失不会以空工程代替。后续票补充其他导入格式、完整编辑/历史、自动保存和媒体生成。

## 可重复验证

### HTTP 与 Python 编译（checkout 根目录）

```powershell
& $env:WEBUI_PYTHON -m unittest webui.tests.test_http -v
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& $env:WEBUI_PYTHON -m py_compile $Files.FullName
```

HTTP 测试生成 8 秒 H.264/AAC 视频、含多行/重叠/乱序/同时间条目的 SRT，启动真实 Uvicorn 于空闲端口，通过 HTTP 验证创建/预览/列表/读取/保存/导出、字节范围读取、非法输入、旧修订冲突、未知版本、缺失媒体及损坏工程。每次独立临时目录，结束清理自建素材和服务。未知版本/损坏/缺失媒体以外部文件变动注入，未 mock 私有模块。

### 浏览器与前端（checkout 根目录）

Windows 默认使用已安装 Microsoft Edge（真实 Chromium），也可 `WEBUI_BROWSER=chrome`。若使用 Playwright 自带浏览器，先安装：

```powershell
# 已安装 Edge 时无需此步；需要自带 Chromium 时：
# npm --prefix webui/frontend exec -- playwright install chromium
# $env:WEBUI_BROWSER = 'chromium'
npm --prefix webui/frontend run typecheck
npm --prefix webui/frontend run build
npm --prefix webui/frontend run test:browser
```

测试自动启动实际 Python 服务于 `127.0.0.1:18761`（该端口须空闲），浏览器使用生产构建；请在前端修改后先 build。生成素材和工程在被忽略的 `webui/frontend/.test-workspace/`，测试服务结束自动停止，文件保留便于检查；测试结果/失败 trace 在 `webui/frontend/test-results/`。测试覆盖真实播放定位、保存重开、实际 SRT 文件、共享视图、非法字段焦点、保存失败保留输入及重试。仅失败重试场景在 HTTP 边界注入一次失败，其余均为真实前后端。

### 手动检查用自建素材

```powershell
& $env:WEBUI_PYTHON -m webui.tests.serve --port 18762 --root 'C:\Users\machi\AppData\Local\Temp\opencode\webui-01-demo'
```

终端打印 `短片.mp4` 和 `来源.srt` 的路径。在浏览器打开 <http://127.0.0.1:18762>，使用这些路径新建工程。该命令只创建自建样本和独立工程，使用 Ctrl+C 结束。

### 开发

```powershell
# 终端一，checkout 根目录
& $env:WEBUI_PYTHON -m uvicorn webui.backend.app:app --host 127.0.0.1 --port 8765
# 终端二，checkout 根目录；Vite 将 /api 转发到 8765
npm --prefix webui/frontend run dev
```

## 下一票接口

公开 HTTP schema：运行后访问 `/docs` 或 `/openapi.json`。JSON 字段采用 snake_case；所有内部时间是整数毫秒。

| 接口 | 输入/结果 |
| --- | --- |
| `GET /api/health` | `{status: "ok"}` |
| `POST /api/imports/preview` | `{media_path, subtitle_path}` → `{media, subtitle_sources, speakers, entries}`；完整校验、不落盘 |
| `POST /api/projects` | 上述路径加 `name` → 完整工程，HTTP 201；重新读取并完整校验源文件 |
| `GET /api/projects` | `{id, name, revision, error}` 列表，异常工程保留可见错误 |
| `GET /api/projects/{id}` | 完整保存文档；未知版本/缺失媒体报错 |
| `PUT /api/projects/{id}` | `{revision, name, entries}` → 完整工程，新修订；来源/媒体/说话人配置保留 |
| `GET /api/projects/{id}/media` | 原视频，标准字节 Range/206/416 |
| `POST /api/projects/{id}/exports` | `{revision}` → `{project, export, url}`；普通 SRT 实际文件；导出登记使工程修订递增 |
| `GET /api/projects/{id}/exports/{export_id}` | 已登记导出文件下载 |

错误：`{error: {code, message, field, entry}}`，条目位置 `entry` 从 1 开始，文件级错误为 null。保存使用修订比较和同目录临时文件/fsync/原子替换；失败不覆盖现有文件。创建先完整验证，临时工程目录原子发布。新票可扩展 `backend/models.py` 的文档与请求 schema、`formats.py` 的格式边界；前端 `api.ts` 定义相应传输类型。`App.tsx` 统一维护工程条目，列表/总览/人物轨按同一条目 ID 选择，文本草稿只在有效提交时进入工作字幕。
