# 当前问题与后续实验

## Gemini Diarization

### 已确认问题

- 大部分主要角色正确，少量语气词和次要角色台词易错
- Mami 和 Roka 容易互换
- FUSHI 教程/系统语音容易被吸收到画面中的 Kaguya 或 Yachiyo
- Koto 和忠犬オタ公在赛事解说中容易互换
- 旧版 OVERLAP 明显过度预测，现已从 Gemini 输出契约移除
- 长 batch 和高 entry batch 出现 speaker identity drift
- 模型 confidence 几乎全部 high，不能用于可靠排序

### 已实施

- Gemini 默认输入改为 `normalized.srt`
- `llm_corrected.srt` 仅在 normalized 缺失时回退
- Prompt 和写回 lock 均改为三档 none/canonical/all，默认 none
- `OTHER` 写回使用 `speaker_raw`，不再恢复错误输入标签
- `{INHERITED}`、`{MULTI}`、`?` 不作为锚点
- Prompt 强调嘴型是否与发声时间同步
- Prompt 明确无同步嘴型时检查画外音、系统/吉祥物和赛事解说
- Prompt 明确 Koto 与忠犬オタ公的区别
- Gemini 禁止输出 OVERLAP；多人同时发声时选择字幕对应的主要单一 speaker
- Gemini grouping 默认最多合并 2 scene、30 entries、90 秒；单个超大语义 scene 不强拆

### 尚未解决

- FUSHI 显式锚点后的连续教程仍无法稳定识别
- 战斗中短促 Koto/オタ公解说仍易被当作画内对手
- Mami/Roka 没有显式锚点的短句仍需进一步评估
- Gold Set 结构与 normalized 不一一对应，需要正式结构对齐评估工具
- Gold 中组合 speaker 标签需要按“预测参与者之一即为可接受”重新定义评估
- DeepSeek 强制预算细分使 Gold 准确率 94.87% 降至 92.95%，已撤回；短语气词最受上下文丢失影响
- `explicit-lock all` 使 91.30% 降到 89.64%；canonical 局部样本存在错误锚点，默认关闭

## 标准化

### 多 Speaker 混在同一字幕

示例：

```text
[Iroha] 一段台词 (かぐや) 一段台词
```

当前可能没有拆成两个 speaker entry。后续需要专门识别括号 speaker 标记，并按文本和可用时间信息拆分；不能在没有时间依据时盲目均分。

### 重复短碎片

同一字幕文本可能被切成多个连续短时间片，Gold Set 已人工修正部分。需要分析源 ASS event 和 normalization 合并规则，识别：

- 完全相同文本
- 时间连续或高度重叠
- 同 speaker/source entry
- 80-500ms 的尾部重复片段

### 原字幕时间轴错误

Gold Set 已修正部分时间轴。后续如要重新规范化，应允许人工时间轴覆盖 normalization 结果，而不是重新生成后丢失修正。

### 音乐与台词混合

纯音乐计划单独剔除，但部分条目同时含歌词和台词。后续需要区分：

```text
纯音乐/歌词 -> 非 speaker 目标
歌词中夹角色对白 -> 保留对白或拆分
```

### オタ公

normalized 中已有大量 `[オタ公]`，但此前 Gemini prompt 未明确区分其与 Koto，导致解说身份混淆。现已加入 prompt 和显式锚点策略。

### idx 1477 附近

原 normalized 有空文本 `[ヘイベイビー]` 条目和长演出空白；Gold Set 在这里已有人工重排。后续标准化需单独检查空文本 name 字段、演出段和重新编号问题。

## 后续实验

### DeepSeek Scene 对人工 Speaker 标签的依赖

需要 A/B：

```text
A: 使用 normalized 当前 speaker/tags 作为 DeepSeek scene 上下文
B: 完全移除 speaker/tags，只给时间和文本
```

比较 scene 边界、refine 次数和后续 Gemini 准确率，确认 scene 分割是否过度依赖人工标签。

### TTS 文本清理

需要验证：

- 日语括号注音如 `是(こ)の者` 是否应保留
- `\N` 是否应转空格、标点或停顿
- 重复短碎片是否会污染 TTS 对齐
- 歌词、笑声、喘息、拟声词是否进入训练集

这部分应在 speaker Gold 和时间轴稳定后单独设计，不与 diarization prompt 混在一起。
