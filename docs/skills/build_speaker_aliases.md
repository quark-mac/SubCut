# Skill：从 SDH 字幕生成 speaker_aliases.json

> 目的：给方案 C（字幕驱动切片，见 `docs/future_plans/plan_C_subtitle_driven_extraction.md`）准备角色规范化映射文件。
>
> 适用：日语 / 中文 / 英文 SDH 或 CC 字幕，说话人在台词前以括号形式标注（`(角色)台词` / `[Speaker] line` / `Speaker: line`）。

## 何时触发这个 skill

满足以下**全部**条件时执行：

1. 用户希望按角色切分一段影片/音频用于 TTS 训练
2. 输入是带说话人标注的字幕（ASS / SSA / SRT / VTT）
3. 项目目录里**还没有** `speaker_aliases.json`
4. 项目目录已按 `sub/project_io.py` 约定组织：

   ```
   sub/input/<project_name>/
       <media>.{mp4|mkv|wav|...}
       <subtitle>.{ass|srt|...}
   ```

否则不要执行此 skill —— 比如用户只想转写、或字幕里完全没有角色标注。

## 前置条件

- `sub/inspect_speakers.py` 存在并可运行
- `env/python.exe`（项目自带 conda 风格 venv）可用
- 终端能输出 UTF-8（脚本内已 `sys.stdout.reconfigure`，但 PowerShell 显示仍可能乱码 — 不必担心，**以报告文件 `sub/inspect_report.txt` 为准**，控制台只是预览）

## 工作流（5 步）

### Step 1 — 先看几十行字幕了解标注格式

不要 `cat` 整个字幕文件，否则上下文会爆。读前 50-80 行就够看出标注模式。

```bash
# 用 Read 工具或 head 看前 60-80 行
```

观察要点：

- 说话人括号是半角 `(...)` 还是全角 `（...）`
- 是否有 furigana 注释嵌套（`酒寄(さかより)彩葉(いろは)`）
- 是否有前缀类型（`NA:` 旁白 / `配信:` 直播中 / `スピーカー:` 设备发出）
- 一行多说话人格式（`-(A)...\N-(B)...`）
- 行首控制字符（U+200E LRM 等，inspect 脚本已处理）

### Step 2 — 跑 inspect 脚本生成全片统计

```bash
env\python.exe sub\inspect_speakers.py --top 100 --samples 1
```

参数说明：
- `--top N`：列出频次前 N 的说话人 token（**用大数，比如 100 或 200**，确保覆盖所有出现 ≥1 次的）
- `--samples K`：每个说话人附带 K 条样本台词（设 1 即可）
- `--input`：默认 `sub/input`，多项目时可指定具体目录

输出两份：
- 控制台：可能因 GBK 乱码，**不要依赖**
- `sub/inspect_report.txt`：UTF-8 干净版，**以此为准**

### Step 3 — 用 Read 工具读 inspect_report.txt 全文

```
Read: sub/inspect_report.txt
```

得到的关键信息：
- 总说话人 token 数（典型番剧电影 80-200 个）
- 每个 token 的频次、原始变体、样本台词
- 多说话人 / 纯音效 / 无标签行的统计

### Step 4 — 应用决策规则分类

把每个 token 按下列**优先级从上到下**判定，第一个匹配的规则即终态。

#### 4.1 排除规则（不进 aliases）

| 类型 | 识别特征 | 例子 |
|---|---|---|
| 群体合声 | 标签是 `N人` / `A・B` / 复数后缀 | `2人`, `3人`, `観客たち`, `真実・芦花`, `かぐや・彩葉`, `大歓声` |
| 路人/职业称谓 | 通称而非角色名 | `先生`, `担任`, `店員`, `男性`, `女性`, `女子1`, `観客1`, `酔っ払い`, `見物客`, `作業員` |
| 音效/环境描述 | 描述声音而非人 | `琵琶の音`, `拍手と歓声`, `ドアの開閉音`, `スイッチ音`, `泣き声が続く`, `和風の音楽`, `ジングル`, `〇〇する音` |
| 设备/媒介播放 | 标签描述声音载体 | `配信音声`, `タブレットの配信音声`, `合成音声`, `音声が続く`, `再生停止` |
| 动物 | 非人类 | `犬DOGE` |

