# 11: 兼容性预览副本

Status: done
Blocked by: 10
Spec: [WebUI 字幕与说话人编辑器](../spec.md)

**What to build:** 用户导入浏览器不能直接播放的原片后，可从界面生成预览副本，查看进度和错误，成功后继续按原片时间播放与校对，并在重开时复用有效结果。

## 上下文与修改范围

- 对应用户故事 62–63；依赖 10 的媒体引用、工程资源和重新定位。
- 修改 WebUI 媒体能力探测、任务提交/状态接口、后台生成、缓存及播放交互，使用真实 FFmpeg 验收。
- 原片时间是唯一编辑基准，预览副本不是裁剪或去空隙后的紧凑视频。

## Acceptance criteria

- [x] 按实际容器、编码和浏览器播放结果判断兼容性，不能只凭扩展名认为可播；不兼容时可触发生成预览副本。
- [x] 导入时可获取原片时长并验证字幕，即使浏览器尚不能解码原片；生成期间工程及字幕数据保持可读取。
- [x] 后台任务公开等待、运行、成功、失败状态和进度，UI 显示当前状态与失败原因；可在失败后重试。
- [x] 真实生成浏览器支持的音视频副本，保持原片播放时间基准、音画同步与有效时长，不移除静音/空隙或重排内容。
- [x] 成功后播放器使用有效副本，工程仍引用原片身份，字幕和导出时间不因副本改变；视频服务支持范围读取定位。
- [x] 结果登记到工程资源，缓存关联源媒体身份及生成参数；重开复用有效缓存，源媒体或参数变化时不误用旧结果。
- [x] 失败或未完成产物不作为可播放缓存；缺少媒体工具、生成失败或源文件失联有明确结果，已保存字幕不受损。
- [x] 记录实际调用的媒体工具版本、测试素材信息和预览检查结果；运行时复用/配置媒体工具的方式写入使用说明。

## Verification

1. 自建带可辨识音画标记的短片，选择目标浏览器实际不能直接播放而 FFmpeg 可解码的编码/容器，从 UI 完成真实转换和播放。
2. 对照开头、中部和结尾标记及字幕时间检查定位与同步；检查输入起始时间偏移的素材，确保没有错误的时间平移。
3. 从 HTTP 和浏览器验证任务状态、工具缺失、失败重试、缓存复用及媒体变化失效；执行相应回归、构建和编译检查，在 Comments 留存证据。

## Comments

- 2026-10-16 开始：独占写入 `ticket-11` / `feat/webui-11`，干净基线及 `feat/webui` 均为 `c9e669d`。测试接缝沿用规格 Testing Decisions 已确认的真实浏览器、公共 HTTP、实际 FFmpeg 产物；按纵向红绿循环实施。演示 18762/PID7544 保持不动。

### 2026-10-16 实现与红绿证据

- 修改仅在 `webui/` 及本票/README。没有代理或生产模块改动。新公共接口：`GET playback`、`POST preview`、`GET tasks/{id}`、`GET previews/{id}`（完整路由见 README）。后台单 worker，真实 FFmpeg `-copyts -start_at_zero`、H.264/yuv420p + AAC/48kHz、原片完整时间线，进度取自 `-progress`；先写 partial，探测及身份验证成功后原子发布。任务记录保留实际命令、工具版本和 stderr。
- RED：`D:\whisper-diarization\env\python.exe -m unittest webui.tests.test_preview -v` 首次真实断言得到 **14000 != 9000**，暴露 +5 秒 Matroska 的 segment duration 被误认为播放长度；按共同原片起点计算长度后 GREEN。下一纵切的 `POST /preview` 首次返回 **404 != 202**，实现后台任务后真实编码、范围读取、缓存及音画定位测试 GREEN。
- RED：`WEBUI_BROWSER=msedge npm run test:browser -- preview.spec.ts` 首次缺“浏览器解码状态”。真实观察发现 Edge 对 FFV1/PCM 文件不一定报 media.error：它能解码音轨但 `videoWidth === 0`，故验收和界面明确检查实际画面解码，不把“无 error”当兼容。实现 UI 触发/状态/成功切换后 GREEN。
- RED：清空 PATH，仅设置正确 `WEBUI_FFPROBE` 时，`python -m webui --no-browser --port 18764` 原启动器仍退出 **2**。现在启动/运行均尊重工具配置；无工具也允许打开已保存字幕，媒体操作明确失败。公共 HTTP 启动验收 GREEN。
- 首轮全浏览器回归暴露旧重定位测试匹配到两个 alert（后台媒体失联提示与模态表单错误）；将后台读取提示改为具名 status 后相关 8 项 GREEN。首轮命令 240s 超时不作为完整通过；最后使用 600s 上限完整运行 **68/68**。
- 提交前公共接口复核另加“缓存命中后的任务 ID 仍可查询”断言，首次 RED（task_not_found）；缓存命中也持久化成功任务回执后 GREEN，随后再次执行全量 HTTP/浏览器回归。

