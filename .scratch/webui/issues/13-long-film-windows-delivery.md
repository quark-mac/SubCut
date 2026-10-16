# 13: 长片体验与 Windows 交付验收

Status: done
Blocked by: 05, 08, 09, 12
Spec: [WebUI 字幕与说话人编辑器](../spec.md)

**What to build:** 用户按安装说明在 Windows 启动完整编辑器，对整片时长和数千条字幕连续校对，滚动、搜索、播放中编辑、保存和导出均保持可用，获得可重复运行的交付版本。

## 上下文与修改范围

- 对应用户故事 1、64，并验收规格所有功能组合后的闭环。
- 直接前置是人物管理、结构编辑、试听工作区和波形缩略图；这些依赖的传递闭包覆盖其余功能任务。
- 修改 WebUI 长列表/时间轴可见范围渲染、交互性能、启动与安装说明及集成测试。仅处理本功能的整合问题，按各前置任务既有接口保持行为兼容。

## Acceptance criteria

- [x] 长列表和时间轴按可见范围工作，播放位置更新不会持续重建整片全部条目；滚动和缩放后选择、错层及手势命中保持准确。
- [x] 用整片时长、数千条字幕和多个说话人的工程完成加载、搜索、横纵滚动、缩放、播放中编辑、撤销、保存重开与导出，不出现条目丢失或长时间失去交互。
- [x] 记录素材规模、浏览器、硬件、冷/热缓存条件以及加载、编辑响应和保存的实际观察；发现明显阻塞时修复并重测相关场景，不以未经测量的性能数字宣称通过。
- [x] 完整流程覆盖普通 SRT、带标签 SRT、JSONL、MOSS JSON，验证多轨编辑、人物管理、批量操作、结构编辑、来源保留、保存重开及四种导出。
- [x] 完成真实不兼容视频的预览生成与播放，叠加字幕、波形、缩略图及定位一致，缓存复用和失败恢复可观察。
- [x] 提供实际可用的 Windows 一键启动入口、依赖安装及媒体工具检查说明；安装后启动本机服务并打开浏览器，启动失败给出可理解原因。
- [x] 工程与缓存的默认位置、导出方式、素材重新定位、快捷键及测试运行方式写入使用说明；所有按钮和菜单对应已交付行为。
- [x] 运行规格列出的十组验收场景及已有公共测试入口，完成前端类型检查/构建、相关 Python 编译检查，并保存实际执行证据。

## Verification

1. 按安装说明在独立临时工作区运行 Windows 启动入口，使用自建短素材执行可重复的完整浏览器/HTTP/真实媒体闭环。
2. 使用可复现的长片规模字幕夹具及代表性媒体，记录规模与环境，实际进行持续滚动、缩放、播放中编辑、结构改动、人物操作和持久化检查。
3. 对照规格十组验收场景逐项记录结果；需要人工观察的播放和布局检查保留说明或截图，将命令、输出及修复后复验结果写入 Comments 或其引用的验证记录。

## Comments

- 2026-10-16 恢复：唯一写入代理在干净ticket-13工作树执行 `git merge feat/webui`，快进至集成失败记录 `8613300`。重新置in-progress并撤销受阻项勾选；加载diagnosing-bugs/TDD，沿用既定浏览器/公开HTTP/Windows Shell接缝诊断Explorer空路径和波形生成POST丢失，旧的81全绿不替代本轮验收。

