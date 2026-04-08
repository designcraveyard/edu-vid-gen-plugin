---
name: extend-image
description: Extend an image in any direction to create space for text overlays. Adds a flat color, gradient, or blurred extension suitable for legible text placement. Use when the user says "extend image for text", "add text space", "make room for title", "extend left/right/top/bottom", "image text overlay", "create text area on image", or wants to prepare images for social media posts, thumbnails, or print layouts with text.
---

# Extend Image for Text Overlays

Extend any image in a chosen direction to create clean space for text placement.

## Workflow

### Step 1 — Collect Input

Ask the user:
1. **Which image(s)?** — Single file or batch
2. **Direction:** left, right, top, bottom, corners, all
3. **Extension amount:** (default: 30%)
4. **Style:** gradient (default), flat, blur
5. **Final aspect ratio** (optional)

### Step 2 — Generate

**Single image:**
```bash
GEMINI_API_KEY="$GEMINI_API_KEY" node __PLUGIN_DIR__/scripts/extend-image.mjs \
  --input "{image_path}" \
  --output "{output_path}" \
  --direction "{direction}" \
  --extend-by {percentage} \
  --style "{style}"
```

**Batch:**
```bash
for f in {OUTPUT_DIR}/images/frame-*.jpg; do
  [[ "$f" == *-small.jpg ]] && continue
  name=$(basename "$f" .jpg)
  GEMINI_API_KEY="$GEMINI_API_KEY" node __PLUGIN_DIR__/scripts/extend-image.mjs \
    --input "$f" \
    --output "{OUTPUT_DIR}/images/${name}-extended.jpg" \
    --direction "{direction}" \
    --extend-by {percentage} \
    --style "{style}"
  sleep 35
done
```

### Step 3 — Review

Display each extended image. If AI outpainting adds unwanted details, try switching style to `flat` or reducing `--extend-by`.

## Style Guide

| Style | Best for | Look |
|-------|----------|------|
| `gradient` | Social media, thumbnails | Smooth professional fade |
| `flat` | Print layouts, clean designs | Solid color block |
| `blur` | Cinematic feel, stories | Soft depth-of-field effect |

## Rate Limits

Wait **35 seconds** between Gemini calls.