### 真实媒体验收

- FFmpeg/ffprobe：`9.0.2-full_build-www.gyan.dev`（gcc 16.2.0，libavcodec 63.1.102 / libavformat 63.1.102）；复用 `D:\whisper-diarization\MOSS-Transcribe-Diarize\ffmpeg\ffmpeg-9.0.2-full_build\bin\`。运行配置为 PATH 或 `WEBUI_FFMPEG` / `WEBUI_FFPROBE` 绝对可执行路径，README 已写明。
- 环境：Python **3.10.19**（指定现有环境）、Node **24.16.0**、npm **11.13.0**、真实 Microsoft Edge **155.0.4283.45**。已执行 `npm ci`，0 vulnerabilities；没有安装/修改生产 Python 环境。
- 素材由 `webui/tests/fixtures.py:create_preview_fixture` 实际生成：**9s、320×180、25fps、FFV1 + PCM s16le Matroska，起始 PTS +5s**，红/440Hz（0–2s）、黑场静音（2–4s）、绿/880Hz（4–6s）、黑场静音（6–8s）、蓝/1320Hz（8–9s），三个独立字幕锚点。另把同一容器改名为 `.mp4`，公共探测仍返回 Matroska/FFV1/PCM；原时长 9000ms 与字幕有效性独立于浏览器解码。
- 真实 Edge 由新建工程 UI 导入 → 显示无法解码视频 → 点击生成 → 等待/成功 100% → 实际 MP4 播放。浏览器 canvas 在 **1 / 5 / 8.5s** 读取 RGB **(254,0,0) / (0,254,0) / (0,0,255)**，叠加分别为开头/中部/结尾字幕；Web Audio 解码该 HTTP MP4，0.1s 样本测得约 **430 / 870 / 1320Hz**（过零计数分辨率 10Hz），RMS 约 **0.283**，浏览器 duration **9s**。这是实际浏览器解码的音频测量，未把自动化测试写成人工听感结论。
- FFmpeg 独立解码产物验证 **3/7s 黑场和静音未被移除**，输出 H.264/AAC、起点 0、长度 9s；额外 **音轨相对视频延迟 +500ms** 的输入保留延迟，未分别归零音视频。无音轨素材生成有效 H.264 副本且不虚构音轨。JSONL 实际导出仍为 **0.2–1.8 / 4.2–5.8 / 8.1–8.9s**。
- 原片身份、工作字幕、来源保持；成功资源登记后自动播放副本。浏览器重开复用；标准/轻量参数切换产生不同副本、切回复用有效旧副本。HTTP 覆盖源内容变更/失联、参数不匹配、产物损坏/缺失失效，以及实际字节 `206` / 越界 `416`。同源重定位保留有效缓存，另存为仍不共享可写产物；任务 10 的旧人工登记夹具升级为通过公开接口实际生成，原有断言保留。
- **54s / 1280×720** 实片后台转换时观察到运行中多个中间进度。正在写入的非空 partial 文件未登记，播放接口返回 409。自动保存 PUT 已真实落盘后延迟其回执，同时任务完成、用户保留更新草稿并切换工程；再释放旧任务回执，第一工程保留“任务完成时的新草稿”及唯一资源，第二工程保留“另一工程独立草稿”且资源为空。后台登记在同一存储锁内重读最新文档，只追加资源，不增加编辑修订；前端不以后台文档替换编辑状态。
- 缺工具/真实失败验收：独立服务配置不存在的 ffmpeg → UI failed/明确工具原因；配置真实 ffprobe 为转码程序 → 实际非零退出/FFmpeg 失败；用真实 ffmpeg 补齐该配置 → UI 重试 succeeded/实际播放。两次失败均无缓存登记、无可播产物，已保存文字完整。HTTP 另检查服务重启复用、缺 ffprobe、无 PATH 的绝对工具配置及完全无媒体工具时已保存工程仍可读取/保存。
- 预览播放逐句终点、循环、2×速度、定位通过真实浏览器；全部既有工作区/重叠/人物/历史/保存/导出回归一起通过。

### 最终命令与结果（在合并检查后运行）

```powershell
# workdir = C:\Users\machi\AppData\Local\Temp\opencode\webui-worktrees\ticket-11
git merge feat/webui  # Already up to date，集成仍为 c9e669d
& 'D:\whisper-diarization\env\python.exe' -m unittest discover -s webui/tests -p 'test_*.py' -v
# 33 tests / OK，最终复跑 21.812s

