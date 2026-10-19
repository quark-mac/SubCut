# WebUI 最终两轴审查与修复

Status: done

最终结论：全部任务已集成，最终全套验收通过，Standards / Spec 独立复审均已关闭原发现。下文按执行顺序保留历史记录；最终闭环见文末。

2026-10-18 清理说明：用户随后批准删除已合并工作树并精简测试记录。本文旧路径和附件链接按当时现场保留；当前精选记录与历史附件恢复入口见 [证据索引](../../webui/tests/evidence/README.md)。主目录最终集成的原始日志已提取至 `webui/tests/evidence/final-integration/`。

## 范围与基线

- 初始审查 HEAD / 本修复干净起点：`5586f22`（`feat/webui`）。规划基线：`17b1aa8`。
- 唯一写入实现工作树：`C:\Users\machi\AppData\Local\Temp\opencode\webui-worktrees\review-fixes`；分支 `feat/webui-review-fixes`。
- 集成位置：`D:\whisper-diarization`；本任务不合回集成、不推送，保留工作树及旧证据。
- 已读 AGENTS、matt-skills/issue-tracker/domain、spec、WebUI README、设计及两份 ADR；使用 TDD，公共接缝沿用已确认的真实浏览器、HTTP、实际导出文件，不启动其他代理。

## Standards（独立轴，保持原顺序）

硬违反：0。

1. **P2 Duplicated Code** — `usePreviewCopy.ts:57–71` 与 `useTimelineMedia.ts:47–65` 及其读取/轮询重复，已经出现等待保存时的竞态策略分叉。修复目标：共用任务读取、轮询、提交生命周期，同上下文刷新不取消生成，上下文（工程/源/参数）变化取消；具体播放源及采样参数仍归各 hook。
2. **P3 可能 Divergent Change** — `App.tsx:110–195,349–404,441–471,524–538` 混合人物/字幕集合变换与 UI/HTTP/DOM 编排。限定修复：抽纯字幕结构与人物集合/替换映射，组件保留草稿、选择、错误定位与编排，不扩大布局或 HTTP 重构。

### Standards 修复映射

1. 已修复：新增 `webui/frontend/src/useMediaTask.ts`，统一快照读取、任务轮询、保存前置门禁、生成提交及过期回执处理。上下文代次只随工程/源身份/源路径/质量或密度改变；刷新仅改变读取代次。POST 前及确认后均使旧 GET/旧轮询失效；同上下文刷新不重置 submitting。两个原 hook 仅管理质量/密度、播放 src/解码或证据 URL，不再各自维护竞态策略。预览 key 补入原片 identity。
2. 已按限定范围处理：`speakerEditing.ts` 承载人物草稿名称校验、新建/更新、开放标签解析、排序、合并、删除转未知及替换字幕的人物身份/颜色映射；`structureEditing.ts` 承载新增、拆分、合并及完整来源/标签组合。身份由调用者一次分配；纯变换不访问 React/DOM/HTTP、不修改输入。App 仍处理草稿/选择/历史提交、错误焦点、播放暂停、对话框、HTTP 与布局，不另拆布局或网络编排。既有真实浏览器人物、结构、来源、撤销与组合链全部复验。

## Spec（独立轴，保持原顺序）

1. **P2 预览生成意图丢失** — spec 185–187、票11:19；`usePreviewCopy.ts:28–37,57–67`。修改字幕→生成→保存回执未到时刷新，同工程/源/质量未变却不 POST、无错误。浏览器确定性拦住实际 PUT 回执，刷新真实 GET 后释放保存；必须生成真实可播放副本。修复映射：Standards 1 的共享生命周期；继续覆盖质量/跨工程/媒体源变化取消。
2. **P2 SRT 成功导出不可解析正文** — spec 106–107、81、169；`formats.py:214–224`。`上句\n\n下句` / 纯空白分隔行会破坏 cue 边界。修复目标：两个 SRT 输出均返回条目级 text 错误，解释分隔歧义并推荐 JSONL；不登记坏导出、不改变合法工程正文、不删除换行、不改生产解析器。普通多行无空段通过，JSONL 精确保留空段，核对其他实际分隔情况。

