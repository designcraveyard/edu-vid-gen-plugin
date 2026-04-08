---
name: setup
description: First-time setup for edu-vid-gen plugin. Installs prerequisites (ffmpeg, imagemagick, python packages, gcloud), configures API keys, sets output directory, and verifies everything works. Run this once on a new machine before using /edu-video.
argument-hint: "[--check] to verify existing setup without modifying"
allowed-tools: ["Bash", "Read", "Write", "Edit", "AskUserQuestion"]
---

# Edu Video Gen — First-Time Setup

Interactive setup that installs prerequisites, configures API keys, and verifies the environment.

If called with `--check`, only verify — don't install or modify anything.

## Step 1 — Check & Install Prerequisites

Check each prerequisite. Install missing ones (with user confirmation on macOS via Homebrew).

```bash
# Check each tool
echo "=== Prerequisite Check ==="

# Node.js
if command -v node &>/dev/null; then
  echo "✅ Node.js $(node -v)"
else
  echo "❌ Node.js — not found"
fi

# Python 3
if command -v python3 &>/dev/null; then
  echo "✅ Python $(python3 --version 2>&1)"
else
  echo "❌ Python 3 — not found"
fi

# ffmpeg
if command -v ffmpeg &>/dev/null; then
  echo "✅ ffmpeg $(ffmpeg -version 2>&1 | head -1)"
else
  echo "❌ ffmpeg — not found"
fi

# ImageMagick
if command -v magick &>/dev/null; then
  echo "✅ ImageMagick $(magick -version 2>&1 | head -1)"
else
  echo "❌ ImageMagick 7 — not found"
fi

# gcloud
GCLOUD_PATH=""
if command -v gcloud &>/dev/null; then
  GCLOUD_PATH="gcloud"
  echo "✅ gcloud $(gcloud --version 2>&1 | head -1)"
elif [ -f ~/Downloads/google-cloud-sdk/bin/gcloud ]; then
  GCLOUD_PATH="$HOME/Downloads/google-cloud-sdk/bin/gcloud"
  echo "✅ gcloud (at $GCLOUD_PATH)"
elif [ -f ~/google-cloud-sdk/bin/gcloud ]; then
  GCLOUD_PATH="$HOME/google-cloud-sdk/bin/gcloud"
  echo "✅ gcloud (at $GCLOUD_PATH)"
else
  echo "❌ gcloud CLI — not found"
fi

# Python packages
python3 -c "import google.genai" 2>/dev/null && echo "✅ google-genai" || echo "❌ google-genai"
python3 -c "import moviepy" 2>/dev/null && echo "✅ moviepy" || echo "❌ moviepy"
python3 -c "from PIL import Image" 2>/dev/null && echo "✅ Pillow" || echo "❌ Pillow"
```

For any missing prerequisite, offer to install:

```bash
# macOS installs
brew install ffmpeg imagemagick node

# Python packages
pip3 install google-genai moviepy Pillow --break-system-packages

# gcloud — direct user to https://cloud.google.com/sdk/docs/install if not found
```

If `--check` was passed, report results and stop here.

---

## Step 2 — Configure API Keys

Ask the user for each API key. Save to `__PLUGIN_DIR__/.env`.

```
I need a few API keys to set up the video generation pipeline:

1. **ElevenLabs API key** (for voiceover generation)
   Get one at: https://elevenlabs.io/app/settings/api-keys

2. **Google Gemini API key** (for image generation + validation)
   Get one at: https://aistudio.google.com/apikey

3. **Together AI API key** (optional — for Wan 2.7 video backend, 33% cheaper than Veo)
   Get one at: https://api.together.ai/settings/api-keys

Please paste each key when prompted (or press Enter to skip optional ones).
```

After collecting keys, write the `.env` file:

```bash
cat > "__PLUGIN_DIR__/.env" << 'EOF'
ELEVENLABS_API_KEY={user_provided}
GEMINI_API_KEY={user_provided}
TOGETHER_API_KEY={user_provided_or_empty}
OUTPUT_BASE_DIR={user_provided}
GCLOUD_PROJECT={user_provided}
EOF
```

