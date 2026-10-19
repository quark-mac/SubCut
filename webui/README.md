# 本机字幕校对 WebUI

当前提供三种 SRT 解释模式、normalized JSONL、MOSS JSON 预览 → 创建工程或整体替换 → 原片播放定位与逐句/循环试听 → 正文/整数毫秒时间/开放人物归属编辑 → 自动保存 → 菜单重开 → 四种字幕导出。支持会话内撤销/重做、有效输入提交与可靠保存；整体替换的条目、人物和来源一起撤销。深色中文工作区包括可调整尺寸的资源区、播放器、可搜索筛选的字幕列表与编辑器、含真实波形及缩略图的锁定视频轨、字幕总览及说话人轨。

## 安装

需要现有 Python 3.10+、Node.js 22.12+（本次使用 24.16）、npm，以及 FFmpeg/ffprobe。默认复用 PATH 中的工具，也可用 `WEBUI_FFMPEG` / `WEBUI_FFPROBE` 分别指定现有可执行文件的绝对路径（不是命令行参数或工具目录）。使用已有 Python 环境；以下 PowerShell 命令在**当前 checkout 根目录**执行，Python 路径按本机环境调整：

```powershell
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
& $env:WEBUI_PYTHON --version
ffprobe -version
ffmpeg -version
& $env:WEBUI_PYTHON -m pip install -r webui/requirements.txt
npm --prefix webui/frontend ci
npm --prefix webui/frontend run build
```

安装完成后双击 `webui/start.cmd`。也可从任意目录运行绝对路径的 `webui/start.ps1`：

```powershell
.\webui\start.ps1 -Python $env:WEBUI_PYTHON
# 自定义工程目录/端口，不自动打开浏览器：
.\webui\start.ps1 -Python $env:WEBUI_PYTHON -Port 8765 -Workspace 'C:\MyEditingProjects' -NoBrowser
```

启动器默认从当前 checkout 的 `env/python.exe` 查找，再查 Git 主工作树的现有环境。服务只监听 `127.0.0.1`，默认 <http://127.0.0.1:8765>，控制台 Ctrl+C 关闭服务。启动前检查已构建前端，并报告缺失的媒体工具；工具缺失仍能打开已保存工程、编辑和导出字幕，相应媒体操作返回明确错误。`WEBUI_WORKSPACE` 或 `--workspace` 指定数据目录；默认 `webui/workspace/<工程 UUID>/project.json`。应用使用单进程服务；不要用多个服务进程同时写同一 workspace。

双击入口使用 `WEBUI_PYTHON` 时，请先将它设置为 Windows 用户环境变量（只在某个 PowerShell 中设置的 `$env:` 不会传给 Explorer）。也可直接使用上面的 `-Python` 命令，无需修改主项目环境。浏览器采用 Windows 默认关联，只有本机服务启动就绪才打开；不要先关启动控制台。打开失败时可手动访问打印的 URL。`start.cmd` 启动失败会保留窗口供查看错误。

| 启动问题 | 处理 |
| --- | --- |
| `Existing Python not found` | 指定现有 `python.exe` 的绝对路径；环境路径不是目录或带参数的命令 |
| 缺少 WebUI Python 依赖 | 按错误中打印的**同一个 Python**执行 `-m pip install -r .../requirements.txt`；不要用另一个环境的 pip |
| 尚未构建前端 | 在当前 checkout 执行 `npm --prefix webui/frontend ci` 和 `npm --prefix webui/frontend run build` |
| `WinError 10048` / 端口占用 | 关闭自己先前的服务，或 `-Port` 选其他空闲端口；不要同时写同一 workspace |
| 媒体工具缺失、生成失败 | 设置实际 `WEBUI_FFMPEG` / `WEBUI_FFPROBE`，重启服务后点击对应“重试生成…”；不要把 ffprobe 配成 ffmpeg |

例如复用本机已有工具（不另装媒体栈）：

```powershell
$env:WEBUI_FFMPEG = 'D:\whisper-diarization\MOSS-Transcribe-Diarize\ffmpeg\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe'
$env:WEBUI_FFPROBE = 'D:\whisper-diarization\MOSS-Transcribe-Diarize\ffmpeg\ffmpeg-9.0.2-full_build\bin\ffprobe.exe'
.\webui\start.ps1 -Python $env:WEBUI_PYTHON
```

## 使用