- 2026-10-16：在独立 `feat/webui-13` 工作树开始；干净基线 `4546e57`，与 `D:\whisper-diarization` 的 `feat/webui` 一致，01–12 均 done。沿用 spec 已确认的真实浏览器、公共 HTTP、CLI/实际文件接缝，TDD 从整片可见范围与连续编辑闭环开始。最终十组验收将另存持久报告，spec 状态留待最终审查。
- 2026-10-16 完成：列表窗口化、时间轴双向可见块、按完整布局的跨视窗框选；缓存排序/播放重叠查询/人物计数与媒体证据渲染。4000按钮红灯→窗口化转绿；额外长人物名红灯复现DOM行高与虚拟坐标错位，固定行高并保留完整名称提示/无障碍标签后转绿。无依赖临时Python红灯→启动器给出准确安装命令。首次完整启动清理的taskkill竞态未算通过，保存失败日志，改为终止本次日志PID并验证服务/DevTools端口关闭后复验。
- 最终运行（相同最终构建、真实Edge `155.0.4283.45`）：`npm ci`、`npm run typecheck`、`npm run build` 通过；`npm run test:browser` **81 passed (6.1m)**；`D:\whisper-diarization\env\python.exe -m unittest discover -s webui/tests -p 'test_*.py' -v` **40 passed / 33.223s**；全部 **17** 个WebUI Python文件编译退出0。完整现有HTTP、真实FFmpeg、票11/12晚回执/保存切换/帧数进度、快速任务均重新运行。
- 持久十组矩阵、命令、素材/硬件/缓存口径、红绿过程与限制：[验收报告](../../../webui/tests/evidence/ticket-13-acceptance.md)。机器可读完整验证/源文件摘要：[verification](../../../webui/tests/evidence/ticket-13-verification.json)；浏览器/HTTP/构建原始日志均在同一目录。新组合链涵盖来源元标签→人物重排→双视图去重→批量→筛选结构→保存故障重试→独立副本→四格式；实际2小时/4000条/26人物文件全量不丢，另覆盖虚拟卸载后框选、真实拖动和长名布局。
- 实测：清浏览器HTTP缓存后的打开1377ms、热重开1436ms、搜索94ms、播放到填字41ms、显式保存484ms；OS缓存未清，不把1fps合成片冒充高码率电影基准。原始rAF样本、20份本轮前票媒体/编辑回归证据、独立Windows自动开窗及手动长片SRT编辑截图均保留；历史票证据未被本轮覆写。
- 完成前执行 `git merge feat/webui`：`Already up to date`；核对集成祖先为 `4546e57a962e75eeb5a96fd7a3ecdc38b379bb13`。仅交付 `feat/webui-13`，不合回集成、不推送；保留全部工作树和自建素材。18761、手动18764及启动/故障辅助服务均已结束，无本轮WebUI服务进程残留。spec仍留待主代理最终code-review后闭环。

### 2026-10-16 集成复验：已快进合并，两个浏览器回归阻塞

- 合并前集成目录 `D:\whisper-diarization` / `feat/webui` 为 `4546e57a962e75eeb5a96fd7a3ecdc38b379bb13`，任务工作树 `ticket-13` / `feat/webui-13` 为指定 `10d5e636fe40525b9ae9897c78cb567e77ad5594`；两者干净，票为 done，祖先与 `git diff --check` 通过。差异仅涉及 WebUI 与本票。实际读取 acceptance 十组矩阵、verification、源码及回归/启动/长片证据；独立核对 verification 内 25 个源文件 SHA-256 全部匹配，原最终日志和 passed JSON 一致。
- 核对 Windows 测试确实从非 checkout 目录运行 start.cmd，经 webbrowser 自动打开独立 Edge，而不是测试主动 goto 替代；新增长片/组合链与 CLI 失败说明的实际接缝符合记录。媒体/缓存及票 11/12 请求代次修复未被改动，依赖清单和锁文件未变。Spec 与基线无差异，仍为 ready-for-agent，不在本次标 done，也没有启动最终双轴 code-review 或代理。
- 执行 `git merge --ff-only feat/webui-13`，成功从 `4546e57` 快进至 `10d5e63`。复用已有前端依赖与指定 Python；所有 shell 显式使用集成目录为 workdir。以下为本轮实际结果，不以任务工作树先前 81 全绿替代：

```powershell
npm --prefix webui/frontend run typecheck
# 通过。
npm --prefix webui/frontend run build
# 通过；Vite 7.3.7，49 modules；JS 260.72 kB / gzip 83.90 kB。
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& 'D:\whisper-diarization\env\python.exe' -m py_compile $Files.FullName
# 17 个 Python 文件通过。
& 'D:\whisper-diarization\env\python.exe' -m unittest discover -s webui/tests -p 'test_*.py' -v
# 40/40 通过，32.939s；HTTP 26 + preview 7 + timeline-media 5 + launcher 2，无跳过。
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm --prefix webui/frontend run test:browser
# 79 passed / 2 failed（6.8m），退出码 1，无跳过、无重跑，不能报告 81/81 通过。
# 后端及浏览器命令实际使用 2>&1 | Tee-Object 保存日志并透传原退出码。
```

