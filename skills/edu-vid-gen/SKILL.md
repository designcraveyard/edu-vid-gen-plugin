---
name: edu-vid-gen
description: Generate an educational explainer video for a given topic and school class. Audio-first pipeline with VO-driven clip planning, Gemini-powered validation after every clip, MoviePy compositor for transitions, ambient audio layers (--audio-layers), and checkpoint gates between phases. Supports human/abstract/no-character modes.
---

# Edu Video Generator V2

Follow each phase exactly and in order. Heavy content lives in `references/` — load only when needed.

## Scripts & Auth Setup

Scripts live at: `__PLUGIN_DIR__/scripts/`

| Script | Purpose | Auth |
|--------|---------|------|
| `generate-audio-timeline.mjs` | Full VO + word timestamps -> `timeline.json` | `ELEVENLABS_API_KEY` |
| `rebuild-timeline.mjs` | Validate + renumber timeline after edits | none |
| `slice-audio.mjs` | Slice `full-vo.mp3` at clip boundaries | ffmpeg |
| `generate-image.mjs` | Keyframe images via Gemini | `GEMINI_API_KEY` |
| `generate-image-vertex.py` | Keyframe images via Vertex AI | gcloud ADC |
| `generate-voiceover.mjs` | Single-segment TTS (legacy/standalone) | `ELEVENLABS_API_KEY` |
| `generate-video.py` | Video clips via Vertex AI Veo 3.1 | gcloud ADC |
| `generate-character-sheet.mjs` | Character pose/expression reference sheets | `GEMINI_API_KEY` |
| `generate-subtitle-video.py` | Karaoke subtitle overlay for review | ffmpeg + Pillow |
| `generate-ambient.mjs` | Generate ambient loop via ElevenLabs Sound Effects API | `ELEVENLABS_API_KEY` |
| `composite.py` | **MoviePy compositor** — transitions + VO overlay + ambient layer | ffmpeg + moviepy |
| `validate-clip.py` | Per-clip Gemini validation (sync, text, style) | `GEMINI_API_KEY` |
| `validate-final.py` | Final video Gemini validation (junctions, ship_ready) | `GEMINI_API_KEY` |
| `checkpoint.py` | Phase gate verification | none |
| `enhance-for-print.mjs` | Upscale, CMYK, contrast for print | ImageMagick 7 |
| `extend-image.mjs` | Extend images for text overlay space | `GEMINI_API_KEY` + ImageMagick |
| `extend-video.py` | Veo video extension chain | gcloud ADC |
| `generate-zoom.mjs` | Ken Burns zoom clip generation | ffmpeg |
| `stitch.mjs` | Legacy ffmpeg concatenation | ffmpeg |

**First-time setup:** Run `/setup` to install prerequisites and configure API keys.

**Loading API keys:** Before running any script that requires an API key, source the plugin's `.env` file:
```bash
# Load keys from plugin .env
set -a; source "__PLUGIN_DIR__/.env" 2>/dev/null; set +a
```

---

## Phase 1 — Collect Inputs

Ask the user:

1. **Topic** — educational concept (e.g. "Water Cycle", "Photosynthesis")
2. **Class** — grade level (e.g. "Class 5", "7th grade")
3. **Narration language** — Hindi / English / Hinglish / Other. Save as `NARRATION_LANG`.
4. **Chapter source** (optional) — URL, PDF, or textbook text. If provided, ALL narration must derive from it.
5. **Visual style** — Pixar, Clay, 2D Flat, Doodle, Watercolour, or Photorealistic
6. **Characters** — Human (`CHARACTER_MODE=human`), Abstract (`abstract`), or None (`none`)
   - Human: **Veo content filter sensitivity depends on style.** See style-safety matrix below.
   - Abstract: image-to-video safe. Generate character sheets in Phase 2.1.
   - None: image-to-video with start+end frames. Skip Phase 2.1.

**Style-Safety Matrix for Human Characters (Veo content filter):**

