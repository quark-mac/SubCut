# 03: 多格式字幕交换与整体替换

Status: done
Blocked by: 02
Spec: [WebUI 字幕与说话人编辑器](../spec.md)

**What to build:** 用户通过导入预览明确选择字幕解释方式，导入现有项目或 MOSS 结果进行校对，导出所需格式；在工程中整体替换字幕后可以一键撤销。

## 上下文与修改范围

- 对应用户故事 10–14、46、57–61；依赖 02 的可撤销编辑和保存。
- 修改 WebUI 字幕格式适配、导入/导出交互、公共服务边界与测试。现有 SRT 解析器要求说话人前缀，普通 SRT 必须通过适当适配处理。
- 来源索引、MOSS 段 ID、工程条目身份和导出序号是不同概念。

## Acceptance criteria

- [x] SRT 预览可选普通、本项目方括号标签、MOSS 冒号前缀三种模式；普通模式保留方括号和冒号正文，项目模式解析说话人及已知元标签，MOSS 模式按明确选择解析。
- [x] normalized JSONL 导入保留正文、说话人、元标签和原来源索引；秒制输入转换为毫秒，非法值及换算后零时长报告错误。
- [x] MOSS JSON 接受 id/start/end/speaker/text 顶层数组；人物 ID 原样建轨，导入 ID 留作来源，不虚构显示名映射或 ASS 来源索引。
- [x] `?`、`NONSPEECH`、组合标签及其他名称保留原意；多行和合法时间重叠不丢失。
- [x] 全部解析和校验成功后才应用导入；畸形条目给出位置、字段、原因，失败不部分替换工作字幕。
- [x] 整体替换的字幕、来源和说话人引用作为一个编辑操作提交，撤销完整恢复原状态，重做及保存重开结果一致。
- [x] 四种导出均可从 UI 触发：默认干净说话人 SRT、普通 SRT、项目 JSONL、MOSS JSON；导出快照不混入稍后的编辑。
- [x] SRT 确定性排序、连续编号，元标签由显式选项保留；JSONL 保留来源和元标签；MOSS 输出五字段数组、唯一段 ID 和当前标签。
- [x] 资源区显示真实导出产物；无法表达完整工程信息的格式不用于替代完整工程保存。

## Verification

1. 使用含 `[笑声]`、冒号、多行、未知标签、组合标签、元标签和重复时间的夹具，分别检查三种 SRT 模式及两个结构化格式。
2. 浏览器整体替换、撤销、保存重开，再导出四种格式；通过实际文件确认来源索引未被重新编号改写、MOSS 输出可重新导入。
3. 通过 HTTP 验证原子导入、非法输入及导出快照；运行已有测试入口与相应类型/构建/编译检查，并在 Comments 记录证据。

## Comments

- 2026-10-15：开始实现。指定工作树 `ticket-03` / `feat/webui-03` 初始干净，HEAD、集成 tip 和 merge-base 均为 `5eee44c94d21b3cffc37a23b2a8c3d209a868911`；前置 02 done。加载 TDD，沿用规格已确认的真实浏览器与公共 HTTP 测试边界，逐片红绿。核对真实 `sub/_srt_io.py` 与 MOSS export 源码。仅本票与 WebUI 子系统写入，无其他代理。`npm ci` 成功，26 packages / 0 vulnerabilities。

### 实现与实际红绿记录（2026-10-15～16）

- 先读项目 AGENTS、三份 agents 约定、规格/本票/README、GLOSSARY、WebUI 设计和两份 ADR，以及外部只读研究指针；另外核对真实 `_srt_io.py`、两条 normalize 的来源赋值、Gemini 最终标签 resolver、MOSS `subtitle/models.py` 与 `export.py`。生产代码无改动。
- SRT 三模式 HTTP 测试先红：`format` 返回 422/extra inputs；扩展显式格式后转绿。JSONL/MOSS 测试先红：JSONL 被当成 SRT 序号；结构化边界实现后转绿。项目 SRT 的单数字小时和无空格箭头先红，兼容生产输入时间语法后转绿。
- 原子应用测试先红：PUT 不接受 `subtitle_sources`；来源、人物与条目一起验证/保存后转绿。错误来源引用的整次请求被拒绝，旧工程不变；公共 PUT 可完整恢复原条目/人物/来源。
- 四格式输出测试先红：`keep_tags` 不支持；实现后通过实际文件与 HTTP 下载验证，额外使用真实生产 `parse_srt` / `parse_jsonl` 读取导出。输出重新编号仍保留 `[91, 0, 91]`，不去重/排序原来源；SRT 缺少来源不回填，MOSS ID 单独保存。
- 错误测试实际发现超大 JSON 数字 `10**400` 和 SRT 上标数字 `²` 导致 HTTP 500；修正为带位置/字段/原因的 422。覆盖反向/越界/负时间、NaN/Infinity、布尔/字符串时间、毫秒换算后零时长、空正文、畸形 JSON、非法 tags/来源索引、MOSS 顶层错误和缺失前缀；失败不创建或部分替换。
- 浏览器替换测试先红：找不到“替换字幕”；接入现有 `useProjectSession.commit` / history / autosave 后转绿，验证一步撤销恢复所有原 UUID、人物、来源和 tags，重做恢复同一批新 UUID，保存重开一致。无效/取消预览不进入历史。
- 浏览器导出测试先红：没有“导出格式”；实现选项后从 UI 触发四种实际文件及显式 tags 开关。延迟回执期间继续编辑的原有快照测试保持通过，保存/导出共享修订队列；后续编辑不进入既有导出文件。
- 新建预览指纹测试先红：缺 `fingerprint`；加入文件内容、路径、格式、时长指纹后转绿。UI 新建时外部来源变化须重新预览；整体替换则应用已看到的完整快照，浏览器验证源文件在预览后改成 `[]` 仍准确应用原预览。
- 项目 SRT 仅连续前置 MULTI/MERGED 进入 tags；未知花括号起保留余文。MOSS SRT 明确采用首个 ASCII `: `。JSON 时间统一服务端 `round(seconds * 1000)`，半毫秒取最近偶数。MOSS 文件中的重复段 ID 只作为来源，输出使用工程条目 UUID 保证唯一。规则记录在 README。