1. 点击“新建工程”，使用“选择视频…”和“选择字幕…”打开系统文件选择窗口，选中文件后自动填入绝对路径；明确选择导入格式，再解析预览并确认创建。字幕须为 UTF-8，选择窗口按当前格式筛选 SRT / JSONL / JSON，也可切到“所有文件”；扩展名不替代显式格式选择。取消保留原选择和预览，重新选择文件后须重新解析。预览展示时间、正文、人物、元标签、输入序号、原来源索引与 MOSS ID。新建时核对文件/格式/时长指纹；来源已变化会要求重新预览。详见下方格式契约。
2. 原片先由 ffprobe 读取实际容器、视频/音频编码和原片时长，再尝试浏览器解码；扩展名不决定兼容性。资源区显示探测结果与实际画面解码状态，包括浏览器只认出音轨而没有画面的情况。不能完整播放时点击“生成预览副本”，成功后自动使用 H.264/AAC MP4；字幕、原片身份与时间保持不变。原片与副本均支持 `206` 范围读取和定位。
3. 右侧编辑正文、起止毫秒和说话人归属。可选择已有标签，或输入新名称；新名称创建独立说话人身份，输入已有名称复用其引用。`?`、`NONSPEECH` 分别保留未标注、非对白语义并固定在底部。点击“应用修改”、离开编辑区、切换条目、保存或导出会校验并提交当前输入。非法字段显示原因并获得焦点，不能保存/导出非法草稿。Esc 或“取消修改”恢复本次输入前的有效值。重叠条目独立保留，轨内错层展示。
4. 每次有效提交后延迟 **650 ms** 自动落盘；“保存工程”或 Ctrl+S 立即提交并保存。显示“未保存 / 保存中… / 已保存 / 保存失败”；已保存只代表服务确认的版本，保存期间可继续编辑。失败保留输入与历史，可点击“重试保存”。磁盘版本冲突保留页面当前修改，不自动覆盖外部更新；可明确点击“放弃修改并重开磁盘版本”，确认后重新读取，取消则保留全部草稿。已落盘但响应丢失时，重试先核对磁盘快照再继续保存。刷新后从“文件 → 打开工程…”重开。切换、新建、另存为及媒体操作先提交有效草稿并等待保存成功；无效字段阻止操作并定位，保存失败不切换。关闭页面仍有未保存提示。
5. 时间轴工具栏的“撤销 / 重做”或输入框外 Ctrl+Z / Ctrl+Shift+Z 恢复正文、时间和归属（包括创建新标签）的完整操作。一次连续表单编辑提交算一步；保存不清历史，重开重置历史，撤销后新编辑清除旧重做分支。无效、取消或与原值相同的输入不产生历史。输入框内方向键、空格、删除及撤销交给原生文本编辑。
6. 点击“替换字幕”，选择格式，点击“选择字幕…”挑选文件并解析预览，点击“应用替换”后整个预览成为一个编辑操作；取消、无效文件和预览本身不修改工程。应用使用已看到的完整预览快照，不重新读取外部文件。来源及人物引用一起替换，同名人物复用身份/颜色，特殊轨身份固定；一步撤销完整恢复原状态，重做恢复同一批新身份。替换通过同一自动保存队列落盘。
7. 顶部选择导出格式，默认“说话人 SRT”，另有“普通 SRT / 项目 JSONL / MOSS JSON”。导出先提交并保存有效输入，固定触发时的内容、格式和元标签选项；等待期间的后续编辑不会混入本次输出。SRT 默认不含元标签，可显式勾选“保留已有元标签”。资源区显示实际文件绝对路径及下载链接。导出失败单独提示并可重试，已成功保存的工程仍显示已保存。
8. 时间轴按**锁定视频 → 音频波形（默认隐藏）→ 字幕总览（可关闭）→ 普通说话人 → 未标注 ? → 非对白 NONSPEECH** 排列。打开工程时普通人物按字幕条数降序显示，同数保留工程原序；编辑期间位置固定，点击“按字幕数排序”刷新，“工程轨序”恢复工程保存顺序。排序视图不自动改写工程；上下换轨及批量纵拖遵循可见顺序。列表人物、轨道标题和字幕块配色一致。同轨重叠错层，选择任一视图都对应同一条目。白色边框表示编辑选择，深绿色底线表示当前播放时间覆盖，两者互不替代。
9. 拖动时间刻度或橙色播放头会暂停并定位实际原片；靠近视窗左右边缘时持续横向滚动，Esc 恢复原时间与横向位置。“跟随播放头”默认开启，播放/跳转出视窗时自动跟随，也可关闭后自由浏览。缩放滑块及 −/＋ 按钮以约 **9%** 小步递增，优先固定播放头屏幕位置；播放头在视窗外时将其带回中央。“适合全片”恢复完整时长，最大倍率仍支持毫秒微调。滚动条或触控板支持水平、垂直滚动，Shift+滚轮可横移；轨道名称和顶部刻度保持可见。极短字幕保留至少 4 px 点击区。
10. 输入控件外，↑/↓ 将选中字幕按**当前轨道顺序**整体偏移一行，时间不变、相对轨道间距不变；任一条越界则整次不执行、不循环。←/→ 按时间顺序选择上一/下一条（相同时间保留输入顺序），无选择时分别从末条/首条开始；空格播放/暂停，Esc 清除选择。换轨进入一步历史，可撤销、重做及保存重开；播放、选择、缩放、滚动不进入历史。文本/数值/归属/缩放控件保留自己的按键行为；对话框打开时不触发工程快捷操作。
11. 右侧“说话人”页签提供人物管理。“新增说话人”创建空轨；“编辑人物”修改名称及颜色，点击“应用人物设置”将连续输入提交为一步编辑并自动保存。保存、导出、切换页签或选择字幕也会先提交有效人物输入；Esc 或“取消人物修改”取消草稿。名称为开放名单，组合标签不会拆分；同名冲突提示使用明确合并，空名与冲突会定位字段并阻止保存/导出。
12. 拖动人物卡片的 **⠿** 到另一普通人物位置进行排序，松开提交一次历史，Esc 取消；自动保存后重开保留顺序。↑/↓ 按重排后的当前顺序换轨。两个特殊轨 `?` / `NONSPEECH` 始终在底部，不提供改名、排序、合并或删除入口。
13. “合并说话人”须先明确选择另一个普通目标再确认；源人物移除，其全部字幕归到目标，目标身份/名称/颜色保留。“删除人物”直接将其字幕转入未标注并移除普通轨，空轨同样可删除；字幕身份、正文、时间、元标签和来源均保留。合并、删除和全部人物配置操作均可一步撤销/重做并自动保存，撤销完整恢复原身份/归属/配置。人物名称和颜色立即同步卡片、列表及时间轴；保存不清空历史。
14. 从总览或人物轨**拖动字幕块中部**可横向平移，保持真实时长；纵向拖到人物轨只改归属，斜向同时修改时间与归属。拖向总览、锁定视频或轨道外保留原归属；重叠合法，其他字幕不随动。左右浅色边缘分别调整开始/结束；极窄块（不足 12 px）将开始/结束手柄分置顶部/底部，中部仍可整体拖动。时间限制在原片范围，最短为 **1 ms**，显示点击宽度不会当作字幕时长。
15. **吸附**默认开启，按钮可切换；移动中的任一端或正在调整的一端，在 **8 屏幕像素**以内吸附到原播放头或其他字幕起止点，青色虚线提示命中位置。距离随当前缩放换算；不吸附自身，纯纵拖不改时间。关闭后可自由微调，放大后在右侧核对整数毫秒。鼠标移动超过 3 px 开始横向编辑，激活后可返回到任意毫秒位置；手势中也可用滚轮移动视窗。
16. 拖动先暂停播放并显示临时预览，列表、右侧字段、总览和人物轨同步；松开鼠标才将整个手势提交为**一步历史**并触发自动保存。预览不写入工程，手势期间快捷键不会另行提交；Esc / Pointer Cancel / 丢失捕获取消手势，恢复原状态且保留重做分支。单击仍定位字幕起点；拖动保留原播放头以便吸附。保存、撤销/重做及菜单重开延续已有语义。
17. **多选**：列表、总览及人物轨中 Ctrl（或 Meta）点选切换同一条目的选中状态；Shift 从最近一次普通/Ctrl 点击的锚点按稳定时间顺序连选，Ctrl+Shift 追加范围。从字幕轨**空白处拖出矩形**框选，Ctrl/Shift 框选追加，可用滚轮跨越视窗；双视图中的同一 ID 只选一次。修饰键点选与框选不暂停、不跳播放头；普通点击仍单选、暂停并定位。Esc 取消正在进行的框选，恢复手势前选择；手势外 Esc 清除选择。
18. 多选时右侧显示条数、共同正文/起止时间/说话人；不同的属性明确显示“不同值”。选择“批量说话人归属”的目标后，点击“应用批量归属”才统一修改；选目标本身不改工程。一次批量改人、换轨、移动或删除均为**一步历史**，无变化/越界/取消不写历史也不清除重做分支。
19. **批量拖动**：拖动已选块保留整个选择。横拖使用共同毫秒偏移，按最早开始与最晚结束整体夹取片头/片尾，保持每条时长与相对时间；纵拖按被拖条目的目标轨计算共同轨道偏移，遵循重排后的顺序。斜拖同时提交时间和人物，任一轨道目标越界时连同时间整次拒绝。拖到总览/视频/轨外不改归属。吸附排除整个选择集合，用任一选中边界命中播放头或未选字幕边界后整体对齐。拖动边缘时各选中条目同一端按共同偏移调整，限制在所有条目共有的合法范围，最短 1 ms。
20. **Delete / 删除选中字幕** 删除单选或多选，完整条目（含身份、元标签、来源）可一步撤销恢复；未选条目不变。正文输入时 Delete 只删文字，方向键/撤销保持输入优先。选择变化先提交已有有效输入，无效输入保留错误焦点；取消后可继续操作。撤销整体替换时清除已不存在的选择 ID，避免出现幽灵条目。自动保存与重开保留批量结果，重开建立新历史。
21. **新增字幕** 暂停并捕获实际播放头，默认 2 秒，临近片尾缩短到原片终点；终点不能新增。先填写非空正文再“确认新增”，取消或 Esc 不创建条目/历史。点击人物轨标题（空轨也可）或时间轴“当前说话人轨”下拉框明确选择新增归属；轨标题蓝边表示当前目标。选择总览/视频轨或未明确目标时归 `?`，列表中的字幕选择不猜测目标人物。对话框允许再选择已有归属，新增没有来源及元标签。
22. **拆分字幕 / Ctrl+B** 只接受单条选择且播放头严格位于内部。两段时间相邻，各自完整复制原文（包括换行）、人物、全部来源和元标签，创建两个不同的稳定身份；不按时间猜字。拆分后选中两段，可分别选择整理正文。端点、多选和无选择不执行；输入框中快捷键优先交给输入控件。
23. **合并字幕 / Ctrl+M** 要求在**全体工作字幕**的开始、结束、稳定同时间顺序中连续多选；不是只看当前人物轨或搜索结果。取最早开始与最晚结束（支持嵌套重叠），正文按此顺序换行，可覆盖间隙。同人直接合并；跨人弹出结果标签选择，初始不预选，明确选择再确认；取消或 Esc 保留条目与重做分支。合并创建独立身份，按参与顺序拼接来源关联，元标签按首次出现顺序合为集合，不添加推断标签。
24. 新增、拆分、合并分别进入**一步历史**并自动保存；撤销恢复原条目身份、时间、全文、归属、元标签和来源，重做复用首次结果身份。列表/总览/人物轨引用同一结果，保存重开及四格式导出一致。工程保存完整来源上下文；导出序号按时间重新生成，原来源索引与 MOSS 来源 ID 不随之改写。
25. **工作区布局**：按浏览器可用高度分配上部三面板与下部时间轴，不再强制 800px 页面高度；常规文字 14px、字幕正文 15px。拖动面板分隔条调整宽高，“视图 → 显示资源面板”可收起左栏。内容独立滚动；Esc 恢复拖动前布局，聚焦分隔条后方向键每次调整 10px。**每条轨道标题区底边**也有高度调整条，视频/波形 48–320px，字幕轨至少容纳全部重叠层；放大后块和媒体随轨高适配。“视图 → 重置面板布局”恢复默认面板比例；布局及轨高仅影响当前工作区，不进入历史或工程文件。
26. **搜索和人物筛选**可组合使用，正文搜索不区分大小写，保留多行正文；“清除筛选”恢复完整列表。列表序号仍为全体时间排序序号，隐藏条目仍在工作字幕、轨道、叠加和选择集合中。筛选不改变历史；Shift 连选、←/→ 导航及合并连续性始终以完整集合为准。
27. **逐句与循环试听**：双击列表、总览或人物轨字幕，从起点播放到终点并暂停。“循环当前字幕”以当前单选字幕为独立试听目标；“退出试听”停止并解除循环/逐句限制。单击或时间跳转暂停、定位并解除试听；空格暂停/继续保留未结束的循环。可选 0.5、0.75、1、1.25、1.5、1.75、2×；跳转接受 `HH:MM:SS.mmm`（小时不限两位）或 0–59 秒（可带 1–3 位毫秒小数），非法/超出原片的输入不移动播放头。
28. **播放选择分离**：播放高亮随实际视频时间变化，不移动编辑选择；试听目标也不随编辑选择改变。播放时可 Ctrl 点选添加另一条、再 Ctrl 取消原条，单独编辑另一条而继续试听。文字及当前说话人标签在提交后更新叠加；输入草稿与时间拖动预览不冒充已提交工作字幕。删除/拆分/替换使试听目标消失时停止试听，撤销恢复条目不会自动播放。
29. 播放器的**字幕**与**说话人**开关独立；关闭再开启字幕仍保留人物开关状态。重叠字幕按时间顺序纵向错位，多行正文保持换行；原始标签（包括 `?` / `NONSPEECH`）直接显示。视图菜单也可切换叠加、字幕页签和说话人管理页签。
30. **菜单与帮助**：文件菜单可新建、打开、替换、保存及按工具栏当前格式导出；编辑菜单可聚焦正文、撤销/重做、新增、拆分、合并及删除，沿用工具栏相同校验与历史。帮助列出已交付的全部快捷键、输入焦点、多选与试听规则；Esc 关闭帮助/菜单。撤销和重做主按钮仍在时间轴工具栏。
31. **工程另存为**：文件菜单选择“工程另存为…”，先保存当前有效字幕和人物输入，再输入副本名称。副本有独立工程 ID、修订从 1 开始；字幕条目、人物配置（身份、名称、颜色、顺序）、元标签、完整来源关联原样复制，视频仍按原路径引用。字幕/人物/来源 ID 作用域在各工程内，修改副本不修改原工程；导出和派生缓存归属原工程，不共享可写目录。新副本建立新编辑历史。
32. **资源状态**：资源区展示源视频、字幕来源、工作工程文件、派生产物和导出文件及真实路径；“刷新资源状态”重新检查失联/变更。原片失联时仍可打开、编辑、保存、另存为和导出字幕。工程列表显示原片路径及失联提示。每个导出提供“打开导出位置”，服务调用 Windows Explorer 打开真实导出所在目录；打开失败显示错误，绝对路径仍可复制。
33. **重新定位与换片**：两个对话框均可点击“选择视频…”从系统窗口选取文件。“重新定位原片”只接受完整文件 SHA-256 身份及原片时长一致的新路径；移动/重命名可恢复，重新编码不视作同一原片。恢复保持原片时间、当前播放位置和字幕历史。真正换片请选择“用新视频建立工程”，带入完整字幕/人物/来源副本并按新时长验证全部条目；越界错误显示条目/字段，失败不创建半份工程、不改变原工程。
34. **兼容预览副本**：资源区可选择标准（最大 1920 宽、CRF 23）或轻量（最大 960 宽、CRF 28），显示等待 / 运行中 / 成功 / 失败及百分比。启动生成先保存有效输入，生成期间仍可编辑和切换工程；后台任务归属原工程，重开可继续查看进度。失败显示实际工具或文件错误，“重试生成预览副本”创建新任务。“刷新预览状态”重查任务与缓存，查询失败也可使用此按钮恢复。
35. **时间与缓存**：转换整条音视频时间线，保留静音、黑场、间隙及音轨相对视频的延迟。使用一个共同播放起点归零，不分别将各轨起点拉到零；非零起始 PTS 的素材请使用生成副本校对。副本不修改字幕/导出时间。音频采用 AAC 160k/48kHz；无音轨的原片保持无音轨。缓存同时关联完整源 SHA-256、全部生成参数/版本以及产物 SHA-256；切换质量不会误用另一组参数的结果，切回可复用仍有效的副本。失联、内容变化、损坏或缺失副本不作为有效缓存。

