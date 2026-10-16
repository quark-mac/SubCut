# Ticket 13 — WebUI 最终集成验收

日期：2026-10-16。范围：`feat/webui-13`，基于集成 `4546e57`（01–12 已完成）。本文是本轮实际运行证据，不以各票旧报告代替复验。实现只修改 `webui/` 与本票 tracker；不运行模型、不修改生产默认值、Gold、源片或保护目录。

规格：`.scratch/webui/spec.md` 的十组验收、`issues/13-long-film-windows-delivery.md`；跨票检查参考 repo 外 `webui-acceptance-map.md`。规格状态仍保留 `ready-for-agent`，由主代理在最终 code-review 通过后闭环。

## 环境与复现入口

- Windows 11 家庭版中文版，10.0.26200 / build 26200。
- Intel Core Ultra 7 251HX，18 核 / 18 逻辑处理器；操作系统报告物理内存 16,822,026,240 bytes（约 15.67 GiB）。设备列表包含 RTX 5060 Laptop GPU 和 GameViewer Virtual Display Adapter；**未测量或声称 GPU 解码加速**。
- Python 3.10.19：`D:\whisper-diarization\env\python.exe`；Node 24.16.0、npm 11.13.0；FFmpeg/ffprobe 9.0.2 full build。
- 真实安装版 Microsoft Edge 155.0.4283.45，Playwright 单 worker，默认 1440×1000；部分媒体/布局用例另用 1100 / 1800 宽。Windows 启动用例另外真正打开有界面的独立 Edge profile；OpenChamber 面板手动检查为 1440×900（非宣称该内嵌引擎就是 Edge）。
- 原始机器信息：[`ticket-13-environment.json`](ticket-13-environment.json)。所有素材自建、工程独立：浏览器在忽略的 `webui/frontend/.test-workspace/`，HTTP 在独立临时目录；手动在 `C:\Users\machi\AppData\Local\Temp\opencode\webui-13-manual/`。没有借用生产素材。

从 checkout 根目录运行：

```powershell
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm --prefix webui/frontend ci
npm --prefix webui/frontend run typecheck
npm --prefix webui/frontend run build
& $env:WEBUI_PYTHON -m unittest discover -s webui/tests -p 'test_*.py' -v
npm --prefix webui/frontend run test:browser
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& $env:WEBUI_PYTHON -m py_compile $Files.FullName
```

浏览器主服务使用 **18761**，不复用已有服务；辅助服务绑定独立空闲端口。最终日志：[`ticket-13-browser-final.log`](ticket-13-browser-final.log)、[`ticket-13-python-final.log`](ticket-13-python-final.log)。以下矩阵中的测试均为本轮真实执行入口；没有 mock React 状态、工程历史或媒体 worker。必要的故障/晚回执只在公共 HTTP 或操作系统文件边界注入。

**最终结果：81项真实Edge通过（6.1分钟）；40项HTTP/媒体/CLI通过（33.223秒）；17个WebUI Python文件编译退出0；npm ci、类型检查、生产构建通过。** 构建日志为 [`ticket-13-build.log`](ticket-13-build.log)，源文件SHA-256及机器可读结果为 [`ticket-13-verification.json`](ticket-13-verification.json)。本轮重新生成的20份前票证据单独保存在 `ticket-13-regressions/`，摘要见 [`ticket-13-regression-manifest.json`](ticket-13-regression-manifest.json)；旧票证据恢复为原样，避免把历史执行覆盖成今天的结果。

## TDD 与本轮修复

