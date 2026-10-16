# Ticket 13 — 集成阻塞修复复验

日期：2026-10-16；唯一写入工作树 `ticket-13`，分支 `feat/webui-13`。恢复时先将集成 `8613300a33a11e2fe9e3a2835a8649febe0a8721`（包含 `10d5e63` 与 79/2 失败记录）快进合入，票改回 `in-progress`。没有启动代理、修改生产字幕流程、保护素材或依赖版本。

## 结果

| 入口 | 本轮实际结果 | 证据 |
| --- | --- | --- |
| 原 Explorer、原晚到 GET、新增按住鼠标的回执时序 | 3 passed，14.0s | [browser-targeted-green.log](browser-targeted-green.log) |
| 并发任务轮询与原缓存/重启/参数失效 | 2 passed，5.435s | [python-targeted-green.log](python-targeted-green.log) |
| 全部真实 Edge 浏览器测试，单 worker | **82 passed，6.3m**，无跳过/重试 | [browser-full.log](browser-full.log) |
| 全部 HTTP / 实际媒体 / CLI | **41 passed，34.763s** | [python-full.log](python-full.log) |
| npm ci / typecheck / build | 26 packages，0 vulnerabilities；三入口通过 | [build-final.log](build-final.log) |
| Python 编译 | 17 个 WebUI 文件，退出 0 | [compile.json](compile.json) |

最终受测源文件与构建产物 SHA-256、环境/清理结果见上级 [ticket-13-verification.json](../ticket-13-verification.json)。十组验收与既有组合链均由全量入口再次执行，见上级 [ticket-13-acceptance.md](../ticket-13-acceptance.md)。旧版 81/40 验收摘要原样另存 [verification-before-recovery.json](verification-before-recovery.json)，不是本轮结果。

## 1. Explorer：两个真实问题，不仅过滤空值

- **红**：原用例稳定抛 `Cannot read properties of null (reading 'toLowerCase')`。Shell.Application 枚举确有 `Document=null` / 空地址窗口；测试增加固定的 null / 空字符串 OS 边界记录，旧谓词同样红灯。
- 过滤空值后仍红：真实目录窗口断言在原有 15 秒内为 false。这暴露了产品打开目录的问题，而不是允许以 `opened:true` 当通过。
- **同机对照**：[explorer-launch-probe.json](explorer-launch-probe.json)。对含中文/空格的新建独立目录，`os.startfile` 返回成功，2 秒后实际窗口仍 `path:null` / `location:""` / `busy:true`；显式系统 `explorer.exe /n, <目录>` 的另一个窗口返回精确目标路径及 `busy:false`。这只是本机实测，不宣称所有 Windows 的默认 Folder shell verb 都失效。
- **修复**：`backend/resources.py` 使用系统目录内的 Explorer 显式导航，无 shell 拼接；枚举谓词拒绝非字符串路径。未改 HTTP 成功语义，也没有增加等待时间。
- **绿**：仍必须经过实际按钮、HTTP 回执、真实 HWND/目录，以及磁盘导出内容与资源状态一致性断言；只关闭本用例唯一导出目录窗口。证据为 [真实窗口回执](regressions/ticket-10-export-location.json) 与 [截图](regressions/ticket-10-export-location.jpg)，不能由注入的 null/空记录满足。

## 2. 波形生成：按钮点击在异步布局变化中丢失

原集成用例等待新密度 POST 超时，页面没有任务/产物。原始 [79/2 日志](original-integration-browser.log) 和 [媒体快照](original-media-error-context.md) 保留。外部原 trace.zip 的文件头是 ZIP，但缺中央目录，Python zipfile 报 BadZipFile；不能从它声称已经观察到原失败的完整 pointer 序列。原用例单独复跑曾通过，**没有据此认定修复**。

按既定接缝测试四个可证伪方向：异步探测造成按钮位移、点击进入后被保存门禁/代次取消、实际 POST 已发但测试漏收、OS 枚举。新增浏览器用例在公共 HTTP 边界仅延迟**真实** playback 与密度 GET 回执；不伪造探测内容、React 状态、媒体任务或保存结果。

1. 选精细波形，保持旧 GET 未返回；移动真实鼠标到生成按钮中心，按下但不松开。
2. 释放实际 playback 回执并等待渲染，再原地松开。旧实现 [red JSON](pointer-media-red.json) 记录按钮从 `y=413` 变为 `433.390625`，**位移 20.390625 px**；pointerdown 在按钮，pointerup 在 SELECT，click 在 SECTION，POST 数为 **0**。它确定性证明与原快照/无 POST 相符的丢点击缺陷，不是提高超时能修复的问题。红灯上下文见 [pointer-media-red-context.md](pointer-media-red-context.md)。
3. `PreviewCopyControls` / `TimelineMediaControls` 将操作区放在异步详情之前；详情使用定高、可滚动且可键盘聚焦的状态区域。进度/错误/编码和提示仍完整可读；代价是侧栏保留状态区域、需更多纵向滚动。未改为 pointerdown 提交，保留原生点击/取消语义。
4. [green JSON](pointer-media-green.json) 中按钮前后矩形完全相同、完整 down/up/click 均在按钮，恰好 **1 次**生成 POST。实际产物 step_ms=5、SVG 显示、字幕/修订仍原样；再释放旧 GET 后仍跟踪新任务。原晚到 GET/保存回执/工程切换用例也通过。

