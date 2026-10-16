# 12: 时间轴波形与缩略图

Status: done
Blocked by: 04, 11
Spec: [WebUI 字幕与说话人编辑器](../spec.md)

**What to build:** 用户在锁定视频轨中看到与原片时间一致的音频波形和画面缩略图，缩放、滚动时仍可用来定位台词；生成有进度且结果可缓存复用。

## 上下文与修改范围

- 对应用户故事 29–30、63；04 提供时间轴坐标和视口，11 提供媒体任务、源身份和缓存语义。
- 修改 WebUI 媒体派生任务、缓存与视频轨渲染及测试；波形和缩略图仍位于视频轨内部。

## Acceptance criteria

- [x] 从实际媒体生成音频波形和按时间采样的缩略图，派生产物包含可确定的时间定位信息。
- [x] 生成操作复用媒体任务的状态、进度、失败及缓存规则，UI 能看到生成过程，完成后资源和时间轴更新。
- [x] 波形及缩略图绘制在锁定视频轨中，不改变视频、总览、说话人的轨道层级或原片时间。
- [x] 缩放和水平滚动后，同一原片位置的声音峰值及画面采样仍正确对齐播放头、刻度和字幕；仅渲染当前需要的内容。
- [x] 原片与预览副本保持一致的定位结果，不能把裁剪或压缩后的时间当原片时间；无音轨的素材有合理空波形状态。
- [x] 重开工程可复用有效缓存；原媒体变化或生成参数变化后旧缓存失效，失败产物不被显示为完成。
- [x] 派生产物生成、加载、缩放和滚动不修改字幕或编辑历史，失败不会阻断已有字幕编辑及保存。

## Verification

1. 使用已知时刻出现音频脉冲和画面变化的素材，真实生成波形及缩略图，并在浏览器多个缩放/滚动位置对照标记。
2. 检查可直接播放素材与预览副本、无音轨素材、缓存复用和失效；通过公共任务状态和实际产物验证生成结果。
3. 检查生成前后工程字幕未变化，运行相关浏览器/HTTP/媒体回归及构建检查并记录证据。

## Comments

### 2026-10-16 implementation start

- 唯一实现代理；工作树 `ticket-12` / `feat/webui-12` 干净，HEAD 与集成 `feat/webui` 同为 `64daae8`。不修改生产模块、不派生代理、不合集成、不推送。
- 沿用 spec 已确认接缝：真实 HTTP 任务/产物、真实 FFmpeg 媒体、Edge UI。按纵切片红→绿验证波形、缩略图、可见范围与并发；保留 ticket 11 质量切换旧 GET 回归。

### 实现与红→绿

- 第一切片：先增加真实 HTTP `test_waveform_is_real_and_carries_source_time`；运行 `D:\whisper-diarization\env\python.exe -m unittest webui.tests.test_timeline_media.TimelineMediaHTTPTests.test_waveform_is_real_and_carries_source_time -v`，先得到 **404 != 202**（未有入口），实现源时间峰值生成/范围读取后通过。
- 第二切片：增加 `test_thumbnails_are_actual_frames_at_explicit_source_times`；运行 `D:\whisper-diarization\env\python.exe -m unittest webui.tests.test_timeline_media.TimelineMediaHTTPTests.test_thumbnails_are_actual_frames_at_explicit_source_times -v`，先得到 **422 != 202**（未知 thumbnails），实现真实 JPEG + 明确采样时间 manifest 后通过。1/3/5/7/8 秒帧通过真实 HTTP 取图并交给 FFmpeg 解码，分别为红/黑/绿/黑/蓝，不是 mock 图片。
- 第三切片：增加 `timeline-media.spec.ts` 用户生成/视频轨/缩放验收；先 `npm run build`，再 `npm run test:browser -- timeline-media.spec.ts`，因不存在“生成音频波形”按钮真实 Edge 超时。接入资源控件、独立媒体任务 hook、视频轨可见范围组件后通过；后续补充的脉冲、窗口尺寸、延迟音轨、失败和交错回执用例均通过。
- 扩展夹具时本机 FFmpeg 拒绝 `-itsoffset .5`，已改为 `0.5`。Matroska 探测的延迟素材总长为 9499ms（与已知 9500ms 相差 1ms）；验收以工程实际原片时长为准，未为了测试修改生产探测或时间默认值。
- 共用 ticket 11 的单 worker、queued/running/succeeded/failed、实际 `-progress`、持久任务与日志、失败/中断及源/参数/产物三重缓存语义。旧任务无 `kind` 按 preview 兼容；各类查询只取自己的任务，原预览编码参数不变。
- 原片直接生成 8kHz mono 10ms/5ms 峰值及 1s/0.5s 的 160×90 JPEG；均一次性使用共同原片起点，不分别重置音轨。JSON / ZIP 有完整摘要，任务临时 WAV / JPEG 结束清理；资源发布在 PUT 同一锁内重读最新工程，只追加资源，不递增编辑修订。
- `useTimelineMedia` 以工程/源路径/源身份/密度及请求代次隔离响应，POST 前作废较早 GET；结果、轮询、可见范围加载不调用 `session.commit`。有效用户草稿先经既有保存门禁提交；媒体失败不阻断后续编辑/保存。