- **失败 1**：`webui/frontend/tests/resources.spec.ts:205`，真实 Explorer 验证已收到 opened:true/正确目录回执，但 Shell.Application 枚举包含 path:null，测试调用 `w.path.toLowerCase()` 抛 TypeError。未完成该用例窗口/实际文件一致性断言，不据回执或旧证据宣称本轮通过。失败工程 `c0a072b4-5231-4f5a-83ee-86c4848b1f1a`，导出 `fa800920-75c5-46b1-9581-24e895f5a9db`；finally 已执行，独立枚举该工程 exports 目录窗口数为 0。本轮未写新的 ticket-10-export-location JSON/JPG，这两个已提交文件仍是历史证据。
- **失败 2**：`webui/frontend/tests/timeline-media.spec.ts:177`，用例“晚到旧 GET 不能覆盖新密度任务，晚到完成与自动保存回执不能覆盖其他工程草稿”。切换精细波形并捕获旧 GET、点击生成后，等待 POST waveform 回执超出 30000ms；快照仍无波形任务状态/派生产物。失败工程 `f640cbbd-7d19-4787-b8d4-abc1692b5919`。根因尚未确定，未将其归为已知无害、未修改实现或延长超时，也未重跑覆盖失败。
- 本票新增组合链、真实 Windows 启动和三个长片用例全部通过。启动证据为集成 start.cmd、独立 56581 服务/56582 DevTools、日志 PID32824，观察真实自动开窗；最终两端口均无监听。cleanup 的 shell status128 为进程已退出，不代替公共端口检查。本轮未重新执行任务工作树的 OpenChamber 手动验收，仅核对其已有说明/证据。
- 本轮实际长片为 7200 秒 / 4000 条 / 26 人；ffprobe 独立确认 H.264 160×90 / 1fps + AAC，24,882,620 bytes。四格式导出实际存在且各 4000 条，来源/修改/撤销/重开断言通过。端到端单次观察：清浏览器 HTTP 缓存后打开 846ms、reload 热重开 824ms、搜索 99ms、播放至填字 49ms、显式保存 491ms，适合全片挂载列表 6、字幕块 1232。未清 OS 缓存，不是高码率电影性能基准、纯组件计时或连续两小时耐久播放结论。新 scale JSON、实际文件和截图保留；已核看长片截图。
- 票 11 旧 GET/new small 回归通过，本轮工程 `bfc03d26-6a0c-4c4e-af36-44e0eb0d8ca3` 最终加载任务 `36e1ffa5-808e-4c17-902f-b46cb31bfdcd`、宽度 320。票 12 的真实帧数持续进度、快速完成、等待保存刷新，以及原片时间/延迟音轨/缓存回归通过；不将这些通过扩展为上述失败的密度回执用例通过。
- 浏览器日志有 5 次 Windows Proactor ConnectionResetError / WinError10054，对应其他用例仍通过，未隐藏日志。PowerShell 对普通 stderr 的 NativeCommandError 包装不是测试结果；本轮以真实 40/40、79/2 和退出码为准。
- 失败 `.last-run.json`、两个 error-context/trace、完整日志、票 11 竞态附件、两个失败工程快照、24 个自动改写证据及本轮长片 ffprobe 结果，已归档至被忽略的 `webui/frontend/.test-workspace/ticket-13-integration-failure/`。日志原件为 `.test-workspace/ticket-13-integration-{backend,browser}.log`；实际工程/素材/输出保留。仅恢复本轮自动改写的已跟踪证据到合并版本，恢复后工作树干净，再仅追加本段并独立提交，不覆盖旧票失败/通过归档。
- 最后检查 18761/18762/18763/18764、56581/56582 均无监听，无 WebUI Python、ffmpeg/ffprobe 或本轮独立启动 Edge 残留；测试目录 Explorer 窗口数为 0。保留全部工作树、未推送、未启动代理。**票 13 已合入但本轮集成验收被上述两项阻塞；顶部 done 是原任务工作树验收状态，Spec 保持非 done，待修复复验和最终双轴 review。**

