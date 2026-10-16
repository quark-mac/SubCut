# WebUI 最终两轴审查与修复

Status: 修复及本轮验收完成，等待独立复审；spec 仍为 ready-for-agent，不标 done。

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
