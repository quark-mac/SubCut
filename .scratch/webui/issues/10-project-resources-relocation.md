# 10: 工程切换、另存为与素材重新定位

Status: done
Blocked by: 02
Spec: [WebUI 字幕与说话人编辑器](../spec.md)

**What to build:** 用户从菜单切换工程，另存当前结果，查看资源与导出位置；原视频移动后可找回同一原片，也可用另一视频和当前字幕副本建立新工程。

## 上下文与修改范围

- 对应用户故事 3–9；依赖 02 的可靠保存与修订语义。
- 修改 WebUI 工程菜单、资源区、工程复制/读取/媒体重新定位接口及测试。采用当前工程 schema 和已支持格式即可验收。
- 单工程单视频单工作字幕；工程复制与字幕导出不同，视频保持路径引用。

## Acceptance criteria

- [x] 工程列表可显示并打开已有工程，同一视频可用于多个工程；切换后名称、字幕、说话人设置和保存状态属于所选工程。
- [x] 切换及另存为先处理当前有效编辑；保存失败时保留待保存状态并提供可理解的恢复方式，不以失败结果显示已保存。
- [x] 另存为生成独立工程身份，复制当前字幕、人物配置与有效来源关系，引用原视频；修改副本不改原工程。
- [x] 资源区展示当前可用的源视频、字幕来源、工作字幕、媒体派生产物及导出文件；可从 UI 打开实际导出位置。
- [x] 原视频移动或缺失时，工程仍保留完整编辑数据，并可选择同一原片的新路径；恢复后定位、时长及字幕基准一致。
- [x] 重新定位与换视频分开；换用另一原片通过新建工程，可带入当前字幕副本并按新视频时长验证，失败不改变原工程。
- [x] 媒体身份、路径与已有缓存引用保持一致，可供后续媒体任务判断缓存有效性；不会因失联素材清空工作字幕。
- [x] 列表、读取、另存为与重新定位的公开服务响应包含可识别工程/资源及错误；未知格式版本明确报告。

## Verification

1. 浏览器建立两个使用同一视频的工程，编辑、切换、另存为并重开；用公共读取结果验证身份独立及来源完整。
2. 移动测试原片后重新定位，验证播放位置和字幕；再以另一较短视频创建带字幕副本工程，检查越界错误及原工程保留。
3. 验证保存失败时切换行为和资源区打开真实导出位置；运行公共 HTTP/浏览器回归及相应构建检查，记录证据。

## Comments

- 2026-10-16：确认 `feat/webui-10` 工作树干净，HEAD `6eb6855` 与集成 `feat/webui` 一致。按规格已确认的真实浏览器、公共 HTTP 和实际文件边界执行 TDD；不测试组件私有状态。依赖 02 及组合 03/05/08 已在基线集成。使用现有 Python、Edge；18762 / PID 7544 保留。

### 实现与实际红绿记录

- 公共 HTTP 第一条另存为 tracer：`test_save_as_copies_complete_editing_document_with_independent_project_identity` 先得到 **404 != 201**，实现复制/修订门禁/完整 SHA-256 身份后 **1 passed**。
- 重定位和离线读写：`test_relocation_verifies_full_content_identity_and_new_media_creates_separate_project` 及扩展未知版本用例先分别在不存在的重定位接口得到 **404 != 200 / 409**；实现同片身份校验、独立换片与离线保存后 **2 passed**。旧“原片失联必须 GET/PUT 404”的回归按本票明确契约改为完整文档可读可写，只有媒体读取继续报错。
- 资源清单 tracer `test_resources_report_missing_changed_and_export_files_without_losing_edits` 先 **404 != 200**，实现资源清单/原路径替换检测/真实导出位置后通过。列表失联摘要 tracer 先 **KeyError: media_missing**，增加身份/路径/失联提示后通过。
- 浏览器先运行 `resources.spec.ts`，因无“工程另存为…”入口红；接通保存成功门禁与菜单后绿。后续无效草稿用例真实发现 `.error` 覆盖菜单，Playwright 报 **alert intercepts pointer events**；降低错误条层级后，无效草稿/磁盘故障/重试闭环变绿。字段定位测试中的 exact label（含 select options / textarea 子文本）改为实际可访问 role+name，不使用强制点击绕过 UI 问题。
- 冲突恢复先增加“放弃修改并重开磁盘版本”的公共 UI 用例，入口缺失时超时（该次前台 shell 60 秒超时，已核查无残留服务）；实现明确重开入口后取消保留、确认读取外部版本均通过。全套首次 **63 passed / 1 failed**，唯一失败是旧“确认放弃后切换”的测试；按新契约改为等待真实 PUT 回执后切换，并继续断言 650 ms 之后不重复写回，最终全绿。
- 新接口：`save-as / new-media / relocate / resources / exports/{id}/open-location`；全部使用稳定工程 ID，写操作携带修订。另存为保留工程内条目/人物/来源身份，重置工程 ID/修订/导出/缓存。重定位只更新媒体路径与修订，保留当前会话字幕历史。
- 任务 11 接口与旧 v1 升级说明见 `webui/README.md` 的“媒体身份与缓存接缝”：完整文件摘要、大小、原片时长、成功派生产物的源身份/参数，真实失联/变更状态；同片移动保持缓存引用，复制不共享可写缓存。缺摘要且早已失联的旧工程不能凭文件名/时长声称同片，明确返回 `media_identity_unknown`，字幕仍能编辑。

