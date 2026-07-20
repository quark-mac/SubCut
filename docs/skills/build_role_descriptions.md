# Skill：编写 role_descriptions.json（角色介绍文件）

> 用途：供 `sub/llm/diarize_llm.py`（Plan B LLM 辅助说话人推断）构造 prompt 使用。
> 文件位置：**`sub/input/<project>/role_descriptions.json`**（每个项目一份，项目专属）。
>
> 这是 LLM 推断准确率的**最关键因素**——角色描述越详细，LLM 推断越准。
>
> **核心原则：不要只写"语言特征"，要写"故事情节"。LLM 能利用剧情上下文判断"在这场戏里谁最可能说出这句话"。**

---

## 何时触发这个 skill

满足以下**全部**条件时执行：

1. 项目已完成字幕归一化（`normalized.srt` 存在）
2. 计划跑 `diarize_llm.py` 对 `[?]` 行做 LLM 推断
3. `sub/input/<project>/role_descriptions.json` **不存在**，或内容不完整（角色介绍有空字段）

已有完整文件时不要重写——直接使用现有产物。

---

## 前置条件

- 了解角色设定：最好看过原片，或从百度百科 / Wikipedia / MyAnimeList / **官方设定集（公式ガイドブック）** 等渠道获取官方角色介绍
- `speaker_aliases.json` 已存在且定义了 canonical 角色列表（script 会用 canonical key 作为角色名）
- 终端能输出 UTF-8

---

## 工作流（5 步）

### Step 1 — 确认 canonical 角色列表

从 `speaker_aliases.json` 获取需要编写的角色：

```powershell
env\python.exe -c "import json; d=json.load(open('sub/input/<project>/speaker_aliases.json',encoding='utf-8')); keys=[k for k in d if not k.startswith('_')]; print('角色数:', len(keys)); print('角色列表:', keys)"
```

必须为**每一个** canonical 角色编写介绍，不能遗漏。

### Step 2 — 搜索官方角色信息

对每个角色，从以下来源收集信息：

| 来源 | 示例 URL | 适合信息 |
|---|---|---|
| 百度百科 | `https://baike.baidu.com/item/<作品名>` | 官方剧情简介、角色介绍 |
| Wikipedia | `https://en.wikipedia.org/wiki/<anime_name>` | 角色关系、CV |
| MyAnimeList | `https://myanimelist.net/anime/<id>/characters` | 角色列表、配音 |
| **官方设定集** | 搜索引擎搜索 `<日文作品名> 公式ガイドブック` | **最权威**——角色性格、故事脉络、CV 访谈 |
| 官方 PV / 宣传页面 | 搜索引擎搜索作品名 | 角色性格描述 |

**关键信息收集清单**（按重要性排序）：

1. **第一人称代词**（最重要！日语角色的标志性特征）：
   - 例：`あたし`（元气少女）、`わたくし`（大小姐/高贵）、`俺`（男性/硬汉）、`僕`（少年/温顺男性）、`私`（普通/中性）
2. **口癖 / 句尾特征**：如 `じゃ`、`だぜ`、`ですわ`、`なのだ`
3. **说话风格**：语速、语气、敬语程度、情绪倾向
4. **称呼方式**：如何称呼其他角色（`あなた`、`君`、`お前`、`名字+さん`）
5. **角色背景**：年龄、性别、职业/身份、与其他角色的关系
6. **故事情节**（★★★）：这个角色在故事中经历了什么？和谁是亲人/朋友/敌人？在哪些场景里出现？

### Step 3 — 编写故事脉络（`_story_context`）

**这是提高准确率的关键一步**。LLM 能利用故事情节判断说话人——例如"烟花大会这场戏里，彩叶问辉夜'你要回月亮上去吗？'，辉夜点头"——知道这个背景，LLM 就不会把这段台词错标给别人。

按故事的时间顺序，用 2-3 句话概括每个关键阶段：

```json
"_story_context": {
  "scene1": "<相遇阶段：谁遇到谁，发生了什么>",
  "scene2": "<发展阶段：主角开始做什么，谁参与进来>",
  "scene3": "<转折阶段：什么事件改变了一切>",
  "scene4": "<结局阶段：最终发生了什么>"
}
```