| Style | Image-to-video safe? | Notes |
|-------|---------------------|-------|
| Clay/Claymation | **YES** — figurine/toy read bypasses filter | Use "clay figurine", "toy diorama", "fingerprint textures" |
| Pixar (toy-like) | **YES** — if bobblehead/plastic/figurine proportions | Use "toy-like", "plastic skin", "figurine proportions", oversized head |
| Pixar (realistic) | **NO** — human-proportioned faces trigger filter | Fall back to text-to-video |
| Watercolour | **NO** — even fully clothed, illustration-style children get blocked | Fall back to text-to-video |
| 2D Flat / Doodle | Usually safe — test first frame before batch | Very stylized = safer |
| Photorealistic | **NO** — always triggers filter for child characters | Text-to-video only |

**Key rules for passing Veo's content filter with human characters:**
- The more artificial/toy-like the character looks, the safer it is
- Always give characters full clothing (shorts + vest/shirt) — never just a loincloth
- Use "figurine", "toy", "plastic", "puppet" language in Veo prompts
- Replace "toddler/baby/child/boy/girl" with "small character", "cartoon figurine"
- If a style fails: don't retry same style — switch to toy-Pixar or clay
7. **Duration** — 60s or 90s
8. **Aspect ratio** — 16:9 or 9:16
9. **Ambient layer** (`--audio-layers`) — Auto-suggest a category based on topic/setting. User can accept, override, or disable (`--no-ambient`).
   - **Bundled loops** (zero cost, instant): `forest`, `rain`, `ocean`, `space`, `underwater`, `workshop`, `lab`, `garden`. Stored in repo `ambient-loops/` dir.
   - **ElevenLabs generation** (`--generate-ambient`): For vibes not covered by bundled loops. Costs ~$0.04 per 30s clip.
   - Save as `AMBIENT_CATEGORY` (or `none`).

Save variables: `TOPIC`, `CLASS`, `NARRATION_LANG`, `CHAPTER_SOURCE`, `STYLE`, `CHARACTER_MODE`, `DURATION_SEC`, `ASPECT`, `AMBIENT_CATEGORY`

Create output folder:
```bash
# Load env for OUTPUT_BASE_DIR (and API keys)
set -a; source "__PLUGIN_DIR__/.env" 2>/dev/null; set +a
BASE_DIR="${OUTPUT_BASE_DIR:-$PWD}"
SLUG=$(echo "{TOPIC}" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT_DIR="${BASE_DIR}/${SLUG}-${TIMESTAMP}"
mkdir -p "$OUTPUT_DIR"/{images,clips,clips-transition,audio,prompts,characters}
```

---

## Phase 2 — Write Video Brief

**If chapter source provided:** Read it first. Use the textbook's exact definitions and terminology.

**Script guidelines:**
- Each keyframe = 8 seconds. Total = `DURATION_SEC / 8` keyframes.
- Each narration segment = ~18-22 words (~150 WPM for 8s).
- Structure: Hook -> Core explanation -> Key facts -> Summary.
- Character descriptions must be identical verbatim in every prompt.
- Auto-insert audio tags for `eleven_v3` (see `references/audio-tags.md` for tag reference).

**For prompt construction details:** Read `references/prompting.md`

Present brief as:
- Keyframe table: #, Timestamp, Scene Description, Narration, Visual Notes, Text, Transition, Sound Cue, Duration
- Scene wireframe diagrams (ASCII art showing composition)

Save to `$OUTPUT_DIR/script.md`. Ask for approval before proceeding.

### Phase 2.1 — Character Sheets (if `CHARACTER_MODE != none`)

```bash
GEMINI_API_KEY="$GEMINI_API_KEY" node __PLUGIN_DIR__/scripts/generate-character-sheet.mjs \
  --name "{NAME}" --description "{DESC}" --style "{STYLE}" --type both \
  --output "{OUTPUT_DIR}/characters/{name}" --aspect "{ASPECT}"
```

Generates: poses sheet, expressions sheet, recreation prompt. Wait 35s between sheets. Review with user. Use pose sheet as `--reference` in all subsequent image prompts.

**GATE:**
```bash
python3 __PLUGIN_DIR__/scripts/checkpoint.py --phase 2 --output-dir "{OUTPUT_DIR}"
```

---

## Phase 2.5 — Audio Timeline

Generate the entire narration at once with word-level timestamps. The clip count is locked at the end of this phase.

**Step 2.5a** — Choose voice + settings. Default: Anika (`ecp3DWciuUyW7BYM7II1`), `eleven_v3`, stability 0.5, speed 0.98.

