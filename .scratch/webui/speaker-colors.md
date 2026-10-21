# 说话人稳定配色与旧工程优化

Status: done
Blocked by: none

## 规格与范围

2026-10-21 用户授权：修复所有导入/新建人物/归属输入/整体替换配色；完成只读 Standards + Spec 审查，清理本轮及上一轮已确认可再生测试垃圾，提交并推送本次和此前轨道管理/文档/测试/CI 维护成果。单写入者，付费 API 预算 0。

- 自动色避开所有既有人物（包括隐藏）的颜色，深色界面候选色板加可扩展补充，按感知色差选择，不循环复用固定色板。
- `?`、`NONSPEECH` 使用不同固定中性色；颜色保存于稳定 speaker ID，不随排序/显示变化。重命名保留颜色，合并保留目标颜色，新增不重配旧人物。
- 整体替换保留同名人物身份、颜色和可见性；先保留全部匹配色再为新人物分配。
- 保留手动选色且允许有意同色；不推断历史色来源，不静默迁移已保存工程。
- “优化轨道配色”明确预览/确认，包括隐藏人物；锁定轨（含特殊轨）保持，其他自动色避开锁定色，无法消除的固定/锁定同色明确提示。取消无历史，确认一步撤销/重做，保存重开保持。
- 检查正常/选中/锁定状态的实际颜色与文本可读性，保持紧凑深色/青色风格。不引入大型依赖。

## 诊断

基线 `1a60a27`，`feat/webui` 与 fetch 后 `origin/feat/webui` 相同。备份原有 diff 和证据，原有未提交工作全部保留。

最小红灯命令：`env\python.exe -m unittest webui.tests.test_speaker_colors -v`，0.007s：五人 normalized JSONL 导入只有四种色，第一/第五均 `#71a8cc`。四人不重复；通过真实 `read_subtitles` 入口断言。

假设：四色循环、前端固定默认色、替换未避开保留色、排序动态重算、深色遮罩降低区分。源码确认前三项；排序读取 speaker.color 不重算；遮罩与锁定透明度需真实浏览器核验。

## 验证与收尾

### 诊断与修复记录

- 初始最小红灯：`env\python.exe -m unittest webui.tests.test_speaker_colors -v`。五人 JSONL 导入仅 4 个颜色，首末均 `#71a8cc`；修复后 **3/3** 通过（覆盖 5/26/90 人及全部格式，8 色 OKLab 最小距离和文字对比）。
- 首轮真实浏览器审查发现背景色在点击悬停时被 `button:hover` 简写覆盖，渐变成为 `none`，造成白字压在浅色字幕块上；将通用 hover 改为只设置 `background-color`，保留字幕块渐变。另补播放叠加人物名字色及 DOM 实际状态对比测试。
- 审查最初的“读源码公式能推测”对比不足，已补正常、选中和锁定块实截屏、读取浏览器 computed `backgroundImage/backgroundColor/color`，按实际两端渐变合成计算 WCAG 对比。锁定块不再降透明度；固定/生成色保证深色覆盖后白字对比不低于 4.5:1。

### 最终验收（2026-10-21）

| 检查 | 最终结果 |
| --- | --- |
| `npm --prefix webui/frontend run build` | 通过；TS + Vite，最终 CSS 包含 hover 修复及预览列宽收尾 |
| `env\python.exe -m py_compile webui/backend/formats.py webui/backend/speaker_colors.py webui/backend/app.py webui/backend/models.py webui/tests/test_http.py webui/tests/test_recycle.py webui/tests/test_speaker_colors.py` | 通过 |
| `env\python.exe -m unittest discover -s webui/tests -p 'test_*.py' -v` | **54/54**，最终复跑 52.984s |
| `npm --prefix webui/frontend run test:browser -- --reporter=line` | **110/110**，最终复跑 7.8m，真实 Edge |
| 最终生产构建后定向 `speaker-colors|speakers|editor-controls|track-management` | **21/21**，1.4m；覆盖本次渲染/对比及前轮轨道功能 |
| 完整回归后仅配色预览表格列宽/内边距收尾，再 build + `speaker-colors.spec.ts` | **4/4**，9.7s；这是最后一次定向复跑，不冒充又一次完整 110 项运行 |
| 最终配色用例独立覆盖 | **4/4**，包含 90 人跨前后端一致分配、五格式导入、隐藏/替换、预览/取消/应用/撤销和正常/选中/锁定色块 |
| `git -c core.safecrlf=false diff --check` | 通过 |

