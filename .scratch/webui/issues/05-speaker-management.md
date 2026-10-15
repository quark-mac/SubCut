# 05: 说话人管理闭环

Status: done
Blocked by: 04
Spec: [WebUI 字幕与说话人编辑器](../spec.md)

**What to build:** 用户在说话人页签维护人物名称、配色和轨道顺序，合并同义标签，删除人物轨时保留字幕，并可以撤销这些操作。

## 上下文与修改范围

- 对应用户故事 16、46–51；依赖 04 的共享轨道、说话人顺序及换轨行为。
- 修改 WebUI 说话人编辑交互、编辑操作及说话人数据校验、相应浏览器/HTTP 测试。
- 开放标签名单；稳定人物身份与名称分离，特殊轨道语义固定，组合标签保留为一个标签。

## Acceptance criteria

- [x] 可创建普通说话人、重命名、改色及拖动排序，保存重开保留设置，字幕归属保持有效引用。
- [x] 重命名不改字幕稳定身份；轨道、列表及现有工作区配色同步。
- [x] 名称冲突明确提示使用合并操作，不隐式覆盖已有人物。
- [x] 合并普通说话人须明确目标；相关条目转入目标，作为一个可撤销操作，恢复时归属和配置完整。
- [x] 删除有字幕的普通轨道将字幕转入 `?`，不删字幕；删除空轨同样可撤销。
- [x] 未标注与非对白保持底部固定位置及语义，普通重排不会将它们当成可随意改名或删除的人物。
- [x] 重排后 ↑/↓ 使用当前顺序；撤销重排恢复顺序与后续换轨目标。
- [x] 创建、改名、改色、重排、合并和删除均参与当前工程历史及自动保存，不把界面浏览动作计为编辑。

## Verification

1. 在浏览器对包含重叠字幕、组合标签及特殊标签的工程完成全部人物操作，逐步撤销/重做并保存重开。
2. 用工程公开读取接口检查人物稳定身份、字幕引用、顺序及配色，验证名称冲突和特殊轨道约束。
3. 运行相关浏览器/HTTP 回归及类型/构建/编译检查，在 Comments 记录实际命令与结果。

## Comments

- 2026-10-16：唯一实现代理开始；前置 04 为 done。`ticket-05` / `feat/webui-05` 初始干净，HEAD、`feat/webui`、merge-base 均为 `3e1d73b42ec6652697fc2b82863eb8e0a28325b9`。已加载 TDD，沿用用户/spec 确认的真实 Edge 浏览器和公共 HTTP 测试边界；端口 18761，Python `D:\whisper-diarization\env\python.exe`，保留 18762 演示。`npm --prefix webui/frontend ci` 成功（26 packages，0 vulnerabilities）。

### 实现与验收

- 新增 `SpeakerManager.tsx`，提供字幕/说话人页签、开放人物新增、改名与颜色表单、原生拖放排序及取消、显式目标合并和删除。普通人物顺序连续，两个特殊轨固定底部且无编辑/拖放/合并/删除操作。删除说明在操作前可见，所有字幕转入未标注。
- `App.tsx` 将人物配置和相关归属修改构造成一次不可变工程提交；沿用既有会话历史及串行自动保存。所有修改和撤销重做保持条目 ID、正文、时间、元标签和完整来源；恢复人物使用原 ID。人物操作同步当前选中字幕草稿，避免已删除/合并人物被旧草稿重建。
- 名称冲突定位字段并提示使用合并，空名/保留名冲突阻止保存和导出。后端公共保存接口重复名称也返回可定位合并提示；非法特殊身份/语义/顺序与悬空引用原子拒绝。
- `speakers.spec.ts` 六个真实 Edge 闭环使用 8 秒视频、6 条字幕（同轨/跨轨重叠、组合标签、两个特殊标签、元标签及重复来源索引）。通过 UI 操作和公共 GET 检查完整保存结果；不调用组件内部状态或历史内部接口。改色通过真实颜色 input，拖放通过 Playwright 鼠标/native drag；撤销重做与重开、当前顺序换轨、取消无历史均通过。