**Step 2.5b** — Pronunciation prep (MANDATORY for Hindi/Hinglish):
1. Read `references/audio-tags.md` — load the Devanagari substitution table
2. Scan the full narration for ALL Hindi words with retroflex, aspirated, or nasal sounds
3. Replace romanized Hindi with Devanagari inline (e.g. `kapde` → `कपड़े`). Keep English words in Roman.
4. For English technical terms that ElevenLabs mispronounces, use a pronunciation dictionary:
   - Create one via ElevenLabs dashboard or API (`POST /v1/pronunciation-dictionaries/add-from-rules`)
   - Pass `--dict-id {ID}` to the script
   - **Do NOT use dictionaries for Hindi** — they make pronunciation worse. Devanagari embedding is the fix.
5. Present the processed narration text to the user for approval before generating.

**Step 2.5c** — Generate full VO + timeline:
```bash
ELEVENLABS_API_KEY="$ELEVENLABS_API_KEY" node __PLUGIN_DIR__/scripts/generate-audio-timeline.mjs \
  --text "{FULL_NARRATION_WITH_DEVANAGARI}" \
  --output-dir "{OUTPUT_DIR}/audio" \
  --voice "ecp3DWciuUyW7BYM7II1" --model eleven_v3 \
  --stability 0.5 --speed 0.98 --language hi \
  --min-clip 5 --max-clip 8
# Optional: --dict-id {ID} --dict-version {VER} for English pronunciation fixes
# Optional: --text-normalization on|off|auto (default: auto)
```

**Step 2.5d** — If `AMBIENT_CATEGORY != none`, add ambient config to `timeline.json`:
```json
{
  "ambient": {
    "category": "{AMBIENT_CATEGORY}",
    "volume": 0.15,
    "source": "bundled",
    "path": "${PWD}/ambient-loops/{AMBIENT_CATEGORY}.mp3"
  }
}
```
If bundled loop doesn't exist for the category, generate one:
```bash
ELEVENLABS_API_KEY="$ELEVENLABS_API_KEY" node __PLUGIN_DIR__/scripts/generate-ambient.mjs \
  --prompt "{vibe description}, seamless loop" --duration 30 \
  --output "{OUTPUT_DIR}/audio/ambient-generated.mp3"
```
Then set `"source": "generated"` and `"path"` to the generated file.

**Step 2.5e** — Present timeline as readable table. Ask for edits (merge, split, adjust).

**Step 2.5f** — Validate after edits:
```bash
node __PLUGIN_DIR__/scripts/rebuild-timeline.mjs --timeline "{OUTPUT_DIR}/audio/timeline.json"
```

**Step 2.5g** — Slice audio:
```bash
node __PLUGIN_DIR__/scripts/slice-audio.mjs \
  --timeline "{OUTPUT_DIR}/audio/timeline.json" \
  --audio "{OUTPUT_DIR}/audio/full-vo.mp3" \
  --output-dir "{OUTPUT_DIR}/audio"
```

**Step 2.5h** — Flag VO overflow clips (VO > 8s) for AC+TC split in Phase 4.

**GATE:**
```bash
python3 __PLUGIN_DIR__/scripts/checkpoint.py --phase 2.5 --output-dir "{OUTPUT_DIR}"
```

---

## Phase 2.7 — Strategy Selection

Present both options with recommendation:

**Option A: AC + TC** — Each clip gets its own keyframe. Best for distinct scene changes. Pre-plan transitions from VO gap analysis.

**Option B: Veo Extend Chain** — Chain extensions from first clip. Best for continuous narrative in one environment. Risk: character drift after 3+ extensions.

Save as `VIDEO_STRATEGY = "ac_tc"` or `"extend"`.

If AC+TC: pre-plan transition types per junction (hard cut / crossfade / slow zoom / Veo TC) based on VO gaps from timeline.json.

---

## Phase 3 — Generate Keyframe Images

**If `VIDEO_STRATEGY = "extend"`:** Generate only frame-01, skip rest.

Image count = `timeline.total_clips`. Wait 35s between Gemini calls.

**For prompt templates and rules:** Read `references/prompting.md`