### 真实媒体与界面证据

- 环境：Python **3.10.19**（`D:\whisper-diarization\env\python.exe`），Node **24.16.0**，npm **11.13.0**，FFmpeg / ffprobe **9.0.2-full_build-www.gyan.dev**，真实 Edge **155.0.4283.45**；未安装另一套媒体栈。
- 自建 9 秒/320×180/25fps 红黑绿黑蓝素材；直接播放版有 1/5/8.5 秒中心的 100ms 880Hz 脉冲。实际波形峰值、帧像素、ruler/图像/峰值坐标在 1×/2×/8×、横移及 1100/1800/1440 宽度下核对；SVG 宽不超过视口，图片只挂载可见采样。
- +5s PTS / +500ms 延迟音轨：200ms 静音、700ms 有声、2700ms 静音、4700ms 有声；HTTP 比较从原片和生成预览分别再生成的波形/图像，Edge 实际生成预览并在 5 秒用 canvas 对照视频和缩略图绿色像素。源身份、字幕整数时间及证据坐标不变。另验无音轨 `peaks: []` / “无音轨 · 空波形”。
- 54 秒/1280×720 FFV1 素材观察到实际 running / 0<progress<1，活动请求返回同一任务；运行中产物 GET 为 409，未登记；成功后才显示缩略图。实际进度记录 `webui/tests/evidence/ticket-12-progress.json`。
- 真实缺 ffmpeg 路径 → 错配实际 ffprobe → 修复为实际 ffmpeg，HTTP 和 UI 均失败后恢复；失败不登记产物，期间字幕可以保存。重启复用、两种密度分离、损坏产物和源身份变化的失效均由真实文件/HTTP 验证。
- 公共 HTTP 只延迟**已真实完成的响应**来注入旧 GET、任务及保存回执顺序；核对旧工程新草稿最终落盘、新工程独立草稿不被覆盖、缓存仍归原工程。没有 mock 自有模块或全部替代媒体调用。
- 自动化截图：`webui/tests/evidence/ticket-12-timeline.jpg`、`ticket-12-delayed-preview.jpg`、`ticket-12-retry.jpg`；实际 Edge 布局/峰值记录 `ticket-12-alignment.json`。
- 额外独立 **18764** 验收：通过 OpenChamber 浏览器新建“任务12实际界面验收”（`737c2bf5-4964-44f4-8957-ba67f3a61663`），分别生成波形、缩略图、兼容副本，跳到 5 秒看到绿帧/绿色字幕，重开复用三种资源，修订仍为 1、撤销禁用。截图 `webui/tests/evidence/ticket-12-manual-reopened.jpg`。服务 PID 19180 已按确切命令行和端口核对后停止。

### 合并检查及验证命令

所有 shell 均显式 workdir；以下根目录命令 cwd 为 `C:\Users\machi\AppData\Local\Temp\opencode\webui-worktrees\ticket-12`，npm 命令 cwd 为该目录的 `webui/frontend`。