**Cosmic Princess Kaguya 的示例**：

```json
"_story_context": {
  "scene1": "相遇：彩叶在发光电线杆中发现婴儿辉夜，辉夜迅速成长。辉夜看完八千代演唱会后宣言「绝对要赢！」",
  "scene2": "直播活动：辉夜在彩叶（彩P）协助下成为主播。BlackonyX 邀请对战，彩叶与帝明（朝日）的兄妹关系曝光。",
  "scene3": "离别：联动演唱会后辉夜状态恶化。烟花大会上彩叶问「你要回月亮上去吗？」辉夜点头。毕业演唱会当天，众人与月人对峙失败，辉夜回到月亮。",
  "scene4": "重逢：FUSHI 现身告知八千代 = 8000年后的辉夜。彩叶与八千代联手复活辉夜。十年后研究员彩叶成功复活辉夜，三人同台。"
}
```

**为什么这很重要**：LLM 在看到一句 `[?]` 台词时，会结合上下文时间戳和故事阶段判断——"这段对话发生在演唱会之前，所以不可能是离别场景的台词"。

### Step 4 — 填写 JSON（按模板）

对于主角（台词 ≥ 100 条），描述越详细越好。配角（台词 < 30 条）可简化。

```json
{
  "_comment": "角色介绍 — LLM prompt 用。信息越详细推断越准。",
  "_story_context": { ... },

  "<canonical_name>": {
    "name_ja": "<日文名 / 中文名 / 别名>",
    "age": <年龄, 未知填 null>,
    "gender": "<male | female | unknown>",
    "role": "<一句话角色定位，含关键剧情信息>",
    "first_person": "<第一人称代词，最重要的字段>",
    "speech_style": "<说话风格描述：语速、语气、敬语程度、句尾特征、情绪倾向>",
    "catchphrases": ["<口癖1>", "<口癖2>"],
    "address_others": "<如何称呼其他角色>",
    "notes": "<其他有助于识别说话人的信息，尤其是人际关系和故事背景>"
  }
}
```

#### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `_story_context` | **强烈推荐** | 故事脉络概述，按时间分阶段。LLM 用此判断"这场戏发生在哪一阶段、谁在说话" |
| `name_ja` | 是 | 角色日文名/中文名，` / ` 分隔多个写法 |
| `age` | 是 | 年龄（int），未知填 `null` |
| `gender` | 是 | `male` / `female` / `unknown`，不要猜。**特别注意：如果一个人有虚拟身份和现实身份（如黑玛瑙 vs 真人），两个 label 指同一个人，性别必须一致** |
| `role` | 是 | 一句话简述，**必须包含和其他角色的关系**。例如 "东京都内高中二年级学生，哥哥是朝日（帝明）" 比 "高中生" 有用得多 |
| `first_person` | **极重要** | 日语第一人称：`あたし`/`俺`/`僕`/`私`/`わたくし` 等。不确定留空 `""`。**注意同一人双身份时代词可能一致** |
| `speech_style` | **极重要** | 越具体越好："语速快、感嘆詞多" 比 "元気" 有用。CV 访谈是绝佳来源——声优本人说"不用可爱声线"可以直接写入 |
| `catchphrases` | 推荐 | 标志性口癖列表，不确定写 `[]` |
| `address_others` | 推荐 | 如 "称 Iroha 为「彩葉」" |
| `notes` | **极重要** | 不要浪费这个字段！**必须写入**：① 与其他角色的关系 ② 在故事中的关键经历 ③ 特殊设定（如 "天生几乎不会说话，台词来自弟弟编写的台词集"） |

#### 正例 vs 反例

**❌ 反例（太模糊，LLM 无法据此判断）**

```json
{
  "Iroha": {
    "first_person": "",
    "speech_style": "元気",
    "role": "主角",
    "notes": ""
  }
}
```

**✅ 正例（具体可辨别，包含故事信息）**