For each clip in timeline.json:
1. **Build image prompt** — character description (verbatim) + scene + style descriptors + TEXT RULES anti-prompt. Remember BEFORE-state for action scenes.
2. **Save prompt** to `prompts/frame-{NN}_prompt.md`
3. **Generate image** — with `--reference` if character sheets exist
4. **Quality gate** — Claude vision review: aspect ratio, character consistency, scene continuity, VO-scene alignment, text contamination. Max 2 retries.
5. **Display and ask** — if user approves + says keep going, skip confirmation on subsequent passing frames.
6. **Compress all** after approval: `sips -Z 1280 frame-{NN}.jpg --out frame-{NN}-small.jpg --setProperty formatOptions 65`

**GATE:**
```bash
python3 __PLUGIN_DIR__/scripts/checkpoint.py --phase 3 --output-dir "{OUTPUT_DIR}"
```

---

## Phase 4 — Generate Video Clips

**If `VIDEO_STRATEGY = "extend"`:** Use `extend-video.py` chain instead (generate initial 8s clip, then chain +7s extensions).

Model: `veo-3.1-fast-generate-001`. Process clips sequentially.

**For Veo prompt structure and beat maps:** Read `references/prompting.md`

**Audio prompt rewriting when `--audio-layers` is active:** When `AMBIENT_CATEGORY != none`, Veo clips must produce SFX only — no ambient/atmospheric sounds. For each clip's `--audio-prompt`:
1. Extract action-specific SFX from the scene (footsteps, splashes, clicks, door creaks, etc.)
2. Prefix with `[SFX only: {extracted SFX}]`
3. Append: `No background music, no ambient noise, no atmospheric sounds`
4. Strip any ambient/atmosphere descriptors from the original prompt

For each clip:
1. **Build word-synced beat map** from `full-vo-timestamps.json` — rebase to clip-relative time, add +1s anticipation buffer
2. **Build timestamp-structured Veo prompt** using `[MM:SS-MM:SS]` format
3. **Save prompts** to `prompts/clip-{NN}_prompt.md`
4. **Generate clip** — image-to-video (abstract/none) or text-to-video (human)
5. **MANDATORY: Run validate-clip.py after EACH clip** (also enforced by hook):
   ```bash
   python3 __PLUGIN_DIR__/scripts/validate-clip.py \
     --clip "{OUTPUT_DIR}/clips/clip-{NN}.mp4" \
     --clip-num {NN} \
     --timeline "{OUTPUT_DIR}/audio/timeline.json" \
     --output-dir "{OUTPUT_DIR}"
   ```
   If any score < 7: pause, alert operator, wait for decision (accept/regenerate/adjust).
6. **Generate transition clips** after all ACs — extract last frames, generate TCs at correct Veo duration [2,4s]

**For validation details:** Read `references/validation.md`
**For error handling:** Read `references/api-errors.md`

Wait 60-90s between Veo calls.

**GATE:**
```bash
python3 __PLUGIN_DIR__/scripts/checkpoint.py --phase 4 --output-dir "{OUTPUT_DIR}"
```

---

## Phase 5 — Composite & Export

Use `composite.py` — NOT manual ffmpeg xfade chains. The compositor reads timeline.json, calculates all gaps and overflow automatically, applies transitions, and overlays the VO.

**Step 5a — Run compositor:**
```bash
python3 __PLUGIN_DIR__/scripts/composite.py \
  --clips-dir "{OUTPUT_DIR}/clips" \
  --timeline "{OUTPUT_DIR}/audio/timeline.json" \
  --vo-audio "{OUTPUT_DIR}/audio/full-vo.mp3" \
  --output "{OUTPUT_DIR}/final.mp4" \
  --veo-tcs-dir "{OUTPUT_DIR}/clips-transition" \
  --sfx-volume 0.35 \
  --ambient "{AMBIENT_PATH}" --ambient-volume 0.15
```
Omit `--ambient` if `AMBIENT_CATEGORY == none`. The ambient path comes from `timeline.json.ambient.path`.

**Audio stack in final video:**
| Layer | Source | Volume |
|-------|--------|--------|
| 1 — VO | ElevenLabs full-vo.mp3 | 100% |
| 2 — SFX | Veo 3.1 native audio per clip | 35% |
| 3 — Ambient | Looped to video length | 15% |

**For transition details:** Read `references/transitions.md`

**Step 5b — Validate final video:**
```bash
python3 __PLUGIN_DIR__/scripts/validate-final.py \
  --video "{OUTPUT_DIR}/final.mp4" \
  --timeline "{OUTPUT_DIR}/audio/timeline.json" \
  --output-dir "{OUTPUT_DIR}"
```

