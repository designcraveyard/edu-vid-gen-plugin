---
name: vo-sync
description: VO-synced video compositor — takes existing clips + timeline.json, calculates gaps/overflow, lets user choose transitions (crossfade, slow zoom, Veo TC), and produces a perfectly synced final video with full-vo.mp3 as master clock.
---

# VO Sync — Transition & Composite Skill

You are running the `/vo-sync` skill. This is a **standalone post-production skill** — it assumes clips and VO are already generated. It takes existing assets and produces a VO-synced final video with transitions.

---

## Required Assets

Before running, verify these exist in the project folder:

| Asset | Path | Required |
|-------|------|----------|
| Timeline | `audio/timeline.json` | ✅ |
| Full VO | `audio/full-vo.mp3` | ✅ |
| VO timestamps | `audio/full-vo-timestamps.json` | Optional (for sync verification) |
| VO slices | `audio/slice-{NN}.mp3` | ✅ (one per clip) |
| Veo clips | `clips/clip-{NN}.mp4` | ✅ |
| Keyframe images | `images/frame-{NN}-small.jpg` | Optional (needed for Veo TCs) |

Ask the user for the project folder path if not obvious from context.

---

## STEP 1 — Analyze VO Timeline

Read `timeline.json` and calculate the full gap/overflow analysis:

```bash
cat "{OUTPUT_DIR}/audio/timeline.json"
```

For each clip, compute:
```
veo_video_dur = ffprobe -v quiet -show_entries stream=duration -select_streams v:0 -of csv=p=0 "clips/clip-{NN}.mp4"
vo_span       = clip.audio_end - clip.audio_start
overflow      = vo_span - veo_video_dur        # >0 means frozen frame at end
gap_after     = next_clip.audio_start - clip.audio_end   # silence between clips
```

Present the analysis table:

```
=== VO Sync Analysis ===
Total VO: {vo_end}s | Clips: {N}

Clip  Veo(s)  VO Span(s)  Overflow(s)  Gap After(s)  Recommendation
────  ──────  ──────────  ───────────  ────────────  ──────────────
  1    8.0     11.05        3.05 ⚠️       0.30        Zoom/Veo TC + crossfade
  2    8.0      6.77        0.00          0.32        Crossfade (0.3s)
  3    8.0      6.94        0.00          0.32        Crossfade (0.3s)
  4    8.0      6.86        0.00          0.16        Crossfade (0.3s)
  5    6.0      5.19        0.00          0.52        Crossfade (0.5s)
  6    6.0      5.38        0.00          —           End
```

**Overflow detection rules:**
- `overflow > 1.0s` → ⚠️ NEEDS TRANSITION (frozen frame is noticeable)
- `overflow 0.3–1.0s` → ⚡ Optional (minor freeze, crossfade can cover)
- `overflow < 0.3s` → ✅ OK (imperceptible)

**Gap classification:**
- `gap < 0.2s` → tight crossfade (0.3s)
- `gap 0.2–0.5s` → standard crossfade (0.3–0.5s)
- `gap > 0.5s` → longer crossfade (0.5s) or consider TC

---

## STEP 2 — Choose Transition Strategy

Present options to the user:

> "Here's what I recommend based on the VO analysis:
>
> **For overflow clips (frozen frames):**
> 1. 🔍 **Slow zoom-in** — ffmpeg Ken Burns on last frame (instant, free, smooth)
> 2. 🎬 **Veo transition clip** — cinematic morph to next scene (4s, ~₹50, best quality)
> 3. 🔀 **Both** — generate Veo TC, keep zoom as backup
>
> **For clip boundaries (VO gaps):**
> → Simple crossfade (0.3–0.5s based on gap size)
>
> **Or:** Skip transitions entirely and keep the base hard-cut stitch.
>
> Which approach?"

Save the user's choice as `TRANSITION_STRATEGY`:
- `"zoom"` — slow zoom for overflows + crossfade for gaps
- `"veo"` — Veo TC for overflows + crossfade for gaps
- `"both"` — generate both, user picks after preview
- `"none"` — base stitch only (skip to Step 6)

---

## STEP 3 — Generate Base Stitch (Perfect Sync)

Always generate the base version first — this is the reference for sync correctness.

