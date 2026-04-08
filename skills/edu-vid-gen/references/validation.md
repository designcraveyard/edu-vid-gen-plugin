# Validation Reference

Per-clip validation, final video validation, and checkpoint gates. Loaded on demand from Phases 4 and 5.

---

## validate-clip.py — Per-Clip Validation

Runs automatically after each clip generation (also enforced by post-tool hook). Checks both technical specs and visual-audio sync.

### Usage

```bash
python3 __PLUGIN_DIR__/scripts/validate-clip.py \
  --clip "{OUTPUT_DIR}/clips/clip-{NN}.mp4" \
  --clip-num {NN} \
  --timeline "{OUTPUT_DIR}/audio/timeline.json" \
  --output-dir "{OUTPUT_DIR}" \
  [--model gemini-2.5-flash] \
  [--skip-gemini]
```

### What ffprobe Checks

| Check | Pass criteria | Notes |
|-------|--------------|-------|
| Video duration | Within 0.5s of timeline clip duration | Veo occasionally produces slightly different lengths |
| Audio stream exists | Has at least one audio track | Clips without audio cause compositor errors |
| Resolution | Matches expected aspect ratio | 16:9 or 9:16 |
| Codec | H.264 video, AAC audio | Ensures compatibility |

### Overflow Detection

| Overflow | Severity | Action |
|----------|----------|--------|
| < 0.3s | INFO | Natural hold, no action needed |
| 0.3 - 1.5s | WARN | Compositor will auto-apply Ken Burns zoom |
| > 1.5s | ERROR | Need Veo TC or clip regeneration |

### What Gemini Checks (unless --skip-gemini)

Extracts 5 evenly-spaced frames from the clip and sends to Gemini for visual analysis:

| Dimension | Score range | What it evaluates |
|-----------|------------|-------------------|
| **VO sync** | 1-10 | Do visuals match what's being narrated at each timestamp? |
| **Text contamination** | pass/fail | Any unwanted text, labels, or words in frames? |
| **Style consistency** | 1-10 | Does clip match the declared visual style? |
| **Character consistency** | 1-10 | Does character match description? (skipped if no characters) |
| **Animation quality** | 1-10 | Smooth motion, no artifacts, no jitter? |

### Sync Scoring Rubric

| Score | Criteria |
|-------|----------|
| 9-10 | Every frame matches narrated content. Key visual beats land within 0.5s of spoken words. |
| 7-8 | Most frames match. One beat may be early/late by ~1s. Overall coherent. |
| 5-6 | General theme matches but specific beats misaligned 1-2s. Viewer might notice. |
| 3-4 | Visual and narration tell different stories for 2+ seconds. Confusing. |
| 1-2 | Visual is completely unrelated to narration. Wrong scene entirely. |

### Gate Logic

- All scores >= 7 and no text contamination: **PASS**
- Any score < 7 or text contamination: **FAIL** — pauses pipeline, alerts operator

---

## validate-final.py — Final Video Validation

Runs on the composited final video. Replaces manual junction analysis from v1.

### Usage

```bash
python3 __PLUGIN_DIR__/scripts/validate-final.py \
  --video "{OUTPUT_DIR}/final.mp4" \
  --timeline "{OUTPUT_DIR}/audio/timeline.json" \
  --output-dir "{OUTPUT_DIR}"
```

### What Gemini Checks

Extracts frames at each clip boundary plus mid-clip samples. Evaluates:

| Dimension | Score | What it evaluates |
|-----------|-------|-------------------|
| **Overall VO sync** | 1-10 | Average sync across all clip boundaries |
| **Junction quality** | per-junction | CLEAN / MINOR / JARRING for each clip boundary |
| **Style consistency** | 1-10 | Uniform style across entire video |
| **Character consistency** | 1-10 | Character looks the same throughout |
| **Narrative flow** | 1-10 | Story progresses logically, no jarring scene jumps |
| **ship_ready** | yes/no | Overall: ready to deliver? |

### Gate Logic

- `ship_ready = yes` and average score >= 8: **SHIP**
- Otherwise: **HOLD** — presents per-junction scores, waits for human decision

---

## checkpoint.py — Phase Gates

Verifies that each pipeline phase completed successfully before allowing the next phase.

### Usage

```bash
python3 __PLUGIN_DIR__/scripts/checkpoint.py \
  --phase {N} \
  --output-dir "{OUTPUT_DIR}"
```

### Phase Definitions

| Phase | Gate checks |
|-------|------------|
| **2** | `script.md` exists, keyframe table has correct clip count, narration word counts within range |
| **2.5** | `audio/full-vo.mp3` exists, `audio/timeline.json` valid, all clip durations in [4,6,8]s range, slice files exist |
| **3** | All `images/frame-{NN}.jpg` exist (count matches timeline), compressed `-small.jpg` versions exist |
| **4** | All `clips/clip-{NN}.mp4` exist (count matches timeline), each passed validate-clip.py |
| **5** | `final.mp4` exists, passed validate-final.py, duration within 0.5s of VO end time |

### Gate Behavior

- **PASS**: Prints checkmark, proceeds
- **FAIL**: Prints what's missing/wrong, blocks progression, alerts operator with `say` command