If `ship_ready = yes` and average score >= 8: proceed. Otherwise: present scores, wait for human decision.

**Step 5c — Generate metadata.json** with all generation settings for reproducibility.

**Step 5d — Launch Timeline Editor:**

The editor lets the operator trim clips, adjust VO timing, add transitions, preview the video, and export to professional NLEs (Premiere Pro, DaVinci Resolve, After Effects).

```bash
node __PLUGIN_DIR__/editor/start.mjs \
  --project "{OUTPUT_DIR}"
```

This starts a local Next.js app at `http://localhost:3333` with a media server at port 3334. The browser opens automatically. The editor provides:
- **Video preview** with per-clip playback and timeline scrubbing
- **Trim & reorder** video clips and VO segments on a visual timeline
- **Transition editor** — apply crossfade, dissolve, wipe, slide, etc. per-clip or globally
- **Save Timeline** — writes `edited-timeline.json` to the project folder
- **Render MP4** — re-renders from the edited timeline using ffmpeg
- **Export Premiere XML** — FCP7 XML format (works in Premiere Pro, DaVinci Resolve, Final Cut Pro) → `{OUTPUT_DIR}/export/project.xml`
- **Export AE Script** — After Effects ExtendScript (.jsx) → `{OUTPUT_DIR}/export/project.jsx`

After the editor launches, also open the project folder:
```bash
open "{OUTPUT_DIR}"
```

Report: output folder, script, characters, prompts, voiceover, frames, clips, final video, metadata, editor URL.

**GATE:**
```bash
python3 __PLUGIN_DIR__/scripts/checkpoint.py --phase 5 --output-dir "{OUTPUT_DIR}"
```

---

## Phase 6 — Post-Pipeline Options

Optional enhancements after video is complete:

**NLE Export (from Timeline Editor):**

If the operator made edits in the Timeline Editor (Step 5d), they can export directly from the editor UI. If the editor is not running, re-launch it:
```bash
node __PLUGIN_DIR__/editor/start.mjs \
  --project "{OUTPUT_DIR}"
```

| Export | Button | Output | Compatible With |
|--------|--------|--------|-----------------|
| Premiere XML | "Export Premiere XML" | `export/project.xml` | Premiere Pro, DaVinci Resolve, Final Cut Pro |
| After Effects | "Export AE Script" | `export/project.jsx` | After Effects (File → Scripts → Run Script) |
| Re-render MP4 | "Render MP4" | `final-edited.mp4` | Standalone playback |

The XML export uses FCP7 XML format — the universal interchange format supported by all major NLEs. It preserves clip positions, trim points, transitions (as cross dissolves), and VO track placement with absolute file paths.

The AE script creates a composition with all clips and VO segments at their correct timeline positions, including opacity keyframes for cross-dissolve transitions.

**Print-ready images:**
```bash
node __PLUGIN_DIR__/scripts/enhance-for-print.mjs \
  --dir "{OUTPUT_DIR}/images" --output-dir "{OUTPUT_DIR}/images/print" --dpi 300 --format tiff
```
For RGB proofs: add `--skip-cmyk --format jpeg`.

**Image extensions for text overlays:**
```bash
GEMINI_API_KEY="$GEMINI_API_KEY" node __PLUGIN_DIR__/scripts/extend-image.mjs \
  --input "{OUTPUT_DIR}/images/frame-{NN}.jpg" \
  --output "{OUTPUT_DIR}/images/frame-{NN}-extended.jpg" \
  --direction "{direction}" --extend-by 30 --style "{style}"
```
Directions: left, right, top, bottom, corners, all. Styles: gradient, flat, blur. Wait 35s between calls.

---

## Error Handling

**For the full error table, face-blocking workarounds, rate limits, and cost reference:** Read `references/api-errors.md`

Quick reference for the most common issues:
- Gemini 429 -> wait 60s, retry
- ElevenLabs 401 -> check `ELEVENLABS_API_KEY`
- Veo 403 -> `gcloud auth application-default login`
- Veo face-blocking (17301594) -> use text-to-video mode (omit `--image`)
- Veo word restriction (58061214) -> replace "girl/boy/child" with "character/animated figure"
- ffmpeg not found -> `brew install ffmpeg`