最终[浏览器截图及日志](../../webui/tests/evidence/speaker-colors/)；初始红灯和背景渐变覆盖失败也保留。构建中只有既有 Lucide `use client` 提示；完整浏览器测试结束时有 Windows Proactor 断连记录，110 个用例均通过。

### 双轴审查

审查固定点 `1a60a27`；审查时 HEAD 尚无提交，范围是 `git diff 1a60a27`、暂存 diff 和每个未跟踪文件。双轴第一次发现的播放叠加颜色和“真正 computed style 的正常/选中/锁定态”两项均已修复并通过最终回归。Standards 提及算法在 Python/TS 镜像与此前未提交的维护工作同时集成；共同 JSON 色板、相同实现/入口对照和 90 人跨端测试作为不新增运行时依赖/API 的防漂移约束。用户明确授权把上轮 WebUI 功能、维护清理及本次修复一并提交，因此该范围不视为未经授权的扩项。

最终独立复审：Standards **0 剩余硬性违规**（两项初始记录问题关闭，镜像算法/协调组件为非阻塞建议）；Spec **0 剩余缺陷**（播放叠加、实际对比检查和验收记录全部关闭）。只读子代理未写文件、未代替主会话运行测试。

### 授权清理

最终回归日志、三态截图、实际 10 人 Edge 页面和配色优化预览已归档。首次清理已删除约 **508.64 MiB** 可再生测试产物；预览表格 CSS 收尾复跑新生成的 workspace/results 和两个临时日志也在归档后删除：

- `webui/frontend/.test-workspace/`（2465 文件，525218557 字节）、`webui/frontend/test-results/`（8 文件）；`playwright-report/` 不存在。
- 临时目录 `C:/Users/machi/AppData/Local/Temp/opencode/` 下：`webui-track-management-demo/`、`webui-track-management-evidence-before/`、`track-management-final-evidence-before/`、`track-management-final-generated-evidence/`、`webui-speaker-colors-20261021/`。
- 同临时根目录的 `track-management-{backend-final,browser-final,browser-release}.log` 和三张 `track-management-final-{desktop,locked,tablet-recycle}-2026-10-20T*.jpg`（仅本轮核实的确切三个文件）。有用日志/截图均已在新旧 evidence 子目录保留。
- 删除由测试新增的 27 个旧票附件；它们的完整路径在清理前与运行前备份比较输出中逐项核实。唯一被覆盖的既有非 README 文件是 `ticket-13-integration-fix/pointer-media-green.json`。清理顺序失误先移除了备份，但初始两次 `git status` 和清理前备份比较已证明该文件原本与 `1a60a27` 完全一致，因此仅此文件从验证过的 Git blob 恢复；未用 HEAD 覆盖 README 或任何原有未提交改动。
- 本轮 18769 演示服务及误启动的临时 5178 Vite 已停止；完整测试的 18761 服务已退出。8765 用户服务保持运行。未删除用户工程、源媒体、字幕、环境和私有配置。
- 另外发现更早的 `webui-picker-validation/`、`webui-usability-*` 临时目录；不属于本次/上一轮明确清理清单，保留。核对其中旧证据快照确认上述 JSON 内容与当前 Git blob 相同（仅 CRLF 差异），恢复了原 CRLF 字节。

此前维护/轨道管理成果均保留；提交按维护 CI、工程生命周期后端、轨道/配色界面及精选证据分组，推送当前 `origin/feat/webui`，不重写历史。新归档日志仅统一换行/去掉行尾空白，验证所有非空白内容不变；保留原有 Windows 控制台乱码及断连提示，未改写测试结论。

功能提交：`1506ff2`（CI/维护）、`4cdc0ce`（锁定字段/回收站后端）、`ccfd778`（轨道控制及稳定配色/显式优化）。验收证据作为后续独立提交保存。

## 审查中的处理

2026-10-21 的 WIP Standards / Spec 双轴审查覆盖 `git diff 1a60a27`、暂存区与所有未跟踪文件。用户明确要求把此前未提交的轨道管理、维护、清理、颜色修复和提交推送作为一轮集成交付；该授权是对通常“一任务只改一子系统”约束的特例，提交会按逻辑分组。

- Standards：后端/前端需在各自离线创建入口即时分配颜色，保留镜像的微小 OKLab 实现；共同 JSON 色板、同一公式注释和跨入口回归测试作为漂移防护，不为这一处引入运行时依赖或 API 往返。`App.tsx` 协调既有编辑会话，未做与当前功能无关的拆分。
- Spec：已补齐播放字幕叠加中的人物名颜色，并将浏览器检查扩展为正常、选中、锁定块的实际 class/颜色断言和实际截图。完整结果待最终复跑后写入。