**Step 3a — Mix Veo SFX + VO slices per clip:**
```bash
mkdir -p "{OUTPUT_DIR}/clips-mixed"
for i in 01 02 ... NN; do
  ffmpeg -y -i "{OUTPUT_DIR}/clips/clip-${i}.mp4" -i "{OUTPUT_DIR}/audio/slice-${i}.mp3" \
    -filter_complex "[0:a]volume=0.35[veo];[1:a]volume=1.0[el];[veo][el]amix=inputs=2:duration=longest:normalize=0[aout]" \
    -map 0:v -map "[aout]" -c:v copy -c:a aac "{OUTPUT_DIR}/clips-mixed/clip-${i}.mp4"
done
```

**Step 3b — Hard-cut stitch:**
```bash
node __PLUGIN_DIR__/scripts/stitch.mjs \
  --clips-dir "{OUTPUT_DIR}/clips-mixed/" \
  --output "{OUTPUT_DIR}/final-elevenlabs-overlay.mp4" \
  --overlap 0 \
  --no-audio-xfade
```

This is the baseline. VO sync is perfect here. If `TRANSITION_STRATEGY == "none"`, deliver this and stop.

---

## STEP 4 — Generate Transition Clips

Skip this step if `TRANSITION_STRATEGY == "none"`.

**Step 4a — For each overflow clip, generate the chosen transition:**

### Slow Zoom (Ken Burns)

**MANDATORY: Pre-upscale to 8000px.** Without this, zoompan produces jittery/stuttery output.

```bash
# Extract last frame of the clip
ffmpeg -y -sseof -0.1 -i "{OUTPUT_DIR}/clips/clip-{NN}.mp4" \
  -frames:v 1 -q:v 2 "{OUTPUT_DIR}/images/clip-{NN}-last-frame.jpg"

# Generate smooth zoom with silent audio — ALL IN ONE PASS
DURATION={calculated_duration}
FRAMES=$((DURATION * 24))

ffmpeg -y -loop 1 -framerate 24 -i "{OUTPUT_DIR}/images/clip-{NN}-last-frame.jpg" \
  -f lavfi -i anullsrc=r=48000:cl=stereo \
  -vf "scale=8000:-2,zoompan=z='min(1+on/${FRAMES}*0.25,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=24" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  -shortest -t $DURATION \
  "{OUTPUT_DIR}/clips-final/tc-{NN}-zoom.mp4"
```

