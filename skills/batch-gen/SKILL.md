---
name: batch-gen
description: Generate multiple educational videos from a single batch manifest (batch.json). Phase-batched execution with 4 review gates, cost tracking, and resume support. Uses all existing edu-vid-gen scripts — no new generation tools.
---

# Batch Video Generator

Generate multiple educational videos from a single JSON manifest. Reuses every script from `edu-vid-gen` — this skill only orchestrates the batch flow.

## Scripts

All scripts at `__PLUGIN_DIR__/scripts/`. Batch-specific:

| Script | Purpose |
|--------|---------|
| `validate-manifest.py` | Pre-flight schema check + cost estimate |
| `batch-checkpoint.py` | Read/write `batch-status.json` state tracking |
| `checkpoint.py` | Per-video phase gate (supports `--json-output`) |
| `validate-sync.py` | Subtitle overlay + Gemini 2.5 Pro sync analysis (Phase 5 self-healing) |
| `composite-video-first.py` | Video-first fallback compositor (Phase 5 attempt 3) |

All generation scripts from edu-vid-gen are used as-is.

---

## Phase 0 — Load & Validate Manifest

The user provides a `batch.json` file. For schema details: read `references/batch-mode.md`.

**Step 0a** — Validate manifest:
```bash
python3 __PLUGIN_DIR__/scripts/validate-manifest.py --manifest "{MANIFEST_PATH}"
```

If errors: show them and stop.

**Step 0b** — Present cost estimate. Wait for approval.

**Step 0c** — Initialize batch state:
```bash
python3 __PLUGIN_DIR__/scripts/batch-checkpoint.py \
  --init --manifest "{MANIFEST_PATH}" \
  --output-dir "{BATCH_OUTPUT_DIR}"
```

**Step 0d** — Create all video output directories.

---

## Phase 1 — Derive Inputs (All Videos)

For each video, merge `defaults` + `overrides` to compute all variables.

```bash
python3 __PLUGIN_DIR__/scripts/batch-checkpoint.py \
  --update --video "{VIDEO_ID}" --state SCRIPTING --status-file "{STATUS_FILE}"
```

---

## Phase 2 — Write Scripts (All Videos)

Follow `edu-vid-gen` Phase 2 rules exactly. After ALL scripts written:

### BATCH REVIEW GATE: Scripts
Present all scripts. Wait for approval.

---

## Phase 2.1 — Shared Characters (if any)

Generate character sheets for each entry in `shared_characters`. Wait 35s between calls.

### BATCH REVIEW GATE: Characters

---

## Phase 2.5 — Audio Timelines (All Videos, Sequential)

```bash
ELEVENLABS_API_KEY="$ELEVENLABS_API_KEY" node __PLUGIN_DIR__/scripts/generate-audio-timeline.mjs \
  --text "{FULL_NARRATION}" \
  --output-dir "{OUTPUT_DIR}/audio" \
  --voice "{VOICE_ID}" --model "{VOICE_MODEL}" \
  --stability 0.5 --speed 0.98 --language hi \
  --min-clip 5 --max-clip 8
```

After each: run `rebuild-timeline.mjs` and `slice-audio.mjs`.

### BATCH REVIEW GATE: Timelines

After approval:
```bash
python3 __PLUGIN_DIR__/scripts/checkpoint.py --phase 2.5 --output-dir "{OUTPUT_DIR}"
python3 __PLUGIN_DIR__/scripts/batch-checkpoint.py \
  --complete-phase --video "{VIDEO_ID}" --phase "2.5" --status-file "{STATUS_FILE}"
```

---

## Phase 2.7 — Strategy Selection (All Videos)

Choose `ac_tc` or `extend` from manifest or ask user.

---

## Phase 3 — Generate Keyframe Images (Round-Robin)

**Rate limit: 35s global between Gemini calls.** Round-robin across videos.

After all images for a video: compress for Veo.

### BATCH REVIEW GATE: Images

---

## Phase 4 — Generate Video Clips (Sequential, Interleaved Validation)

**Rate limit: 60-90s global between Veo calls.**

For each clip: generate, validate with `validate-clip.py`, queue retries if score < 7.

### BATCH REVIEW GATE: Flagged Clips Only

Auto-approve scores >= 7. Present only flagged clips.

---

## Phase 5 — Self-Healing Composite (Parallel per Video)

Each video runs max 3 composite attempts:
1. Attempt 1-2: `composite.py` (VO-first)
2. Attempt 3: `composite-video-first.py` (video-first fallback)

After each: run `validate-sync.py` for Gemini Pro sync analysis.

If score >= 7: PASS. If < 7 after 3 attempts: ESCALATE.

---

## Phase 6 — Summary Report

```bash
python3 __PLUGIN_DIR__/scripts/batch-checkpoint.py \
  --summary --status-file "{STATUS_FILE}"
```

---

## Resume

```
/batch-gen --resume {path-to-batch-status.json}
```

---

## Error Handling

| Error | Strategy |
|-------|----------|
| One video fails | Mark `FAILED`, continue others |
| Gemini 429 | Wait 60s, retry |
| Veo face-blocking | Switch to text-to-video |
| Auth errors | Pause entire batch |
| Self-healing exhausted | Escalate to user |

---

## Prompt Building

Load references as needed:
- `edu-vid-gen/references/prompting.md`
- `edu-vid-gen/references/validation.md`
- `edu-vid-gen/references/audio-tags.md`
- `edu-vid-gen/references/transitions.md`
- `edu-vid-gen/references/api-errors.md`