→ **不写入 aliases**。下游 `extract_simple.py --speakers` 选定主角后这些自动被忽略。

#### 4.2 不合并规则（疑似不同声线，单独保留 / 不入 aliases）

| 类型 | 例子 | 处理 |
|---|---|---|
| 童年 / 老年版同角色 | `幼い彩葉`, `年老いたX` | **不合并**到成年版（儿童配音/老人配音音色不同） |
| 角色的亲属（即使姓相同） | `彩葉の父`, `かぐやの母` | 独立角色；如果只 1-2 行不值得训练 → 排除 |
| 角色的合成音 / AI 分身 / 闹钟 | `FUSHIアラーム`, `FUSHIの分身`, `〇〇の合成音` | **不合并**（声线可能与本人不同） |
| 角色的特定动作描述 | `かぐやの泣き声`, `かぐやの配信音声`, `かぐやの口笛` | **不合并**（不确定是台词还是音效） |
| 没有前缀的孤立标签 | 裸 `涙声`（与 `かぐや:涙声` 共存时） | 不合并（归属不明） |

→ 这些都**不进 aliases**，理由写到 `_notes.uncertain_not_merged`。

#### 4.3 合并规则（同一角色不同写法）

满足下列**任一**就视为同一角色：

| 模式 | 例子 |
|---|---|
| 全名 / 短名 | `酒寄彩葉` ↔ `彩葉` |
| 旁白前缀 | `NA:ヤチヨ`, `ナレーション:ヤチヨ` ↔ `ヤチヨ` |
| 媒介前缀（同声优同音色） | `配信:かぐや`, `スピーカー:ヤチヨ` ↔ 本名 |
| 情绪后缀（同声优） | `かぐや:涙声`, `〇〇:叫び` ↔ 本名 |
| 专属称谓 | `帝アキラ` ↔ `帝`（同人不同称呼） |
| 别名 / 绰号 | 在剧情上下文里能确认是同人 |

→ 写入 aliases 同一 canonical key 下。

#### 4.4 频次门槛（建议）

- **≥ 4 行**：值得作为单独 canonical 角色（够 TTS 试训练样本）
- **1-3 行**：列入 aliases 但标注 `_notes.low_count`，或排除
- **0 行**：不存在，跳过

### Step 5 — 写 `speaker_aliases.json`

#### 命名约定

| 字段 | 规则 |
|---|---|
| canonical key | **罗马字**（ASCII），如 `Iroha` / `Kaguya` —— 路径 ASCII 友好，TTS 框架不易因路径里的 CJK 跑挂 |
| 变体值 | 保留字幕**规范化后**形式（即 `inspect_speakers.py` 里 `normalize_speaker()` 输出的形式：去 furigana 括号嵌套，保留 `NA:` 这类前缀整体） |
| 注释 key | 以 `_` 开头（`_comment`, `_notes`）— 下游脚本约定忽略 |

#### 文件模板

```json
{
  "_comment": "speaker_aliases.json — 字幕原始说话人标签 → 规范化角色名。下游脚本按 key 创建输出目录；以 _ 开头的 key 是注释，会被忽略。",

  "_notes": {
    "main_characters": "用户明确指定的主角",
    "supporting_characters": "频次 >= 4 的有名配角",
    "uncertain_not_merged": [
      "幼い<X> - 童年版, 儿童配音, 不合并",
      "<X>アラーム / <X>の分身 - 合成音/分身, 暂不合并",
      "..."
    ],
    "excluded_groups_and_sfx": "群体合声 / 路人职业 / 音效描述 / 动物 不进 aliases；--speakers 选主角即可自动忽略。",
    "naming_convention": "canonical 用罗马字, 变体用字幕 normalize 后形式"
  },

  "Iroha":   ["彩葉", "酒寄彩葉"],
  "Kaguya":  ["かぐや", "ウミウシ:かぐや", "配信:かぐや", "かぐや:涙声"],
  "Yachiyo": ["ヤチヨ", "NA:ヤチヨ", "スピーカー:ヤチヨ", "配信:ヤチヨ", "月見ヤチヨ"]
}
```

