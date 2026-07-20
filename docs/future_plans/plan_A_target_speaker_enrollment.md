# 方案 A：参考音频 Enrollment（Target Speaker Diarization）

## 核心思路

不再让模型"自己发现"音频里有谁，而是**先告诉模型"这是 Kaguya 的声音"**，让它去找匹配的片段。

学术名：**Target Speaker Diarization (TSD)** / **Speaker-Conditioned Diarization** / **Speaker Spotting**。

```
传统 Diarization:        TSD:
  目标音频              目标音频 + 参考音频
     ↓                      ↓
   聚类                  相似度匹配
     ↓                      ↓
  SPK1/2/3...           Kaguya / not-Kaguya
```

## 适用场景

- 你能为每个角色找到 10-30 秒的干净参考音频
- 角色数量已知且固定（比如就是 Kaguya / Iroha / Yachiyo / Fushi 4 人）
- 不要求自动发现新角色

## 完整流程

```
1. 准备每个角色的参考音频 (enrollment audio)
   - 每人 10-30 秒干净语音
   - 最好覆盖角色的不同情绪 (平静 + 激动 + 低声)
   - UVR 处理过, 无 BGM

2. 用 embedding 模型提取 enrollment embedding
   - 候选模型: TitaNet (NeMo, 已装) / CAM++ (3D-Speaker) / ECAPA-TDNN
   - 对每个角色的 N 段参考音频提 embedding, 取平均得到 centroid

3. 对目标音频做切片 (用 pyannote segmentation, 不做聚类)
   - 得到每个 "有人说话" 的时间段

4. 对每个时间段提取 embedding

5. 计算每段 embedding 和 4 个角色 centroid 的余弦相似度

6. 分配规则:
   - 最高相似度 > threshold_high (如 0.7) → 直接归该角色
   - 最高相似度 < threshold_low  (如 0.4) → 标记 "未知"
   - 介于中间 → 标记 "低信心", 进人工审听

7. 输出:
   - output/Kaguya/  → 高信心片段
   - output/Iroha/
   - output/Yachiyo/
   - output/Fushi/
   - output/_uncertain/  → 低信心, 待审听
   - output/_unknown/    → 完全不匹配, 可能是路人/旁白
```

## 工具选择

### Embedding 模型对比

| 模型 | 训练数据 | 对日语的适配 | 工程量 |
|---|---|---|---|
| NeMo TitaNet | VoxCeleb（英文） | 弱，和 pyannote 现状类似 | 已装 |
| 3D-Speaker CAM++ | CN-Celeb（中文） | 中等，亚洲语种共性多 | 装 modelscope |
| 3D-Speaker ERes2Net | CN-Celeb + 3D-Speaker | 中等偏好 | 装 modelscope |
| WeSpeaker | VoxCeleb / CN-Celeb 多个版本 | 看选哪个 checkpoint | 装 wespeaker |

**推荐**：先用 CAM++（亚洲语种偏置 + 不需要 HF token）。

### 切片工具

- **pyannote 4.x** 的 segmentation 部分（已装），只用切片不做聚类
- 或 silero-vad（更轻量）

## 已知开源/商业方案

| 方案 | 性质 | 备注 |
|---|---|---|
| pyannote `speaker-spotting` | 开源 | 4.x 版本不确定是否还维护 |
| WeSpeaker target speaker | 开源 | 需自己拼流水线 |
| Microsoft Azure Speaker Identification | 商业 API | 支持 enrollment, 上传到云 |
| NVIDIA NeMo SpeakerVerification | 开源 | 可做相似度比对 |
| 3D-Speaker / FunASR | 开源 | 阿里出品，亚洲语种友好 |

## 实施计划（如果选这个方向）

### 阶段 0：准备参考音频（你来做）

每个角色准备：
- 主目录：`reference/{角色名}/`
- 内容：3-5 段 5-10 秒的干净语音（已 UVR）
- 命名：`reference/Kaguya/01_normal.wav` / `02_emotional.wav` / `03_quiet.wav`

### 阶段 1：脚本开发

新文件 `diarize_enrollment.py`：