### Spec 修复映射

1. 已修复：共用上述生命周期。`preview.spec.ts` 新增真实 PUT 已落盘但回执被阻拦→刷新真实 playback GET→释放 PUT→实际 preview POST/成功产物/Edge 解码检查。刷新后质量与生成按钮仍禁用，不能重复启动同一次保存等待。原有质量切换旧 GET、新任务、晚任务/保存回执与跨工程草稿用例保留；新增同工程原片重新定位、扣住新源 GET 时释放旧 POST 的用例，明确观察旧回执不冒充当前源状态，新 GET 返回后才加载有效副本。
2. 已修复：只在 `write_subtitles()` 的两个 SRT 分支检查正文按 CRLF/CR 归一化后的各行是否纯空白；归一化仅供判断，不改写正文。返回 422 / `entry`（排序后位置）/ `field=text`，解释空白行与条目分隔/换行丢失并提示 JSONL。覆盖中间空行、空格/Tab 行、全角空格行、CRLF、CR、首尾空行，共七种；每种均验证普通和说话人 SRT、失败前后工程/修订/资源登记不变、无输出文件、JSONL 精确保留原串。原普通多行和生产 `parse_srt` / `parse_jsonl` 兼容测试仍通过。工程合法性校验和生产解析器未改动；README 补充格式能力说明。

## 实际验证记录

- 初始 `git status --short --branch` 仅分支行（干净），`git log` 确认为集成 HEAD。
- `npm --prefix webui/frontend ci`：通过，26 packages，0 vulnerabilities。
- 初始完整 HEAD：`5586f22214f82e02d5bf85ffd7e59cdb7b2176c2`；规划完整基线：`17b1aa80931e0f3a81ebec11c35071d8383b467a`。

### 红绿过程及非产品失败（不覆盖历史）

- 预览红：`npm --prefix webui/frontend run test:browser -- preview.spec.ts -g '等待保存时同上下文刷新预览'`，真实 Edge 等不到 POST，30 秒超时；[红灯日志](../../webui/tests/evidence/final-review/preview-red.log)、error-context/trace 在同目录 `preview-red-results/`。共用生命周期后相同入口 **1 passed / 4.3s**，实际测试 2.1s；[绿灯日志](../../webui/tests/evidence/final-review/preview-green.log)。未延长超时或禁用刷新按钮。
- SRT 红：`D:\whisper-diarization\env\python.exe -m unittest webui.tests.test_http.ProjectHTTPTests.test_srt_rejects_ambiguous_body_separators_without_changing_saved_text_or_registering_export -v`，七种输入均实际返回 201 并登记坏导出，**7 failures / 1.189s**。最小输出校验后同测试及原普通多行/四格式产物两项 **3 passed / 2.044s**；[red](../../webui/tests/evidence/final-review/srt-red.log) / [green](../../webui/tests/evidence/final-review/srt-green.log)。
- 首次新增测试编译曾因前端 `Project` 传输类型没有 `media_artifacts` 而失败；改为与既有 HTTP 检查一致地读取真实响应后再开始红绿，不计作产品复现。
- 针对性五文件组原 33 项通过，另外两个新写“保存等待时切换质量”用例在 `select disabled` 处超时。该操作被既有 UI 明确禁止，非实际可达场景；保留 [targeted-browser.log](../../webui/tests/evidence/final-review/targeted-browser.log) 和 `targeted-first/test-results/`，撤下这两个新增的不可达测试，不强行解锁 DOM、不改产品规则。改为验证同上下文刷新保持禁用，并用可达的实际重定位/原跨工程及质量切换场景覆盖取消规则。没有删除或放宽任何原有回归。
- 最终全套后补用 JSON reporter 保存两个新场景的实际附件。第一次证据命令经 PowerShell stdin 将中文筛选串变成问号，正则编译失败、**0 tests**，不是测试失败或通过：`new-scenarios-command-encoding-error.json/.log` 保留。改从 UTF-8 测试源读取两个名称后执行，**2 expected / 0 unexpected / 0 skipped / 0 flaky，6.098s**；[JSON 原报告](../../webui/tests/evidence/final-review/new-scenarios-browser.json)、[保存/刷新实际任务与工程](../../webui/tests/evidence/final-review/preview-refresh-save.json)、[重定位回执](../../webui/tests/evidence/final-review/relocated-source.json)。
- 初期 PowerShell Tee 日志有 stderr 包装/编码损失；最终命令用 Python subprocess 将 stdout/stderr 原始字节直接写日志。未隐藏最终日志中的异常。