### 实际红 → 绿记录

以下浏览器命令前均设置 `$env:WEBUI_PYTHON='D:\whisper-diarization\env\python.exe'`、`$env:WEBUI_BROWSER='msedge'`；每次实现后先 `npm --prefix webui/frontend run build` 再运行同一测试。

| 实际命令 | Red | Green |
| --- | --- | --- |
| `npm --prefix webui/frontend run test:browser -- speakers.spec.ts`（首个用例） | 找不到“说话人”页签，1 failed | 新增/历史/自动保存/身份重开闭环，1 passed |
| `npm --prefix webui/frontend run test:browser -- speakers.spec.ts -g '重命名及配色'` | 缺“编辑人物”入口，1 failed | 冲突/取消/不变输入不写历史，Ctrl+S 提交、三处计算配色与身份重开，1 passed |
| `npm --prefix webui/frontend run test:browser -- speakers.spec.ts -g '真实拖动重排'` | 缺“拖动排序 乙”，1 failed | 真实拖放、撤销顺序后换轨目标恢复、特殊目标拒绝、Esc 取消，1 passed |
| `npm --prefix webui/frontend run test:browser -- speakers.spec.ts -g '明确选择普通目标'` | 缺“合并说话人”，1 failed | 未选目标禁止确认、特殊轨不在目标内、合并及一步恢复全部身份/来源，1 passed |
| `npm --prefix webui/frontend run test:browser -- speakers.spec.ts -g '删除有字幕人物'` | 缺“删除人物”，1 failed | 有字幕转未标注、空轨恢复、分支编辑清除重做，1 passed |
| `& 'D:\whisper-diarization\env\python.exe' -m unittest webui.tests.test_http.ProjectHTTPTests.test_speaker_management_conflicts_are_explicit_and_saves_are_atomic -v` | 冲突错误不包含“合并”，1 failed | 改进公共错误提示后纳入 HTTP 全套，21 passed |
| `npm --prefix webui/frontend run test:browser -- speakers.spec.ts -g '再次编辑当前人物'` | WIP 自查复现：待提交名称“新的甲”重复点编辑后回填旧“甲”，1 failed | 从刚提交快照读取人物，空名/保留名阻止保存导出、Esc 取消不加历史，1 passed |

### 最终验证与分支

- 2026-10-16：在任务工作树运行 `git merge feat/webui` → `Already up to date.`，集成 tip 仍为 `3e1d73b42ec6652697fc2b82863eb8e0a28325b9`。随后执行最终全套验证：

```powershell
npm --prefix webui/frontend run typecheck
npm --prefix webui/frontend run build
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& 'D:\whisper-diarization\env\python.exe' -m py_compile $Files.FullName
& 'D:\whisper-diarization\env\python.exe' -m unittest webui.tests.test_http -v
$env:WEBUI_PYTHON='D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER='msedge'
npm --prefix webui/frontend run test:browser
git diff --check
```

- 结果：typecheck、build 通过；WebUI 全部 **11 个 Python 文件编译通过**；**21 个 HTTP 测试通过（6.213s）**；**26 个 Edge 浏览器测试通过（53.6s）**，含原有编辑/格式/时间轴全套及本票六个闭环；`git diff --check` 无空白错误。执行了未提交/新增文件范围自查，没有调用其他代理。
- 附加手动浏览器检查：独立 18761 服务打开自建“05 说话人管理验收”，实际从说话人卡片改名“甲 · 校对”，看到轨名同步、修订 1→2 和“已保存”；公开媒体请求返回 206、保存 PUT 返回 200。真实 Edge 的重开与配色截图：[ticket-05-speaker-management.jpg](../../../webui/tests/evidence/ticket-05-speaker-management.jpg)，1440×1000，已查看。
- 手动服务 PID 9888 已停止；最终 Playwright 服务自动退出，18761 无监听。原 18762 演示仍监听于 PID 36112，未停止或改写。任务 worktree 保留；提交仅在 `feat/webui-05`，不合入集成、不推送。改动仅限 `webui/`、其 README 与本票。
