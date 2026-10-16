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