### 2026-10-16 集成阻塞恢复完成（覆盖上一段未修复状态，保留其失败历史）

- 唯一写入实现代理仅在 `ticket-13` / `feat/webui-13` 工作；开始先合入 `feat/webui`，从10d5e63快进至指定集成 `8613300a33a11e2fe9e3a2835a8649febe0a8721`，改票为in-progress并撤销受阻项勾选。加载diagnosing-bugs/TDD，无代理/新会话；完成前再次 `git merge feat/webui` 为Already up to date。没有将修复合回集成或推送。
- 诊断与验收主报告：[恢复报告](../../../webui/tests/evidence/ticket-13-integration-fix/acceptance.md)；更新后的十组报告 `webui/tests/evidence/ticket-13-acceptance.md`、机器摘要 `webui/tests/evidence/ticket-13-verification.json`。原集成79/2日志、媒体快照与旧81/40摘要仍保留，不以重跑掩盖失败。
- Explorer原用例稳定红于path:null；固定null/空枚举边界、过滤后又真实红于目录未导航。含中文/空格目录的实际Windows同机对照表明os.startfile返回成功但空地址/Busy，显式系统Explorer /n导航能读到精确目标路径。兼容空路径并修复导航；绿灯仍验证真实HWND、导出文件内容及资源状态，不用opened:true替代。
- 波形原用例单跑曾过，未据此关闭。新增可控真实HTTP回执与真实鼠标回归先红：按下后媒体信息返回使按钮位移20.390625px，松开落到SELECT，零POST；新布局固定操作区，异步详情定高可滚动/可键盘聚焦，相同矩形不变、down/up/click完整、一次5ms波形POST及实际SVG/产物。未改超时、未改为pointerdown提交。原trace.zip截断，未声称可回放原失败每个pointer事件。
- 完整后端另捕获任务JSON读/替换WinError5竞态；共享轮询诊断加HTTP状态断言，新增六路公共HTTP轮询在旧实现先红500/storage_error。所有任务write与get共用原RLock后，同一回归及原缓存/重启测试转绿；保留真实帧数进度算法、代次及等待保存意图逻辑。
- 实际针对性绿：浏览器原两项+新点击回归3/3（14.0s）；HTTP并发轮询+原缓存测试2/2（5.435s）。最终全套真实Edge **82/82（6.3m）**、HTTP/媒体/CLI **41/41（34.763s）**，无跳过/重试；npm ci/typecheck/build逐项退出0、17个Python文件编译退出0。摘要记录63个源/测试/配置文件原始及LF归一化SHA-256、实际JS/CSS产物哈希。Windows Proactor取消Range仍有WinError10054，原日志保留，未放宽页面/保存断言。
- 票11/12晚到GET、质量/密度、等待保存刷新、晚任务/保存回执与工程切换、240秒1080p真实帧数中间进度、54秒快速完成均在最终全套复验。28份本轮跨票证据独立保存在 `webui/tests/evidence/ticket-13-integration-fix/regressions/`，清单带SHA-256；已提交前票与首轮证据恢复原样。
- 十组验收、完整组合链、三个长片与真实Windows自动开窗全部再次执行。实际7200秒/4000条/26人物；本轮打开1399ms、热重开1452ms、搜索103ms、播放到填字45ms、保存497ms。仅清浏览器HTTP缓存，未清OS缓存，仍非高码率电影或连续两小时耐久基准。补充OpenChamber真实页面布局/解码画面检查与截图，不冒充音频鉴定或Edge自动化结果。
- 本轮独立启动62183/DevTools62184已关闭；补充手动服务PID19504停止。清理JSON确认18761/18762/18763/18764/62183/62184/56581/56582无监听，无ticket-13 Python/ffmpeg/独立Edge残留；保留素材/输出/工作树，不关闭用户预存Explorer或共享浏览器面板。全部标准重新勾选，票恢复done；**spec仍ready-for-agent，等待主代理最终code-review与集成闭环**。