```powershell
# frontend cwd
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm ci
# 26 packages，0 vulnerabilities
npm run typecheck
# 通过
npm run build
# 通过；47 modules，JS 258.58 kB / gzip 83.01 kB
npm run test:browser -- timeline-media.spec.ts
# 5/5 通过，最终针对性复跑 21.4s

# checkout root cwd
& D:\whisper-diarization\env\python.exe -m unittest discover -s webui/tests -p 'test_*.py' -v
# 合并检查后最终复跑 38/38 通过，32.639s；无 mock 媒体替代、无跳过
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& D:\whisper-diarization\env\python.exe -m py_compile $Files.FullName
# 16 个 Python 文件通过
git merge --no-edit feat/webui
# Already up to date；集成仍为 64daae8，未向集成分支合并

# frontend cwd
npm run test:browser
# 首轮 74/74 通过（4.0m），包含 ticket 11 旧 GET / 新质量任务回归
# 合并检查后最终全量复跑 74/74 通过（4.1m），无跳过、无重跑，退出码 0
```

- 两轮全量的延迟/取消连接场景记录过 Windows asyncio `WinError 10054` 断连日志，全部断言仍通过；没有将失败测试忽略为成功。
- 仅修改 `webui/`、README 与本票；旧票自动化截图由回归重写的内容不纳入本票提交。真实自建素材/缓存保留在忽略的 `.test-workspace` 便于检查，不触碰生产数据。
- 最终 `Get-NetTCPConnection` 确认 **18761 / 18762 / 18763 / 18764 全部离线**，没有本工作树的 Python WebUI/uvicorn 遗留进程。工作树保留，未推送、未合入集成；`feat/webui` 仍为 `64daae84be8aa982cb0c931559422816fd73ba47`。
- 完成范围含已跟踪 WIP 和本票全部新增文件的自审：共享预览编码参数及 `usePreviewCopy` 竞态保护未变；API 范围与序号校验、源/产物身份、任务发布锁、旧响应隔离、无编辑历史入口、生成文件清理均核对。最终 `git diff --check` 通过。

### 2026-10-16 集成复验：已快进合并，长媒体进度用例未通过

- 合并前核对集成目录 `D:\whisper-diarization` / `feat/webui` 为 `64daae84be8aa982cb0c931559422816fd73ba47`，任务工作树 `ticket-12` / `feat/webui-12` 为 `b522d89ef2083e35c605ca72b84d4b6033c0404b`；两个工作树均干净，票为 done。Comments、README、passed JSON、实际对齐/进度证据及延迟预览截图已读取，差异仅为 WebUI 与本票，祖先检查和 `git diff --check 64daae8 b522d89` 通过。
- 核对实现及验收：波形/JPEG 使用共同原片起点，保留 +5 秒 PTS 素材的原片时间和 +500ms 音轨延迟；源身份、参数/密度及完整产物摘要控制缓存，失败不发布；资源发布在 PUT 锁内重读工程，不增加编辑修订。票 11 的 `usePreviewCopy.ts` 和 `preview.spec.ts` 与集成基线无差异，独立请求代次保护未回退，依赖清单/锁文件未变。
- 执行 `git merge --ff-only feat/webui-12`，成功从 `64daae8` 快进至 `b522d89`。复用已有前端依赖及指定 Python 环境；没有修改实现或启动其他任务。以下命令均显式使用 `D:\whisper-diarization` 为工作目录：

```powershell
npm --prefix webui/frontend run typecheck
# 通过。
npm --prefix webui/frontend run build
# 通过；Vite 7.3.7，47 modules；JS 258.58 kB / gzip 83.01 kB。
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& 'D:\whisper-diarization\env\python.exe' -m py_compile $Files.FullName
# 16 个 Python 文件通过。
& 'D:\whisper-diarization\env\python.exe' -m unittest discover -s webui/tests -p 'test_*.py' -v
# 38/38 通过，33.932s，无跳过：HTTP 26 + preview/启动入口 7 + timeline-media 5。
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm --prefix webui/frontend run test:browser
# 73 passed / 1 failed（4.9m），退出码 1，无跳过、无重跑；不能报告 74/74 通过。
# 后端及浏览器命令实际使用 2>&1 | Tee-Object 留存日志，并透传原退出码。
```

