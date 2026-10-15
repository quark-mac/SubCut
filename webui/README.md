# 本机字幕校对 WebUI

当前提供三种 SRT 解释模式、normalized JSONL、MOSS JSON 预览 → 创建工程或整体替换 → 原片播放定位 → 正文/整数毫秒时间/开放人物归属编辑 → 自动保存 → 菜单重开 → 四种字幕导出。支持会话内撤销/重做、有效输入提交与可靠保存；整体替换的条目、人物和来源一起撤销。深色中文工作区包括资源区、播放器、字幕列表与编辑器、锁定视频轨、字幕总览及说话人轨。

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

1. 点击“新建工程”，输入本机视频和 UTF-8 字幕的**绝对路径**（无外层引号），明确选择导入格式，解析预览，确认后创建。预览展示时间、正文、人物、元标签、输入序号、原来源索引与 MOSS ID。新建时核对文件/格式/时长指纹；来源已变化会要求重新预览。详见下方格式契约。
2. 本票直接播放浏览器兼容原片，建议 H.264/AAC MP4。视频按原路径引用，选择字幕暂停并定位起点，原生播放器支持播放/拖动定位。原片范围读取返回 `206`。视频解码失败会提示。
3. 右侧编辑正文、起止毫秒和说话人归属。可选择已有标签，或输入新名称；新名称创建独立说话人身份，输入已有名称复用其引用。`?`、`NONSPEECH` 分别保留未标注、非对白语义并固定在底部。点击“应用修改”、离开编辑区、切换条目、保存或导出会校验并提交当前输入。非法字段显示原因并获得焦点，不能保存/导出非法草稿。Esc 或“取消修改”恢复本次输入前的有效值。重叠条目独立保留，轨内错层展示。
4. 每次有效提交后延迟 **650 ms** 自动落盘；“保存工程”或 Ctrl+S 立即提交并保存。显示“未保存 / 保存中… / 已保存 / 保存失败”；已保存只代表服务确认的版本，保存期间可继续编辑。失败保留输入与历史，可点击“重试保存”。磁盘版本冲突会提示重新打开，保留页面当前修改，不自动覆盖外部更新。已落盘但响应丢失时，重试先核对磁盘快照再继续保存。刷新后从“文件 → 打开工程…”重开。未保存的关闭/切换有提示，确认离开后取消尚未发送的自动保存；取消切换对话框则恢复自动保存。
5. 时间轴工具栏的“撤销 / 重做”或输入框外 Ctrl+Z / Ctrl+Shift+Z 恢复正文、时间和归属（包括创建新标签）的完整操作。一次连续表单编辑提交算一步；保存不清历史，重开重置历史，撤销后新编辑清除旧重做分支。无效、取消或与原值相同的输入不产生历史。输入框内方向键、空格、删除及撤销交给原生文本编辑。
6. 点击“替换字幕”，选择格式与路径并解析预览，点击“应用替换”后整个预览成为一个编辑操作；取消、无效文件和预览本身不修改工程。应用使用已看到的完整预览快照，不重新读取外部文件。来源及人物引用一起替换，同名人物复用身份/颜色，特殊轨身份固定；一步撤销完整恢复原状态，重做恢复同一批新身份。替换通过同一自动保存队列落盘。
7. 顶部选择导出格式，默认“说话人 SRT”，另有“普通 SRT / 项目 JSONL / MOSS JSON”。导出先提交并保存有效输入，固定触发时的内容、格式和元标签选项；等待期间的后续编辑不会混入本次输出。SRT 默认不含元标签，可显式勾选“保留已有元标签”。资源区显示实际文件绝对路径及下载链接。导出失败单独提示并可重试，已成功保存的工程仍显示已保存。

工程文件保存稳定的工程/字幕/说话人身份、格式版本、媒体路径/时长、字幕来源及来源序号、当前工作字幕、已有元标签及导出记录。未知版本和损坏工程会明确报错并保留文件；原片缺失不会以空工程代替。继续编辑以工程保存对象为准：交换字幕缺少工程人物配置、来源上下文等字段，不能替代完整工程保存。后续票补充结构编辑、完整人物管理和媒体生成。

### 格式与来源契约

格式均为显式选择，不从扩展名、方括号或冒号猜测：

