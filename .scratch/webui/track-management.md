# 轨道交互与工程管理

Status: done
Blocked by: none

基线 `1a60a27`；保留此前未提交的 retro 文档与 CI 改动。本任务只修改 WebUI、相关文档及测试；模型 API 预算 0。

## 用户确认

- 修复拖动排序不跟手、松手突然换位；180 ms 长按激活、跟随预览与让位动画，取消无历史、释放一步提交。
- 参考用户剪映截图：中性深灰轨道、紧凑图标控制、清晰标签和低噪声字幕块。
- 保留重命名/合并（手动标签匹配）、删除人物转未标注；新增确认后“删除轨道及字幕”，可撤销。
- 完整锁定：禁止字幕正文/时间/归属、移入移出、轨序与人物名称/合并/删除；保留查看、播放、导出、隐藏。持久化并可撤销。视频/波形只读；总览锁定控制全部字幕轨。
- 工程删除移入回收站，7 天内可恢复，到期永久清理工程自身数据；不删除原片及导入字幕。服务运行时周期清理，关闭期间到下次启动清理。

## 验证

真实浏览器复现短长按、移动前后预览位置、提交/取消和跨视窗；HTTP 验证锁定字段兼容、工程回收/恢复/过期/媒体任务互斥。构建、Python 编译、相关浏览器和完整后端测试。

## Comments

2026-10-20 完成，基线后的改动仍未提交。

- 180 ms 激活；拖动中整轨跟随、相邻轨让位、插入线和边缘滚动。释放动画从最后预览位置衔接；补充实际坐标断言，防止释放后跳回起点。取消不保存，释放一次历史。
- 深灰轨道、紧凑锁定/可见性/管理按钮、字幕计数和青色反馈；桌面 1440×900 检查锁定轨，768×1024 检查回收站对话框。
- 手动匹配通过重命名/合并；旧删除人物转 `?`，新增整轨及字幕删除需确认，撤销完整恢复。
- 锁定由各编辑入口统一实施，保留查看、播放、导出与隐藏；持久化并可撤销。曾尝试后端比较旧锁定快照，但这会误拒绝解锁→编辑→再锁定和连续撤销的合并保存，已移除该限制。HTTP 保存保留完整快照语义，锁定字段不作为 API 写权限；旧客户端省略字段不会意外解锁。
- 工程移入 `.trash`，7 天到期；启动/每小时/查看回收站时清理。活动媒体任务阻止删除。文件占用导致清理失败保留到期记录，后续重试；过期工程不能在等待重试期间恢复。恢复递增修订，旧页面不能覆盖。

### 最终验收

| 检查 | 结果 |
| --- | --- |
| `npm --prefix webui/frontend run build` | 通过；TypeScript + Vite |
| `env\python.exe -m py_compile webui/backend/app.py webui/backend/models.py webui/backend/speakers.py webui/backend/recycle.py webui/tests/test_http.py webui/tests/test_recycle.py` | 通过 |
| `env\python.exe -m unittest discover -s webui/tests -p 'test_*.py' -v` | **51/51**，51.602s |
| `npm --prefix webui/frontend run test:browser -- --reporter=line` | **106/106**，5.6m，真实 Edge |
| 新增释放坐标断言后：`npm --prefix webui/frontend run test:browser -- '[/\\](track-management\|editor-controls)\.spec\.ts$' --reporter=list` | **11/11**，22.3s；仅测试新增断言，生产源码与完整回归相同 |
| `git -c core.safecrlf=false diff --check` | 通过 |

浏览器命令设置 `WEBUI_PYTHON=D:\whisper-diarization\env\python.exe`。日志中的 Windows 断连记录与 Vite 的 lucide `use client` 提示保留；没有失败用例。

本轮[日志及截图](../../webui/tests/evidence/track-management/)使用独立目录。测试覆盖的旧证据已按运行前备份逐文件恢复，27 个新生成的历史附件已移至临时归档；此前维护/CI/文档改动保留。自建测试 workspace 与演示素材仍保留，未清理用户工程。