36. **波形与缩略图**：工具栏提供“视频缩略图”（默认开）、“音频波形”（默认关）和未生成时的快捷生成按钮。视频轨按轨高等比展示缩略图；波形独立成轨，默认高度 100px。资源区仍可选标准/精细密度、查看进度、错误与重试。沿用同一后台队列及重开复用规则，生成前保存有效输入；加载与显示开关不写字幕历史或编辑修订。**拖动播放头期间**，上方显示缓存参考帧及准确播放头时间，另标实际采样时间；松开/Esc 关闭。未生成或加载失败明确提示，不把采样图冒充实时逐帧画面。波形展示全部音频的振幅，可帮助找起音/停顿，并非人物识别声纹。
37. **时间轴媒体证据**：波形是实际音频降为 8kHz 单声道后按 10ms / 5ms 窗口取绝对峰值；静音显示中线，无音轨明确显示“无音轨 · 空波形”。缩略图是按原片每 1 秒 / 0.5 秒采样的 160×90 JPEG（保留比例加黑边），悬浮提示实际采样毫秒；它们是时间点参考，不代表两采样点之间所有帧。二者直接从原片按共同播放起点生成，保留延迟音轨和间隙，不借用裁剪或压缩后的时间。缩放/横移只请求当前可见的聚合波形并解码所需缩略图；改变密度不会误用旧参数，切回可复用有效结果。加载失败可点击“刷新波形状态 / 刷新缩略图状态”重试，编辑及保存仍可用。

### 长片、文件位置与操作速查

文件选择窗口在运行 Python 服务的本机桌面打开，使用 Python 的 Tkinter（本机环境已包含；可用 `python -m tkinter` 检查）。文件继续按原路径引用，不上传或复制整部视频。一次只打开一个选择窗口，等待时页面显示提示；取消后可立即重试，超过 10 分钟自动关闭并提示重新选择。若窗口在后台，请用 Alt+Tab 切换；启动失败会在页面报告。路径框仍可复制或粘贴绝对路径（无外层引号）。