| 格式 ID | 导入解释 | 导出 |
| --- | --- | --- |
| `plain-srt` | 全文保留，归属 `?`；方括号、冒号是正文 | 仅正文；显式选项可在正文前写已有 `{TAG}` |
| `speaker-srt` | 首行 `[Speaker]`；仅连续前置 `{MULTI}` / `{MERGED}` 进入 tags，遇未知花括号后整个余文保留 | 默认干净 `[Speaker] text`；显式选项保留所有已有 tags |
| `moss-srt` | 首行按第一个 ASCII `: ` 分隔人物与正文；后续冒号及换行不拆。全角冒号不作为分隔符 | 本票不提供此输出 |
| `normalized-jsonl` | 每个非空行一个对象：`idx/start/end/speaker/text`；`tags/source_entries` 可省略为空数组 | 生产七字段、秒制时间、已有 tags 和原来源索引 |
| `moss-json` | 顶层五字段数组：`id/start/end/speaker/text`；id 与 speaker 为非空字符串 | 恰好五字段；秒制时间、当前人物标签、独立且唯一的段 ID |

- SRT 支持 UTF-8 BOM、CRLF、1–3 位小时、箭头两侧空白与普通多行。分钟/秒限 0–59。项目格式缺人物前缀、MOSS 格式缺 `: ` 均报告错误，用户可改选普通模式。
- JSON 数字必须有限，拒绝字符串/布尔值冒充时间；先校验原秒制 `0 ≤ start < end ≤ duration`，再由服务统一执行 Python `round(seconds * 1000)`（半毫秒取最近偶数），拒绝换算后零时长。重叠、同时间和多行均保留。
- `?` / `NONSPEECH` 为固定特殊语义；组合标签如 `Iroha&Kaguya` 是一个完整标签。`OTHER`、`OVERLAP` 等文件中的字面名称按开放标签保留，不套用 Gemini 模型结果的 canonical / speaker_raw 转换规则。MOSS JSON 不含显示名映射，按 `S00` 等文件值建轨。
- 工程 `Entry.id` 为独立 UUID；`sources[]` 每项为 `{subtitle_id, index, source_entries, moss_id}`。`index` 保存 SRT cue number / JSONL idx，MOSS 为 null；`source_entries` 保存 JSONL 的原 0-based 关联数组，**不重排、不去重、不从当前序号推导**；`moss_id` 保存导入段 ID，其余格式为 null。来源记录 `subtitle_sources` 保存路径、格式和稳定 ID。
- JSONL 导出按参与来源关联顺序拼接已有 `source_entries`；缺失来源、SRT 与 MOSS 来源导出此字段为 `[]`。MOSS 重复输入段 ID 可作为来源保留，工程条目仍独立，输出使用当前条目 UUID 保证唯一。将来拆分/合并须继承这些来源关联，新增条目使用 `sources: []`。
- 所有输出按 `(start_ms, end_ms)` 稳定排序；SRT / JSONL 从 1 连续编号，不改动输入序号或原来源索引。JSONL 始终保留 tags。SRT 无来源字段，MOSS 无 tags/原来源索引；它们不保证完整工程往返。SRT 人物前缀或元标签遇无法表达的分隔/换行字符时明确报错，不生成损坏文件。
- 生产兼容性依据为 `sub/_srt_io.py` 的七字段 JSONL / SRT writer，以及 MOSS `subtitle/models.py`、`export.py` 的五字段数组 / ASCII 冒号约定；WebUI 独立落实严格校验。测试还使用真实生产 `parse_jsonl` / `parse_srt` 读取输出文件。

## 可重复验证

### HTTP 与 Python 编译（checkout 根目录）

```powershell
& $env:WEBUI_PYTHON -m unittest webui.tests.test_http -v
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& $env:WEBUI_PYTHON -m py_compile $Files.FullName
```

HTTP 测试生成 8 秒 H.264/AAC 视频、含多行/重叠/乱序/同时间条目的字幕，启动真实 Uvicorn 于空闲端口，通过 HTTP 验证创建/五格式预览/原子替换/列表/读取/保存/四种实际导出、来源与元标签、字节范围读取、非法输入与人物配置、开放标签及稳定身份、并发修订冲突、未知版本、缺失媒体及损坏工程。畸形 JSON、NaN/Infinity/超大数字、转换后零时长、负来源索引等返回条目/字段/原因，失败不创建或部分替换。Windows 另使用真实文件共享锁阻止原子替换，验证 HTTP 500、磁盘完整旧版本、临时文件清理及解锁重试。每次独立临时目录，结束清理自建素材和服务。故障以外部文件变动或 OS 文件锁注入，未 mock 私有模块。

### 浏览器与前端（checkout 根目录）

Windows 默认使用已安装 Microsoft Edge（真实 Chromium），也可 `WEBUI_BROWSER=chrome`。若使用 Playwright 自带浏览器，先安装：

