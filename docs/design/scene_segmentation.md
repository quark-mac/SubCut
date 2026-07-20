# DeepSeek Scene 分割

本文说明 `sub/llm/scene_segmenter.py` 当前如何把整部电影字幕划分为语义 scene，以及 `sub/llm/scene_srt_to_json.py` 如何处理人工调整后的时间线。

## 目标

这里的 scene 不是逐镜头的电影 shot，也不是固定长度字幕块，而是服务于后续 Gemini speaker labeling 的事件级语义段：

```text
同一个地点、事件、连续对话或叙事段落
```

目标粒度通常约 20-75 秒，但语义完整优先。曾测试让第二遍 refine 强制细分超过 90 秒或 30 条字幕的 scene；Gold A/B 显示总体准确率下降，因此该字幕数细分默认关闭。

脚本不再提供按固定时长、字幕数或 gap 机械切分的模式。Python 只负责：

- 构造局部 DeepSeek 请求
- 校验模型返回的切点
- 按 idx 组装 scene
- 复核异常 scene
- 检查完整覆盖
- 对超长 scene 告警

Python 不会为了满足 Gemini 请求预算而从 scene 中间自动切开。

## 输入

未传 `--srt` 时，按顺序读取：

```text
sub/intermediate/<project>/llm_corrected.srt
sub/intermediate/<project>/normalized.srt
```

每条字幕包含：

```text
idx
start / end
speaker
tags
text
```

当前目标字幕筛选排除：

```text
speaker == NONSPEECH
文本包含 ♪
```

其余条目参与 scene 分割。现有 speaker 和 tags 会发给 DeepSeek，只用于理解对话结构，不要求模型修正 speaker。

## 总体流程

```text
完整字幕
  -> 筛选目标 entry
  -> 把所有相邻字幕间隙分配给多个局部请求
  -> DeepSeek 第一遍输出 after_idx 切点
  -> Python 汇总切点并组装 scene
  -> 可选两轮 DeepSeek refine
  -> 覆盖和顺序校验
  -> 超长 scene 告警
  -> scene_segments.json + scene_segments.srt
```

## 第一遍：候选边界判断

### 为什么只让模型输出切点

DeepSeek 不返回完整的 `start_idx/end_idx` 列表，只返回应该在哪条字幕之后切分：

```json
{
  "cuts": [
    {
      "after_idx": 30,
      "title": "学校课堂场景",
      "reason": "课堂互动结束，重新转入日常叙事"
    }
  ]
}
```

Python 根据切点统一组装：

```text
after_idx = 8, 16, 30

scene 1: 第一个目标 entry - idx 8
scene 2: idx 8 后的目标 entry - idx 16
scene 3: idx 16 后的目标 entry - idx 30
scene 4: idx 30 后的目标 entry - 最后一个目标 entry
```

这样可以保证模型无法通过漏写 `start_idx` 让字幕消失，也不会因不同请求的输出格式差异造成范围重叠。

### 请求窗口

默认：

```text
--llm-window-entries 80
--llm-context-entries 20
```

`llm-window-entries` 表示一次请求负责判断多少个候选边界，不是 scene 最大字幕数。

以第 2 批为例：

```text
前置上下文：约 idx 61-80
本批候选：约 idx 81-160
后置上下文：约 idx 161-181
```

只有本批负责的位置带有：

```text
<CUT_CANDIDATE_AFTER>
```

上下文字幕没有此标记。它们帮助模型理解跨窗口事件，但切不切由真正负责该位置的请求决定。

### 候选边界的唯一归属

每个候选边界恰好归一个请求负责。相邻请求可以看到同一段上下文，但不会共同决定同一个切点。

如果 DeepSeek 返回了上下文中的越权切点，例如本批负责到 idx 160，却返回 `after_idx=177`，脚本会：

```text
打印 warning
忽略 after_idx=177
保留本批其他合法切点
```

不会因为一个越权结果废弃整个请求。

### 第一遍 Prompt 的 scene 定义

应该切分：