### 组合与实际操作证据

- `resources.spec.ts` **5 项**：JSONL 导入 → 拆分 → 人物草稿改名/颜色 → 另存为；MOSS 整体替换 → 连续合并 → 人物拖动排序 → 复制故障重试。通过公共 GET 比较完整 entries/speakers/subtitle_sources/media，保留 `[91,0,91]`、MULTI/CUSTOM、重复 `seg-77` 来源关联、颜色和轨序；副本独立编辑、保存切换及刷新重开一致。
- 对真实 8 秒原片执行文件移动，离线重开并编辑保存；错误原片返回 `media_identity_mismatch`，找回同片后恢复 **4000 ms** 播放位置且视频实际继续播放，时长仍 **8000 ms**；2 秒片新建失败显示条目错误，去掉音轨但等长的另一文件成功创建独立工程，原工程 GET 完整不变。
- Windows 平台实际导出位置证据：`webui/tests/evidence/ticket-10-export-location.json` 记录 HTTP 回执、实际文件及 **Shell.Application** 枚举的 Explorer 路径/HWND。最终全套中工程 `6d5a58ad-daf2-4c21-b3d1-539cd309cf8a`、导出 `cb2e6557-1c46-4ce9-8db6-70fa523267a0`，Explorer **HWND 1970554** 实际指向该工程 `exports` 目录；读取真实 SRT 内容包含 `[甲&乙] 完整来源\n第二行`。测试结束仅关闭自己打开的这个窗口。配套 `.jpg` 及 `ticket-10-relocated-resources.jpg` 已保存。
- 另用 OpenChamber 浏览器在独立 **18763 / PID 13940** 人工点击新建 → 工程另存为 → 导出 → 打开导出位置，观察资源区绝对路径与已保存状态。原工程 `f1cf810e-50c8-4557-94d8-db19f947cd6d`、副本 `f73a29b1-d729-4416-a224-55df43c9911f`；Shell.Application 读到实际 Explorer **HWND 528862** 指向 `C:\Users\machi\AppData\Local\Temp\opencode\webui-10-manual\projects\f73a29b1-d729-4416-a224-55df43c9911f\exports`。截图 `webui/tests/evidence/ticket-10-manual-save-as-export.jpg`。该服务及自己打开的 Explorer 窗口均已清理，素材保留供复核。

### 最终命令与结果

以下均在 `C:\Users\machi\AppData\Local\Temp\opencode\webui-worktrees\ticket-10` 执行：

```powershell
npm --prefix webui/frontend ci
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
git merge feat/webui
git merge-base --is-ancestor feat/webui HEAD
& $env:WEBUI_PYTHON -m unittest webui.tests.test_http -v
$files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& $env:WEBUI_PYTHON -m py_compile $files.FullName
npm --prefix webui/frontend run typecheck
npm --prefix webui/frontend run build
npm --prefix webui/frontend run test:browser
git diff --check
Get-NetTCPConnection -LocalPort 18761,18762,18763 -State Listen -ErrorAction SilentlyContinue
```

- `npm ci` 成功，0 vulnerabilities；`git merge feat/webui` **Already up to date**，集成仍为 `6eb6855`，祖先检查成功。
- HTTP **26/26 passed**（含真实 Windows 文件共享锁/原子替换失败、完整文档保留、未知版本、旧工程迁移、缓存引用移动与缺失）。Python 全部 WebUI 文件编译成功。
- typecheck / production build 成功。合并检查后的真实 Edge 全套 **65/65 passed，3.4 分钟**；包含 03/05/08 全套及新增组合验收。
- 自检覆盖已跟踪差异与新增的资源模块、浏览器测试、证据文件。仅提交本票/WebUI 范围；全套生成的 05–08 截图恢复为基线，未混入本票。生产模块、集成工作树未改，未 push。
- 端口核查：**18761 已释放，18763 已释放；18762 仍为 PID 7544**。没有替换、重启或停止原演示服务。工作树保留。