超过 100 条的列表使用带预留范围的窗口化：行内展示两行预览，悬浮提示或右侧编辑器可读完整多行正文；搜索仍查全部正文。时间轴保留全体条目的错层布局，只挂载横向/纵向可见的字幕块。滚出视窗不会取消选择；框选按完整布局命中，不能把卸载的块当作不存在。缩放、过滤和虚拟渲染都不裁掉保存/导出的条目。播放位置更新复用时间排序和重叠索引，不每帧重排全片，波形/缩略图不因播放帧重复重建。

轨道名称不会撑高布局改变虚拟坐标；过长名称在标签区受限展示，悬浮提示显示全名，实际人物标签、无障碍名称及导出不截断。

| 位置（相对所选 workspace） | 内容 |
| --- | --- |
| `<工程ID>/project.json` | 完整工程与当前字幕、人物、来源、导出/缓存登记；继续编辑应备份它和原片 |
| `<工程ID>/exports/` | 工具栏或文件菜单生成的实际字幕文件；资源区下载或“打开导出位置” |
| `<工程ID>/previews/` | 保持原片时间的 H.264/AAC 副本；不是源视频 |
| `<工程ID>/timeline-media/` | 可再生波形 JSON、缩略图 ZIP；生成中的 `.partial` 不可用 |
| `<工程ID>/tasks/` | 媒体任务状态、实际命令及错误日志；失败后可重试 |

媒体始终按原绝对路径引用，不复制到 workspace。移动原片后在资源区“重新定位原片”验证相同 SHA-256；换另一视频用“用新视频建立工程”，不要改工程 JSON 冒充重定位。另存为是独立工程，不共享可写导出/缓存目录。来源字幕不会被保存覆盖。

| 操作区 | 实际行为 |
| --- | --- |
| 文件菜单 | 新建、工程列表打开、另存为、整体替换、保存、按当前工具栏格式导出 |
| 编辑菜单 | 聚焦正文、撤销/重做、新增、拆分、连续合并、删除；复用工具栏相同校验 |
| 视图菜单 / 帮助 | 切换字幕/人物页签、字幕/姓名叠加、重置面板；帮助列出已交付规则 |
| 资源区 | 三类媒体生成/进度/重试/刷新、资源状态刷新、同片重定位、新片副本、实际下载与 Explorer 导出目录 |
| 时间轴 | 历史、删除/新增/拆分/合并、明确新增人物轨、吸附、缩放及适合全片；视频轨保持锁定 |
| 人物页签 | 新增、名称/颜色、普通轨拖动排序、明确合并、删除转未标注；特殊轨保留 |

| 快捷键（输入控件外） | 行为 |
| --- | --- |
| ↑ / ↓ | 按当前轨序整体换轨；任一越界整次拒绝 |
| ← / → | 按完整字幕顺序选上一/下一条并定位 |
| 空格 / Delete | 播放暂停 / 删除选择 |
| Ctrl+B / Ctrl+M | 严格内部拆分 / 全体连续选择合并 |
| Ctrl+S | 提交有效草稿并立即保存（输入框内同样有效） |
| Ctrl+Z / Ctrl+Shift+Z | 一步撤销 / 重做；输入控件内优先文本编辑 |
| Esc | 取消手势或草稿、清除选择、关闭菜单/帮助 |
| Ctrl / Shift / Ctrl+Shift 点选 | 切换单条 / 完整时间顺序连选 / 追加范围；不定位、不暂停 |

本机实测和十组最终验收见 [ticket 13 验收报告](tests/evidence/ticket-13-acceptance.md)。两小时合成片用于验证时间范围、4000 条和 26 人物的编辑/完整导出，不冒充高码率电影解码基准；浏览器缓存冷/热、实际硬件及帧间隔原始数据分别记录，未承诺毫秒级性能门槛。

2026-10-18 已按用户要求清理历史工作树并精简验收附件。当前保留的最终集成日志、关键故障记录与截图见 [精选证据索引](tests/evidence/README.md)；下文各测试生成的历史截图/产物路径不保证仍在当前 checkout，已提交旧附件的恢复方式也见该索引。

工程文件保存稳定的工程/字幕/说话人身份、格式版本、媒体路径/内容身份/时长、字幕来源及来源序号、当前工作字幕、已有元标签及导出记录。未知版本和损坏工程会明确报错并保留文件；原片缺失不会以空工程代替。继续编辑以工程保存对象为准：交换字幕缺少工程人物配置、来源上下文等字段，不能替代完整工程保存。

### 格式与来源契约

格式均为显式选择，不从扩展名、方括号或冒号猜测：

| 格式 ID | 导入解释 | 导出 |
| --- | --- | --- |
| `plain-srt` | 全文保留，归属 `?`；方括号、冒号是正文 | 仅正文；显式选项可在正文前写已有 `{TAG}` |
| `speaker-srt` | 首行 `[Speaker]`；仅连续前置 `{MULTI}` / `{MERGED}` 进入 tags，遇未知花括号后整个余文保留 | 默认干净 `[Speaker] text`；显式选项保留所有已有 tags |
| `moss-srt` | 首行按第一个 ASCII `: ` 分隔人物与正文；后续冒号及换行不拆。全角冒号不作为分隔符 | 本票不提供此输出 |
| `normalized-jsonl` | 每个非空行一个对象：`idx/start/end/speaker/text`；`tags/source_entries` 可省略为空数组 | 生产七字段、秒制时间、已有 tags 和原来源索引 |
| `moss-json` | 顶层五字段数组：`id/start/end/speaker/text`；id 与 speaker 为非空字符串 | 恰好五字段；秒制时间、当前人物标签、独立且唯一的段 ID |

- SRT 支持 UTF-8 BOM、CRLF、1–3 位小时、箭头两侧空白与普通多行。分钟/秒限 0–59。项目格式缺人物前缀、MOSS 格式缺 `: ` 均报告错误，用户可改选普通模式。
- JSON 数字必须有限，拒绝字符串/布尔值冒充时间；先校验原秒制 `0 ≤ start < end ≤ duration`，再由服务统一执行 Python `round(seconds * 1000)`（半毫秒取最近偶数），拒绝换算后零时长。重叠、同时间和多行均保留。
- `?` / `NONSPEECH` 为固定特殊语义；组合标签如 `Iroha&Kaguya` 是一个完整标签。`OTHER`、`OVERLAP` 等文件中的字面名称按开放标签保留，不套用 Gemini 模型结果的 canonical / speaker_raw 转换规则。MOSS JSON 不含显示名映射，按 `S00` 等文件值建轨。
- 工程 `Entry.id` 为独立 UUID；`sources[]` 每项为 `{subtitle_id, index, source_entries, moss_id}`。`index` 保存 SRT cue number / JSONL idx，MOSS 为 null；`source_entries` 保存 JSONL 的原 0-based 关联数组，**不重排、不去重、不从当前序号推导**；`moss_id` 保存导入段 ID，其余格式为 null。来源记录 `subtitle_sources` 保存路径、格式和稳定 ID。
- JSONL 导出按参与来源关联顺序拼接已有 `source_entries`；缺失来源、SRT 与 MOSS 来源导出此字段为 `[]`。MOSS 重复输入段 ID 可作为来源保留，工程条目仍独立，输出使用当前条目 UUID 保证唯一。拆分两段各继承完整来源；合并按时间顺序拼接关联、不去重（包括同一来源拆分再合并的重复关联）；新增条目使用 `sources: []`。
- 所有输出按 `(start_ms, end_ms)` 稳定排序；SRT / JSONL 从 1 连续编号，不改动输入序号或原来源索引。JSONL 始终保留 tags。SRT 无来源字段，MOSS 无 tags/原来源索引；它们不保证完整工程往返。SRT 人物前缀或元标签遇无法表达的分隔/换行字符时明确报错，不生成损坏文件。
- 正文中的真实换行在工程和 JSONL 内原样保存。普通/说话人 SRT 允许普通多行，但空行、纯空白行（含首尾空行、CR/LF 分隔）会成为条目分隔或丢失，导出会返回具体条目的 `text` 错误并提示改用 JSONL；不会静默删行，也不会登记坏导出。可继续保存此类合法工程正文。
- 生产兼容性依据为 `sub/_srt_io.py` 的七字段 JSONL / SRT writer，以及 MOSS `subtitle/models.py`、`export.py` 的五字段数组 / ASCII 冒号约定；WebUI 独立落实严格校验。测试还使用真实生产 `parse_jsonl` / `parse_srt` 读取输出文件。

