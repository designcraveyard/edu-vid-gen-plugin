# Transitions Reference

MoviePy compositor usage, transition decision tables, and VO overflow handling. Loaded on demand from Phase 5.

---

## composite.py — MoviePy Compositor

Replaces manual ffmpeg xfade chains. Reads timeline.json, calculates gaps/overflow automatically, and composites everything into a synced final video.

### Usage

```bash
python3 __PLUGIN_DIR__/scripts/composite.py \
  --clips-dir "{OUTPUT_DIR}/clips" \
  --timeline "{OUTPUT_DIR}/audio/timeline.json" \
  --vo-audio "{OUTPUT_DIR}/audio/full-vo.mp3" \
  --output "{OUTPUT_DIR}/final.mp4" \
  [--veo-tcs-dir "{OUTPUT_DIR}/clips-transition"] \
  [--sfx-volume 0.35]
```

### What it does

1. Reads `timeline.json` for clip timing and VO boundaries
2. Lays clips on the timeline at VO-dictated positions
3. Calculates gaps between clips automatically
4. Applies appropriate transitions (crossfade, hard cut, or Veo TC insertion)
5. Handles VO overflow with auto Ken Burns zoom
6. Overlays `full-vo.mp3` at 100% volume, Veo SFX at `--sfx-volume` (default 0.35)
7. Trims final video to VO end time

### Why composite.py instead of ffmpeg xfade

- ffmpeg xfade chains are brittle — one wrong offset breaks all subsequent sync
- xfade consumes duration from both clips, requiring complex arithmetic
- composite.py uses MoviePy's layer model: later clips simply overlap earlier ones
- Automatic gap/overflow detection eliminates manual calculation errors

---

## Transition Decision Table (VO Gap)

When a gap exists between adjacent clips' VO segments:

| VO gap | Transition type | How | Notes |
|--------|----------------|-----|-------|
| < 0.3s | Hard cut / tiny blend | MoviePy layers, later clip placed on top | Gap is imperceptible |
| 0.3 - 1.0s | Opacity crossfade | MoviePy overlap blend (0.3-0.5s) | Smooth, no extra clip needed |
| 1.0 - 3.0s | Veo TC (2s) | Generate 2s transition clip, place in gap | Use start+end frame interpolation |
| > 3.0s | Veo TC (4s) | Generate 4s transition clip, place in gap | Longer morph for scene change |

---

## VO Overflow Handling

When a clip's VO extends past its Veo video duration (`overflow = VO_duration - clip_video_duration`):

| Overflow | Treatment | How |
|----------|-----------|-----|
| < 0.3s | Natural hold | Last frame freezes briefly — imperceptible |
| 0.3 - 1.5s | Ken Burns zoom | MoviePy auto-extends clip with slow zoom on last frame |
| > 1.5s | Veo TC | Generate a bridging clip to fill the gap |

---

## Veo TC Generation

When a transition clip is needed (gap > 1.0s or overflow > 1.5s):

```bash
# 1. Extract last frame from the preceding activity clip
ffmpeg -sseof -0.1 -i "{OUTPUT_DIR}/clips/clip-{NN}.mp4" \
  -frames:v 1 -q:v 2 "{OUTPUT_DIR}/images/clip-{NN}-last-frame.jpg"

# 2. Compress for Veo
sips -Z 1280 "{OUTPUT_DIR}/images/clip-{NN}-last-frame.jpg" \
  --out "{OUTPUT_DIR}/images/clip-{NN}-last-frame-small.jpg" --setProperty formatOptions 65

# 3. Generate TC at correct Veo duration (2s or 4s)
python3 __PLUGIN_DIR__/scripts/generate-video.py \
  --image "{OUTPUT_DIR}/images/clip-{NN}-last-frame-small.jpg" \
  --end-frame "{OUTPUT_DIR}/images/frame-{NN+1}-small.jpg" \
  --prompt "Slow smooth cinematic transition. Camera glides forward. Scene morphs into {next_scene}. {STYLE} animation. NO TEXT. NO WORDS. NO LABELS." \
  --audio-prompt "Gentle cinematic swoosh, soft ambient warmth, subtle musical bridge" \
  --duration {2 or 4} \
  --aspect "{ASPECT}" \
  --output "{OUTPUT_DIR}/clips-transition/tc-{NN}.mp4"
```

**Rules:**
- TC prompts are a single continuous morph — no `[00:00]` timestamp segments needed
- Generate TCs at their natural Veo duration [2, 4s] from the start
- NEVER generate a longer clip and speed it up — creates artifacts
- Skip TC for the last AC (no next scene to bridge to)
- Always add swoosh SFX in the audio prompt for transitions

---

## Ken Burns Zoom Parameters

When composite.py auto-extends a clip for VO overflow (0.3-1.5s):

- Zoom range: 1.0x to ~1.03x (3% zoom over freeze duration)
- Center-weighted zoom (pushes gently toward center)
- Applied to the last frame of the clip
- Duration matches the overflow exactly

For manual Ken Burns (if not using composite.py):

```bash
# MUST pre-upscale to 8000px for smoothness (integer pixel rounding causes jitter otherwise)
ffmpeg -y -loop 1 -framerate 24 -i "{last_frame.jpg}" \
  -f lavfi -i anullsrc=r=48000:cl=stereo \
  -vf "scale=8000:-2,zoompan=z='min(1+on/{total_frames}*0.25,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=24" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  -shortest -t {duration} \
  "{output}.mp4"
```

**Critical rules:**
- ALWAYS pre-upscale to 8000px before zoompan (prevents jittery output)
- Use `d=1` (one input frame per output frame) — NOT `d=96` or total frame count
- Zoom 1.0x to 1.25x max — more looks unnatural
