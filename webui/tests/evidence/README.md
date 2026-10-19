# WebUI 精选验收记录

2026-10-18 按用户要求清理已合并工作树，并精简历史测试记录。当前目录保留 **52 份精选证据**，另有本索引和清理清单；原有 203 份记录保留 34 份，删除 169 份，补入 18 份重要本地记录。

## 优先阅读

| 目的 | 记录 |
| --- | --- |
| 最终集成、独立 Standards / Spec 复审与结论 | [最终审查记录](../../../.scratch/webui/final-review.md) |
| 十组功能验收、测试入口与规模限制（票 13 历史轮次） | [验收矩阵](ticket-13-acceptance.md) |
| 主目录最终实际验收：后端 42/42、真实 Edge 84/84 | [后端完整日志](final-integration/final-review-integration-backend.log)、[浏览器完整日志](final-integration/final-review-integration-browser.log)、[passed 记录](final-integration/browser-last-run.json) |
| 最终受测源码/构建摘要、工具环境及执行参数 | [verification](final-review/verification.json)、[commands](final-review/final-commands.json)、[environment](final-review/cleanup-environment.json) |
| 4000 条 / 7200 秒工程的规模与输出记录 | [最终集成采样](final-integration/ticket-13-scale.json)、[组合编辑与输出](final-integration/ticket-13-combination.json)、[界面截图](final-integration/ticket-13-long-film.jpg) |
| 实际 Windows 启动及导出目录 | [启动记录](final-integration/ticket-13-launcher.json)、[Explorer 回执](final-integration/ticket-10-export-location.json) |

`final-review/` 是修复工作树的验收；`final-integration/` 是随后在主目录实际执行的独立集成验收，两轮结果不混用。后者从主目录已有的 `webui/frontend/.test-workspace/final-review-integration-verified/` 原字节提取，并逐文件核验 SHA-256。本次清理没有重跑测试。

## 保留的关键故障记录

- 预览旧 GET / 新质量任务竞态：`ticket-11-quality-race-{red,green}.json`，以及 `final-integration/ticket-11-quality-response-order.json`。
- 缩略图真实帧数进度：`ticket-12-progress-diagnosis.json`；最终集成的 `ticket-12-{progress,fast-progress,alignment}.json`。
- Windows Explorer、异步布局吞掉点击、任务文件并发读写：`ticket-13-integration-fix/acceptance.md` 与同目录原始失败日志、红绿 JSON / 日志。
- 等待保存时刷新丢失预览生成意图、歧义 SRT 正文：`final-review/{preview,srt}-{red,green}.log`、`preview-refresh-save.json`、`relocated-source.json`。
- 票 11 / 12 修复工作树独有的最终浏览器日志：`worktree-records/`。

原始失败与成功记录均按历史内容保存。日志中的 Windows 断连异常、不可达测试尝试和历史轮次限制不作删改；摘要中的文件哈希对应当时受测版本，不是对清理后文档的新摘要。

## 清理范围与来源

[cleanup-20261018.json](cleanup-20261018.json) 记录：

- 保留的主分支及清理基线 `d742d30c38de382e51996cb556f1a84efac6878e`。
- 14 个已合并分支的完整 HEAD、原工作树路径及删除前文件体积。
- 34 份原有证据、18 份提取记录的原始字节大小与 SHA-256。
- 169 份已删除的已跟踪证据及各自的 Git 恢复位置。

已移除 `feat/webui-01` 至 `feat/webui-13`、`feat/webui-review-fixes` 及其工作树。重复截图、重复回归副本、大体积 trace 和工作树内的生成媒体、测试工程、依赖/构建缓存已清理；不为这些临时素材另建整批备份。主目录 `feat/webui`、现有主目录 `.test-workspace/` 和工作树外的验收/演示目录保留。

## Historical artifacts

旧票 Comments、验收报告、JSON 和清单中的绝对路径、截图链接及“工作树/素材保留”描述是**当时的历史记录**。清理后，旧工作树路径不再可用；已删的历史附件以清理基线中的版本为准。当前入口以上表及本清单为准。

在仓库根目录读取历史文本：

```powershell
git show 'd742d30c38de382e51996cb556f1a84efac6878e:webui/tests/evidence/ticket-13-acceptance.md'
```

如需恢复某个已提交的历史附件（会写回该路径）：

```powershell
git restore --source=d742d30c38de382e51996cb556f1a84efac6878e --worktree -- webui/tests/evidence/ticket-01-workspace.jpg
```

该恢复方式只适用于 Git 中的文件；已清理且未纳入 Git 的生成媒体、工程和缓存不能据此恢复。重新验收可使用 `webui/README.md` 的测试入口生成新素材，新一轮结果不替代本目录历史记录。
