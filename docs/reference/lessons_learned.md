# 经验教训

记录试过什么、哪些有效、哪些不有效、后续应考虑什么。

## 有效的方法

### 语义 scene + compact video + 按 scene batching

早期测试中 `15 entries/request` 比 45 条大 batch 稳定，但它也会破坏完整对话并显著增加请求数。接入 DeepSeek 语义分段后，当前默认每次处理 2 个完整 scene，不按字幕条数切开 scene。

- scene 太粗会导致不同语义段混在同一 batch，模型容易混 speaker。
- scene 够细但 batch 目标字幕太多同样会导致混淆。
- 最新全片为 164 个语义 scene、82 次 Gemini 请求，平均 25.7 条字幕/84.1 秒，最大 58 条/157.8 秒。
- 全片粗审显示超过 30 条或 90 秒后错误明显增加；固定 2 scene 仍需要安全阈值。
- `human.srt` 存在缺失 idx 和大量继承错误，这些错误率只能表示相对趋势。正式结论等待 Gold Set。

### context 统一到 batch 级

之前每个 scene 各自提供前文，可能重复且会把 target 再当 context 发。改成 batch 级统一的 context 后：

- 减少重复
- 不会把 target 当作 context
- context 和 target 都提供 compact 时间

### 只给 Gemini compact 时间，不给原始时间

原始时间对 speaker 判断没有帮助，反而增加 prompt 复杂度。

Gemini 收到：

```text
idx + compact time + text
```

原始时间只留在本地 `results.jsonl` 和 `report.md`。

### 角色资料分层

把角色描述拆成 speaker evidence、visual evidence、context only 三类：

- 声线、语气、口癖 → speaker evidence
- 外貌、服装 → visual evidence（弱证据）
- 剧情背景、未来关系 → context only（不可单独决定 speaker）

降低模型把"Yachiyo 是未来 Kaguya"之类信息用作当前 speaker 证据。

### scene_segments.srt 人工编辑流程

通过编辑 SRT 时间轴来调整 scene 边界，再转换回 JSON，比手写 JSON 或 TSV 更可行。

### 模型观察

- 明确二人对话场景准确率最高。
- 课堂段等需要角色区分的场景基本能正确处理。
- 多人混杂、路人、旁白附近短反应仍是难点。

## 不有效的方法

### 给模型附加角色参考图片

测试结果：即使只附相关候选角色图，准确率反而下降。

原因：

- 模型会被参考图强烈干扰。
- 它开始依赖"画面里谁像参考图"而不是听声音。
- 课堂段、旁白段等原本正确的判断反而变差。

代码保留为实验开关 `--use-speaker-images`，但默认不启用。

### 给模型附加角色参考音频（WAV）

测试结果：准确率没有提升。

原因：

- 模型可能把参考音频当作模糊语义印象，而不是声纹比对。
- 错误地将 Yachiyo 旁白匹配到 Kaguya/Iroha。
- 中转站 OpenAI-compatible 通道对 audio_url 的处理不确定。

代码保留为实验开关 `--use-speaker-audio`。

### 限制 canonical speaker 为三主角

测试结果：教室段正确，但旁白段和多人段变差。

原因：

- 限制角色数量后，模型把不确定的其他人强行塞进三个候选。
- 加"非三人必须 OTHER"规则后有改善，但同龄女性配角仍会被误归。

### 大量补充角色外貌描述

之前做了详细的 visual_cues/forms 等外貌锚点，但让模型更依赖画面表面特征，忽视声音。现在保留精简 summary + avoid_mistakes，去掉详细视觉 anchor。

### gemini-3.5-flash-high 模型

实际效果没有比 preview 好，而且中转站通道不稳定。当前建议继续使用 `gemini-3.5-flash`。

### 大型 batch（45 条 entry）

课堂回答被误判成老师/OTHER，说明 target 条数太多时模型注意力分散、跨语义段混淆。

## 后续可以考虑的改进

### Gold Set 驱动的 A/B 评估

Gold Set 已完成，覆盖简单双人对话、多人 ensemble、旁白与现场反应、Mami/Roka、FUSHI、Koto、多人组合、OTHER 和 NONSPEECH。

Gold Set 完成后比较：

- 固定 2 scenes/request
- 单 scene/request
- 超过 30 条或 90 秒的单 scene 先由 DeepSeek 在自然边界二次细分，再做动态 grouping
- 后续 prompt 小改动

### 两遍标注：大 batch 筛 + 小 batch 纠错

第一遍用较大 batch 省请求，第二遍只对高风险区域用 10-15 条小 batch 复核。

高风险信号：OTHER/? 多、短语气词密集、老师/路人/主角混杂、旁白附近短反应、虚拟形态变化。

### 利用已有可靠人工标签

这条旧策略已被生产流程取代。当前 Gemini 对全部字幕逐条输出 speaker；normalize 对无显式 speaker 的对白只保留 `?`，不做继承。

### 长片段改用 continuous video

复杂多人场景中 compact video 可能剪掉关键画面信息（谁转头、谁进来、镜头切换）。可对高风险区段改用 continuous video 或更大的 pre/post roll。

### 声纹 diarizer 作为第二信号（长期）

类似 offmute-v2 的 consistency pass，但会引入额外依赖。不建议作为当前第一步。