### 最终实际命令与结果

所有 shell 显式 workdir；Python/Git 在指定工作树根目录，npm 在 `webui/frontend`。最终验证前完成要求的合并：

```powershell
git merge feat/webui
# Already up to date. 集成 tip 仍为 5eee44c94d21b3cffc37a23b2a8c3d209a868911。

& 'D:\whisper-diarization\env\python.exe' -m unittest webui.tests.test_http -v
# Ran 20 tests in 5.902s — OK，无跳过。
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& 'D:\whisper-diarization\env\python.exe' -m py_compile $Files.FullName
# 11 个 Python 文件编译通过。
npm run typecheck
# tsc --noEmit 通过。
npm run build
# Vite 7.3.7；31 modules；JS 208.24 kB / gzip 66.70 kB；通过。
$env:WEBUI_PYTHON='D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER='msedge'
npm run test:browser
# 15 passed (19.4s)。真实 Edge + 当前生产构建 + FastAPI，18761。
```

- HTTP 20 项含前票所有回归：开放人物、稳定身份、并发修订、未知版本/损坏文件、真实 Windows 共享锁导致原子替换失败和解锁重试；新增五格式、四实际输出、完整来源、原子替换、原始时间和错误定位。
- 浏览器 15 项含原有 11 项回归及 `exchange.spec.ts` 4 项，覆盖五种导入、完整替换/撤销/重做/保存重开、来源/元标签、四实际导出、MOSS 导出重导入、预览取消/非法输入/文件变化。`.last-run.json` 为 passed，生成工程与实际文件保留在被忽略的 `.test-workspace/`。
- WIP 自审覆盖 tracked diff 和新增 `exchange.spec.ts`、两张验收截图；改动范围仅 `webui/` 与本票。`git diff --check` 通过。

### 可视验收、产物与服务

- OpenChamber 浏览器实际打开 18761，指定新 tabId 完成快照/菜单重开/截图检查；未对既有 18762 页面执行编辑。另用真实 Edge **155.0.4283.45**、1440×1000 查看多行与同时间重叠字幕、四格式资源链接、已保存状态和来源预览；JS `pageerror` 数组为空，原片请求为 206。
- 已读取并检查 [四格式导出资源截图](../../../webui/tests/evidence/ticket-03-exports.jpg) 与 [JSONL 来源/标签预览截图](../../../webui/tests/evidence/ticket-03-import-preview.jpg)。额外截图脚本首跑因 Windows PowerShell 管道默认编码将中文 selector 变为 `??` 而失败；设置 UTF-8 OutputEncoding 后成功，不计作应用故障。
- 保留验收工程 `81404e48-91c1-4318-976a-56322b3cf6eb`：`C:\Users\machi\AppData\Local\Temp\opencode\webui-03-acceptance\projects\81404e48-91c1-4318-976a-56322b3cf6eb\`。其中实际输出为 `exports/c919351c-cec6-4f49-826e-25933a9dbbec.srt`（说话人）、`79f8abd4-f637-4d76-8097-927b49018068.srt`（普通）、`4e5f0961-2f1f-432b-86c1-90e78cc9ae56.jsonl`、`8751a0d2-8571-4a38-8d3b-f3365b9a58f3.json`。直接读取 JSONL 再次确认来源 `[91, 0, 91]`、tags、秒制时间、多行和连续 idx。
- 额外验收服务 18761 / PID 35436 在确认命令行后主动停止；最终测试服务也随测试退出，18761 已无监听。原有 **18762 / PID 36112** 演示服务保持运行。保留所有工作树与生成素材。

### 后续接口

- `POST /api/imports/preview` 新增 `format`，返回完整预览和 `fingerprint`；`POST /api/projects` 支持 `preview_fingerprint`。`PUT /api/projects/{id}` 是预览应用/保存的原子 HTTP 边界，新增可选完整 `subtitle_sources`，省略保留原配置。两条特殊人物的旧身份需保留，前端已按同名人物映射。
- `Entry.sources[]` 为 `{subtitle_id, index, source_entries, moss_id}`：输入序号、原来源关联、MOSS ID 分开，工程 UUID 独立。新增字段默认空值兼容旧 plain-srt 工程。后续拆分/合并须继承/组合来源关联与 tags，新增条目不虚构来源。
- `useProjectSession.commit` 仍提交一次完整不可变编辑；整体替换一次更新 entries/speakers/subtitle_sources。`persist()` 保存，`persist({format, keep_tags})` 捕获工程与选项快照串行导出。后续功能继续使用该历史和保存队列。
- `POST /api/projects/{id}/exports` 接受 format/keep_tags，默认 speaker-srt / false；记录格式、选项、来源修订，下载按实际扩展名和 MIME 类型响应。四格式均为交换产物，完整继续编辑仍用工程保存对象。
- 全部验收通过后标记 done；提交至 `feat/webui-03`，交由集成会话合入与复验。未合入 `feat/webui`、未推送、未启动其他代理。
