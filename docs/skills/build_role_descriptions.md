# 角色描述编写规范

本文规定如何为新项目编写 `sub/input/<project>/role_descriptions.json`，供生产入口 `sub/llm/gemini_segment_diarize.py` 构造多模态 speaker-labeling prompt。

项目级 OpenCode Skill 位于：

```text
.opencode/skills/build-role-descriptions/SKILL.md
```

## 1. 目标和边界

角色描述的目标不是概括百科，而是提供能区分说话人的证据：

1. 声音与说话风格。
2. 第一人称、口癖、句尾和称呼。
3. 角色之间容易混淆的差异。
4. 弱视觉辅助和形态切换提醒。
5. 必要但不能单独决定 speaker 的身份/剧情上下文。

角色描述不能替代视频、音频、嘴型和发声时机。即使完整故事和外貌会发送，剧情与外貌仍只能作为辅助，不能因为“某角色应该在这场戏出现”就覆盖实际声音证据。

## 2. 当前代码消费的字段

生产 CLI 通过 `--role-detail baseline/selected/full` 控制角色资料。默认 `baseline` 是旧精选字段；实验 `selected` 增加 `age/gender`；实验 `full` 还会保留 `_story_context`、完整视觉线索和形态。已知字段按以下证据层级渲染：

| JSON 字段 | Prompt 层级 | 用途 |
|---|---|---|
| `_speaker_identification_rules` | 全局规则 | 项目专属的易错规则 |
| `_story_context` | context only | 完整故事脉络，不可单独决定 speaker |
| `name_ja` | 身份信息 | 日文名、别名、读音 |
| `age` | context only | 年龄，未知写 `null` |
| `gender` | context only | 性别或角色设定 |
| `role` | context only | 身份及必要关系 |
| `first_person` | speaker evidence | 第一人称 |
| `speech_style` | speaker evidence | 声线、语速、语气、敬语和句尾 |
| `catchphrases` | speaker evidence | 经证实的口癖 |
| `address_others` | speaker evidence | 对其他角色的称呼 |
| `appearance.summary` | visual evidence（弱） | 简短视觉识别辅助 |
| `appearance.visual_cues` | visual evidence（弱） | 全部视觉线索 |
| `appearance.forms` | visual evidence（弱） | 现实、虚拟、未来等形态 |
| `appearance.avoid_mistakes` | visual evidence（弱） | 形态切换和易混淆提醒 |
| `notes` | context only | 特殊设定和必要剧情关系 |

实验可通过 `--role-extra story,demographics,visual_cues,forms` 单独追加组件。故事无净收益，完整视觉线索收益弱且组合后下降，形态单独正向但组合后下降；`demographics` 在五窗口中方向不一致，因此也未进入默认。

以下顶层字段是文件维护元数据，不作为角色知识发送：

```text
_comment
_instructions
```

`_comment` 用于记录来源和审核日期，`_instructions` 用于解释 schema，两种模式都不发送。不要把角色事实只写在这两个维护字段中，也不要为了重复强调而把 `_story_context` 复制进 `notes`。

## 3. 新项目开始前必须追问

Agent 不得直接根据作品名生成文件。先检查磁盘已有内容，再向用户追问缺失决策。

### 第一轮：任务范围

必须确认：

1. 项目目录名是什么？
2. 处理哪一集、哪一季或整部作品？角色信息是否允许包含后续剧透？
3. canonical speaker 应包含哪些角色？
4. 路人、老师、店员、广播、电视声音如何归类，通常应为 `OTHER`。
5. 目标是高精度主要角色标注，还是尽可能细分所有具名配角？

### 第二轮：标签身份

对每个疑似 canonical 角色确认：

1. 输出标签使用罗马字、英文名、日文名还是用户自定义名？
2. 同一人的现实/虚拟、成年/幼年、变声或伪装身份是否合并？
3. 双胞胎、同声优角色、变声角色是否需要独立标签？
4. 群体声音是否一律 `OTHER`，还是有固定 canonical 群体？
5. 唱歌与说话是否使用同一个角色标签？

### 第三轮：可用证据

询问用户是否能提供：

- 官方角色页或可信资料链接；
- 用户已知的角色名单、关系和剧透边界；
- 代表性声线、口癖、第一人称和称呼；
- 已知易混淆角色对；
- 角色参考图片或语音；
- 已标注的小段样本；
- 希望 Agent 自行联网研究的范围。