- **失败位置**：`webui/frontend/tests/timeline-media.spec.ts:262`，用例“真实较长媒体显示中间进度、活动任务去重，未完成产物不供给时间轴”。在已通过活动任务去重、未完成产物 409、“运行中”和当时无图断言之后，5 秒内未观察到 `observations` 含 `state === running && 0 < progress < 1`，expect.poll 返回 false；报告另含 30000ms test timeout。快照最终显示成功 100% 且缩略图可见，实际持久任务也为 succeeded/1。尚不能据此确定是生成进度还是采样时序问题，不将其擅自认定为无害或已修复；没有重跑覆盖失败。
- 失败工程 `c90bf1f6-4046-4e7f-98ca-f330072112b7`，任务 `79eb9312-4bf5-4b49-adec-f21412e45793`，原片为 `.test-workspace/timeline-media/1792116920783/large.mkv`（54 秒）。原片、完整工程、任务命令/日志、ZIP 与失败上下文/trace 均保留。该用例未执行到最终写 `ticket-12-progress.json`，因此该已提交文件仍是任务工作树旧证据，不可冒充本轮进度通过记录。
- 本票另四项 Edge 与五项后端真实媒体测试均通过：脉冲/帧原片时间、1×/2×/8× 和横滚/窗口变化、延迟音轨/预览前后一致、无音轨空波形、重开/重启缓存、参数/源/产物变化失效、失败重试与保存回执隔离。本轮对齐工程 `304ded95-cb6e-4d39-815c-b393ef7e4529` 的最大屏幕坐标误差小于 0.014px；1×/2×/8× 图片节点分别为 9/6/2，峰值节点 900/451/114，SVG 宽 1274px、不超过 1424px 视口。已读取对齐 JSON 并核看本轮时间轴截图。
- 票 11 完整音画及确定性旧 GET 回归继续通过：本轮工程 `fc9563ed-5d19-41cb-aed3-c12f25d44aee` 的新 small 任务 `187b5988-bc23-456f-bed2-88fb0380eee0` 最终为播放器实际 src、宽度 320、有 loadedmetadata/loadeddata。既有 69 项全部通过，未将新失败误归因于旧竞态。
- 服务日志记录两次 Windows asyncio Proactor `ConnectionResetError / WinError 10054`，发生在预览交错和媒体移动附近，对应用例均通过；如实保留，不描述为无错误日志运行。PowerShell 对普通 stderr 的 NativeCommandError 包装不代表 unittest/Uvicorn 自身失败，以原退出码及测试结果为准。
- 原始失败 `.last-run.json`、error-context、trace、后端/浏览器日志、票 11 本轮竞态 JSON、失败工程/任务快照及 17 个本轮自动重写的已跟踪证据，已归档至被忽略的 `webui/frontend/.test-workspace/ticket-12-integration-failure/`。日志原件为 `.test-workspace/ticket-12-integration-{backend,browser}.log`。仅恢复本轮自动改写的已跟踪证据到合并版本；恢复后工作树干净，再仅追加本段并独立提交。旧票 11 失败/通过归档未覆盖。
- 最后核查 18761/18762/18763/18764 均无监听，无 WebUI Python、ffmpeg/ffprobe 残留；未重启演示服务。保留全部工作树、未推送、未启动其他代理。**票 12 已合入但集成验收未通过，被上述进度回归阻塞；顶部 done 是原任务工作树验收状态，不代表本轮集成全绿。**

### 2026-10-16 恢复原会话修复集成阻塞

- 工作树 `ticket-12` / `feat/webui-12` 恢复时干净，`git merge --no-edit feat/webui` 从 `b522d89` 快进到 `f0426cf6a6512f7ac28100a819cd10a8b31b2aa9`，包含原实现及完整失败 Comments。票恢复 in-progress，不以此前工作树通过覆盖集成失败。
- 加载 diagnosing-bugs / tdd；继续使用已确认的真实 HTTP / 真实媒体 / Edge 接缝。先重放失败 trace、建立可反映“遗漏 running 且 0<progress<1”的反馈，再区分生成、轮询与监听问题。不放宽超时、不为了测试拖慢生产任务，不派生代理、不推送、不合入集成。

### 集成进度阻塞：反馈、根因和反证