首次修复后有一次忘记重建静态 dist，浏览器再次运行的仍是旧 bundle，因此仍红；随后执行生产构建再测才绿，没有把旧构建的失败覆盖成通过。最终全套运行的 JS 为 `index-CVLgSwkg.js`、CSS 为 `index-BBLk1t7b.css`，与启动器实际请求记录一致。

另以 OpenChamber 面板实际打开本轮独立工程并检查布局：状态详情计算高度 130px、overflow:auto，可聚焦；原片实际解码红帧、三个字幕可见，面板快照未报页面脚本错误。[manual-media-controls.jpg](manual-media-controls.jpg) 是补充目视检查，不冒充 Edge 测试或音频测量。

## 3. 全量复验额外发现并修复的 Windows 任务文件竞态

- 第一轮后端 **39 pass / 1 error**，不是 40 全绿：[python-initial-failure.log](python-initial-failure.log)。轮询直接解 JSON 后只报 `KeyError: state`，丢失了 HTTP 错误上下文。为共享 `finish()` 增加 200 状态及原始响应断言后，针对性复验捕获真实 `thumbnails_failed`：`os.replace(...tasks/tmp... → ...tasks/<id>.json)` 报 **WinError 5 拒绝访问**：[python-cache-diagnostic.log](python-cache-diagnostic.log)。
- `get()` 持任务 RLock 读取文件，但 FFmpeg 初始/进度路径调用 `write()` 时未必持锁。Windows 普通文件读句柄不共享 delete 权限，读取和原子替换撞上会导致 GET 500 或 worker 写失败。不是 FFmpeg 编码错误，也不是票 12 的帧数算法问题。
- 新增公共 HTTP 回归用 Barrier 同步启动六个实际轮询者，分别观察真实 waveform / thumbnails 任务，不替换 worker、文件 API 或进度。在旧实现先红：**500 != 200 / storage_error**，1.340s：[python-polling-red.log](python-polling-red.log)。该测试是受控并发压力回归；不将线程调度称为数学意义的确定性。原缓存测试也实际暴露过独立的拒绝访问失败。
- 最小修复：所有 `write()` 都持与 `get()` 相同的 RLock，包含原来无锁的进度路径；RLock 保留已有嵌套调用。未改变队列、参数、任务代次、百分比算法或成功回执时机。相同测试和缓存测试绿，再跑全部 41 项通过。
- 最初 PowerShell Tee 日志保留其 stderr 包装及控制台编码损失；最终全套日志由 subprocess 原始字节直写 UTF-8。另有两次**证据工具**错误（旧 PowerShell 缺 GetRelativePath、打印 npm ✓ 时 GBK 编码失败），已改用 Python 路径/编译报告与原始日志，不作为产品失败或测试通过数。

## 4. 票 11/12 与规模组合复验

本轮重新生成的证据在 [regressions/](regressions/)，清单为 [regression-manifest.json](regression-manifest.json)。前票已提交文件恢复原样；本轮没有覆盖旧历史证据。新增按下/松开用例外，未改原竞态断言、超时、夹具或帧数阈值。

- 票 11：旧 GET/new quality、真实解码缓存、保存回执交错/工程切换、工具失败重试；[quality-response-order](regressions/ticket-11-quality-response-order.json)、[concurrency](regressions/ticket-11-concurrency.json)、[playback](regressions/ticket-11-playback.json)。
- 票 12：旧密度 GET、新任务、保存等待中刷新、晚完成不污染新工程；[真实帧数进度](regressions/ticket-12-progress.json)、[快速任务](regressions/ticket-12-fast-progress.json)、[对齐](regressions/ticket-12-alignment.json)、[运行截图](regressions/ticket-12-running-progress.jpg)。240秒 1080p 原片仍有中间帧数与递增百分比，54秒快速任务仍允许直接成功，没有添加最短运行时间。
- 原最终组合链与三个长片用例均再执行：[组合输出](regressions/ticket-13-combination.json)、[长片原始采样](regressions/ticket-13-scale.json)、[跨视窗选择](regressions/ticket-13-virtual-selection.json)、[真实 Windows 启动](regressions/ticket-13-launcher.json)。
- 同机 Edge 155.0.4283.45；7200秒 / 4000条 / 26人物，实际素材仍为160×90 / 1fps H.264/AAC。一次观察：打开1399ms、热重开1452ms、搜索103ms、播放到填字45ms、保存497ms；清浏览器 HTTP cache，未清 Windows 文件缓存。[scale-summary.json](scale-summary.json) 保留口径与 rAF 统计；不是高码率/4K、组件计时、连续两小时耐久播放或跨机器 SLA。

## 5. 边界与交付

- 全套仍观察到 Python 3.10 Windows Proactor 的 Range 取消断连 `WinError 10054`（完整日志保留）；页面/字幕保存/媒体生成用例通过。未改事件循环、吞掉页面错误或放宽断言。
- 新状态区会保留空白空间；过长媒体说明/错误可在具名详情区滚动，未截断文本或丢弃错误。这是避免异步内容推动操作目标的布局取舍。
- 本票恢复为 done；spec 仍 `ready-for-agent`，留主代理最终 review。仅提交任务工作树修复，不合回集成、不推送、保留全部工作树、素材和实际输出。独立测试 Edge/服务/DevTools 与手动检查服务的关闭结果写入 verification；不结束用户的预存 Explorer 窗口或共享浏览器面板。