写入位置（**必须**与 `project_io.py` 约定一致）：

```
sub/input/<project_name>/speaker_aliases.json
```

文件名固定为 `speaker_aliases.json`（`project_io.ALIASES_FILENAME`），不要改。

## 验证（必跑）

写完文件**必须**跑两条验证：

### 1. JSON 合法性 + 内容预览

```powershell
env\python.exe -c "import json; d=json.load(open('sub/input/<project>/speaker_aliases.json',encoding='utf-8')); keys=[k for k in d if not k.startswith('_')]; print('canonical roles:', len(keys)); [print(f'  {k:8s} <- {len(d[k])} variants: {d[k]}') for k in keys]"
```

期望：列出所有 canonical 角色 + 变体数 + 变体内容。

### 2. project_io 能识别到

```powershell
env\python.exe sub\project_io.py "<project_name>"
```

期望输出包含：

```
aliases  : speaker_aliases.json
```

而不是 `(none)`。

## 决策原则

不确定时按以下优先级：

1. **宁缺毋滥** — 不确定的变体宁可不合并。误合并会污染 TTS 训练数据，少合并最多损失部分数据。
2. **声线优先于剧情** — 同一角色不同情境（旁白/直播/普通对话）合并；同一角色不同年龄段（童年/成年）**不合并**。
3. **频次门槛** — 1-3 行的小角色可以略过，避免 aliases 文件臃肿。
4. **写理由到 `_notes`** — 任何"不合并"的决定都要在 `_notes.uncertain_not_merged` 留一行说明，方便用户复核。

## 常见坑

- **PowerShell 乱码**：报告文件是 UTF-8 干净的。如果只看控制台会以为脚本坏了 —— 永远以 `sub/inspect_report.txt` 为准。
- **U+200E (LRM)** 字符：行首常有，inspect 脚本已 strip。手动核对样本台词时如果看到诡异空格可能是它。
- **furigana 嵌套**：`酒寄(さかより)彩葉(いろは)` 这种是字幕里给汉字注音，inspect 的 `normalize_speaker()` 已去掉嵌套括号；映射文件里写 `酒寄彩葉` 这种**已 normalize 后**的形式即可，**不要**写带 furigana 的原始形式。
- **半角/全角括号混用**：inspect 脚本两种都接受。映射文件里直接复制报告里的 normalize 后形式即可。
- **`--top` 太小**：默认 `--top 40` 在大量小角色场景下会漏掉部分 token。生成 aliases 时**至少用 `--top 100`**，确保看到所有出现过的标签。

## 不要做的事

- ❌ 不要凭"角色名相似"就合并（`帝` vs `帝アキラ` 必须确认是同人；`乙事照琴` vs `琴` 同理需要 inspect 报告里的样本台词佐证）
- ❌ 不要把音效行的"描述性标签"当角色（`かぐやの泣き声` 是描述，不一定有台词）
- ❌ 不要在 aliases 里写注释字段以外的额外结构 —— 下游 `extract_simple.py` 期望 `Dict[str, List[str]]` 格式，多余字段都靠 `_` 前缀过滤
- ❌ 不要修改 `speaker_aliases.json` 这个文件名（`project_io.ALIASES_FILENAME` 硬编码）

## 一句话总结

跑 inspect → 读 report → 按四档规则（合并 / 不合并 / 排除 / 频次太低）分类 → 用罗马字做 canonical key 写 JSON → 用 `project_io.py` 验证识别 → 任何不合并决策写进 `_notes`。