---

## Step 3 — Configure Output Directory

Ask the user:

```
Where should generated videos be saved?

Examples:
- ~/Documents/edu-videos/
- ~/Desktop/video-output/
- /Users/you/Projects/videos/

This is where each video run creates its output folder (e.g. water-cycle-20260408-143022/).
Default: current working directory when you run /edu-video
```

Save as `OUTPUT_BASE_DIR` in `.env`. If left empty, the plugin uses `$PWD` at runtime.

---

## Step 4 — Configure Google Cloud (for Veo)

If gcloud was found:

```bash
# Login
{GCLOUD_PATH} auth login
{GCLOUD_PATH} auth application-default login

# Ask user for project ID or use default
{GCLOUD_PATH} config set project {GCLOUD_PROJECT}

# Enable Vertex AI API
{GCLOUD_PATH} services enable aiplatform.googleapis.com
```

If gcloud was NOT found, inform the user:

```
⚠️ gcloud CLI not installed. You'll need it for Veo video generation.
Install from: https://cloud.google.com/sdk/docs/install
After installing, run /setup again to complete gcloud configuration.

You can still use Wan 2.7 (--backend wan) without gcloud if you have a Together AI key.
```

---

## Step 5 — Install Editor Dependencies

```bash
cd "__PLUGIN_DIR__/editor" && npm install 2>&1 | tail -3
```

---

## Step 6 — Verify Setup

Run a quick verification of each component:

```bash
echo "=== Verification ==="

# Load env
set -a; source "__PLUGIN_DIR__/.env" 2>/dev/null; set +a

# Check ElevenLabs
if [ -n "$ELEVENLABS_API_KEY" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "xi-api-key: $ELEVENLABS_API_KEY" "https://api.elevenlabs.io/v1/user")
  [ "$STATUS" = "200" ] && echo "✅ ElevenLabs API key valid" || echo "❌ ElevenLabs API key invalid (HTTP $STATUS)"
else
  echo "⚠️ ElevenLabs API key not set"
fi

# Check Gemini
if [ -n "$GEMINI_API_KEY" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY")
  [ "$STATUS" = "200" ] && echo "✅ Gemini API key valid" || echo "❌ Gemini API key invalid (HTTP $STATUS)"
else
  echo "⚠️ Gemini API key not set"
fi

# Check Together AI
if [ -n "$TOGETHER_API_KEY" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOGETHER_API_KEY" "https://api.together.xyz/v1/models")
  [ "$STATUS" = "200" ] && echo "✅ Together AI API key valid" || echo "❌ Together AI API key invalid (HTTP $STATUS)"
else
  echo "⚠️ Together AI API key not set (optional — Wan 2.7 backend won't work)"
fi

# Check gcloud ADC
if python3 -c "from google.auth import default; default()" 2>/dev/null; then
  echo "✅ Google Cloud ADC configured"
else
  echo "❌ Google Cloud ADC not configured — run: gcloud auth application-default login"
fi

# Check output dir
if [ -n "$OUTPUT_BASE_DIR" ]; then
  mkdir -p "$OUTPUT_BASE_DIR" 2>/dev/null && echo "✅ Output directory: $OUTPUT_BASE_DIR" || echo "❌ Cannot create output directory: $OUTPUT_BASE_DIR"
else
  echo "ℹ️ Output directory: not set (will use current working directory)"
fi
```

---

## Step 7 — Summary

Print final setup status:

```
=== Setup Complete ===

Prerequisites:    ✅ All installed
ElevenLabs:       ✅ Connected
Gemini:           ✅ Connected
Together AI:      ⚠️ Not configured (optional)
Google Cloud:     ✅ ADC configured
Output directory: ~/Documents/edu-videos/
Editor:           ✅ Dependencies installed

You're ready to go! Run /edu-video to generate your first video.
```
