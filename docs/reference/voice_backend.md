# Voice 后端集成现状

## 实现

`voice/diarize_audio.py` 调用 `diarize.diarize()`；`export_speaker.py` 将匿名说话人时间段关联到字幕；`workflow.py` 串联推理和字幕导出。命令、格式及诊断字段以 [voice/README.md](../../voice/README.md) 为准。

当前依赖固定在 `voice/requirements.txt`，本机环境使用 CPU Torch/Torchaudio 2.8.0。需要其他依赖栈的模型使用独立环境。

输入音频保留原片时间基准；短片通过显式 offset 关联全片字幕。匿名标签与人工角色映射按单次推理运行管理。

## 验证与后续接入

官方推理与字幕导出已完成 62 秒素材的端到端验证，详见 [字幕对齐验证](../design/voice/subtitle_export_results.md)。算法选择依据见 [官方流程研究](../design/voice/official_pipeline_research.md)。

两阶段聚类方案已结束，相关 [实验结果](../design/voice/implementation_results.md) 保留作历史记录。

下一步在单视频管理界面中接入当前 voice 流程，与 MOSS 字幕进行候选对应和冲突检查。总体范围见 [CURRENT.md](../CURRENT.md#当前方向单视频管理界面)。