```json
{
  "_story_context": {
    "scene1": "相遇：...",
    "scene2": "直播活动：...",
    "scene3": "离别：...",
    "scene4": "重逢：..."
  },
  "Iroha": {
    "name_ja": "彩葉 / 酒寄彩葉",
    "age": 17,
    "gender": "female",
    "role": "东京都内高中二年级学生。因与母亲（律师红叶）不合开始独自生活。八千秋是她的精神支柱。作为辉夜的制作人「彩P」支持她的主播活动。",
    "first_person": "あたし",
    "speech_style": "语速快、感嘆詞多（やった! / うわー! / オッケー）、カジュアル。在月读中较放得开。CV 永濑安娜被要求「以最自然的状态去演」。",
    "catchphrases": ["やった!", "うわー!", "イェーイ", "オッケー"],
    "address_others": "称八千代为「ヤチヨさん」、称辉夜为「かぐや」。",
    "notes": "哥哥是朝日（= 帝明），父亲朝久 37 岁去世时彩叶 6 岁。在游戏 KASSEN 中有出色瞄准能力。对辉夜的感情是后知后觉的渐变。十年后成为研究员复活辉夜。"
  },
  "Rai": {
    "name_ja": "雷 / 駒沢雷",
    "age": 19,
    "gender": "male",
    "role": "BlackonyX 成员，乃依的亲哥哥，大学一年级。游戏中担任坦克/辅助。",
    "first_person": "俺",
    "speech_style": "★★★ 关键特征：天生几乎不会说话！乃依给他编写了「雷专用台词集（随时更新）」，他背诵后使用。作品中台词几乎全部来自台词集，因此可能显得生硬、像在念稿。唱歌时却异常流畅。",
    "catchphrases": [],
    "address_others": "称乃依为「乃依」。",
    "notes": "虽然不擅言辞但背诵台词后能流畅说设定好的句子。CV：内田雄马。设计：白熊主题，佣兵气质。"
  }
}
```

注意 Rai 的 `speech_style`——这种"设定集级别的细节"才是 LLM 推断的关键依据。如果只写"冷静话少"，LLM 无法区分 Rai 和其他话少的角色。写出"台词来自台词集"才能帮 LLM 识别他的台词特征。

### Step 5 — 验证

```powershell
# 1. JSON 合法性 + 角色数
env\python.exe -c "
import json
d = json.load(open('sub/input/<project>/role_descriptions.json', encoding='utf-8'))
keys = [k for k in d if not k.startswith('_')]
print(f'角色数: {len(keys)}')
for k in keys:
    r = d[k]
    ok = all(r.get(f) for f in ['name_ja','gender','role','first_person','speech_style'])
    print(f'  {\"OK\" if ok else \"MISS\"}  {k}  first_person={r.get(\"first_person\",\"?\")!r}')
"

# 2. 与 aliases 一致性（角色列表应完全匹配）
env\python.exe -c "
import json
role_keys = [k for k in json.load(open('sub/input/<project>/role_descriptions.json',encoding='utf-8')) if not k.startswith('_')]
alias_keys = [k for k in json.load(open('sub/input/<project>/speaker_aliases.json',encoding='utf-8')) if not k.startswith('_')]
only_role = set(role_keys) - set(alias_keys)
only_alias = set(alias_keys) - set(role_keys)
if only_role: print(f'role 中多余: {only_role}')
if only_alias: print(f'aliases 中缺失: {only_alias}')
if not only_role and not only_alias: print('角色列表一致 ✓')
"

# 3. dry-run 验证 prompt 渲染效果
env\python.exe sub\llm\diarize_llm.py "<project>" --dry-run --max-batches 1 | head -40
```

---

## 常见坑

