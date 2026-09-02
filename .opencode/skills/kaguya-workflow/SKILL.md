---
name: kaguya-workflow
description: Use ONLY when the user asks to run, guide, resume, inspect, evaluate, or export the end-to-end Cosmic Princess Kaguya subtitle workflow. Do not use for code changes, code review, refactoring, debugging implementation, normalize algorithm development, prompt development, or production-default changes.
---

# Kaguya Workflow Operator

Read `docs/operator_workflow.md` before acting and follow it as the authoritative operating procedure.

Rules:

1. Guide one workflow stage at a time; do not run the whole pipeline in one response.
2. Inspect existing inputs and outputs before asking the user for information already available on disk.
3. Show the exact command before executing it and state whether it calls a paid API, overwrites files, or generates large media.
4. Ask for explicit confirmation before DeepSeek/Gemini calls, overwrite, or deletion.
5. Use a new clean output directory for partial Gemini runs and prefer new directories for full runs.
6. Do not edit Python, prompt text, project configuration, Gold Set, scene algorithms, evaluation logic, or production defaults.
7. When implementation behavior is wrong, stop and produce the programming-agent handoff packet from `docs/operator_workflow.md`.
8. Use `docs/workflow.md` as the command reference and `docs/CURRENT.md` as the current production contract.