### 完成前合并与最终全套

在本修复 worktree 显式执行 `git merge feat/webui` → **Already up to date**；集成仍为 `5586f22`。以下均在此后、同一最终生产构建实际执行；所有 shell 使用修复 worktree 为显式 workdir，未合回 `D:\whisper-diarization`、未推送。

```powershell
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm --prefix webui/frontend run typecheck
npm --prefix webui/frontend run build
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& $env:WEBUI_PYTHON -m py_compile $Files.FullName
& $env:WEBUI_PYTHON -m unittest discover -s webui/tests -p 'test_*.py' -v
npm --prefix webui/frontend run test:browser
```

实际编译文件和完整 subprocess 参数见 [final-commands.json](../../webui/tests/evidence/final-review/final-commands.json)，最终构建/编译/后端/浏览器日志为同目录 `final-*.log`；typecheck 原始 stdout 因包含 EOF 空行，字节不变另存 `final-typecheck.log.zip`（解包即原日志），不为通过 whitespace 检查而改写证据内容。

| 入口 | 本轮结果 |
| --- | --- |
| npm ci | 通过；26 packages / 0 vulnerabilities |
| typecheck / build | 均退出 0；51 modules，JS `index-B1eVkF6x.js`，260.40 kB / gzip 83.76 kB |
| Python 编译 | 17 个 WebUI Python 文件，退出 0 |
| 后端 HTTP / 真实 FFmpeg 媒体 / 启动错误 | **42 passed / 34.056s**，无跳过 |
| 全套真实 Edge | **84 passed / 4.9m**，单 worker、无跳过/重跑 |
| 新场景 JSON reporter 补证据 | 2 passed / 6.098s，无跳过/重跑；生产源码未再改动 |
| git diff --check / git diff --cached --check | 源码检查通过；staged 全范围首次只报 typecheck 原始日志末尾空行，原字节 ZIP 归档后全范围通过；仅 Windows LF→CRLF 提示 |

### 规格十组验收本轮覆盖

| 场景 | 实际重新执行的公共入口 |
| --- | --- |
| 1 编辑闭环 | editing、exchange、integration：真实媒体、改正文/时间/人物、保存重开及四种实际文件 |
| 2 共享条目 | timeline、multiselect：总览/人物轨同一 ID、多选去重、导出不复制条目 |
| 3 换轨与重叠 | timeline、drag-timing、multiselect、long-film：边界拒绝、轨序、错层和跨视窗命中 |
| 4 结构编辑 | structure、integration、resources：严格内部拆分、完整集合连续合并、来源元标签、替换与恢复 |
| 5 历史 | speakers、structure、editing、multiselect：一步撤销/重做、原身份恢复、保存不清历史、重开重建 |
| 6 焦点与播放 | review、timeline、editing：原生文本快捷键、逐句/循环/变速、选择高亮分离、真实帧 |
| 7 格式 | exchange、structure、HTTP：五种导入、四种导出、真实生产 readers、正文空段错误与 JSONL 保留 |
| 8 错误与恢复 | HTTP、editing、integration：条目定位、外部文件锁、修订冲突、响应丢失/交错、失败重试 |
| 9 媒体 | preview、timeline-media、HTTP：真实不兼容 FFV1/PCM→H.264/AAC、画面/音频样本、PTS/延迟、缓存、帧数进度、旧回执、刷新等待保存 |
| 10 规模/交付 | long-film、launcher、resources：真实 7200s/4000条/26人物、完整导出、start.cmd 自动打开独立 Edge、实际 Explorer HWND/路径/文件 |

### 环境、实际产物、清理与证据完整性

