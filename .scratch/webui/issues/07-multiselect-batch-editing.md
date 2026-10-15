# 07: 多选与批量编辑

Status: done
Blocked by: 06
Spec: [WebUI 字幕与说话人编辑器](../spec.md)

**What to build:** 用户用 Ctrl 点选、Shift 连选或框选处理多条字幕，批量改人、整体移动时间、上下换轨和删除，且一次批量动作可以一步撤销。

## 上下文与修改范围

- 对应用户故事 34、41–45、52–53；依赖 06 的手势、坐标、边界限制和编辑提交。
- 修改 WebUI 选择模型、右侧共同属性、批量操作及相应测试。使用稳定条目身份区分数据，多个视图不增加数据份数。

## Acceptance criteria

- [x] Ctrl 点选、Shift 连续选择及时间轴框选有效；同一条目在总览和人物轨都被框住时只进入选择集合一次。
- [x] 修饰键点选与框选只改选择，不暂停或跳转播放头；普通单击沿用选中、暂停并定位的语义。
- [x] 右侧展示共同属性及混合值；明确选择目标说话人后所有选中条目统一归到该标签。
- [x] 批量横向移动保持相对时间和各条时长，到片头/片尾时整体停止，而非逐条截短或独立夹取。
- [x] 多选 ↑/↓ 按当前说话人轨顺序整体偏移一行，保持相对轨道间距；任何一条越界则整次不执行，不循环。
- [x] 批量鼠标移动继承单条手势的时间、归属及撤销规则，任何提交均保持有效状态；未选条目不受影响。
- [x] Delete 可删除单选或多选条目，正文输入时优先删文字；一次批量改人、移动或删除各算一步历史。
- [x] Esc 取消手势或清除选择；无效、取消及纯选择操作不污染历史。撤销恢复完整条目集合，保存重开保持结果。

## Verification

1. 以至少三个说话人、相同时间和重叠条目构造工程，验证三种多选方式、双视图去重及多选时播放头稳定。
2. 执行跨轨整体移动、越界拒绝、全归同一人、片头片尾时间约束和删除；通过 UI 与公开工程读取结果确认每条仅变更一次。
3. 验证批量操作的一步撤销/重做、输入框焦点及自动保存；运行回归和相应构建检查并记录结果。

## Comments

- 2026-10-16：唯一可写实现代理，`ticket-07` / `feat/webui-07` 初始干净，HEAD 与 `feat/webui` / merge-base 均为 `fcc327354c747a33e7467b9b0e62af6758c5e8f1`，前置 06 done。加载 TDD；测试边界沿用 spec 已确认的真实 Edge 手势与公共 HTTP 工程读写，不测组件私有状态。`npm --prefix webui/frontend ci` 成功，26 packages / 0 vulnerabilities。使用指定 Python 与 msedge，18761 为测试服务，保留 18762 演示。

### 实现与真实红 → 绿