1. 长片 `long-film.spec.ts` 首先失败：`expect(.subtitle-row.count()).toBeLessThan(80)`，实得 **4000**。随后实现列表窗口化、时间轴横纵可见块、按完整布局的框选；同一用例转绿。数量上限是验证没有全量挂载的结构性检查，不是臆造的毫秒性能承诺。
2. 当前排序、前缀最大结束时间索引和人物计数按字幕数组变化重建，不随播放每帧重排/遍历所有人物字幕；媒体证据组件按稳定参数复用。只呈现可见条目，完整工程仍用于结构连续性、身份和输出。框选不再仅遍历 DOM：长片窗口卸载后仍保留经过的十条选择。
3. 缺依赖 CLI 红灯：无第三方包的临时 Python 环境只给 `ModuleNotFoundError: uvicorn`，缺少安装指令。修改后明确打印所用 Python 和 `pip install -r .../requirements.txt`，无 traceback；同一公开 CLI 测试转绿。缺前端 build 同时验证，不改真实 dist。
4. 新增组合测试编写期间曾因精确匹配包含 textarea/option 内容的原生 label 而等待超时；改用已有公共 UI 标签匹配，并给新用例设置 10 秒动作超时。此为测试定位修正，不归为产品性能故障。最初 77 项浏览器 / 38 项 HTTP+媒体也实际完整通过，后续在新增链和 CLI 测试后再次全量复验。
5. 一轮全量为79通过、1失败：实际自动开窗/服务/负向Python检查均成功，但清理时 `taskkill /T` 与进程树退出竞争，返回 “operation attempted is not supported”。本轮没有将其算通过；保存 [`ticket-13-browser-cleanup-failure.log`](ticket-13-browser-cleanup-failure.log)。测试现先只终止本次服务日志中的Python PID，随后清理自己的shell，并从公共端口确认服务和DevTools都已关闭；启动和长片3项针对性复验通过，再次全量重跑。不是吞掉清理错误后假称无残留。
6. 随后80项全部通过（`ticket-13-browser-80-pass.log`）。额外检查开放长人物名时，新增公开浏览器用例先红：纵向滚动至第五人物，实际字幕块不存在；长名称换行撑高DOM行，违反虚拟布局所用高度。现固定轨道行高并限制标签溢出，完整名字保留在 `title` 和无障碍名称中。相同用例转绿；红灯页面记录见 `ticket-13-long-label-red.md`。最终完整入口增加为81项。

## 十组验收矩阵

