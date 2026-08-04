# Gemini Prompt 结构

> 默认生产模式不发送当前 speaker 标签；`--explicit-anchor canonical/all` 仅用于已审核源标签实验。不使用 `--speakers`、`--use-speaker-images`、`--use-speaker-audio`

## 每次请求 Gemini 收到的完整内容

### 文字 prompt

```text
你会看到一个由多个场景片段拼接而成的动画视频，包含下面这些字幕条目的画面和音频。

=== 角色介绍 ===
【全局识别规则】
+ 每个 canonical 角色的资料

=== 可选 canonical 角色 ===
全部 canonical speaker 列表

=== 前文上下文（只供理解，不要输出这些 idx） ===
batch 级统一 context，每条含：
[21] context context_compact 00:00:05,750 --> 00:00:09,420 text=...

=== 需要标注的字幕条目 ===
按 SCENE 分组，每条含：
[25] compact 00:00:15,090 --> 00:00:18,810 text=...

若 normalized 中该 idx 是无 tag 的显式标记：
[27] compact ... locked_anchor=先生 text=...

=== 任务 ===
请根据拼接视频的音频、画面和字幕上下文，为每个字幕 idx 判断实际说话人。

JSON schema 要求

规则：
12 条推断规则
```

### 媒体附件

```text
Target compact video to label:
data:video/mp4;base64,...
```

## 角色资料分层

每个角色的 prompt 行按证据类型分层：

```text
【Kaguya】
  context only（不可单独决定 speaker）: 角色身份、故事背景
  speaker evidence/说话风格: 声线、语速、语气描述
  speaker evidence/口癖: 标志性句型
  speaker evidence/称呼: 对其他角色的称呼
  visual evidence（弱证据）: 外貌简要描述 + 易错提醒
  context only（不可单独决定 speaker）: 剧情设定、未来关系
```

三层含义：

- **speaker evidence**：声线、语气、口癖、称呼习惯。这是判断 speaker 的主要依据。
- **visual evidence**：外貌、服装、虚拟形态。只作为弱辅助，不能覆盖声线。
- **context only**：角色身份、剧情背景、未来关系。标记为"不可单独决定 speaker"，防止模型因为"Yachiyo 是未来 Kaguya"而混淆当前标签。

## 全局识别规则

写在所有角色之前：

```text
必须综合画面、台词语义、上下文和声音判断：
观察角色是否出现及是否有口型/动作，
比较声线及其突然变化，
检查对话承接是否合理；
任何单一信号都不能独立决定 speaker。

画面中出现角色不代表该角色一定在说话；
要区分画外音、旁白、电话/直播声音、回忆声音和路人插话。

短促语气词、笑声、叹息、喘息不要自动继承前后 speaker，
也不要只看画面中央人物；
必须结合声线、发声时机和角色反应判断。

路人、老师、醉汉、店员、工作人员、观众等非主要角色说话时输出 OTHER。

Yachiyo 常用古典旁白口吻，
但旁白附近 Iroha/Kaguya 的短促发声仍要结合画面反应、声线和发声时机判断。

角色在月读/虚拟空间会换服装或形态，
不要只凭发色、服装、画面位置或台词内容判断。
```

## 时间映射

Gemini 只收到 compact 时间，不收到原始时间：

```text
[25] compact 00:00:15,090 --> 00:00:18,810 text=...
```

原始时间只保留在本地 `results.jsonl` 和 `report.md` 中。

## 格式要求

```json
[
  {
    "scene_id": <场景编号>,
    "idx": <字幕idx>,
    "speaker": "<canonical角色名 | ? | NONSPEECH | OTHER>",
    "speaker_raw": "<OTHER 时写具体身份>",
    "reason": "<理由>"
  }
]
```

## 推断规则（prompt 内）

1. 必须只为目标条目输出，不输出 context idx
2. 输出必须包含 scene_id 和原始 idx
3. 综合画面、台词、上下文和声音判断；同步连续嘴型是强证据，无同步嘴型时检查画外音/系统/解说等独立音源
4. 用 compact 时间在当前视频中定位
5. 画面中出现角色不代表该角色在说话
6. 不要只凭台词内容、外貌或画面中央人物猜测
7. 冲突时不要强行猜，必要时输出 OTHER 或 ?
8. 禁止输出 OVERLAP；多人同时发声时选择当前字幕文本对应最清晰或主要的一个 speaker，非 canonical 群体输出 OTHER
9. 音效/歌曲输出 NONSPEECH
10. 非 canonical 但确定身份输出 OTHER + speaker_raw
11. 无法判断输出 ?
12. 区分 Koto 和忠犬オタ公；オタ公输出 OTHER + speaker_raw
13. Mami/Roka 逐句检查嘴型和声线，不按轮次机械交替
14. FUSHI 分身/警报形态的有语义台词统一为 FUSHI
15. 不要强行猜

## 不会发送给 Gemini 的内容

- 原始 SRT 时间（除非显式传 `--include-current-speaker`）
- `{MULTI}`、`?` 当前标签（除非显式传 `--include-current-speaker`）
- 角色参考图片（除非显式传 `--use-speaker-images`）
- 角色参考音频（除非显式传 `--use-speaker-audio`）
- scene 标题
- 上一批 Gemini 的结果
- 上一批的对话历史

默认 `--explicit-anchor none`，不发送任何当前 speaker。可选 `canonical/all` 时使用 `locked_anchor=<speaker>`；它只锁定自己的 idx，不自动继承到后续字幕。最终写回使用独立的 `--explicit-lock none/canonical/all`，默认 none。

## 三角色实验 prompt

使用 `--speakers "Iroha,Yachiyo,Kaguya"` 时：

- 角色资料只保留三人
- 追加规则：三人之外的必须输出 OTHER，不能强行归类
- 强调年轻女性配角不能因声线相似归入三个主角

使用 `--use-speaker-audio` 时（需同时传 `--speakers`）：

- 不发送文字角色资料
- 作为替代发送三人 WAV 参考音频
- 使用独立的严格语音匹配 prompt