- Windows 11 build 26200；Intel Core Ultra 7 251HX，18 核/18 逻辑处理器；可见内存约 15.7 GiB；Python 3.10.19；实际 Edge **155.0.4283.45**。原始硬件与清理记录见 [cleanup-environment.json](../../webui/tests/evidence/final-review/cleanup-environment.json)。
- 长片是自建 H.264/AAC、160×90/1fps、7200 秒，4000 条、26 人物。四格式真实输出各 4000 条、路径存在且摘要已记录。一次观察：清浏览器 HTTP 缓存后打开 **624ms**、热重开 **646ms**、搜索 **92ms**、播放中输入 **45ms**、保存 **489ms**；适合全片挂载列表行 6、字幕块 1232。未清 OS 缓存，不是高码率电影/4K 或连续两小时耐久播放基准，不承诺 SLA。
- 真实 Windows 启动从非 checkout 目录调用本工作树 `start.cmd`，启动器自动打开 Edge（非测试自行 goto 替代）；独立服务 **51849** / DevTools **51850**，日志实际请求新 JS/CSS。原 Explorer 与按住鼠标等待媒体信息的回归仍通过。
- 最终浏览器原始日志保留 **4 次** Windows Proactor / WinError10054 取消连接异常；全部页面/媒体/保存断言通过，未改事件循环或压制异常。
- 完整套件后及 JSON reporter 补证据后均检查 18761/18762/18763/18764/51849/51850 无监听，本工作树 WebUI Python/ffmpeg/ffprobe/独立 Edge 进程与 Explorer 目录窗口为零；最后记录为 [cleanup-final.json](../../webui/tests/evidence/final-review/cleanup-final.json)。不关闭用户预存窗口或共享浏览器，不删除自建素材、工程、缓存或输出。
- 测试改写的旧票证据 **27 份** 另存 [regressions](../../webui/tests/evidence/final-review/regressions/) 及 [SHA-256 manifest](../../webui/tests/evidence/final-review/regression-manifest.json)，再仅恢复这些本轮生成文件到初始 HEAD，旧失败/通过证据保持原样。针对性初次运行与红灯也各自保留，非覆盖式重跑。
- [verification.json](../../webui/tests/evidence/final-review/verification.json) 记录初始/规划/合并基线、最终受测 WebUI 源/测试/配置原始与 LF 归一化 SHA-256、实际构建产物及四种长片导出摘要。提交前独立核对 **67 个源/测试/配置摘要、3 个构建产物摘要、27 份归档摘要**全部匹配；旧证据与 HEAD（按 LF 归一化）一致，spec/生产路径无改动，集成 ref 未变。`final-browser-results/.last-run.json` 是完整 84 项全绿记录；新两项完整 JSON 报告另存，不覆盖全套记录。
- 本报告是对提供的两个独立审查轴的修复与实际验收记录，**不是独立复审结论**。Spec 保持非 done，后续由主会话安排独立复审及集成；本任务不再启动代理。

## 2026-10-16 独立集成验证：全套通过，等待独立两轴复审

本节仅记录集成工作树的实际合并与重新验证，**不是独立 Standards / Spec 复审结论**。Spec 仍为 `ready-for-agent`，不标 `done`，本次不启动代理或复审会话。

- 合并前 `D:\whisper-diarization` / `feat/webui` 为 `5586f22214f82e02d5bf85ffd7e59cdb7b2176c2`；`review-fixes` / `feat/webui-review-fixes` 为指定 `08a75301223c334bf49079b4493b482c3e343ccc`。两个工作树均干净，祖先与差异检查通过；已读本报告及票13 Comments。范围仅为 WebUI、审查记录和票13，无生产字幕路径/保护数据/依赖变更，Spec 无差异。
- 核对共享媒体任务生命周期、人物/结构纯变换提取及坏 SRT 导出拒绝的代码和红绿证据。预览红灯明确等不到 POST，绿灯生成真实副本；七种空段正文旧路径返回201并登记坏导出，修复后两个 SRT 均422、定位text且不登记文件，JSONL保留原串。保留不可达质量切换测试及命令编码错误的历史说明，没有以删除既有回归或增加超时换绿。工作树证据中67个源/测试/配置摘要、3个构建产物摘要、27份归档摘要独立核验全部匹配。
- 执行 `git merge --ff-only feat/webui-review-fixes`，成功从 `5586f22` 快进至 `08a7530`。所有 shell 显式使用集成目录为 workdir，依赖未变，复用已装前端依赖与指定Python。实际执行入口及结果：