- 原归档 `failed-test-task.json`、error-context 及日志已读取，原件只读保留。归档的 `trace.zip` 有 ZIP 本地头但无有效中央目录，Python `zipfile` 无法打开；没有据此编造网络事件。转而用真实 Edge 在任务 HTTP 边界记录请求/接收毫秒及真实 JSON，失败也在 finally 保存，替代此前仅成功后才写证据的问题。
- 原命令 `npm run test:browser -- timeline-media.spec.ts -g '真实较长媒体' --repeat-each=8` 在前 4 次已有 3 次失败，整条排查命令在 120 秒外部上限被中止，**不计为完整测试通过/完整次数**。后续加边界观测后用 `--repeat-each=12 --trace off` 得到 **10 passed / 2 failed**（1.7m）：一次是本次相同的 5 秒中间进度断言，另一次点击后没有 POST，卡在 60 秒 waitForResponse。关闭 trace 仅用于排查归档/收尾问题，不改变断言；最终全套仍使用默认 trace 配置。
- 同一进度失败的真实项目 `fb101f92-2189-4f16-b973-a0e59b7a403d`：375–381ms 的回执为 running/0，643–648ms 已 succeeded/1；之后轮询停止。此时再等待 5 秒不可能补回漏过的中间状态。监听器确实覆盖了该任务的全部实际 UI 读取，不是因其只监听了错误 task ID 或在成功后才安装。
- 先列出并逐一验证三个预测：①实际工作窗口不足 250ms 导致采样遗漏，改用真实持续解码工作量应能观察多个值；②生成器的时间进度失真，直接记录真实 FFmpeg 与帧数应看见差异；③初始化/刷新推进请求代次会丢弃生成意图，应可在保存回执等待中用同工程刷新确定性复现。不是仅看到一次成功便认定某一假设成立。
- **生成进度根因**：只重放失败任务的真实 FFmpeg 命令（输出改为本工作树独立临时目录，原媒体不变）。54 秒/1280×720 纯色 FFV1 的 FFmpeg 实际只需约 **0.17 秒**，输出 54 张 JPEG；带 `-copyts -start_at_zero` 时，首批已经输出 **44 / 49 张**而 `out_time_us=0`，最终 frame=54 时 out_time_us 仍只有 5–10 秒，另一些运行甚至为 0。仅在 CLI 对照实验移除这两个标志，frame=50/54 时才对应 out_time_us=50/54 秒。此组合的 image2 时间计数不能当作源时间采样完成度。**最终实现保留原全部 FFmpeg 时间标志/采样/编码参数**，没有通过移除共同原片时间基准来修百分比。
- **UI 意图根因**：`generate()` 在等待有效草稿保存前捕获 epoch，保存期间同工程刷新（或初始元数据 effect）会推进 epoch；原判断将其当作换工程而无声 return，因而没有 POST。新增真实 PUT 已落盘、仅延迟回执的用例，刷新缩略图状态后释放保存回执，旧代码确定性失败：5 秒内没有“缩略图任务状态”节点。修复后先按工程/源身份/路径/密度 key 判断意图是否仍有效，保存通过后再捕获当前 epoch 用于 POST 回执；更换工程/源/参数仍取消旧意图，POST 前作废旧 GET 的 read 代次保护不变。
- **修复**：仅缩略图把 FFmpeg `frame=` 作为已完成工作量，`processed_frames × interval_ms / duration_ms` 为真实源时间采样进度；任务附带 `progress_source: sampled_frames` 和 `processed_frames` 便于公共 API 核对，成功发布前仍最多 99%。预览及波形的既有计时分支未改，未增加 sleep/最短任务时长/人为 FFmpeg 限速，UI 250ms 轮询也未变。

### 新验收设计与明确红→绿