| 规格组 | 本轮公共入口与素材 | 实际验证与失败/恢复证据 |
| --- | --- | --- |
| **1 编辑闭环** | `editing.spec.ts`、`exchange.spec.ts`、`integration.spec.ts`；8 秒真实 H.264/AAC，SRT/JSONL/MOSS | 浏览器修改正文/整数毫秒时间/人物，自动及显式保存，关闭重开、实际下载/磁盘文件核对。有效草稿先提交，无效草稿聚焦字段阻止导出；导出锁定触发时快照，后续编辑不混入。另存为复制当前完整状态、独立 ID、修改互不污染。最终组合见 `ticket-13-combination.json/.jpg`。 |
| **2 共享条目** | `timeline.spec.ts`、`multiselect.spec.ts`、`integration.spec.ts`、两个长片用例 | 总览/人物/列表/叠加引用稳定 ID；任一视图改字/时间/归属同步。普通和 Ctrl+Shift 双视图操作不复制条目；跨总览与人物的同一框选只得两条而非四条。长片滚出卸载、回滚重挂载选择仍在，完整导出仍是 4000 条。 |
| **3 换轨与重叠** | `speakers.spec.ts`、`drag-timing.spec.ts`、`multiselect.spec.ts`、`timeline.spec.ts`、长片重叠/长名夹具 | 原生拖放人物排序后键盘/批量移动按当前顺序；保留相对轨距、底部特殊轨和越界整体拒绝（含斜拖时间部分）。同时间同人物错层分别命中；长片256×可见块真实拖动、一步恢复；开放长名纵滚后点击和框选不偏移。片尾 1ms 点击与拖动；缩放、双向滚动、取消、吸附和无吸附均验证。实际 GET 比较全部未选条目不受影响。 |
| **4 结构编辑** | `structure.spec.ts`、`review.spec.ts`、`integration.spec.ts` | 严格内部拆分复制完整多行/标签/来源；新增无虚构来源，片尾缩短、终点拒绝。合并按**全体**稳定时间序：搜索隐藏中间条不能使两条变连续；Shift 包含隐藏条后允许显式跨人合并，覆盖间隙、保留来源顺序/重复索引和标签集合。撤销恢复原身份；整体替换原子且一步可撤销。MOSS 来源 ID 不冒充 ASS 索引，输出 UUID 唯一。 |
| **5 历史** | `editing.spec.ts`、`drag-timing.spec.ts`、`multiselect.spec.ts`、`speakers.spec.ts`、`structure.spec.ts` | 连续文本、横/纵/斜拖、两端调整、批量、人物重命名/改色/排序/合并/删除各一步。按住超过自动保存延迟仍不落盘；松开才提交。取消、无变化、无效输入、导航与媒体操作不造历史、不误清重做；保存不清历史，重开清空，撤销后新编辑清旧分支。 |
| **6 焦点与播放** | `review.spec.ts`、`timeline.spec.ts`、`preview.spec.ts`、长片播放中编辑 | 实际 video 单击暂停定位，修饰键和框选不暂停/定位；原片及真实预览副本双击到准确终点停止，0.5×/2× 循环和退出有效。播放高亮、试听目标和编辑选择独立，输入方向键/空格/Delete/撤销不误改工程。重叠多行错位、姓名独立开关、提交后当前改名标签同步。 |
| **7 格式** | `exchange.spec.ts`、`test_http.py`、`structure.spec.ts`、`integration.spec.ts`、长片四格式 | 三种 SRT 解释、JSONL、MOSS 五种输入全部重新运行；普通方括号/冒号原样，多行、组合/特殊/开放标签、同时间稳定顺序。四种实际输出和 HTTP 下载一致，SRT 元标签开关、JSONL 原索引（含重复）和元标签不丢，重新编号不改来源。JSONL 及 SRT 用真实生产解析器检查兼容；MOSS 恰好五字段且 ID 唯一。不声称 SRT/MOSS 能完整保存工程。 |
| **8 错误与恢复** | `test_http.py`、`editing.spec.ts`、`resources.spec.ts`、`preview.spec.ts`、`timeline-media.spec.ts`、`integration.spec.ts` | 非法时间、空正文、NaN/Infinity、畸形文件与转换后零时长逐字段报告，失败无半份工程/部分替换。Windows 实际共享文件锁使原子写失败，旧文件完整且可解锁重试；未知版本、损坏文件及失联媒体保留数据。延迟、反序或丢失回执不确认新草稿/覆盖新版本。后台资源登记与 PUT 共存不丢字幕，工程切换丢弃旧回执；三个媒体生成的“等待保存→刷新→晚回执”均复验。组合链另外实际注入 500、保留页面和旧磁盘状态、点击重试恢复。 |
| **9 媒体** | `test_preview.py`、`test_timeline_media.py`、`preview.spec.ts`、`timeline-media.spec.ts` | 真实 FFV1/PCM MKV（9秒、320×180/25fps、PTS +5秒），Edge 确认无画面，再由实际 FFmpeg 生成 H.264/AAC。1/5/8.5秒解码 canvas 红/绿/蓝与 Web Audio 440/880/1320Hz、字幕一致；3/7秒黑场/静音及 +500ms 音轨延迟、无音轨单独验证。真实脉冲波形/JPEG 对齐时间刻度，1×/2×/8× 和多视宽、缩放/滚动可见请求。Range 206/416；重开/服务重启复用；源/参数/产物变化失效。真实缺 ffmpeg、错配真实 ffprobe 转码失败，不发布产物，修复后 UI 重试成功。54秒快任务允许直接成功；240秒1920×1080移动原片仍有递增的真实帧数百分比、中间进度条、活动去重、未完成资源 409，保留票12进度修复。最新原始 JSON/JPG 另存 `ticket-13-regressions/`，不是引用旧执行。 |
| **10 规模与交付** | `long-film.spec.ts` 两用例、`launcher.spec.ts`、`test_launcher.py`；手动面板 | 实际7200秒视频、4000条、26人物：加载、全文搜索、列表至片尾、256×时间轴、横纵滚动、卸载/重挂载、同轨重叠、播放中改字、结构撤销、人物改名、保存重开和四格式全量文件；删除10条后一步恢复全部身份/元数据。`start.cmd` 从非checkout目录真正启动并自动打开 Edge，不由测试 `goto` 冒充；观察启动器打开的页面和错误说明。README 已补完整依赖、路径、启动/故障、菜单/按钮/快捷键和所有可重跑命令。见下方实测与启动/手动证据。 |