- **性别猜错**：不要凭名字或外貌猜性别。查官方资料确认。如乃依（Noi）看起来像女性但实际是男性（雷的弟弟，CV 松冈祯丞）。
- **双身份混错**：同一人物在作品中可能有多个标签（虚拟身份 vs 现实身份）。如 `帝明/Mikado` 和 `朝日/Asahi` 是同一人——哥哥（男），不是母亲！必须查官方设定集确认。两标签共用一个真实身份描述，但 speech_style 要分开写（直播张扬 vs 现实沉稳）。
- **第一人称空着**：`first_person` 是 LLM 分辨角色最重要的信号之一。即使不确定也要推测一个，比空着强。
- **说话风格太笼统**："元気"、"冷静" 这些词对 LLM 帮助有限。用描述性语言："语速快、感嘆詞多、句尾用 '!' 多于 '。'"。
- **角色介绍过短**：配角可以只写基本信息，但主角（台词多、推断价值高）必须写详细。
- **notes 浪费了**：notes 不是存放废话字段。必须写入：① 人际关系（"哥哥是 XX"）② 故事经历（"父去世时 6 岁"）③ 特殊设定（"台词来自弟弟写的台词集"）。这些是 LLM 判断说话人时最有用的辅助信息。
- **忘了故事脉络**：没有 `_story_context`，LLM 不知道对话发生在故事的哪个阶段。知道"烟花大会→别离"这个时间线后，LLM 才能把对应的台词正确分配给辉夜和彩叶。

---

## 不要做的事

- ❌ 不要在 `role_descriptions.json` 里只写名字不写语言特征（LLM 需要语言层面的线索）
- ❌ 不要用 AI 凭空编造角色信息（有官方资料的必须查官方资料，没资料的标注 "请在此填入"）
- ❌ 不要让角色列表和 `speaker_aliases.json` 不一致（角色名数量、名字必须完全匹配）
- ❌ 不要把非 canonical 角色（音效、路人、群体合声）写进去

---

## 参考：Cosmic Princess Kaguya 的实际案例

以下是从百度百科和官方设定集提取的角色介绍核心字段（完整文件见 `sub/input/Cosmic Princess Kaguya/role_descriptions.json`）：

| 角色 | first_person | 关键特征 |
|---|---|---|
| Kaguya | わたくし | 句尾「じゃ」，元气满满，天马行空，任性撒娇。实际身份：8000 年后将成为八千代 |
| Iroha | あたし | 语速快，感嘆詞多（やった!/うわー!），カジュアル。哥哥是朝日（帝明）。父去世时 6 岁 |
| Yachiyo | わたくし | 叙事时古典口调（今は昔/ありけり），日常切换现代语调。真实身份：8000 年后的辉夜 |
| FUSHI | ボク | 语调平稳带傲娇戒备。真实身份：8000 年间耗尽力量的 DOGE，告知彩叶真相 |
| Mikado | 俺 | 俺様系，张扬华丽，BlackonyX 队长。真实身份：彩叶的哥哥朝日（同一人双标签） |
| Rai | 俺 | ★ 天生几乎不会说话！台词来自乃依编写的「雷专用台词集」，像在念稿。唱歌时流畅 |
| Noi | 僕 | 慵懒随性，男身可爱风穿搭，兴致高时异常热情。BlackonyX 概念提出者 |
| Roka | 私 | 细腻敏感，美容网红，默默关心彩叶，对彩叶有超越友情的感情。偶尔用「ヤバい」 |
| Mami | 私 | 从容务实，美食网红，帝明忠实粉丝。被父母溺爱，有弟弟妹妹 |
| Koto | 私 | 口才出众，前职业玩家转型解说，人脉广。合作搭档忠犬宅公 |
| **Asahi** | 俺 | **★ 彩叶的亲哥哥（不是母亲！），与 Mikado 是同一人。"朝日"是他在现实生活中的真实人格。** |

> **教训**：Asahi 最初被错写为 "Iroha's mother"——因为没查官方设定集。直到阅读公式ガイドブック才发现朝日(Asahi)是哥哥，母亲叫红叶(Momiji)。**务必用官方设定集验证人际关系。**

---

## 一句话总结

查官方设定集（最权威）→ 写 `_story_context` 故事脉络 → 填写每个角色的 `first_person` 和 `speech_style`（CV 访谈金句最有价值）→ `notes` 里填人际关系+故事经历+特殊设定 → 角色列表必须与 `speaker_aliases.json` 完全一致 → dry-run 验证 prompt。