## 可重复验证

### HTTP 与 Python 编译（checkout 根目录）

```powershell
& $env:WEBUI_PYTHON -m unittest webui.tests.test_http -v
# 真实预览、缺工具及启动入口验收（先完成前端 build）：
& $env:WEBUI_PYTHON -m unittest discover -s webui/tests -p 'test_*.py' -v
$Files = Get-ChildItem webui -Recurse -Filter *.py | Where-Object { $_.FullName -notmatch 'node_modules|workspace' }
& $env:WEBUI_PYTHON -m py_compile $Files.FullName
```

HTTP 测试生成 8 秒 H.264/AAC 视频、含多行/重叠/乱序/同时间条目的字幕，启动真实 Uvicorn 于空闲端口，通过 HTTP 验证创建/五格式预览/原子替换/列表/读取/保存/四种实际导出、来源与元标签、字节范围读取、非法输入与人物配置、开放标签及稳定身份、并发修订冲突、未知版本、缺失媒体及损坏工程。畸形 JSON、NaN/Infinity/超大数字、转换后零时长、负来源索引等返回条目/字段/原因，失败不创建或部分替换。Windows 另使用真实文件共享锁阻止原子替换，验证 HTTP 500、磁盘完整旧版本、临时文件清理及解锁重试。每次独立临时目录，结束清理自建素材和服务。故障以外部文件变动或 OS 文件锁注入，未 mock 私有模块。

### 浏览器与前端（checkout 根目录）

文件选择验证：`file-picker.spec.ts` 在公开 HTTP 边界模拟选择/取消/失败，随后由真实后端完成新建、替换、保存和视频副本，覆盖等待禁用、取消保留预览与重新选择失效。`test_http.py` 另在 Windows 桌面实际打开系统文件选择窗口，验证中文/空格路径、取消、重复请求及窗口打开期间的服务响应；并启动真实 Vite 代理，验证带浏览器 Origin 的选择请求。原生窗口测试只操作其临时服务拥有的窗口，结束清理服务进程树。

`workspace-usability.spec.ts` 验证 1280×650 窗口无整页溢出、跳转跟随与窗口变窄、拖动边缘滚动和 Esc 恢复、总览/缩略图/波形开关、单轨高度与大量重叠层、真实生成缩略图浮层、数量排序稳定性及其与保存顺序不同情况下的显式重排撤销/重做。手动缩放以约 9% 递增，长片可用“30 秒视窗”直接进入逐句尺度。

Windows 默认使用已安装 Microsoft Edge（真实 Chromium），也可 `WEBUI_BROWSER=chrome`。若使用 Playwright 自带浏览器，先安装：

```powershell
# 已安装 Edge 时无需此步；需要自带 Chromium 时：
# npm --prefix webui/frontend exec -- playwright install chromium
# $env:WEBUI_BROWSER = 'chromium'
npm --prefix webui/frontend run typecheck
npm --prefix webui/frontend run build
$env:WEBUI_PYTHON = 'D:\whisper-diarization\env\python.exe'
$env:WEBUI_BROWSER = 'msedge'
npm --prefix webui/frontend run test:browser
```

测试自动启动实际 Python 服务于 `127.0.0.1:18761`（该端口须空闲），浏览器使用生产构建；请在前端修改后先 build。生成素材和工程在被忽略的 `webui/frontend/.test-workspace/`，测试服务结束自动停止，文件保留便于检查；测试结果/失败 trace 在 `webui/frontend/test-results/`。`editing.spec.ts` 覆盖真实播放定位、保存重开、共享视图、历史/焦点/草稿、自动保存、延迟/丢失回执、导出快照、修订冲突与失败重试。`exchange.spec.ts` 覆盖五种导入、预览错误/取消/文件变化、整体替换的一步撤销重做、完整来源/身份保存重开、四种实际文件和元标签开关、MOSS 重导入。失败、延迟及丢失回执在公共 HTTP 边界注入；延迟/丢失前实际请求服务落盘，其余闭环也由真实前后端参与。

`timeline.spec.ts` 使用三个普通人物、两个特殊标签、同时间/同轨/跨轨重叠夹具，覆盖轨序与计算样式配色、双视图选择/编辑/实际文件不重复、换轨边界及历史/重开、键盘与输入焦点、播放期间草稿不被替换、缩放与双向滚动、Pointer Capture 拖动/取消及媒体边界。读取浏览器实际解码帧，验证 1 秒与 6 秒画面不同，缩放滚动后拖到 6 秒与点击 6 秒字幕得到相同原片帧；片尾 7999–8000 ms 的同轨条目仍可分别点击。导航后 HTTP 文档保持原值，媒体 Range 返回 206。

`speakers.spec.ts` 使用同轨重叠、组合标签、特殊轨、重复来源索引及元标签夹具，从真实 Edge 操作新增/改名/颜色输入/原生拖放排序/明确合并/删除（含空轨），通过公共 GET 读取完整工程，核对身份、引用、颜色、顺序和不变的字幕字段。覆盖各操作的一步历史与自动保存重开、重排后换轨/撤销恢复目标、特殊轨锁定、取消拖动/冲突/无效输入不写历史、Ctrl+S 提交人物草稿、重复编辑不回填旧名称。成功截图保留于 `webui/tests/evidence/ticket-05-speaker-management.jpg`。HTTP 回归另验证重复名称的合并提示、特殊身份/语义/位置保护、悬空引用拒绝、完整配置及归属的原子保存与恢复。

`drag-timing.spec.ts` 通过真实 Edge `mouse.down/move/up`、键盘 Esc 和滚轮验证横/纵/斜拖、两端 resize、总览/无效归属目标、片头片尾/1 ms 边界、重叠保留、吸附开关及播放头/字幕边界、1×/2×/8× 缩放与双向滚动。按住超过 650 ms 后读取公共 GET，确认预览没有落盘；释放后核对完整工程的条目身份、时间、人物、元标签、来源和全部未选条目。一手势一步撤销/重做，取消不清重做分支，保存重开一致；极短 4 px 点击块可移动和独立拖两端，8× 下验证 1 ms 微调与按屏幕距离吸附。截图：`webui/tests/evidence/ticket-06-drag-timing.jpg`。单独运行：`npm --prefix webui/frontend run test:browser -- drag-timing.spec.ts`。

`multiselect.spec.ts` 使用三个普通人物、特殊标签、同时间重叠及重复来源索引夹具。11 项真实 Edge 用例覆盖 Ctrl/Shift/框选、滚轮跨视图去重、实际视频持续播放、共同/混合属性、显式批量改人、整体时间夹取、键盘及鼠标重排后轨道偏移、越界全拒绝、批量边缘调整、2× 吸附、输入焦点、Delete、Esc、完整历史与自动保存重开。按住超过保存延迟后从公开 GET 验证预览未落盘；每种编辑比较完整条目集合（身份/时间/人物/文本/元标签/来源），证明未选条目不受影响。另覆盖撤销整体替换后的失效选择清理。截图：`webui/tests/evidence/ticket-07-batch-editing.jpg`。单独运行：`npm --prefix webui/frontend run test:browser -- multiselect.spec.ts`。