### 高风险组合链（不仅单票断言）

- `integration.spec.ts`：JSONL 重复来源索引/元标签 → 人物重排 → 总览/人物双视图去重 → 批量换轨/统一归属并撤销 → 搜索隐藏中间条阻止合并 → Shift 全体连选 → 明确跨人合并 → 拆分/来源继承/一步恢复 → 无效时间阻止导出 → 保存500/旧版本完整/重试 → 独立另存为 → 保存重开 → 四格式实际文件及 SRT 元标签。原输入文件逐字未改。完整公开快照与输出保存在 `ticket-13-combination.json`。
- 媒体链重新运行 `preview.spec.ts` + `timeline-media.spec.ts` + 两个真实媒体 HTTP 模块：不兼容原片 → 实际转码 → 多点音画字幕 → 原片波形缩略图 → 切换副本不移动证据 → 参数切换/重开缓存 → 真实工具失败/保存继续/重试；同时覆盖等待保存、刷新、旧 GET、后台完成、工程切换回执。旧票 11/12 的竞态与真实帧数进度不是靠文档复读认定。

## 规模观测口径

原始数据：[`ticket-13-scale.json`](ticket-13-scale.json)。视频为真实 7200秒 H.264/AAC MP4，160×90 / 1fps、连续440Hz音频；这是时间范围/工程规模夹具，不代表4K高码率电影。字幕4000条（多行、原序号倒序、重复原来源索引、元标签），24普通人物 + 两特殊轨。另一个4000条夹具专测同时间同人物重叠及虚拟框选。

- “冷加载”只明确清除了 Edge HTTP cache；新建 fixture/import 已读过媒体，**没有清空 Windows 文件缓存**，不能称真正磁盘冷启动。
- 加载值包含文件菜单、读取工程列表、打开及首条可操作；热重开还包含页面 reload。搜索包含 Playwright 输入与可见断言；输入值包含点击播放到填字完成；显式保存包含 UI点击、提交、HTTP、服务校验及回执。它们是端到端观察，不是纯组件耗时或吞吐基准。
- 在“适合全片”和256×编辑视图分别记录 requestAnimationFrame 帧间隔及 Long Tasks；这反映 UI 调度，**不是视频解码帧率**。小夹具只有1fps画面，实际声音持续播放、currentTime递增且编辑时 `paused=false`。
- 原始帧样本、实际DOM数和输出路径保留；不以单次小数数字承诺跨硬件 SLA。不做连续两小时耐久播放或人工音质鉴定声明。

本轮最终构建的一次端到端实测（不是多轮平均或性能门槛；未隔离系统其他负载）：

