---
name: build-role-descriptions
description: Use ONLY when the user asks to create, research, complete, audit, or validate role_descriptions.json, canonical speaker lists, character voice/style evidence, or Gemini character profiles for a subtitle project. Do not use for running diarization, editing normalization algorithms, or general anime discussion.
---

# Build Role Descriptions

Read `docs/skills/build_role_descriptions.md` and follow it as the authoritative specification.

## Mandatory Workflow

1. Inspect the project directory, candidate normalized SRT, existing role descriptions, aliases, and relevant docs before asking questions.
2. Do not generate `role_descriptions.json` until the user has confirmed the target episode/season, spoiler boundary, canonical speaker scope, and label naming convention.
3. Ask 3-5 high-value questions per round. Continue questioning contradictions and missing decisions instead of guessing.
4. Present a proposed canonical list, `OTHER` boundary, identity merges/splits, confusion pairs, and information gaps before writing.
5. Research only within the user's authorized scope. Prefer official sources and record URLs; do not treat search snippets as evidence.
6. Write descriptions for the fields actually consumed by `_format_role_descriptions()`. Keep plot and appearance as context-only/weak evidence.
7. Never invent first-person pronouns, catchphrases, relationships, genders, voice qualities, or future identities. Leave unknown values empty and report them.
8. Validate the JSON with `load_role_descriptions()` and `_format_role_descriptions()`, then inspect the rendered prompt.
9. Require explicit `--speakers` for non-Kaguya projects and verify it matches all non-underscore top-level role keys.
10. Run Gemini only with `--plan-only` unless the user separately approves a paid API call.

## Question Priorities

Ask in this order:

1. Scope: episode/season/movie and spoiler allowance.
2. Label ontology: canonical characters, `OTHER` boundary, groups, songs, and identity variants.
3. Label naming: exact output strings.
4. Evidence: official links, user knowledge, references, known voice/speech traits, and confusion pairs.
5. Research permission: whether web research is desired and which sources/languages are acceptable.

Do not ask for information already present in local files. When user answers conflict with local or web evidence, surface the conflict and ask which source controls the label contract.

## Completion Report

Return:

- file path;
- canonical speaker list and exact `--speakers` value;
- unresolved facts left empty;
- sources consulted;
- rendered-prompt validation result;
- plan-only result or reason it was not run;
- warning that OpenCode must be restarted after creating/updating this Skill.