`structure.spec.ts` 的 9 项真实 Edge 用例覆盖片头/普通位置/片尾新增、终点拒绝、明确空轨与未知归属、空白和取消不落盘；按钮/Ctrl+B 严格内部单选拆分且两段复制全文；按钮/Ctrl+M 连续性、同时间/间隙/嵌套重叠、跨人明确选择及取消；一步撤销/重做完整身份/来源/元标签、保存重开。按全体条目检查连续性，包括同人物轨中被另一人物插入、拆分两段中被重叠字幕插入的情形，为后续筛选保持正确语义。导出闭环通过实际文件及 HTTP 下载核对四格式时间排序/重新编号、重复来源索引、无来源新增、SRT 元标签开关、MOSS 重复来源 ID 与唯一输出 UUID，确认输入文件未被覆盖。截图：`webui/tests/evidence/ticket-08-structure-editing.jpg`；最近一轮导出路径清单：`webui/frontend/.test-workspace/ticket-08-artifacts.json`。单独运行：`npm --prefix webui/frontend run test:browser -- structure.spec.ts`。

`review.spec.ts` 的 7 项真实 Edge 用例覆盖搜索/人物过滤不制造全体连续性、350 ms 短句的列表与轨道双击终点、0.5× 循环/2× 试听/退出/跳转、重叠多行与标签开关、草稿提交才更新叠加、播放中另一条编辑与输入快捷键、三面板/上下拖动及 Esc 恢复、1100×800 布局、帮助和真实菜单导出，另检查片尾循环及删除试听目标后的停止/撤销。使用真实媒体与公开 GET 核对导航不改工程；与 `structure.spec.ts` 一同覆盖过滤后的结构编辑边界。单独运行：`npm --prefix webui/frontend run test:browser -- review.spec.ts`。实际浏览器观察截图：`webui/tests/evidence/ticket-09-review-workspace.jpg`（1.2 秒原片、两条重叠多行/人物标签、编辑选择和播放高亮）。

`resources.spec.ts` 的 5 项真实 Edge 用例组合 JSONL/MOSS 导入及替换、人物改名/颜色/排序、拆分/合并后另存为，核对完整来源（重复原索引、MOSS 段 ID）、元标签、人物和媒体身份；覆盖副本独立修改、切换前有效草稿落盘、无效字幕/人物草稿及保存/复制失败、重试恢复。移动实际测试原片后离线重开编辑，拒绝错误原片，再重定位恢复 4 秒播放位置并实际播放；短片新工程越界失败，另一等长原片成功新建。资源打开用真实 Explorer：通过 Shell.Application 查询实际窗口目录/HWND，核对实际导出文件，随后只关闭该测试目录窗口。证据为 `tests/evidence/ticket-10-export-location.json` / `.jpg`、`ticket-10-relocated-resources.jpg`；另有 OpenChamber 浏览器人工操作截图 `ticket-10-manual-save-as-export.jpg`。单独运行：`npm --prefix webui/frontend run test:browser -- resources.spec.ts`。

`preview.spec.ts` 使用真实 FFV1/PCM Matroska（9 秒、320×180、25fps、起始 PTS +5 秒）。Edge 会识别音轨但无法解码视频，测试检查 `videoWidth === 0`，然后从 UI 生成实际副本、播放/定位、逐句与 2× 循环试听、重开复用和两档参数切换。浏览器 canvas 读取 1/5/8.5 秒的红/绿/蓝帧，Web Audio 解码实际 HTTP MP4 并在对应时间检查 440/880/1320Hz 音频及字幕叠加；HTTP 测试另验证 3/7 秒黑场静音保留、+500ms 音轨延迟和无音轨素材。频率证据是实际解码样本测量，不是人工听感结论。

同文件的 54 秒/1280×720 夹具验证后台进度与自动保存、晚到任务/保存回执、未提交草稿及工程切换组合；真实请求先完成，回执在公共 HTTP 边界延迟，核对两份工程的实际保存结果。缺工具用独立空闲端口服务和实际可执行文件配置：缺失路径 → 错配真实 ffprobe 导致转码失败 → 安装现有 ffmpeg 到测试配置位置 → UI 重试成功。各服务在测试结束退出。截图和机器可读结果在 `tests/evidence/ticket-11-*`；产物与任务日志保留在 `.test-workspace/preview/` 和 `.test-workspace/projects/<id>/`。单独运行：`npm --prefix webui/frontend run test:browser -- preview.spec.ts`。

`timeline-media.spec.ts` 的 7 项真实 Edge 验收使用已知在 1 / 5 / 8.5 秒出现的 100ms 声音脉冲及红/绿/蓝画面，验证 1× / 2× / 8×、水平滚动、1100 / 1800 / 1440 宽度下，实际 SVG 峰值与 JPEG 图像的位置对齐刻度；波形 SVG 不超过视口宽，图片节点数量受视口限制。另验证 +5 秒 PTS、+500ms 音轨延迟、切换实际兼容副本前后证据不移动、无音轨、重开缓存、旧 GET 晚于新密度任务、晚到任务/自动保存回执与工程切换、真实缺/错工具后的保存和 UI 重试，以及生成等待真实保存回执时同工程刷新不丢弃已点击的生成意图。进度验收分开覆盖：54 秒/1280×720 纯色素材可能不到一轮 UI 查询就处理完，允许直接显示成功；240 秒/1920×1080/25fps 移动 H.264 素材验证至少两个递增的真实中间值、实际进度条、活动任务去重、未完成产物 409。后者只在 HTTP 边界暂缓后续浏览器查询以核对真实快照，worker 始终继续运行；不加入生产延时，不增大原 5 秒观察断言。自建移动原片首次生成后保存在忽略的测试目录复用，各次工程/任务仍独立。`test_timeline_media.py` 的 5 项 HTTP 检查真实波形/帧像素、实际已输出帧数、延迟音轨与预览重新生成证据的一致性、无音轨、重启复用、参数/源身份/产物完整性失效和并发保存。单独运行：

```powershell
& $env:WEBUI_PYTHON -m unittest webui.tests.test_timeline_media -v
npm --prefix webui/frontend run test:browser -- timeline-media.spec.ts
```

证据：`tests/evidence/ticket-12-timeline.jpg`（脉冲）、`ticket-12-delayed-preview.jpg`、`ticket-12-retry.jpg`、`ticket-12-alignment.json`（Edge 版本及实际布局/峰值）、`ticket-12-progress.json`。另在 18764 用 OpenChamber 浏览器实际新建、分别生成三种媒体资源、跳到 5 秒、重开复用，截图为 `ticket-12-manual-reopened.jpg`；仅操作自建样本，验收服务结束后停止。

进度修复证据：`ticket-12-progress-diagnosis.json` 保留真实 FFmpeg 原始 frame / out_time_us 对照、原 0→100% 采样遗漏及旧时间算法反证；`ticket-12-running-progress.jpg` 和更新的 `ticket-12-progress.json` 为真实持续进度；`ticket-12-fast-progress.json` 为原 54 秒素材只收到成功回执的闭环。排查与针对性压力复验命令和红绿结果见 `.scratch/webui/issues/12-waveform-and-thumbnails.md`。

`long-film.spec.ts` 生成实际 7200 秒 H.264/AAC MP4（160×90、1fps、连续音频），用 4000 条、多行、26 人物验证列表/时间轴可见范围、片尾滚动、搜索、缩放、横纵滚动卸载与重挂载、播放中编辑、一步历史、结构、人物改名、保存重开与四种完整文件。重叠长片用例验证同时间同人物错层、双视图框选去重及跨视窗卸载后的十条选择、批量删除和完整身份恢复。`integration.spec.ts` 将来源标签、人物排序、双视图多选、重排后批量换轨、过滤下完整连续性、拆分合并、无效输入、保存故障/重试、独立副本及四格式串成同一编辑链。

