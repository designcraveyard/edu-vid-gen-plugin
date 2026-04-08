---
name: veo-extend
description: Generate character-consistent videos using Veo's video extension chain. Instead of generating separate clips and stitching, this creates one continuous video by extending each clip from the previous one's last frame. Solves character drift (especially for human characters like Mowgli) and eliminates stitching/sync issues. Use when generating multi-clip educational videos, when character consistency matters, or when the user mentions "extend", "chain clips", "consistent characters", or "continuous video".
---

# Veo Extension Pipeline

Generate perfectly synced, character-consistent videos by chaining Veo clip extensions. Each clip starts from the last frame of the previous one — characters, lighting, and style carry forward automatically.

## Why Use This Instead of Separate Clips

| Problem with separate clips | How extension fixes it |
|---|---|
| Characters look different in each clip | Each extension starts from the last frame — same character carries forward |
| Stitching creates hard cuts or crossfade artifacts | One continuous video, no stitching needed |
| VO sync requires complex clip-plan math | Continuous video = just overlay full-vo.mp3 on top |
| Copyright/safety filters block image-to-video for human characters | First clip uses text-to-video, all extensions preserve that character |

## How It Works

```
Frame → Clip 1 (8s) → Extend → Clip 1+2 (15s) → Extend → Clip 1+2+3 (22s) → ... → Full Video
```

**Key facts:**
- Initial clip: 4, 6, or 8 seconds
- Each extension: **exactly 7 seconds** (fixed)
- Maximum: 20 extensions = **148 seconds** total (8s + 20×7s)
- Input: must be a Veo-generated video (MP4, 24fps, 720p/1080p)

## Script Reference

**Location:** `__PLUGIN_DIR__/scripts/extend-video.py`

### Initial generation (first clip):
```bash
python3 __PLUGIN_DIR__/scripts/extend-video.py \
  --prompt "[Scene description] 3D animated cartoon. NO TEXT." \
  --audio-prompt "ambient sounds, SFX description" \
  --duration 8 --aspect "16:9" \
  --output clip-chain-01.mp4
```

### Extension (each subsequent clip):
```bash
python3 __PLUGIN_DIR__/scripts/extend-video.py \
  --video clip-chain-01.mp4 \
  --prompt "[NEW scene description — what happens next]" \
  --audio-prompt "[NEW ambient sounds for this scene]" \
  --output clip-chain-02.mp4
```

Each output contains the FULL video up to that point (not just the new 7s).

### Final compositing:
```bash
ffmpeg -y \
  -i clip-chain-final.mp4 \
  -i audio/full-vo.mp3 \
  -filter_complex "[0:a]volume=0.35[veo];[1:a]volume=1.0[vo];[veo][vo]amix=inputs=2:duration=shortest:normalize=0[aout]" \
  -map 0:v -map "[aout]" \
  -c:v copy -c:a aac -b:a 128k \
  -t {VO_DURATION} \
  final-video.mp4
```

## Pipeline Steps

### Step 1: Prepare prompts from timeline

Read `audio/timeline.json`. Map each clip to an extension prompt. Since extensions are fixed at 7s, **regroup** timeline clips into 7s windows.

### Step 2: Generate initial clip

Pick the first scene. If human characters, use text-to-video. If animals only, use image-to-video.

### Step 3: Chain extensions

For each subsequent 7s segment:
1. Wait 60-90s between extensions (rate limit)
2. Use previous output as `--video` input
3. Write a new prompt describing what happens in THIS 7s window
4. Keep the same art style descriptors in every prompt

### Step 4: Overlay VO

```bash
ffmpeg -y -i final-chain.mp4 -i audio/full-vo.mp3 \
  -filter_complex "[0:a]volume=0.35[veo];[1:a]volume=1.0[vo];[veo][vo]amix=inputs=2:duration=shortest:normalize=0[aout]" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -t {TOTAL_VO_DURATION} \
  final-with-vo.mp4
```

## Limitations

- Extension is always 7s — cannot request 4s or 6s extensions
- Only Veo-generated videos can be extended
- Cannot use reference images with extensions
- Videos expire from Google servers after 2 days — always save locally
- Max 148s total
- Scene changes are gradual — write prompts for natural visual transitions

## Cost

- Initial clip (8s fast): ₹100
- Each extension (7s fast): ₹88
- 20 extensions for 148s video: **₹1,860**
- Equivalent separate clips: ~₹3,000+
