# 开发约定

## 任务与工作树

- 同一工作树由一个任务写入；并行实现使用独立工作树、分支和输出目录。
- 开始时核对分支与工作区改动，明确本次目标、涉及模块和验收方式。
- 规格与任务使用 [本地 Markdown tracker](agents/issue-tracker.md)；临时明确的小改动直接执行。
- 提交按目标组织。算法实验、默认值调整和数据清理分别记录。

## 验证

Python 修改至少编译改动文件，使用现有环境：

```powershell
env\python.exe -m py_compile <changed-python-files>
```

按改动范围执行：

| 范围 | 验证 |
| --- | --- |
| WebUI | [构建、后端和浏览器检查](../webui/README.md#可重复验证)；浏览器测试前构建 `frontend/dist` |
| Voice | [推理与字幕关联测试](../voice/README.md#validation)，保持原片时间基准 |
| Normalize | 检查条目结构、来源关联、SRT/JSONL 往返；保留人工 Gold 修订 |
| Scene | 先运行下方计划检查，再检查生成结果的完整覆盖和语义边界 |
| Gemini | 先运行下方请求计划；媒体构造变化时先用 `--prepare-only` 检查 clips |
| 标注准确率或默认值 | 代表性片段回归后做 [Gold 评估](reference/evaluation.md)，依据结果决定是否扩大到全片 |
| 文档 | 检查相关链接、路径和命令参数，核对当前状态与历史记录的区分 |

Scene 计划检查：

```powershell
env\python.exe sub\llm\scene_segmenter.py "Cosmic Princess Kaguya" --llm-plan-only
```

Gemini 请求计划检查（`<scene-json>` 使用与输入字幕对应的文件，输出为本次独立目录）：

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "Cosmic Princess Kaguya" --segments-json "<scene-json>" --compact-video --plan-only --max-segments 0 --output-dir "<run-dir>"
```

归一化改变字幕结构后，重新检查下游场景和请求计划。场景或提示词的效果以标注评估衡量。默认值调整在实验结论明确后单独提交。

WebUI 的 Linux CI 覆盖构建与 Python HTTP/媒体检查；Windows 桌面和浏览器行为使用本机测试。记录实际执行的命令、失败及修复复跑，并将证据关联到受测版本。

## 模型实验

每次实验使用独立目录，例如 `sub/intermediate/<project>/experiments/<run-id>/`。记录：

- 代码提交与本次未提交改动范围。
- 输入媒体、字幕、场景文件及其版本/哈希。
- 模型、prompt 选项、分批参数、输出目录和实验目的。
- 实际 API 用量、运行结果与评估结论。

付费调用按本次任务约定的范围和预算执行。结果目录保存原始响应与有价值的评估记录；清理按根目录的数据约定处理。

## 审查与交接

WIP 审查覆盖已提交差异、暂存区、未暂存改动和相关未跟踪文件。完成记录注明验证范围；跨模块任务还需验证连接处的行为。交接保留复现命令、必要文件路径和未决问题。