- 地点、时间或事件明确变化
- 一个事件结束并开始新事件
- 旁白与现场对话发生结构性切换
- 对话参与者或主题明显改变
- 音乐、音效或长无台词段承担转场作用
- 同一大场景内开始可独立理解的新行动或新对话阶段

不应该切分：

- 问题和紧接着的回答
- 连续喘息、惊叫和动作反应
- 同一段旁白或同一事件中的短暂停顿
- 仅仅因为 speaker 轮换、字幕较多或持续时间较长

尺度要求：

```text
事件级，不是逐镜头
通常约 20-75 秒
75-120 秒内若已有多个独立事件，应在自然承接处切开
```

## 长电影和上下文控制

整部电影不会一次发给 DeepSeek。长片只会增加请求数量，不会让单个 prompt 随电影长度持续增长。

当前全片数据：

```text
目标字幕：2106
第一遍请求：27
单批 prompt：约 4,172-10,535 字符
```

另有字符安全阀：

```text
--llm-max-prompt-chars 50000
```

如果字幕文本异常长，导致某批 prompt 超过上限，脚本会把该批候选边界对半拆成两个请求，并分别重新附加上下文。拆的是 DeepSeek 判断窗口，不是最终语义 scene。

运行前可只查看请求规划，不调用 API：

```powershell
env\python.exe sub\llm\scene_segmenter.py "Cosmic Princess Kaguya" --llm-plan-only
```

## 第二遍：局部 Refine

启用：

```text
--llm-refine
--llm-refine-passes 2
```

第一遍完成后，脚本不会再次把全片交给模型，而是只选择可疑 scene 及其邻居进行局部复核。

### Refine 触发条件

当前默认条件：

```text
scene > 75 秒
scene < 5 秒
scene 只有 1 条目标字幕
scene 末尾不是第一遍确认的 LLM 切点
```

`--llm-refine-max-entries` 默认是 0，即不按字幕数触发。可显式设置用于实验，但 refine prompt 允许在拆分会损失连续对话上下文时保留完整 scene。

预算细分 Gold A/B：

```text
测试区域：156 条
原语义 scene：148/156 = 94.87%
预算细分 scene：145/156 = 92.95%
短语气词：90.38% -> 84.62%
```

准确率损失主要来自拆成独立请求后丢失后半段上下文，而不是新边界附近直接出错。因此正式 scene 恢复为预算细分前版本。

### Refine 区域

默认把问题 scene 前后各一个 scene 一起送入：

```text
--llm-refine-neighbor-scenes 1
```

这样模型可以决定：

- 为一个过长 scene 添加切点
- 删除切在问答、回忆、连续动作中间的错误边界
- 把极短或单条 scene 合并到前后更合适的一侧
- 同时调整一组彼此依赖的相邻边界

多个相邻问题区域会合并，但单个 refine 请求默认最多约 120 条字幕：

```text
--llm-refine-region-entries 120
```

这个参数只限制复核 prompt 大小，不直接限制最终 scene 条数。

### Refine Prompt 标记

```text
<CUT_CANDIDATE_AFTER>
```

表示允许在该字幕后切分。

```text
<CURRENT_CUT_AFTER>
```

表示第一遍当前已有切点。

DeepSeek 必须返回区域内部应该保留的全部最终切点，而不是只返回新增或删除操作。因此模型可以保留、删除和新增边界。

区域最后一条字幕后的边界固定，不要求模型输出，避免局部 refine 影响区域外 scene。

### 为什么默认两轮

第一轮修复边界后，可能产生新的异常，例如合并后形成新的超长 scene。因此默认再扫描一次：

```text
pass 1 -> 重建全部 scene -> 重新检测异常
pass 2 -> 只复核仍异常或新产生的区域
```

如果某一轮前后 scene 的 idx 范围完全相同，脚本会提前结束。

## 响应校验和重试

每次响应必须：

- 是包含 `cuts` 数组的 JSON 对象
- 每个 `after_idx` 是整数
- 每个 `after_idx` 属于本批候选范围
- 重复切点会去重