一次只问 3-5 个高价值问题。答案不完整时继续追问，直到 canonical 边界和标签身份明确。不要用一个包含几十项的表单压给用户。

## 4. 证据来源和可信度

优先级：

1. 用户明确决定的标签体系。
2. 官方角色页、官方网站、官方设定集和官方访谈。
3. 正片中可核验的台词、声音和称呼。
4. 可信百科、字幕和数据库。
5. 粉丝 wiki、论坛和推测，只能标记为低置信参考。

联网研究时记录 URL、访问日期和提取的事实。不要把搜索摘要当作事实来源。无法核验的信息留空或写入审查报告，不要猜测。

禁止规则：

- 不凭姓名、外貌或声优性别猜角色性别。
- 不凭性格标签编造第一人称或口癖。
- 不把字幕翻译措辞当成日语口癖证据。
- 不把未来剧情信息用于用户禁止剧透的范围。
- 不把“元气”“冷静”“温柔”这类泛化词单独作为 `speech_style`。

## 5. Canonical Speaker 选择

canonical 列表应该小而明确。满足以下任一条件才建议加入：

- 在目标视频中有足够台词，值得独立评估或导出。
- 用户明确要求独立标签。
- 与其他主要角色容易混淆，需要专门描述。
- 有可靠声线、语言或视觉证据可供 Gemini 区分。

通常不要加入：

- 单句路人、老师、店员和工作人员；
- 无语义音效；
- 泛化群体和观众；
- 只在后续剧集出现、当前视频没有台词的角色；
- 无法稳定区分的极小角色。

这些应使用 `OTHER + speaker_raw` 或 `NONSPEECH`。

对 MKV-only 项目，`speaker_aliases.json` 不是前置条件。Gemini 的可选角色范围由 `--speakers` 和 `role_descriptions.json` 共同决定。新项目必须显式传：

```powershell
--speakers "CanonicalA,CanonicalB,CanonicalC"
```

否则会错误使用代码中的辉夜姬默认角色列表。

## 6. 推荐 JSON 结构

```json
{
  "_comment": "目标范围、资料来源和最后审核日期。",
  "_speaker_identification_rules": [
    "项目专属的全局易错提醒。不要重复 Gemini 已有的通用规则。"
  ],
  "CanonicalA": {
    "name_ja": "日文名 / 别名",
    "role": "一句话身份和必要关系；只作为 context，不能单独决定 speaker。",
    "first_person": "私",
    "speech_style": "可辨别的声线、音高、语速、语气、敬语程度、句尾和情绪变化。",
    "catchphrases": ["经核验的口癖"],
    "address_others": "如何称呼关键角色。",
    "notes": "特殊声音设定、身份切换或必要剧情关系；保持简短。",
    "appearance": {
      "summary": "1-2 句弱视觉辅助，包括当前目标范围内常见形态。",
      "avoid_mistakes": [
        "与 CanonicalB 的具体视觉/声音区别。",
        "形态变化时不要只凭发色或服装。"
      ]
    }
  }
}
```

字段要求：

| 字段 | 要求 |
|---|---|
| `name_ja` | 必填；包含正片使用名和常见别名 |
| `role` | 必填但简短；身份与关系，不写剧情长文 |
| `first_person` | 确认后填写；未知写空字符串，不猜 |
| `speech_style` | 必填；至少两个可辨别维度，避免泛化形容词 |
| `catchphrases` | 无可靠证据时写 `[]` |
| `address_others` | 有区别力时填写，否则空字符串 |
| `notes` | 只写特殊设定和必要关系，建议不超过 3 句 |
| `appearance.summary` | 简短弱证据，不列百科式服装清单 |
| `appearance.avoid_mistakes` | 必须针对真实混淆风险，不写通用废话 |

## 7. 对比式描述

Gemini 更需要“如何区分”而不是孤立人物简介。对每个易混淆角色对，至少写出：

- 声音高低、质感和年龄感差异；
- 语速、停顿、情绪和敬语差异；
- 第一人称、句尾、口癖和称呼差异；
- 当前剧集常见场景和形态差异；
- 哪些特征不可靠。

反例：

```json
"speech_style": "开朗活泼。"
```

正例：