同文件另有开放长人物名的可见范围回归：名称不撑高虚拟轨道，纵向滚动后仍可点击和框选字幕；只改变呈现，不改写人物标签。

`launcher.spec.ts` 从非 checkout 目录实际运行 `start.cmd`，用 Python webbrowser 的 `BROWSER` 环境变量自动打开已安装 Edge 的独立测试 profile，通过 DevTools 观察**启动器打开的页面**（不自行导航），检查 UI 与缺失 Python 的错误。辅助服务、浏览器和进程树结束清理；其 workspace/profile 留在忽略的测试目录，不改用户默认浏览器资料。`test_launcher.py` 用无第三方包的临时 Python 环境验证缺依赖的安装指令，另用隔离副本验证缺前端 build 的失败说明。

```powershell
npm --prefix webui/frontend run test:browser -- long-film.spec.ts integration.spec.ts launcher.spec.ts
& $env:WEBUI_PYTHON -m unittest webui.tests.test_launcher -v
```

### 手动检查用自建素材

```powershell
& $env:WEBUI_PYTHON -m webui.tests.serve --port 18762 --root 'C:\Users\machi\AppData\Local\Temp\opencode\webui-01-demo'
```

终端打印 `短片.mp4` 和 `来源.srt` 的路径。在浏览器打开 <http://127.0.0.1:18762>，使用这些路径新建工程。该命令只创建自建样本和独立工程，使用 Ctrl+C 结束。

### 开发

```powershell
# 终端一，checkout 根目录
& $env:WEBUI_PYTHON -m uvicorn webui.backend.app:app --host 127.0.0.1 --port 8765
# 终端二，checkout 根目录；Vite 将 /api 转发到 8765
npm --prefix webui/frontend run dev
```

## 公共服务接口

公开 HTTP schema：运行后访问 `/docs` 或 `/openapi.json`。JSON 字段采用 snake_case；所有内部时间是整数毫秒。

| 接口 | 输入/结果 |
| --- | --- |
| `GET /api/health` | `{status: "ok"}` |
| `POST /api/files/pick` | `{kind: media\|subtitle, format?, current_path?}` → `{path: 绝对路径或null}`；打开本机系统文件选择窗口，取消返回 null，已有窗口返回 409，不创建/修改工程 |
| `POST /api/imports/preview` | `{media_path, subtitle_path, format?}` → `{media, subtitle_sources, speakers, entries, fingerprint}`；完整校验、不落盘；默认 plain-srt |
| `POST /api/projects` | 上述路径和格式加 `name, preview_fingerprint?` → 完整工程，HTTP 201；重新读取并完整校验，指纹不符返回 409/source_changed；UI 总是带指纹 |
| `GET /api/projects` | `{id, name, revision, media, media_missing, error}` 列表，异常工程保留可见错误 |
| `GET /api/projects/{id}` | 完整保存文档；未知版本报错，缺失媒体仍返回完整工程 |
| `PUT /api/projects/{id}` | `{revision, name, entries, speakers?, subtitle_sources?}` → 完整工程，新修订；这是预览的原子应用/保存边界。来源、人物和条目一起验证并保存；媒体固定。省略可选字段保留原配置 |
| `GET /api/projects/{id}/media` | 原视频，标准字节 Range/206/416 |
| `POST /api/projects/{id}/exports` | `{revision, format?, keep_tags?}` → `{project, export, url}`；默认 speaker-srt / false；按指定修订生成实际文件，登记使工程修订递增 |
| `GET /api/projects/{id}/exports/{export_id}` | 已登记导出文件下载 |
| `POST /api/projects/{id}/save-as` | `{revision, name}` → 独立完整工程，201；复制已保存修订，原媒体引用不变 |
| `POST /api/projects/{id}/relocate` | `{revision, media_path}` → 原工程新修订；只接受同一完整文件身份和时长，保留编辑内容/缓存引用 |
| `POST /api/projects/{id}/new-media` | `{revision, name, media_path}` → 独立工程，201；带入字幕副本，按新媒体时长完整验证 |
| `GET /api/projects/{id}/resources` | `{project_id, revision, media, subtitle_sources, working_subtitles, media_artifacts, exports}`；每项带路径/身份及可用状态 |
| `POST /api/projects/{id}/exports/{export_id}/open-location` | 实际打开已登记导出所在目录，返回 `{project_id, export_id, path, opened}`；不存在/打开失败分别报错 |
| `GET /api/projects/{id}/playback?quality=standard` | `{project_id, source, preview, task, url}`；实际源容器/编码/时长/起始 PTS、有效副本与最近任务；质量为 standard/small |
| `POST /api/projects/{id}/preview` | `{quality?: standard\|small}` → 202 任务；状态 queued/running/succeeded/failed、progress 0–1、error、artifact_id、cached；同源同参数活动任务去重，有效缓存立即返回 succeeded/cached |
| `GET /api/projects/{id}/tasks/{task_id}` | 持久任务状态/进度/错误、工具版本与实际命令；工程切换不改变任务归属 |
| `GET /api/projects/{id}/previews/{artifact_id}` | 只读取已登记且身份/参数/产物完整性有效的 MP4；Range/206/416，失效返回 409 |
| `POST /api/projects/{id}/timeline-media/{kind}` | kind 为 waveform/thumbnails，`{density?: standard\|detailed}` → 202；复用同一队列/任务状态、活动去重、失败和有效缓存规则 |
| `GET /api/projects/{id}/timeline-media/{kind}?density=standard` | `{project_id, artifact, task, url}`；仅返回匹配当前参数及完整身份的资源与同种/同参数最新任务 |
| `GET /api/projects/{id}/timeline-artifacts/{artifact_id}?start_ms=0&end_ms=9000&bins=1000` | 波形：`{duration_ms, has_audio, peaks:[{start_ms,end_ms,peak}]}`，按基础采样网格聚合，bins 为目标数量（1–4096，边缘可多一格）；无音轨 peaks 为空。缩略图：`{duration_ms,interval_ms,width,height,frames:[{time_ms,url}]}` |
| `GET /api/projects/{id}/timeline-artifacts/{artifact_id}/frames/{index}` | 读取有效 ZIP 中的一张实际 JPEG；越界 404、未完成/缺失/损坏/参数过期 409，源变化 409 |

错误：`{error: {code, message, field, entry}}`，SRT/MOSS 条目位置 `entry` 从 1 开始，JSONL 使用物理行号（含空行），文件级错误为 null。保存使用修订比较和同目录临时文件/fsync/原子替换；失败不覆盖现有文件。创建先完整验证，临时工程目录原子发布。`speakers` 为完整配置数组：身份/名称唯一、六位十六进制颜色、`order` 从零连续；最后两项为身份固定的 `?`、`NONSPEECH`。字幕只能引用本次配置中的有效人物与来源身份；整体替换预览的新人物 ID 应先映射到现有同名人物（尤其两个特殊轨）再提交。所有导出记录含 `format / keep_tags / revision`。工程版本仍为 1，旧 plain-srt 文档缺少的新增来源/导出字段按空值加载。

后续票可扩展 `backend/models.py` 的文档与请求 schema、`formats.py` 的格式边界；前端 `api.ts` 定义相应传输类型。`App.tsx` 管理选择/草稿和校验，列表/总览/人物轨按同一条目 ID 选择。

### 媒体身份、预览任务与缓存接缝

