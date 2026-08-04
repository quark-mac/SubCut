# Scene / Batch / Entry / Compact Video 概念

## 层级关系

DeepSeek scene 生成、Gemini batching、媒体构造和最终写回的完整交互式演示见 [pipeline_explorer.html](pipeline_explorer.html)。

```text
entry
  = 一条字幕，一条 idx

scene
  = 多条 entry 组成的语义/时间段
  = 给人类编辑和给 batching 做边界

batch
  = 一次 Gemini 请求
  = 可以包含一个或多个 scene

compact window
  = 从原视频里围绕 entry 裁出来的小视频窗口

compact video
  = 一个 batch 的所有 compact windows 拼起来的视频

context entry
  = 前文字幕，只给 Gemini 理解，不要求输出 speaker
```

## entry

每条字幕 = 一个 entry。有唯一 `idx`、原始 `start/end`、`text`。

```text
idx=25
start=116.69s
end=120.41s
text=ここでの"久しくなりぬ"は...
```

所有目标标注、时间映射和最终写回都依赖 `idx`。

## scene

`scene_segmenter.py` 生成。推荐由 DeepSeek 按语义事件划分，通常约 20-75 秒；字幕条数不是 scene 边界依据。

scene 的作用：

- 给人类可编辑的时间轴
- 给 batch 合并提供自然边界
- 避免 batch 从一句话中间切开

scene 在 `scene_segments.srt` 中显示为可编辑的时间段。

### LLM scene 模式

`scene_segmenter.py` 通过 `sub/llm/config.json` 调用 DeepSeek，让模型只判断标记字幕之后是否存在自然语义边界：

```text
字幕 + 前后上下文
  -> DeepSeek 输出 after_idx 切点
  -> Python 按切点组装 scene
  -> 校验所有目标 idx 恰好覆盖一次
```

`--llm-window-entries` 只是单次请求负责判断的候选边界数量，不是 scene 的长度限制。请求窗口之间通过上下文相连，但每个候选边界只归一个请求负责，因此不会因为 API 分批而人为切 scene。

脚本不再提供固定时长、字幕数或 gap 的规则分段；Python 只负责分批、校验和超长告警，不会自行决定 scene 切点。

## batch

一次 Gemini 请求。一个 batch 可以包含多个 scene。

默认按完整 scene 数 batching：

```text
--segments-per-request 2
```

规则：

```text
每次取连续 2 个完整 scene
不从 scene 中间按字幕条数切开
最后不足 2 个 scene 时作为最后一个 batch
```

`--max-request-duration`、`--max-request-entries`、`--max-request-scenes` 仍保留为可选安全阀；只要其中任意一个大于 0，就切换到预算式贪心 grouping。默认三者均为 0，因此不再用 15 条字幕限制破坏语义 scene。

旧 164-scene 全片结果：

```text
semantic scenes: 164
2 scenes/request: 82 requests
平均 entries/request: 25.7
最大 entries/request: 58
平均 compact video/request: 84.1s
最大 compact video/request: 157.8s
```

全片实测表明固定 2 scene grouping 并不总是安全：

| Request 规模 | 粗略错误率趋势 |
|---|---:|
| <=30 entries | 约 19% |
| 31-40 entries | 约 28% |
| 41-50 entries | 约 33% |
| >50 entries | 约 52% |
| <=90s compact video | 约 20% |
| >90s compact video | 约 30% |

这些数字使用不完全可靠的 `human.srt` 做粗审，只能说明风险趋势，不能当作正式准确率。当前 Gold Set 完成后，应重新比较：

```text
固定 2 scenes/request
单 scene/request
优先合并 2 scene，但超过安全阈值时退回单 scene
```

曾将预算前移到 DeepSeek refine，对超过 30 条或 90 秒的单 scene 做语义细分。实验结果：

```text
Gold sample: 156 entries
old semantic scenes: 94.87%
budget-refined scenes: 92.95%
short/interjection: 90.38% -> 84.62%
requests: 6 -> 10
```

因此没有采用预算细分结果，正式 scene 恢复为 164 个原语义 scene。当前 Gemini grouping 仍会避免把多个 scene 合并成超预算请求，但单个超大 scene 保持完整。下一步如要降低单请求 target，应测试“拆 target 输出范围，但每个请求仍附带完整原 scene 视频和字幕上下文”，而不是切断上下文。

## batch 之间的关系

每个 batch 是一次独立的全新 Gemini 请求：

```text
batch 1: 新请求
batch 2: 新请求
batch 3: 新请求
```

没有对话历史或状态继承。batch 之间的唯一连接是 script 显式构造的 context。

## compact video

两种媒体构造模式及全部前后扩展参数的交互式示例见 [media_windows.html](media_windows.html)。该页面可以切换连续/compact 模式并实时调整参数，显示哪些范围被保留、删除、合并和重新映射。

在 `--compact-video` 模式下，脚本不会把整段原片发给 Gemini。

每条 entry（包括 context 和 target）生成一个小窗口：

```text
entry.start - 1.0s
entry.end + 1.0s
```

相邻不超过 1.0s 的窗口会合并。合并后的窗口按原片顺序拼接成一个 batch 专属 MP4。

好处：

- 剪掉长空白和无对白片段
- 视频更短，成本更低
- 对有对白的地方保留完整上下文

代价：

- 密集对白片段收益不大
- 空白本身可能包含视觉信息
- 拼接处可能出现不自然的跳转

## compact 时间映射

由于视频被压缩拼接，原片时间在 compact video 中已经改变。

脚本为每个 entry 计算 compact 时间：

```json
{
  "compact_map": {
    "25": {"start": 15.09, "end": 18.81}
  },
  "context_map": {
    "20": {"start": 1.0, "end": 5.67}
  }
}
```

Gemini 收到的是 compact 时间：

```text
[25] compact 00:00:15,090 --> 00:00:18,810 text=...
```

最终写回 SRT 时，脚本用 `idx` 找回原始字幕，保留原始 `start/end`，只替换 speaker。

## context

每个 batch 有统一的 context，而不是每个 scene 各自重复提供。

规则：

- 取 batch 第一条 target entry 之前 `context_before` 秒内的字幕
- 合并所有 scene 的候选 context
- 按 `idx` 去重
- 如果某条 context 已经是当前 batch 的 target，从 context 中移除

context entry 有完整的 compact 时间映射，但 prompt 明确要求：

```text
前文上下文（只供理解，不要输出这些 idx）
```

Gemini 能看到/听到 context，但不应该输出它们的 speaker。

## 完整映射关系

```text
original SRT time   →   original video windows   →   compact video time   →   idx
(本地保留)               (ffmpeg 切片/拼接)          (发给 Gemini)            (稳定标识)
```

Gemini 的职责：

```text
compact video + compact time → 判断 speaker → 输出 idx
```

脚本的职责：

```text
idx → 找回 original entry → 写回 original SRT time + Gemini speaker
```

人工作业的职责：

```text
results.jsonl / report.md → 检查 original/compact 映射 → 确认 speaker
```