```powershell
# 已安装 Edge 时无需此步；需要自带 Chromium 时：
# npm --prefix webui/frontend exec -- playwright install chromium
# $env:WEBUI_BROWSER = 'chromium'
npm --prefix webui/frontend run typecheck
npm --prefix webui/frontend run build
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm --prefix webui/frontend run test:browser
```

测试自动启动实际 Python 服务于 `127.0.0.1:18761`（该端口须空闲），浏览器使用生产构建；请在前端修改后先 build。生成素材和工程在被忽略的 `webui/frontend/.test-workspace/`，测试服务结束自动停止，文件保留便于检查；测试结果/失败 trace 在 `webui/frontend/test-results/`。`editing.spec.ts` 覆盖真实播放定位、保存重开、共享视图、历史/焦点/草稿、自动保存、延迟/丢失回执、导出快照、修订冲突与失败重试。`exchange.spec.ts` 覆盖五种导入、预览错误/取消/文件变化、整体替换的一步撤销重做、完整来源/身份保存重开、四种实际文件和元标签开关、MOSS 重导入。失败、延迟及丢失回执在公共 HTTP 边界注入；延迟/丢失前实际请求服务落盘，其余闭环也由真实前后端参与。

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
| `POST /api/imports/preview` | `{media_path, subtitle_path, format?}` → `{media, subtitle_sources, speakers, entries, fingerprint}`；完整校验、不落盘；默认 plain-srt |
| `POST /api/projects` | 上述路径和格式加 `name, preview_fingerprint?` → 完整工程，HTTP 201；重新读取并完整校验，指纹不符返回 409/source_changed；UI 总是带指纹 |
| `GET /api/projects` | `{id, name, revision, error}` 列表，异常工程保留可见错误 |
| `GET /api/projects/{id}` | 完整保存文档；未知版本/缺失媒体报错 |
| `PUT /api/projects/{id}` | `{revision, name, entries, speakers?, subtitle_sources?}` → 完整工程，新修订；这是预览的原子应用/保存边界。来源、人物和条目一起验证并保存；媒体固定。省略可选字段保留原配置 |
| `GET /api/projects/{id}/media` | 原视频，标准字节 Range/206/416 |
| `POST /api/projects/{id}/exports` | `{revision, format?, keep_tags?}` → `{project, export, url}`；默认 speaker-srt / false；按指定修订生成实际文件，登记使工程修订递增 |
| `GET /api/projects/{id}/exports/{export_id}` | 已登记导出文件下载 |

错误：`{error: {code, message, field, entry}}`，SRT/MOSS 条目位置 `entry` 从 1 开始，JSONL 使用物理行号（含空行），文件级错误为 null。保存使用修订比较和同目录临时文件/fsync/原子替换；失败不覆盖现有文件。创建先完整验证，临时工程目录原子发布。`speakers` 为完整配置数组：身份/名称唯一、六位十六进制颜色、`order` 从零连续；最后两项为身份固定的 `?`、`NONSPEECH`。字幕只能引用本次配置中的有效人物与来源身份；整体替换预览的新人物 ID 应先映射到现有同名人物（尤其两个特殊轨）再提交。所有导出记录含 `format / keep_tags / revision`。工程版本仍为 1，旧 plain-srt 文档缺少的新增来源/导出字段按空值加载。

后续票可扩展 `backend/models.py` 的文档与请求 schema、`formats.py` 的格式边界；前端 `api.ts` 定义相应传输类型。`App.tsx` 管理选择/草稿和校验，列表/总览/人物轨按同一条目 ID 选择。`useProjectSession.ts` 统一管理有效工程、历史与保存：

- `open(project)` 建立新会话；`commit(project)` 提交一个不可变有效快照，整次操作进入一步历史；`travel(redo)` 撤销/重做。调用方不得原地修改工程数组/对象。
- 历史恢复 `name / entries / speakers / subtitle_sources`，不回退磁盘修订或导出登记。后续结构/批量/人物操作应在一次完成时调用一次 `commit`，手势预览留在草稿层。
- `persist()` 保存；`persist({format, keep_tags})` 捕获调用时的工程与导出选项快照，串行执行保存和导出登记。每次本地编辑有单调递增代次，回执只更新服务修订/导出信息及对应代次的确认状态，不替换当前正文/人物/来源或草稿。
- `pauseAutosave / resumeAutosave` 用于工程切换或导入对话框；请求进行时暂缓切换，打开另一工程后旧会话回执失效。整体替换通过一次 `commit` 更新 `entries / speakers / subtitle_sources`，由现有历史与保存队列持久化；失败/取消预览不提交。