```json
"speech_style": "偏低的年轻女性声线，语速快，情绪上升时连续使用短句和强重音；对熟人不用敬语。与 B 相比更直接、更少停顿。"
```

## 8. 全局规则编写

`_speaker_identification_rules` 只放项目专属规则，例如：

- 同一人有两个输出标签时如何按场景区分。
- 固定节目中存在非 canonical 解说者，如何输出 `OTHER`。
- 某角色的系统/吉祥物形态是否仍使用同一标签。
- 特定易错角色对必须逐条检查声线或嘴型。

不要重复以下生产 prompt 已有规则：

- 画面出现不等于正在说话。
- 短促语气词不能自动继承。
- 路人输出 `OTHER`。
- 禁止 `OVERLAP`。

规则应少而具体，通常 0-6 条。过长的全局规则会稀释每个角色的有效证据。

## 9. 文件生成流程

1. 检查项目目录、candidate normalized SRT、已有 aliases/角色资料。
2. 从用户处确认范围、canonical 列表、标签合并规则和剧透边界。
3. 抽取字幕中的人名、称呼、第一人称和高频句尾作为候选证据。
4. 按用户授权范围联网核验官方资料。
5. 先给出“角色清单 + 易混淆对 + 信息缺口”，不要立即写文件。
6. 对缺口进行第二轮追问。
7. 生成 `role_descriptions.json`。
8. 用实际 loader 和 formatter 验证最终 prompt 文本。
9. 用 Gemini `--plan-only --speakers ...` 检查角色范围，不调用 API。
10. 只有用户确认后才做付费实验。

## 10. 验证

### JSON 和字段

```powershell
env\python.exe -c "import json; from pathlib import Path; p=Path(r'sub/input/<project>/role_descriptions.json'); d=json.loads(p.read_text(encoding='utf-8')); roles={k:v for k,v in d.items() if not k.startswith('_')}; assert roles; required={'name_ja','role','speech_style','catchphrases','appearance'}; missing={k:sorted(required-set(v)) for k,v in roles.items() if isinstance(v,dict) and required-set(v)}; assert not missing, missing; print('roles=', ','.join(roles))"
```

### 实际 prompt 渲染

```powershell
env\python.exe -c "from pathlib import Path; from sub.llm.diarize_llm import load_role_descriptions,_format_role_descriptions; p=Path(r'sub/input/<project>/role_descriptions.json'); print(_format_role_descriptions(load_role_descriptions(p)))"
```

人工检查渲染结果：

- 每个 canonical 角色只出现一次。
- 关键证据确实进入 prompt。
- 没有占位符、未核验推测或不允许的剧透。
- 没有长篇剧情简介压过 speaker evidence。
- 易混淆角色有明确差异。

### Gemini plan-only

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "<project>" `
  --srt "<candidate>/normalized.srt" `
  --segments-json "<scene-dir>/scene_segments.json" `
  --role-desc "sub/input/<project>/role_descriptions.json" `
  --role-detail full `
  --speakers "CanonicalA,CanonicalB,CanonicalC" `
  --compact-video `
  --plan-only `
  --max-segments 0 `
  --output-dir "<unique-plan-dir>"
```

确认输出中的“角色范围”与 JSON 顶层角色完全一致。

## 11. 完成定义

满足以下条件才算完成：

1. 用户确认目标范围、剧透边界和 canonical 标签。
2. 每个角色的关键事实都有来源或用户确认。
3. 未知信息明确留空，没有猜测。
4. 易混淆角色有对比式证据。
5. 实际 formatter 输出已人工审查。
6. `--speakers` 与 JSON 顶层角色一致。
7. Gemini `--plan-only` 通过。
8. 未经确认没有调用 API。

## 12. 当前 Makeine 项目的首轮问题

为 `too many losing heroines` 编写文件前，至少需要用户确认：

1. 只处理第 1 集，还是为整季建立角色集合？
2. 是否允许使用第 1 集之后的角色信息和剧透？
3. 第 1 集 canonical 是否只包含主要学生，还是包含袴田草介、姫宮華恋、店员等配角？
4. 输出标签希望使用英文罗马字、日文姓氏还是完整日文名？
5. 用户是否希望 Agent 联网查官方角色页并提出候选列表？

在这些决策明确前，不应生成正式 `role_descriptions.json`。