# workdir = <上述工作树>\webui\frontend
npm ci
npm run typecheck
npm run build
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm run test:browser
# 68 passed (3.8m)，真实 18761 测试服务，进程自动退出
```

- Python 对 `webui/` 14 个源文件执行 `py_compile.compile(..., doraise=True)`，全部通过；另对本次变更 Python 文件执行 `python -m py_compile`。`git diff --check` 通过。WIP 审查覆盖已跟踪差异、新增源文件/测试及证据，未仅检查 HEAD；全回归重写的旧票截图恢复为基线，只提交本票证据。
- 证据：`webui/tests/evidence/ticket-11-{1s,5s,8.5s,retry}.jpg`、`ticket-11-playback.json`（实际浏览器、原片/产物身份与样本数值）、`ticket-11-concurrency.json`（运行进度、partial 不可播放、两个工程保存结果）。原片/产物/任务日志留在被忽略的 `webui/frontend/.test-workspace/`，JSON 内有实际路径。
- 最后一轮完整浏览器输出保留于 `webui/frontend/.test-workspace/ticket-11-final-browser.log`（PowerShell 重定向日志；摘要 68 passed / 3.8m）。
- 另用 OpenChamber 真实浏览器在 **18763** 手动新建/转换/跳转 5 秒，观察绿色画面、“[?] 绿色 880Hz 中部”、原片时间 5/9 秒、成功 100% 和已登记资源；截图 `ticket-11-manual-preview-5s.jpg`。实际工程 `f2e2432b-27ec-4e68-9213-b11376e60e86` 和 MP4 留在 repo 外 `C:\Users\machi\AppData\Local\Temp\opencode\webui-11-acceptance\`。该验收服务 **PID7216 已退出**。
- 退出检查：18761/18763 均拒绝连接，无 ffmpeg/ffprobe 残留进程。未对 18762/PID7544 执行停止、重启或写入；当前环境检查 18762 未监听且 PID7544 不存在，未宣称该演示仍在线。测试切换媒体请求时 Python 3.10 Windows Proactor 曾记录一次 WinError10054 连接重置，68 项断言及持久化结果均通过，服务退出正常。

### 2026-10-16 集成复验：已快进合并，浏览器验收未通过

- 合并前确认集成目录 `D:\whisper-diarization` 的 `feat/webui` 为 `c9e669dfd804268dbdc24a7486a12f849169cd4f`；任务工作树 `ticket-11` / `feat/webui-11` 为 `8e56215d973b8ace66c6efc4c702efcfb44261ce`。两个工作树均干净，票顶部为 done；改动仅涉及 WebUI 与本票，`git diff --check c9e669d 8e56215` 通过。已读取原验收记录、音画/并发 JSON、5 秒截图及实际转换/探测实现和延迟音轨测试。
- 集成目录执行 `git merge --ff-only feat/webui-11` 成功，从 `c9e669d` 快进至 `8e56215`。依赖未变，复用已安装前端依赖及现有 Python；没有实现修复或下一票。以下为本轮实际结果，不以任务工作树先前全绿替代集成结果。

```powershell
# cwd: D:\whisper-diarization；先构建以满足启动入口测试前提
npm --prefix webui/frontend run typecheck
# 通过。
npm --prefix webui/frontend run build
# 通过；Vite 44 modules；JS 253.08 kB / gzip 81.37 kB。
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& 'D:\whisper-diarization\env\python.exe' -m py_compile $Files.FullName
# 14 个 Python 文件通过。
& 'D:\whisper-diarization\env\python.exe' -m unittest discover -s webui/tests -p 'test_*.py' -v
# 33 tests / OK，20.733s，无跳过：HTTP 26 + 真实媒体/启动入口 7。
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm --prefix webui/frontend run test:browser
# 67 passed / 1 failed (4.5m)，退出码 1；并非 68/68 通过。
```

- 音画专项本轮实际通过：+5 秒 PTS 的 FFV1/PCM Matroska 探测为 9000 ms；真实生成 H.264/AAC 起点约 0、长度 9 秒，1/5/8.5 秒色块与音频频率、3/7 秒黑场静音、字幕导出时间不变。+500 ms 延迟音轨用实际解码样本检查 0.2/0.7/2.3/2.7 秒静音/有声模式，保留相对延迟；无音轨不虚构音轨。无 PATH 的绝对工具配置、无工具打开/保存、真实生成失败/重试与服务重启缓存复用均通过。
- **集成失败位置**：`webui/frontend/tests/preview.spec.ts:83`，首个预览用例在标准副本完成音画采样、逐句/循环、重开及 Range 检查后，切到 small 并点击生成。任务状态显示“成功 · 100%”，但“浏览器解码状态”5 秒内仍为“浏览器视频解码失败（仅识别到音轨），请生成预览副本”，未出现“已解码”。报告另含 30000 ms test timeout。根因未确定，不将此描述为已确认编码损坏或已排除竞态；未通过重跑覆盖该失败。
- 失败工程 `7e1b354e-30c9-4b27-9258-435c187950c7`，实际工程/原片/副本/任务文件留在集成 `webui/frontend/.test-workspace/`。本轮该用例在写出 `ticket-11-playback.json` 前失败，因此该已提交 JSON 仍是任务工作树旧证据，不能当作本轮完整成功记录。并发任务和失败重试两个新用例均通过，既有 65 项均通过。
- 失败 `.last-run.json`、error-context、trace 及本轮自动重写的证据已另存至被忽略目录 `webui/frontend/.test-workspace/ticket-11-integration-failure/`；原始失败报告仍在 `webui/frontend/test-results/`。仅恢复本轮自动重写的已跟踪证据文件，源码未改。
- 最后检查 18761/18762/18763 均无监听，无 WebUI Python、ffmpeg/ffprobe 残留进程；旧 PID7544 在验证前已不存在，没有重启演示服务。恢复测试产物后工作树干净，再仅追加本段并独立提交。保留全部工作树、未推送、未启动其他代理。**集成验收被上述浏览器失败阻塞，不能宣布本票集成通过；顶部 done 是原任务验收状态。**

### 2026-10-16 集成阻塞修复开始

- 已确认 `ticket-11` 干净并 fast-forward merge `feat/webui` 到 `9401c1a`；重新置为 in-progress。沿用已确认的公共 HTTP / 真实 Edge 接缝，读取原失败 trace 与实际媒体，先建立确定性失败再修复，不放宽等待或用重跑覆盖失败。仍为唯一写入者，无代理，不启动任务 12。

### 2026-10-16 集成阻塞根因与修复

- **失败→复现**：集成报告为 67 pass / 1 fail，`preview.spec.ts:83`。原 trace.zip 尾部/中央目录不完整，仅从压缩流恢复调用记录及部分 DOM 快照，未恢复完整网络记录；从失败工程与调用记录提取最小操作链，在公共 HTTP 边界控制“延后质量切换的旧 `GET playback?quality=small`，先提交新 small 任务，再交付旧响应”。修复前真实 Edge **2/2** 失败：任务显示成功 100%，播放器仍为原 MKV，`videoWidth=0`，解码状态保持“仅识别到音轨”。
- **排除**：原工程两份 standard/small MP4 的 `output_identity` 均匹配；ffprobe 均为 H.264/yuv420p + AAC、320×180、9.000 秒；FFmpeg 全量解码退出 0。单独用真实 Edge 从本地 HTTP 逐份加载，两份均产生 loadedmetadata/loadeddata、320×180、9 秒。因此不是小副本损坏或编码不兼容。
- **根因**：`usePreviewCopy` 只用 `epoch` 判断播放查询回执。质量切换产生的 GET 在 POST 生成回执之后返回时，旧 GET 带着旧 standard 任务/空 preview，仍通过同一 epoch 检查，覆盖了新任务；轮询因此停止，video src 停留在原 MKV。播放器实际检测正确报告 `videoWidth=0`，表面呈现为解码失败，根因在资源/任务回执顺序。
- **修复**：新增独立 `playbackRead` 代次。每次 playback GET 捕获 read token，只有 session 和 read token 同时仍有效才提交；生成操作在保存有效草稿后、POST 前推进 `playbackRead`，使所有已发出的旧播放查询回执失效。POST 返回后仍由任务状态和后续 playback refresh 驱动当前副本；工程切换继续由原有 session epoch 保护。未放宽等待，也未改变实际解码判定。
- **修复后红绿**：最小竞态回归连续 **2/2** 通过；收紧断言为 POST 任务参数必须为 `small`、播放器必须指向该任务 `/previews/{task_id}`、Edge `videoWidth=320` 且状态为“已解码”。原完整 preview 用例和竞态用例 **2/2** 通过。红证据为 `ticket-11-quality-race-red.json`，真实产物独立检查为 `ticket-11-integration-artifacts.json`。
- 修复后的最终回归新增该竞态用例后共 **69/69 Edge tests**（4.0m）通过；`33/33` HTTP/真实媒体测试（21.059s）通过；typecheck、build、14 个 Python 文件编译及 `git diff --check` 通过。全量回归自动改写的旧票证据已恢复，工作树保持干净。
- GREEN 实测：`webui/tests/evidence/ticket-11-quality-race-green.json` 保留旧 GET、新 POST、真实完成任务与媒体事件，播放器最终指向新 small 任务的 MP4，出现宽度 320 的 loadedmetadata/loadeddata；与 `ticket-11-quality-race-red.json` 中仅原 MKV/宽度 0 的事件对照。没有修改集成失败原始文件。
- 本轮命令（工作树根目录/前端目录分别执行）：`python -m unittest discover -s webui/tests -p 'test_*.py' -v`；`npm run typecheck`；`npm run build`；`npm run test:browser -- preview.spec.ts --grep '旧播放查询' --repeat-each=2`（修复前 RED 2/2、修复后 GREEN 2/2）；`npm run test:browser -- preview.spec.ts --grep '真实不兼容原片|旧播放查询'`（2/2）；最后 `npm run test:browser`（69/69）。Python 固定 `D:\whisper-diarization\env\python.exe`，浏览器固定 `WEBUI_BROWSER=msedge`，断言超时维持原 5000ms。最终全量日志位于 `webui/frontend/.test-workspace/ticket-11-final-fixed-browser.log`。
- 服务检查：18761/18762/18763 均未监听，诊断用独立临时 HTTP 服务与 Edge 均已关闭；未重启 18762。保留 `ticket-11` 工作树，不合回 `feat/webui`、不推送，无新增代理及生产模块改动。