```powershell
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm --prefix webui/frontend run typecheck
# 通过，退出0。
npm --prefix webui/frontend run build
# 通过，51 modules；JS 260.40 kB / gzip 83.76 kB。
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& $env:WEBUI_PYTHON -m py_compile $Files.FullName
# 17个Python文件通过。
& $env:WEBUI_PYTHON -m unittest discover -s webui/tests -p 'test_*.py' -v
# 42/42通过，34.159s，无跳过，退出0。
npm --prefix webui/frontend run test:browser
# 真实Edge单worker，84/84通过（6.2m），无跳过/重跑，退出0。
```

- 后端/浏览器通过Python subprocess按上述原参数执行，原始stdout/stderr字节直接保存为 `webui/frontend/.test-workspace/final-review-integration-{backend,browser}.log` 并透传退出码。浏览器 `.last-run.json` 为passed/空failedTests。集成实际源码67个LF归一化摘要及3个新构建产物摘要均与受测verification一致，不以修复工作树的84全绿替代本轮结果。
- 新预览保存等待期间同上下文刷新、原片重定位后旧POST回执隔离均通过；票11旧GET/new small、跨工程草稿、票12密度/保存刷新/帧数进度、并发任务读写和缓存继续通过。后端七种空段正文在两个SRT输出均拒绝、工程/资源不变、JSONL原串保留，原普通多行与四格式兼容通过；人物/结构/替换/历史全套通过。
- 独立核对本轮缩略图17/240、49/240等进度比例、240帧发布前99%及成功100%，ZIP完整SHA-256一致。Explorer本轮工程 `f2f99e47-9845-46ce-802e-f1b5ca1f7441` 的真实HWND399376、目标目录与实际导出一致；真实start.cmd从独立目录自动开Edge，服务54150/DevTools54151，日志PID31180并请求本轮新JS/CSS。退出清理的shell status128为目标进程已退出，最终端口检查另行完成。
- 长片与组合链通过，7200秒/4000条/26人，四种实际导出各4000条且存在；本轮打开1388ms、热重开1370ms、搜索96ms、播放输入44ms、显式保存485ms，适合全片挂载列表6行/字幕块1232，已核看本轮长片截图。仍限160×90/1fps合成片、仅清浏览器HTTP缓存而未清OS缓存，不声称高码率电影或两小时连续耐久基准，没有重做或冒充人工音画鉴定。
- 本轮日志保留3次Windows Proactor ConnectionResetError/WinError10054；相关断言均通过，不描述为零异常日志。原修复红绿和旧失败归档未覆盖。本轮passed JSON、完整日志、票11竞态附件和27个测试改写证据归档在被忽略的 `webui/frontend/.test-workspace/final-review-integration-verified/`，证据保留原相对路径于其evidence/下，实际工程/素材/产物均保留。仅恢复本轮自动改写的已跟踪证据到合并版本，恢复后干净，再仅追加本节并独立提交。
- 最后检查18761/18762/18763/18764/54150/54151无监听，无WebUI Python/ffmpeg/ffprobe或本轮独立Edge残留；测试工程Explorer窗口0。所有worktree保留、未推送、未启动代理。**集成验证通过，可安排独立两轴复审；Spec暂不done。**

## 2026-10-16 最终独立复审与 tracker 闭环

独立 Standards 与 Spec 审查会话均复用原会话，以 `moyuu/gpt-6.1-sol#high` 完成只读复审。核对集成 HEAD 为 `f75b9241ac18333af141075a3c09a22d14b0ab37`，修复提交 `08a75301223c334bf49079b4493b482c3e343ccc`。复审范围 `git diff 5586f22...HEAD`，沿用整体范围 `git diff 17b1aa8...HEAD` 及原规格、仓库标准；没有改代码或重跑测试。

