# SubCut

Subtitle-driven speaker annotation, manual review, and character clip export, maintained by **quark-mac**.

The local subtitle editor supports video playback, speaker tracks, timing and text edits, project persistence, and subtitle import/export. The next feature is a single-video management interface: invoke an existing vocal-separation tool, combine MOSS and Diarize results into an editable project, then export media after manual review.

`Cosmic Princess Kaguya` is the evaluation dataset and workflow example.

## Status

- **Available on `feat/webui`:** local subtitle editor with autosave, undo/redo, track management, playback previews, waveforms, and thumbnails.
- **Available CLI tools:** normalization, acoustic diarization and subtitle alignment, semantic scene generation, Gemini labeling, Gold evaluation, and SRT-driven clip extraction.
- **In design:** the MOSS + Diarize management workflow and project-driven media export. Multimodal integration is reserved for later work.

See [current status](docs/CURRENT.md) for scope and data baselines. The editor is on [`feat/webui`](https://github.com/quark-mac/SubCut/tree/feat/webui), pending integration into `main`.

## Start Here

- [Subtitle editor](webui/README.md): installation, use, formats, and validation.
- [Management workflow diagrams](docs/README.md#管理界面第一版): with and without source subtitles.
- [Voice backend](voice/README.md): anonymous diarization and subtitle alignment.
- [Operator guide](docs/operator_workflow.md): run or resume existing tools.
- [CLI commands](docs/workflow.md): normalization, scenes, Gemini, evaluation, and extraction.
- [Documentation index](docs/README.md).

## Development

Repository conventions and task-specific reading: [AGENTS.md](AGENTS.md).
Validation and experiment records: [docs/development.md](docs/development.md).

Local environments, media, generated results, editing workspaces, and private model configuration are kept outside version control. Use the sample configurations under `sub/llm/` when setting up model access.

## Project

- **Maintainer:** [quark-mac](https://github.com/quark-mac)
- **Repository:** [quark-mac/SubCut](https://github.com/quark-mac/SubCut)
- **Issues:** [GitHub issues](https://github.com/quark-mac/SubCut/issues)
- **License:** [BSD 2-Clause](LICENSE). Copyright notices for earlier contributions are retained alongside the SubCut notice.