- 选择以稳定条目 ID 的 Set 表达，列表/总览/人物轨共享；Shift 使用稳定时间排序范围，框选用滚动内容坐标命中 DOM 的条目 ID 并去重。修饰键选择不经过暂停/定位，框选支持追加、滚动与 Esc 恢复原选择。
- `BatchEditor.tsx` 显示共同/不同值，显式选择目标并点击应用才批量归属。键盘与鼠标共用 `selectionEditing.ts` 的当前轨道顺序偏移，任一条越界全拒绝。拖动先生成条目数组预览；时间偏移夹取所有选中条目的共同范围，吸附排除整个选择。释放一次 `session.commit`，Esc/无效/无变化保留历史和重做。删除完整条目可撤销；沿用自动保存队列和公共工程 schema，无后端或生产行为改动。
- 所有测试都从真实 Edge 手势及公共 GET 验证；逐切片先失败再实现：
  1. `-g 'Ctrl 跨视图'`：Ctrl 后第 1 条丢失选中（单选模型）→ Set + 跨视图修饰键转绿，验证视频 paused/currentTime、Shift 同时间稳定范围、HTTP 完全不变。
  2. `-g 空白框选`：期望选 2 条，实际 0 → pointer 矩形与滚轮坐标、ID 去重转绿；总览和甲轨同时覆盖相同两条，播放继续，Esc 恢复手势前 3 条选择，无历史。
  3. `-g 共同与混合`：缺少选择数量和共同属性 → 批量面板转绿。共同 1000/2000 ms、甲；混合时间/正文/归属明确“不同值”；选择目标不保存，点击应用后仅前三条归丙，一步撤销/重做及重开保持完整身份来源。期间补充 select 的准确 aria-label。
  4. `-g 多选上下键`：重排后 ↓ 没有修改选中集合 → 共用轨道偏移转绿。乙/甲/丙 顺序下甲→丙、乙→甲；顶部和 NONSPEECH 底部任一越界全拒绝，撤销重排后目标回到原顺序，无效动作保留重做。
  5. `-g 'Delete 单选'`：Delete 后首条仍存在 → 删除集合转绿。输入焦点仅删文字、Esc 取消草稿、无选择删除无历史；多删后一步恢复完整 tags/source_entries，重做、保存重开一致。首次测试定位使用了不适合现有嵌套 label 的 exact 匹配，修正定位后才记录上述行为失败。
  6. `-g 多选横拖`：按下拖动后多选面板消失（只拖单条）→ 条目数组手势转绿。+500 ms，向前夹到 0–1000 / 1500–3000，向后夹到 5000–6000 / 6500–8000；各次持针 750 ms 的 GET 仍为原状态，释放后一步历史，未选条目完全不变。
  7. `-g 多选纵斜拖`：时间可以移动但人物仍甲/乙 → 整体轨道偏移转绿。纵拖和 +500 ms 斜拖分别得到乙/丙；拖向 NONSPEECH 越界连同时间全拒绝，Esc 与手势中 Ctrl+S/Delete/↓ 不提交，重做和重开保持结果。
  8. 自查与 03 集成的 `-g 撤销整体替换`：撤销后仍出现“已选 0 条”，继续 Ctrl 点击残留旧 ID → 历史恢复时过滤失效 ID 转绿。先修正导入格式 select 的测试定位，再复现实际失效选择问题。
- 补充用例直接通过现有实现：无效正文的修饰键选择保持错误焦点，取消后继续多选；05 重排后的鼠标偏移；多选两端调整到共同合法范围（最短 1 ms）；2× 吸附、跨视图框选每条只移动一次、总览无归属目标不写历史。2× 测试初次框选起点在 sticky 标签下，改用真实横向滚轮回到片头后通过，未为该测试修改实现。
- 每轮使用 `$env:WEBUI_PYTHON='D:\whisper-diarization\env\python.exe'`、`$env:WEBUI_BROWSER='msedge'`，实现修改后 `npm --prefix webui/frontend run build`，再 `npm --prefix webui/frontend run test:browser -- multiselect.spec.ts -g <上列名称>`。本票共 11 项浏览器测试。前七切片完成后的全套回归 **40/40 passed**（2.2 分钟）；HTTP **21/21 OK**（6.079 秒）、全部 WebUI Python 编译通过。最终同步集成后的复验另记下方。

### 完成与集成基线复验

- 实现提交 `7acce02`（`feat(webui): add multiselection and atomic batch editing`）。提交后在 `ticket-07` / `feat/webui-07` 执行 **`git merge feat/webui`**，返回 `Already up to date.`；merge-base / 集成 HEAD 仍为 `fcc327354c747a33e7467b9b0e62af6758c5e8f1`。只读确认 `D:\whisper-diarization` 的 `feat/webui` 工作树干净。未合入集成、未推送，保留任务工作树。
- 同步检查后在任务工作树执行以下完整验证，全部通过：

```powershell
npm --prefix webui/frontend run typecheck
# tsc --noEmit 通过。
npm --prefix webui/frontend run build
# tsc / Vite 构建通过，35 modules。
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm --prefix webui/frontend run test:browser
# 44/44 passed，2.5 分钟；本票 11 项以及全部既有 33 项，无跳过。
& 'D:\whisper-diarization\env\python.exe' -m unittest webui.tests.test_http -v
# 21/21 OK，6.262 秒，无跳过。
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& 'D:\whisper-diarization\env\python.exe' -m py_compile $Files.FullName
# 11 个 Python 文件编译通过。
git diff --check
# 通过。
```

