# offmute-v2 参考结论

参考项目：`SouthBridgeAI/offmute-v2`

该项目解决的是会议音视频转写和 diarization，不是字幕 speaker relabeling。但有几条工程原则可以迁移。

## offmute-v2 的核心做法

- 使用长音频 chunk，默认约 `600s` chunk + `60s` overlap
- chunk 边界尝试用 `ffmpeg silencedetect` 贴近静音点
- 每个 chunk prompt 带 speaker roster 和上一 chunk 的最后几行 transcript tail
- LLM 输出需要结构化 JSON，并做 validation：segment 数、时间单调性、覆盖 chunk 时长比例。不合格会 retry
- LLM 负责内容和粗 speaker；独立 ASR/diarizer 提供全局 word timestamp 和 voice cluster
- 后处理用 alignment 把 LLM 文本对齐到 ASR word times，再用 ASR voice cluster 做 speaker consistency
- overlap 区域不用 fuzzy dedup，而是用 `trustedStart` ownership：每个 chunk 只拥有自己负责的时间段
- 对混合说话人的长 segment，会根据 ASR voice cluster runs 再切开

## 为什么它可以用长 chunk

offmute-v2 能用长 chunk，是因为后面有 validation、alignment、speaker consistency 和 mixed-voice split 兜底。它不把 LLM 一次输出当最终结果。

## 对本项目的启发

- 本项目已经有字幕时间和固定 `idx`，不需要照搬 ASR word alignment
- 但不能只照搬"长 chunk"。offmute-v2 的兜底层我们目前没有
- 如果要让 batch 更大（更多 target entries），需要引入类似的后处理校验
- 更实际的下一步是两遍标注：大 batch 初筛 + 高风险区域小 batch 复核
- 长期可以尝试 ASR voice cluster 作为第二信号，但不应作为当前第一步

## 已验证的差异

当前仅有一次 Gemini 判断，batch 目标太多（如 45 条）时模型会高置信误判。解决方案不是堆更多模型描述或参考样本，而是控制每次请求的目标密度，或用后处理兜底。