JSON 格式或候选范围校验失败时，脚本会追加纠错提示并重试一次。连续两次无效才终止当前运行。

## Prompt/Response 缓存和断点续跑

启用：

```text
--dump-llm-prompts
```

输出目录：

```text
scene_segments_llm/llm_boundary_debug/
├── boundary_prompt_0001.txt
├── boundary_response_0001.txt
├── refine_p1_prompt_0001.txt
├── refine_p1_response_0001.txt
├── refine_p2_prompt_0001.txt
└── refine_p2_response_0001.txt
```

重新运行时，只有同时满足以下条件才复用响应：

```text
保存的 prompt 与本次 prompt 完全相同
保存的 response 能通过当前候选 idx 校验
```

prompt 变化、字幕变化或 response 无效时会重新调用 DeepSeek。

当前全片生成曾在第一遍 27 个请求完成后因 API 超时中断；重新运行时复用了有效的第一遍响应，只继续未完成的 refine 请求。

## Python 组装与完整性校验

所有切点汇总后，Python 按目标 entry 顺序组装 scene，并检查：

```text
所有目标 idx 是否按原顺序出现
是否遗漏 idx
是否重复 idx
是否出现意外 idx
相邻 scene 是否范围重叠或逆序
```

校验失败会终止，不会输出看似正常但不完整的 JSON。

## 超长 Scene 告警

默认：

```text
--warn-scene-seconds 120
```

超过阈值时只报告：

```text
scene_id
idx 范围
时长
字幕数
```

不会自动拆分。当前全片最终结果中有一个约 122 秒、4 条字幕的演出/长空白型 scene，被保留并告警。

## 输出

```text
sub/intermediate/<project>/scene_segments_llm/
├── scene_segments.json
├── scene_segments.srt
└── llm_boundary_debug/
```

JSON 示例：

```json
{
  "scene_id": 4,
  "enabled": true,
  "name": "学校课堂场景",
  "start_idx": 23,
  "end_idx": 30,
  "start": 114.61,
  "end": 135.09
}
```

`start/end` 来自该 scene 第一条和最后一条目标字幕。scene 标题只用于人工时间线和报告，不会作为 speaker evidence 发送给 Gemini。

## 基于已有 JSON 重新 Refine

如果已有第一遍或旧版 scene JSON，可以跳过全片第一遍：

```powershell
env\python.exe sub\llm\scene_segmenter.py `
  "Cosmic Princess Kaguya" `
  --llm-refine-from "path\to\scene_segments.json" `
  --llm-refine-passes 2 `
  --dump-llm-prompts `
  --output-dir "path\to\refined"
```

`--llm-refine-passes 0` 表示只读取、校验并重新输出已有 JSON，不调用 DeepSeek。

## 人工编辑后的 SRT 回写

人工回写已拆到独立脚本：

```powershell
env\python.exe sub\llm\scene_srt_to_json.py `
  "Cosmic Princess Kaguya" `
  "sub\intermediate\Cosmic Princess Kaguya\scene_segments_llm\scene_segments.srt"
```

它用每条原字幕的时间中点判断归属：

```text
midpoint = (entry.start + entry.end) / 2
scene.start <= midpoint <= scene.end
```

默认严格拒绝：

- 一个 idx 被多个 scene 重复覆盖
- 目标 idx 未被任何 scene 覆盖
- 空 scene
- 重复 scene_id
- scene 时间逆序

局部时间线可使用 `--allow-partial`，但重复覆盖和空 scene 仍会报错。

## 当前全片结果

最新运行：

```text
目标字幕：2106
第一遍 DeepSeek 请求：27
正式语义 scene：164
预算 refine 实验：169 scene（未采用）
```

全片 Gemini 已完整输出 2106 条结果。现有 `human.srt` 包含缺失 idx 和大量继承标签，只能粗略审查；正在制作的 Gold Set 将用于正式比较 scene grouping、Gemini batching 和 prompt 改动。