- 已读取 `webui/frontend/test-results/.last-run.json`，`status: passed` / `failedTests: []`。已核看成功截图 `webui/tests/evidence/ticket-07-batch-editing.jpg`：选中两条，右侧不同值，1500–2500 ms 的第一句在乙轨、3000–4500 ms 的第二人在丙轨，播放头保留原 1 秒，工程已保存；未选重叠和第三人仍存在。README 已记录多选/批量语义、复验入口及新回调契约。
- 自行审查已提交实现、测试、新文件和文档，范围仅 `webui/` 与本票；没有其他代理。05/06 回归自动刷新的旧截图恢复原版本，本票只提交 07 证据。生产模块、配置与素材未修改。
- `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 18761,18762 } | Select-Object LocalAddress,LocalPort,OwningProcess` 只返回 `127.0.0.1:18762` / PID `36112`：**18761 已释放，18762 演示保留**。

### 2026-10-16 集成验收

- 合并前确认集成目录 `D:\whisper-diarization` 的 `feat/webui` 为 `fcc327354c747a33e7467b9b0e62af6758c5e8f1`；任务工作树 `C:\Users\machi\AppData\Local\Temp\opencode\webui-worktrees\ticket-07` 的 `feat/webui-07` 为 `fa02b8949d3867329acf231b6cc458b2c323d42c`，包含实现 `7acce024f87b8360c57962656e58c0bba39c4d49` 及验收记录提交。两个工作树均干净，票为 done，差异仅涉及 WebUI 前端、测试、文档和本票；`git diff --check fcc3273 fa02b89` 通过。
- 实际读取 Comments、已提交批量编辑截图和任务工作树 `.last-run.json`（passed）。在集成目录执行 `git merge --ff-only feat/webui-07`，成功从 `fcc3273` 快进至 `fa02b89`。依赖清单与锁文件未变，复用已安装前端依赖及指定现有 Python 环境。
- 以下命令均在 `D:\whisper-diarization` 实际执行，全部通过：

```powershell
& 'D:\whisper-diarization\env\python.exe' -m unittest webui.tests.test_http -v
# Ran 21 tests in 6.192s — OK，无跳过。
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& 'D:\whisper-diarization\env\python.exe' -m py_compile $Files.FullName
# 11 个 Python 文件编译通过；本票无 Python 源码改动。
npm --prefix webui/frontend run typecheck
# tsc --noEmit 通过。
npm --prefix webui/frontend run build
# Vite 7.3.7；35 modules；JS 229.18 kB / gzip 73.34 kB。
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm --prefix webui/frontend run test:browser
# 44 passed (2.5m)，无跳过：multiselect 11 + 既有 33 项。
# 真实 Edge + 集成目录生产构建 + 本地 FastAPI。
```

- 多选十一项覆盖 Ctrl/Shift/框选及双视图去重、播放头稳定、共同/混合属性、批量归属、当前轨序和越界全拒绝、Delete/输入焦点、整体时间夹取与边缘调整、吸附、取消与完整历史、自动保存重开，以及撤销整体替换后的失效 ID 清理。既有浏览器三十三项和 HTTP 二十一项全部通过。
- 实际核看本次批量编辑截图：选中两条、右侧不同值、乙/丙轨分别显示第一句/第二人，播放头保留原 1 秒、工程已保存，未选条目仍存在。回归重写的 05/06/07 三张截图已复制至被忽略的 `webui/frontend/test-results/`，分别为 `ticket-07-integration-speaker-management.jpg`、`ticket-07-integration-drag-timing.jpg`、`ticket-07-integration-batch-editing.jpg`，随后仅恢复这三张已跟踪截图到合并提交版本。集成 `.last-run.json` 为 passed，测试工程保留于 `.test-workspace/`。
- 测试前确认 18761 空闲，测试后确认该服务退出；原有 18762 / PID 36112 演示服务保持运行。恢复测试产物后工作树干净，再仅追加本段并独立提交。未启动其他代理，未推送，保留全部工作树。