### Standards 独立结论

- 文档硬违反：0。
- 原 P2 Duplicated Code / 媒体任务竞态策略分叉：**关闭**。两个媒体 hook 实际共用 `useMediaTask`；上下文 key 变化才推进生命周期代次，刷新不取消保存中的生成意图，POST 前后及读取/轮询均核验代次。依据：`usePreviewCopy.ts:14–15`、`useTimelineMedia.ts:12–14`、`useMediaTask.ts:22–26,34,49,59–80`。
- 原 P3 可能 Divergent Change / App 混合领域变换：**关闭**。`speakerEditing.ts:7–58` 与 `structureEditing.ts:12–33` 承载纯人物/字幕规则并被 App 实际调用；身份由调用方传入，变换不访问 React、DOM、HTTP，不修改输入。App 保留草稿、选择、历史提交和界面编排。
- 本次修复范围未发现新增文档硬违反、实质代码味道或确定性回归；共享 hook 有两个实际调用方，提取不是无需求抽象或纯转发层。

### Spec 独立结论

- 原 P2 预览生成意图被刷新吞掉：**关闭**。`useMediaTask.ts:22–41,59–75` 分离上下文和刷新读取；保存结束仍提交，工程/源/参数变化取消，旧 POST、GET、轮询被拒收。核对 `preview.spec.ts:148–219` 的真实保存门禁、刷新、生成、解码及重定位回执隔离，以及对应实际附件。
- 原 P2 空段正文成功导出坏 SRT：**关闭**。`formats.py:217–220` 只在两个 SRT 分支返回条目位置、text 字段、原因及 JSONL 建议；JSONL 原样保留正文。`app.py:279–281` 在序列化成功后才写文件、登记导出和增加修订。`test_http.py:246–270` 覆盖七种空段、两种 SRT、资源/文件不变及 JSONL 原串保留。
- 纯变换提取保留全体条目连续性、拆分全文、来源标签、特殊轨身份及归属迁移；App 仍以一次操作提交历史。本次修复范围未发现新增确定性规格问题或范围扩张。

### 完成记录

- Standards：原判断项 2，关闭 2，未关闭 0，新增 0；Spec：原问题 2，关闭 2，未关闭 0，新增 0。
- 最终集成实际验收沿用上节：后端 HTTP / 真实媒体 / 启动 **42/42**、真实 Edge **84/84**、typecheck/build、17 个 Python 文件编译均通过。独立复审后仅更新 tracker 文档，未改受测代码，未无理由重复全套测试。
- 主代理确认 `.scratch/webui/issues/` 的 13 票全部 `done`，全部任务和修复分支均已纳入 `feat/webui`；将 `.scratch/webui/spec.md` 标为 `done`。源码变化局限 WebUI，生产流程与保护素材未改动。
- 所有任务及修复 worktree 保留供检查；未推送远程。安装和启动见 `webui/README.md`，默认入口 `webui/start.cmd`。

## 2026-10-18 用户批准的收尾清理

- 重新只读核对全部 14 个目标分支均为 `feat/webui` 的祖先，独有提交为 0，无已跟踪文件未提交修改。票 01 唯一未跟踪截图与已提交历史附件 SHA-256 相同。
- 删除 `feat/webui-01` 至 `feat/webui-13`、`feat/webui-review-fixes` 及对应工作树；主目录保留 `feat/webui`，HEAD 仍为 `d742d30`。
- 原有 203 份验收记录保留 34 份，移除 169 份重复或低价值附件；从主目录最终集成归档和票 11/12 工作树提取 18 份重要原始记录并校验 SHA-256。最终结论、完整验收日志、关键红绿诊断及一张长片截图保留。
- 清理没有重新执行产品测试。原有测试统计仍对应历史受测提交；删除清单、分支 HEAD 和文件来源见 [cleanup-20261018.json](../../webui/tests/evidence/cleanup-20261018.json)，历史附件恢复见 [证据索引](../../webui/tests/evidence/README.md#historical-artifacts)。
