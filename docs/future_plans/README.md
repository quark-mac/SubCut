# 已归档：早期 Plan A/B/C

> **已归档。** 当前项目已从旧 Whisper/NeMo 方案转向字幕驱动的多模态 speaker labeling。
> 主线流程见 [workflow.md](../workflow.md)。

本目录记录了在调试 NeMo / pyannote 方案过程中讨论出的三个备选方向。
均针对旧目标：**从视频/音频提取并分离不同说话人的语音用于单角色 TTS 训练**。

## 背景

- 当前主流水线（NeMo Sortformer / MSDD、pyannote 3.1 + Whisper）在日语番剧场景下表现不佳：
  - Sortformer 硬限 ≤4 人
  - MSDD 在番剧干声上片段碎片化严重
  - pyannote 即使调参（min/max_speakers=4, clustering_threshold=0.55, min_cluster_size=6）后仍然"几乎没一个准"
- 根因：现有所有 diarization 工具的 embedding 模型（VoxCeleb 等英文数据训练）都不适配日语番剧声优"用相似声线演不同角色"的特点。
- 番剧场景仍存在多人同时说话、情绪化演绎、声线撞型等结构性难题。

## 三个备选方向

| 方向 | 文件 | 核心思路 | 难度 | 预期效果 |
|---|---|---|---|---|
| A | `plan_A_target_speaker_enrollment.md` | 给参考音频做 enrollment，再在目标音频里识别 | 中 | 中-高，依赖参考音频质量 |
| B | `plan_B_llm_assisted_diarization.md` | 转写台词后，让 LLM 基于剧情/口癖/对话连贯性推断角色 | 中 | 中-高，**已实现**（`sub/llm/diarize_llm.py`） |
| C | `plan_C_subtitle_driven_extraction.md` | 利用无障碍字幕（自带说话人标注）直接切片 | 低 | **高，工程问题不是研究问题** |

## 推荐顺序

如果素材有无障碍字幕 → **优先选 C**（最干净、最可靠）

如果只有普通字幕（无说话人标注）+ 你了解角色 → **B + 人工辅助**（已实现，`sub/llm/diarize_llm.py`）

如果什么字幕都没有，但你能从其他渠道找到角色样本 → **A**

如果三者条件都不具备 → 接受现状，pyannote 输出作粗分 + 人工审听

## 共同的工程基线

不管走哪个方向，最终都要：

1. UVR 去 BGM（你已掌握）
2. 切片到 2-15 秒单条
3. **人工抽样审听**（任何全自动方案都会有 5-30% 错分）
4. DNSMOS / UTMOS 评分过滤低质量片段
5. 按角色组织输出目录 + metadata.csv，喂 GPT-SoVITS / Bert-VITS2

## 文件清单

- `README.md` — 本文件（索引 + 总体策略）
- `plan_A_target_speaker_enrollment.md` — 参考音频 enrollment 方案
- `plan_B_llm_assisted_diarization.md` — LLM 辅助修正方案
- `plan_C_subtitle_driven_extraction.md` — 无障碍字幕驱动方案（**首选**）