- HTTP 现有真实帧验收增加 `processed_frames == 9` 及实际进度来源核对。`D:\whisper-diarization\env\python.exe -m unittest webui.tests.test_timeline_media.TimelineMediaHTTPTests.test_thumbnails_are_actual_frames_at_explicit_source_times -v`：先 **None != sampled_frames** 红（1.480s），实现后通过（1.786s）。后端测试仍共 38 项。
- 同工程保存期间刷新回归：`npm run test:browser -- timeline-media.spec.ts -g '同工程生成等待' --trace off`，先缺少任务状态失败（6.8s），修复后 `--repeat-each=5` **5/5 通过**（18.0s），真实保存文本和产物归属均核对。
- 进度验收不再把“媒体时长 54 秒”当作“处理一定足够慢”。保留原 54 秒纯色源为**快速完成闭环**：只延迟浏览器自己的首次任务回执，直到同一个真实任务已成功，然后交付实际成功响应；断言可以没有任何中间状态、缩略图仍加载、字幕/修订/历史不变。不创建虚假任务、不暂停 worker。
- **持续工作闭环**另用 FFmpeg 生成 240 秒/1920×1080/25fps 移动 testsrc2 H.264。首次生成约数秒，保存在忽略的测试目录供后续复用，所有工程/任务全新。真实任务一般持续数秒，要求两个不同的递增 running 百分比、与真实输出帧数/240 的比例一致、UI 进度条准确显示同一个真实回执；只在两个真实快照之后暂缓下一次浏览器请求便于核对 DOM，worker 不停。继续检查活动去重、未完成 409、成功发布、240 张实际输出帧及原字幕/修订不变，5 秒观察断言不变。
- **反证旧算法**：在上述新持续工作回归中仅暂时恢复旧 out_time_us 计算、保留真实帧数观测（没有更换素材或改断言），`npm run test:browser -- timeline-media.spec.ts -g '真实较长媒体' --trace off` 于 2.7s 明确跑红：已处理 48/240 帧应为 **0.2**，旧算法返回 **0.175**。恢复正确帧数算法后通过，临时对照代码不保留。这证明不是仅用慢素材迁就旧算法。
- 新三场景分别重复 8 次：`npm run test:browser -- timeline-media.spec.ts -g '真实较长媒体|54秒原片快速完成|同工程生成等待' --repeat-each=8 --trace off`，**24/24 通过，1.5m，无跳过/失败重试**。首次新增长源的针对性运行 **2/2 通过，17.6s**（含冷生成），不只依赖已缓存夹具。
- 新证据 `webui/tests/evidence/ticket-12-progress-diagnosis.json` 含原采样遗漏 JSON、真实 CLI frame/out_time_us 对照及旧时间算法反证；更新的 `ticket-12-progress.json` 记录真实持续进度（含帧数、来源及请求/接收毫秒），`ticket-12-fast-progress.json` 记录原 54 秒素材的纯成功回执闭环，`ticket-12-running-progress.jpg` 为实际 UI 百分比截图。临时 CLI 探针已删除，原始原件和排查 JSON 保留在忽略目录；调试 console 前缀已移除。

### 修复后全量验收与收尾

命令环境、checkout root / frontend cwd 与本票前述一致；`WEBUI_PYTHON=D:\whisper-diarization\env\python.exe`、`WEBUI_BROWSER=msedge`，不创建其他环境、不启动其他代理。

```powershell
# frontend cwd
npm run typecheck
# 通过
npm run build
# 通过，47 modules；JS 258.59 kB / gzip 83.02 kB
# root cwd
& D:\whisper-diarization\env\python.exe -m unittest discover -s webui/tests -p 'test_*.py' -v
# 38/38 通过，32.554s，无跳过
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& D:\whisper-diarization\env\python.exe -m py_compile $Files.FullName
# 16 个文件通过
# frontend cwd，保留原退出码
npm run test:browser 2>&1 | Tee-Object -FilePath '.test-workspace/ticket-12-progress-fix-browser.log'
exit $LASTEXITCODE
# 76/76 通过，4.4m；无跳过、无失败重试，使用默认 trace 配置。
```

- 最终全量含票 11 旧 GET / 新质量任务回归，及本票旧 GET / 新密度、晚到保存 / 换工程回归，均通过。最终持续进度真实回执从 18/240（7.5%）、50/240（20.833%）递增至 216/240（90%），240 帧后仍 99% 等待验证/发布，最终成功 100%；截图已实际查看，为“运行中 · 21%”，未完成视频轨没有挂载缩略图。日志留在忽略的 `webui/frontend/.test-workspace/ticket-12-progress-fix-browser.log`。
- 全量及部分诊断运行仍打印 Windows asyncio `WinError 10054`（浏览器取消/关闭连接时），没有造成断言失败。PowerShell 将 npm 转发的服务 stderr 标成 `NativeCommandError`，实际 npm / Playwright 退出码为 0；未隐藏这些输出，也未据此误报失败或重试。
- 本轮测试前没有用户未提交改动。全量重写的票 05–11 证据仅恢复本轮生成变化，本提交保留票 12 更新/新增证据，不修改其他票和生产模块。未改变测试超时、生产最短时长或 FFmpeg 时间基准；修复范围限于 WebUI、README、本票。
- 最后核查 18761/18762/18763/18764 均无监听，无属于本工作树的 WebUI Python / ffmpeg / ffprobe 残留。恢复 done 表示本修复工作树针对 `f0426cf` 的规定验收全绿；**不声称修复已经合入集成**。唯一写入者，未派生代理、未合入 `feat/webui`、未推送，保留工作树供集成人复验。
