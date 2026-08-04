# Gold Set 与评估

## 当前状态

`gold_set.srt` 已完成人工校对。它不仅修正 speaker，也人工修正了部分时间轴、合并/拆分了碎片字幕，因此：

```text
normalized.srt: 2106 entries
gold_set.srt: 2104 entries
```

Gold Set 不是与 normalized idx 一一对应的纯标签文件。自动评估必须优先用：

```text
timestamp + normalized text
必要时对人工合并/拆分条目使用时间重叠和唯一文本对齐
```

不能在首次结构分歧后继续按 idx 直接比较。

旧 `human.srt` 仍不能作为正式金标准：

- 只有 2105 条，缺少源字幕 `idx=1879`
- 大量 `{INHERITED}` 标签跨 speaker 继承
- `女の子`、`赤ちゃん`、`2人`、`?` 等描述性标签没有统一归一
- 音效、音乐、群体发声和台词有时混在 speaker 字段

因此：

```text
严格字符串一致率不能代表模型准确率
human.srt 只能用于发现粗粒度错误模式
Gold Set 才用于正式 A/B 和回归测试
```

## 已知结构修正

Gold Set 中存在有意的人工修正：

- 合并原字幕重复短碎片
- 拆开同一字幕中不同 speaker 的台词
- 修正原字幕错误时间轴
- 移除或重排空白/无效条目
- 保留部分同时发声的相同时间范围

因此 Gold Set 适合作为最终成品和语义金标准，但评估脚本必须支持结构对齐。

## Gold Set 标签规范

以完整 2106 条源字幕的 `idx/start/end/text` 为准，只人工确认 speaker，不改字幕编号和时间。

建议标签：

```text
Iroha / Kaguya / Yachiyo / ... canonical speaker
OTHER:先生
OTHER:路人男
NONSPEECH:音乐
NONSPEECH:电子音
Iroha&Kaguya（Gold 保留实际参与者，Gemini 输出时选择其中主要一人）
UNCERTAIN
```

规则：

- 同时间的两条独立字幕分别标各自 speaker
- Gold 可保留单条字幕中的多人参与者，例如 `Iroha&Kaguya`
- Gemini 不再输出 OVERLAP；评估组合标签时，预测为参与者之一视为可接受，具体主导 speaker 可另做人工规则
- 无法可靠判断时标 UNCERTAIN，并从硬准确率中排除
- `女の子`、`赤ちゃん` 等角色阶段应归一到已确认的 canonical 角色

## 推荐覆盖

Gold Set 不应只收集 Gemini 与旧标签不一致的条目，还要随机抽查双方一致的条目，避免共同错误。

优先覆盖：

- Iroha/Kaguya 快速轮次
- Mami/Roka/Iroha 三人对话
- Yachiyo 旁白夹现场反应
- FUSHI 与 Kaguya/Yachiyo 同场
- Koto 与其他赛事解说
- BlackonyX 多人段
- 短语气词、笑声、喘息
- OTHER / 多人组合 Gold 标签 / NONSPEECH
- 30 条以上或 90 秒以上的高风险 request
- 当前最差的多人和结尾 ensemble batch

## 旧双 Scene 基线

使用旧全片 `gemini_latest_scene_full/results.jsonl`，按时间和文本对齐 Gold：

```text
总体 normalized accuracy: 88.40%
canonical accuracy: 89.84%
Iroha/Kaguya/Yachiyo/FUSHI: 92.17%
```

主要问题：

- 短语气词/反应：87.10%
- Mami/Roka 合计：62.77%，直接互换 20 条
- Koto + オタ公解说：56.31%
- FUSHI recall：58.06%
- 旧版 OVERLAP precision 仅 21.43%，因此已从 Gemini 输出契约移除
- batch >=120 秒：83.73%，明显低于 <60 秒的 94.76%
- batch >=35 entries：85.81%，低于 15-24 entries 的 92.20%

## 当前 Single Scene 基线

使用 `gemini_single_scene_full/results.jsonl`：

```text
总体 accuracy: 91.30%
canonical accuracy: 91.57%
Iroha/Kaguya/Yachiyo/FUSHI: 92.03%
Mami/Roka: 77.66%
Koto: 100.00%
オタ公 as OTHER: 95.08%
FUSHI semantic variants: 75.00%
```

当前最终 SRT 写回后仍为 91.30%，与 raw results 一致。

## 首轮提示词回归

加入嘴型、Koto/オタ公、OVERLAP、Mami/Roka 规则后：

```text
开场 30 条：28/30 -> 28/30
正式赛事解说 12 条：6/12 -> 11/12
FUSHI 教程 9 条：2/9 -> 1/9（未解决）
小型战斗解说 10 条：3/10 -> 3/10（未解决）
```

加入 normalized 显式 `locked_anchor` 后：

```text
开场 30 条：30/30
Mami/Roka 两个显式起始错误均修复
FUSHI 显式锚点自身修复，但后续连续教程仍无法靠 prompt 稳定传播
```

结论：锁定显式源标签有效，但不应自动继承到后续条目。FUSHI 连续教程需要后续单独策略或人工保护，不能继续堆通用 prompt。

## 写回与 Lock A/B

旧写回逻辑遇到 Gemini `OTHER` 时会保留输入 speaker，导致原始模型 91.30% 的结果写成 SRT 后只有约 67%。现已修复：

```text
OTHER -> 写 speaker_raw；缺失时写 OTHER
NONSPEECH -> 写 NONSPEECH
? -> 写 ?
仅解析/调用失败才保留输入 speaker
```

写回 lock 三档实测：

| explicit-lock | Final SRT accuracy |
|---|---:|
| none | 91.30% |
| canonical | 91.30% |
| all | 89.64% |

`all` 会锁死 `女の子`、`赤ちゃん`、音效描述等非最终 speaker 标签。`canonical` 在当前全片结果上与 none 同分，但局部 Gold A/B 发现显式 canonical 也可能错误，例如 idx47、1479、1486。Prompt anchor 三组测试为：

```text
none: 50/59 = 84.75%
canonical: 51/59 = 86.44%
```

仅 +1 条，且 21 个显式 canonical 中有 3 个与 Gold 冲突。单次随机调用不足以证明 anchor 稳定增益，因此生产默认设为：

```text
--explicit-anchor none
--explicit-lock none
```

`canonical/all` 只用于来源标签已经独立审核、且严格保留比模型纠错更重要的场景。

## 下一轮评估方案

在同一批 Gold Set 上比较：

```text
A: 固定 2 scenes/request
B: 1 scene/request
C: 优先 2 scene；合并后超过安全阈值则退回 1 scene
```

曾测试的预算细分阈值：

```text
entries <= 30
compact video <= 90s
```

DeepSeek 预算细分 A/B 已完成：在 156 条受影响样本上从 94.87% 降至 92.95%，短语气词从 90.38% 降至 84.62%。因此不采用强制 scene 细分。下一步应测试保持完整 scene 上下文、只拆 target 输出范围的方案。

## 指标

- canonical speaker accuracy
- 每个 canonical speaker 的 precision/recall
- OTHER identity accuracy
- 多人组合条目中主导 speaker 的可接受率
- NONSPEECH accuracy
- missing / duplicate / unexpected idx
- 按 request entries、compact duration、角色数量分桶的错误率
- API 请求数和费用

生产 Gemini 输出已移除未校准的 `confidence` 字段；历史结果中的该字段不参与评估。