- `Media.identity` 是 `sha256:<完整文件摘要>`，`size_bytes` 为字节数，`path` 是当前原片绝对路径，`duration_ms` 始终为原片时长。新建/换片时流式计算，重定位比对全文件内容和时长；路径、文件名及修改时间不是持久身份。进程内只缓存最近 32 个文件签名（路径、大小、mtime、ctime、inode）对应的完整摘要，签名变化重新计算；计算期间变化报 `media_changed`。首读整片需要顺序读取原文件。
- 原片读取用 `verify_media` 核对身份，原路径被另一文件替换返回 409/`media_identity_mismatch`，不会默默播放错误原片。资源清单状态为 `available / missing / changed / unavailable / unverified`，编辑文档读取和保存不依赖媒体在线。
- 版本仍为 1，旧文档缺失的身份/大小默认为 null、`media_artifacts` 默认为 `[]`。旧工程原片在线且时长匹配时，在读取/列出时原子补记身份并递增修订；若早已失联且没有摘要，仍可编辑，但不能证明任意新路径属于同一原片，重定位返回 `media_identity_unknown`。先恢复原路径并打开以补记，或用新视频建立独立工程；不凭文件名/时长猜身份。
- `Project.media_artifacts` 记录**已经成功发布**的派生产物：`{id, kind: preview|waveform|thumbnails, path, media_identity, parameters, output_identity?}`。预览必须同时匹配源摘要、当前全部参数及产物摘要；旧记录没有 `output_identity` 时保留引用但不作为可播预览。同一原片重定位保留有效引用；另存为/换片新工程清空缓存与导出登记，避免共享可写产物。
- `backend/preview.py` 单 worker 排队执行 FFmpeg，进度来自 `-progress`，任务记录与 stderr 在 `<工程>/tasks/`。先写 `<工程>/previews/<task>.partial.mp4`，成功后检查实际编码/起点/时长、再次核验源身份，原子改名及登记；失败/运行中的文件不进入资源数组或播放接口。服务重启后未完成任务查询标为 failed/`task_interrupted`，允许重试；不自动恢复转码。
- 资源登记在与 PUT 相同的锁内**重读最新工程，只追加资源**，不递增字幕编辑/导出的 `revision`。PUT 也重读最新资源，只更新编辑字段。这使后台完成不会制造编辑修订冲突或覆盖字幕/人物/导出；客户端资源刷新与字幕保存/历史独立，按工程身份和请求代次丢弃过期播放/任务回执。
- `backend/timeline_media.py` 在同一任务队列中生成 `<工程>/timeline-media/<task>.json`（零起点、明确 step_ms 的峰值数组）和 `.zip`（manifest.json 的原片采样时间与 JPEG）。WAV / JPEG 中间文件在任务专属临时目录，结束即清理；JSON / ZIP 在原子发布前也先写 `.partial`。资源清单及各读取接口验证源身份、当前版本/密度的全部参数和整个产物摘要。范围接口只回传需要的聚合峰值，解析后的不可变数据采用有界进程缓存；不把全片 PCM 送进浏览器。
- 缩略图的实时任务会给出 `progress_source: sampled_frames` / `processed_frames`，百分比按 FFmpeg 实际输出帧数 × 采样间隔 / 原片时长计算，验证/打包完成前最多 99%。`-copyts` + image2 的 `out_time_us` 实测可能从首批输出才起算，不能代表已覆盖的原片采样时间；不能为了百分比而移除共同时间基准。预览/波形仍保留既有计时进度路径。快速任务允许在两次 250ms 查询间结束，不保证浏览器看见每个中间状态，也不为显示百分比故意停留；缓存立即成功的任务不要求包含采样帧遥测。
- `ProjectResources.tsx` 在工程 ID/修订变化或用户刷新时读取公开资源清单；`useProjectSession.persist()` 返回保存是否成功供切换门禁，失败仍保留草稿/历史。`relocate(project)` 只更新媒体与磁盘修订，不重置字幕历史；新工程 `open(project)` 建立新会话。

`SourceTimeline.tsx` 负责原片坐标、缩放/滚动、刻度、轨内错层和 pointer 手势。接收同一 `project / selected: Set<Entry.id> / position`，通过 `onChoose(entry, modifiers?)` 请求选择、`onSeek(integerMilliseconds)` 请求播放定位；自身只持有临时手势，不维护第二份持久字幕。`onBeginEdit(id)` 先校验/提交已有表单并返回有效选择条目数组，暂停但不跳播放头；`onPreview(entries | null)` 同步 App 的临时列表/字段/播放叠加；`onCommitEdit(entries)` 在释放时一次提交整个集合的时间和归属。`onBeginSelect / onSelect(Set<id>) / onEndSelect` 承载框选校验、ID 去重与取消恢复，不调用播放定位或历史。预览不进入 `session.commit`，布局保持提交前轨道高度以免命中目标在手势中移动；释放后重新错层。取消、无变化或无效表单不产生拖动历史。坐标以原始条目整数时间为基准，不使用最小点击宽度反推时长。`selectionEditing.ts` 的共同轨道偏移供键盘与鼠标复用；`BatchEditor.tsx` 展示共同属性，仅暂存明确目标，提交由 App 构造单个完整快照。

`SpeakerManager.tsx` 展示人物卡片、配置表单和显式合并目标，只持有拖放/目标选择等界面状态。人物配置草稿由 `App.tsx` 与字幕草稿统一校验/提交；新增/修改/重排/合并/删除构造一个完整不可变工程快照，通过现有 `session.commit` 进入同一历史与保存队列。人物操作后按当前选中字幕的稳定 ID 刷新归属字段，避免旧草稿重新创建已合并/删除的人物；重排不会更换人物或字幕身份。

`structureEditing.ts` 的 `mergeSelection(project, selectedIds)` 直接接收完整工程、按 `project.entries` 检验连续性。搜索/人物筛选只过滤列表呈现，不把过滤后的列表传入合并判定。`App.tsx` 构造新增/拆分/合并的单次不可变快照；`AddSubtitleDialog` / `MergeSubtitleDialog` 用原生模态 dialog 隔离未提交输入，取消不进入 session。`SourceTimeline` 的 `currentTrack / onTrack` 为显式新增目标，轨道选择不改字幕、播放位置或历史。

`useAudition.ts` 持有独立的试听条目身份与循环状态，用真实 video 时间同步播放头；播放期间逐帧检测终点，`timeupdate` / `ended` 也走同一边界处理。终点暂停并定位准确结束毫秒；循环回到当前已提交起点，编辑选择变化不会替换目标。`SourceTimeline.onListen` 从 pointer capture 所在滚动区处理原生双击，仅已完成的未移动单击可触发试听。`WorkspaceSplitter.tsx` 只管理临时尺寸手势，支持指针捕获、取消和键盘；不调用工程提交。`WorkspaceHelp.tsx` 集中记录当前已实现操作。

`useProjectSession.ts` 统一管理有效工程、历史与保存：

- `open(project)` 建立新会话；`commit(project)` 提交一个不可变有效快照，整次操作进入一步历史；`travel(redo)` 撤销/重做。调用方不得原地修改工程数组/对象。
- 历史恢复 `name / entries / speakers / subtitle_sources`，不回退磁盘修订或导出登记。后续结构/批量/人物操作应在一次完成时调用一次 `commit`，手势预览留在草稿层。
- `persist()` 保存；`persist({format, keep_tags})` 捕获调用时的工程与导出选项快照，串行执行保存和导出登记。每次本地编辑有单调递增代次，回执只更新服务修订/导出信息及对应代次的确认状态，不替换当前正文/人物/来源或草稿。
- `pauseAutosave / resumeAutosave` 用于工程切换或导入对话框；请求进行时暂缓切换，打开另一工程后旧会话回执失效。整体替换通过一次 `commit` 更新 `entries / speakers / subtitle_sources`，由现有历史与保存队列持久化；失败/取消预览不提交。