**NEVER:**
- Generate zoom without `scale=8000:-2` — will be jittery
- Use `d={total_frames}` — must be `d=1`
- Generate video-only then add audio separately — causes container mismatch and breaks xfade chain
- Use `-preset fast` — use `-preset slow` for zoom clips (they're short, quality matters)

### Veo Transition Clip

```bash
# Compress last frame for Veo
sips -Z 1280 "{OUTPUT_DIR}/images/clip-{NN}-last-frame.jpg" \
  --out "{OUTPUT_DIR}/images/clip-{NN}-last-frame-small.jpg" --setProperty formatOptions 65

# Generate 4s Veo TC with start+end frame interpolation
python3 __PLUGIN_DIR__/scripts/generate-video.py \
  --image "{OUTPUT_DIR}/images/clip-{NN}-last-frame-small.jpg" \
  --end-frame "{OUTPUT_DIR}/images/frame-{NN+1}-small.jpg" \
  --prompt "Slow smooth cinematic dolly zoom pushing gently forward into the scene. Camera glides closer to center. Everything is still, only camera moves. Scene gradually morphs and transitions into {next_scene_description}. {STYLE} animation. NO TEXT. NO WORDS. NO LABELS." \
  --audio-prompt "Gentle cinematic swoosh, soft ambient warmth, subtle musical bridge transitioning between scenes" \
  --duration 4 \
  --aspect "{ASPECT}" \
  --output "{OUTPUT_DIR}/clips-final/tc-{NN}-veo.mp4"
```

Then re-encode to match AC encoding:
```bash
ffmpeg -y -i "{OUTPUT_DIR}/clips-final/tc-{NN}-veo.mp4" \
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  "{OUTPUT_DIR}/clips-final/tc-{NN}.mp4"
```

**Step 4b — Let user preview TC clips before stitching.**

---

## STEP 5 — Build Final with Transitions

**Step 5a — Prepare all clips in `clips-final/`:**

Re-encode ALL raw Veo clips with both video AND audio:
```bash
mkdir -p "{OUTPUT_DIR}/clips-final"
for i in 01 02 ... NN; do
  ffmpeg -y -i "{OUTPUT_DIR}/clips/clip-${i}.mp4" \
    -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p \
    -c:a aac -b:a 128k \
    "{OUTPUT_DIR}/clips-final/ac-${i}.mp4"
done
```

**Step 5b — Calculate xfade offsets**

Build the clip sequence: `ac-01, tc-01, ac-02, ac-03, ..., ac-NN`

Assign crossfade durations:
- **AC → TC**: `0.5s`
- **TC → AC**: `0.5s`
- **AC → AC (gap < 0.4s)**: `0.3s`
- **AC → AC (gap ≥ 0.4s)**: `0.5s`

Calculate offsets **cumulatively**:
```
durations = [dur_ac01, dur_tc01, dur_ac02, dur_ac03, ...]
xf_durs   = [0.5,      0.5,     0.3,      0.3,     ...]

offset[0] = durations[0] - xf_durs[0]
offset[i] = offset[i-1] + durations[i] - xf_durs[i]
```

**Step 5c — Execute ffmpeg xfade chain**

```bash
ffmpeg -y \
  -i clips-final/ac-01.mp4 \
  -i clips-final/tc-01.mp4 \
  -i clips-final/ac-02.mp4 \
  ... \
  -filter_complex "
    [0:v][1:v]xfade=transition=fade:duration=0.5:offset=7.5[v1];
    [v1][2:v]xfade=transition=fade:duration=0.5:offset=11.0[v2];
    ...
    [0:a]volume=0.35[a0v];[1:a]volume=0.35[a1v];[2:a]volume=0.35[a2v];...
    [a0v][a1v]acrossfade=d=0.5[a1];
    [a1][a2v]acrossfade=d=0.5[a2];
    ...
  " \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 128k \
  "{OUTPUT_DIR}/video-track.mp4"
```

**CRITICAL RULES:**
- Apply `volume=0.35` to EACH input audio stream INDIVIDUALLY, BEFORE acrossfade
- Every clip in the chain MUST have an AAC audio stream
- Verify each clip has audio before building the chain

**Step 5d — Overlay full-vo.mp3**

```bash
ffmpeg -y \
  -i "{OUTPUT_DIR}/video-track.mp4" \
  -i "{OUTPUT_DIR}/audio/full-vo.mp3" \
  -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:normalize=0[aout]" \
  -map 0:v -map "[aout]" \
  -c:v copy -c:a aac -b:a 128k \
  -t {VO_END} \
  "{OUTPUT_DIR}/final-synced.mp4"
```

**Step 5e — Verify sync**

```bash
fdur=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "{OUTPUT_DIR}/final-synced.mp4")
echo "Final: ${fdur}s | VO: {VO_END}s | Drift: $(echo "$fdur - {VO_END}" | bc)s"
```

Acceptable drift: < 0.2s.

---

## STEP 6 — Deliver

```
🎬 VO-Synced Video Complete!

📁 Output: {OUTPUT_DIR}
🎥 final-elevenlabs-overlay.mp4  — base (hard cuts, perfect sync)
🎥 final-synced.mp4              — with transitions ({strategy})

VO sync drift: {drift}s ✅
```

---

## Quick Re-run (Changing Just Transitions)

If the user wants to swap transition types, only Steps 4-5 need re-running. The base stitch, VO, and clips stay unchanged.

---

## Error Reference

| Error | Cause | Fix |
|-------|-------|-----|
| `acrossfade matches no streams` | A clip has no audio track | Ensure ALL clips have AAC audio |
| Jittery/stuttery zoom | Source image not upscaled | Add `scale=8000:-2` BEFORE zoompan |
| Sync drift > 1s | Using container duration instead of video-stream duration | Use `ffprobe -select_streams v:0` |
| Video breaks at clip boundary | Mismatched pixel format or profile | Re-encode all clips with same settings |
| xfade offset wrong | Cumulative calculation error | offset[i] = offset[i-1] + dur[i] - xf_dur[i] |