| 观察 | 实际值 |
| --- | --- |
| 清浏览器HTTP缓存后打开工程至首条可操作 | 1377 ms |
| 页面reload后热重开 | 1436 ms |
| 搜索第2400条至可见 | 94 ms |
| 点击播放至完成正文填入 | 41 ms |
| 显式保存至服务回执“已保存” | 484 ms |
| 全片视图已挂载列表 / 字幕块 | 6 / 1232（完整数据4000条，两种轨道视图不是两份数据） |
| 全片播放采样355帧，UI rAF间隔中位 / P95 / 最大 | 5.6 / 11.2 / 22.2 ms，采样窗口无Long Task条目 |
| 256×播放中编辑/保存采样496帧，UI rAF间隔中位 / P95 / 最大 | 5.6 / 5.6 / 38.8 ms，采样窗口无Long Task条目 |

汇总：[`ticket-13-scale-summary.json`](ticket-13-scale-summary.json)；原片实际ffprobe及SHA-256：[`ticket-13-long-media.json`](ticket-13-long-media.json)，文件24,882,620 bytes、时长7200.000秒，非伪造duration字段。rAF统计使用原始采样最近秩P95；短采样无Long Task不等于所有操作都无延迟。冷/热值包含不同导航过程，热值不比冷值小也没有改写数据。

## Windows 与手动观察

- [`ticket-13-launcher.json`](ticket-13-launcher.json) / [`ticket-13-windows-launch.jpg`](ticket-13-windows-launch.jpg)：实际 `.cmd` → PowerShell → Python 服务 → Python webbrowser 打开 installed Edge 独立窗口，workspace 路径含空格/中文。测试连接该已打开窗口观察 UI，不主动导航代替打开。无 Python 的启动退出码1、错误指向 `WEBUI_PYTHON`；临时无依赖 Python 与未构建副本分别有实际失败检查。
- [`ticket-13-manual.json`](ticket-13-manual.json) / [`ticket-13-manual-long-film.jpg`](ticket-13-manual-long-film.jpg)：另外通过 OpenChamber 浏览器面板实际预览并创建4000条**普通SRT**工程，搜索2400、点击定位01:09:58.250、修改多行、保存并导出4000条说话人SRT；画面与工作字幕叠加目视检查。手动面板没有声称完成听感验收。该服务18764已关闭。
- 音画的主要客观证据为 Edge 实际 canvas / Web Audio 样本、HTTP媒体解码、真实SVG峰/JPEG时间坐标，不用截图冒充音频测量。
- 本轮Edge实际采样：1秒红帧 `[254,0,0]` / 430Hz、5秒绿帧 `[0,254,0]` / 870Hz、8.5秒蓝帧 `[0,0,255]` / 1320Hz；原始目标440/880/1320Hz，公开验收允许20Hz窗口测量偏差，并检查实际能量。不是把目标频率当作测量值。真实缩略图进度依次出现19/40/71/105/143/169/208/240帧，最终240帧，登记/验证完成前保持99%，而非假时间进度。

## 边界与残留

- FFmpeg转换、字幕保存和所有UI测试均只使用独立工程/自建素材；输出、fixture和工作树保留，不删除生产数据、不推送。
- Windows Python3.10 Proactor 在浏览器取消长视频 Range 连接时有时记录 `ConnectionResetError: WinError 10054`；这是服务端断连日志，未发生页面脚本错误、字幕丢失或保存失败，后续请求及测试继续通过。未为了隐藏它改事件循环或放宽验收断言。
- 默认路径、离线编辑、原片身份及缓存失败语义沿用既有公共契约；源片失联不等于丢工程，失败产物不当缓存。MOSS/SRT 交换文件不宣称完整工程往返。
- 集成分支合并确认和测试统计记于本票 Comments，交付提交见 `feat/webui-13` 的Git历史及完成回复；未把本功能合回集成，最终Spec审查由主代理执行。
- 完成前 `git merge feat/webui` 返回 `Already up to date`，祖先检查通过，集成仍为4546e57。18761、18764及最新自动启动52733/DevTools52734均无监听；也检查先前失败运行的56811/56812，无残留本轮WebUI服务进程。工作树、测试素材及输出保留；没有推送或合回集成。