```python
# 伪代码
def main():
    # 1. 加载所有角色的参考音频, 提 embedding, 算 centroid
    centroids = {}
    for role in os.listdir("reference/"):
        embs = [extract_emb(wav) for wav in glob(f"reference/{role}/*.wav")]
        centroids[role] = np.mean(embs, axis=0)

    # 2. 对目标音频切片 (用 pyannote segmentation only)
    segments = segment_audio(target_wav)  # [(start, end), ...]

    # 3. 对每段提 emb, 算和每个 centroid 的相似度
    for seg_start, seg_end in segments:
        seg_emb = extract_emb(target_wav, seg_start, seg_end)
        sims = {role: cosine(seg_emb, c) for role, c in centroids.items()}
        best_role = max(sims, key=sims.get)
        best_score = sims[best_role]

        if best_score > 0.7:
            save_to(f"output/{best_role}/", seg_start, seg_end)
        elif best_score < 0.4:
            save_to("output/_unknown/", seg_start, seg_end)
        else:
            save_to("output/_uncertain/", seg_start, seg_end, sims=sims)
```

### 阶段 2：配置和测试

```json
// diar_config.json 新增
"enrollment": {
    "embedding_model": "campplus",  // titanet / campplus / eres2net
    "reference_dir": "reference/",
    "threshold_high": 0.70,
    "threshold_low": 0.40,
    "min_segment_duration": 1.5
}
```

### 阶段 3：评估和迭代

- 听 `_uncertain/` 目录的片段，调整阈值
- 听各角色目录，统计错误率
- 必要时增加参考音频（特别是漏掉的情绪/音域）

## 优点

- **不依赖聚类**——直接绕开了 pyannote/NeMo 最不稳定的环节
- **声线撞型场景仍能工作**——只要参考音频差异够大
- **可以增量增加角色**——后续添加新角色只需增加参考音频
- 完全离线、可控

## 缺点和风险

- **参考音频质量决定效果上限**
  - 如果参考音频和目标音频的录音条件差异大（比如参考是 OP 歌曲、目标是对话），相似度会下降
  - 建议参考音频从同一影片/同一录音环境取
- **短片段（< 1.5s）相似度不稳**
  - 太短的音频提不出稳定 embedding
  - 需要丢弃或合并相邻段
- **情绪极端的片段会失败**
  - 角色尖叫、哭戏、装别人声音的段落，参考音频里可能不存在类似的，会被判为 "_uncertain"
  - 这其实是好事——这类片段对 TTS 训练也有害，丢弃即可
- **需要每个角色 ≥10s 的高质量参考**
  - 如果你只有少量样本，可能不够稳

## 与其他方案的对比

| 维度 | 方案 A (Enrollment) | 方案 B (LLM) | 方案 C (Subtitle) |
|---|---|---|---|
| 依赖资源 | 参考音频 | LLM API + 角色介绍 | 带说话人的字幕 |
| 准确率上限 | 中-高 | 中 | 极高 |
| 短片段处理 | 不稳，需丢弃 | 完全无解 | 字幕有标，能处理 |
| 工程量 | 中 | 中 | 低 |
| 离线性 | 完全离线 | 多数 LLM 需联网 | 完全离线 |
| 跨集泛化 | 好 | 中 | 看字幕是否覆盖 |

## 何时选 A 而不是 C

- 你没有带说话人标注的字幕
- 但你能找到每个角色的纯净样本（比如从 OST、特典、声优访谈、其他作品）

## 何时选 A 而不是 B

- 你不想依赖 LLM API
- 短台词占比不大（<30%）

## 参考资料

- pyannote speaker-spotting: https://huggingface.co/pyannote/speaker-diarization-3.1（同 repo 下）
- 3D-Speaker: https://github.com/modelscope/3D-Speaker
- WeSpeaker: https://github.com/wenet-e2e/wespeaker
- NeMo SpeakerVerification: https://docs.nvidia.com/deeplearning/nemo/user-guide/docs/en/main/asr/speaker_recognition/intro.html
- 综述论文：搜 "target speaker diarization" / "speaker-conditioned VAD" 相关 INTERSPEECH/ICASSP 论文
