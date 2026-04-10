---
name: setup
description: First-time setup for edu-vid-gen plugin. Installs prerequisites (ffmpeg, imagemagick, python packages, gcloud), configures API keys and Google Cloud Vertex AI, sets output directory, and verifies everything works. Run this once on a new machine before using /edu-video.
argument-hint: "[--check] to verify existing setup without modifying"
allowed-tools: ["Bash", "Read", "Write", "Edit", "AskUserQuestion"]
---

# Edu Video Gen — First-Time Setup

Interactive setup wizard that walks the user through prerequisites, account creation, API configuration, and verification.

If called with `--check`, skip to **Step 6 — Verify Setup** and only report status without modifying anything.

---

## Step 1 — Welcome & Account Inventory

### 1.1 — Welcome

Display:

```
Welcome to Edu Video Gen setup!

This wizard will help you:
  1. Check & install prerequisites (ffmpeg, Python, Node.js, etc.)
  2. Set up the cloud accounts you need
  3. Configure API keys and authentication
  4. Verify everything works

Let's start by understanding what accounts you already have.
```

### 1.2 — Account inventory

Use **AskUserQuestion** with a **multi-select** question:

> Which of these accounts do you already have?

| Option | Description |
|--------|-------------|
| Google Cloud Platform | Used for video generation (Veo) and image generation via Vertex AI. This is the primary auth method. |
| ElevenLabs | Used for AI voiceover generation. |
| Google AI Studio (Gemini API key) | Optional fallback for image generation if you prefer not to use Google Cloud. |
| Together AI | Optional — enables the Wan 2.7 video backend (~33% cheaper than Veo). |
| None of the above | I need to create all accounts from scratch. |

Store the user's selections. Steps 2.x below will guide them through creating any missing accounts.

---

## Step 2 — Account Creation Guidance

For each account the user does NOT already have, walk them through creation using the relevant subsection below. Skip subsections for accounts they already have.

### 2.1 — Google Cloud Platform (required)

Google Cloud is the **primary authentication method** for this plugin. It powers:
- Video generation (Veo 3.1 via Vertex AI)
- Image generation (Imagen 4 / Nano Banana 2 via Vertex AI)
- All validation scripts (clip, sync, final review)

Guide the user through these steps:

```
=== Google Cloud Platform Setup ===

1. Go to https://console.cloud.google.com/
2. Click "Get started for free" or sign in with your Google account
3. If new: accept terms, choose your country, and add billing info
   (GCP offers $300 free credit for new accounts — more than enough to get started)

4. Create a project:
   - Click the project selector at the top of the page
   - Click "NEW PROJECT"
   - Name it something like "edu-video-gen"
   - Click "CREATE"

5. Enable the Vertex AI API:
   - Go to https://console.cloud.google.com/apis/library
   - Search for "Vertex AI API"
   - Click on it and press "ENABLE"
   - Wait for it to finish enabling

6. Note your Project ID (visible in the project selector dropdown) — you'll need it shortly.
```

Use **AskUserQuestion**:

> Have you completed the Google Cloud setup above?

| Option | Description |
|--------|-------------|
| Yes, done | I've created a GCP project and enabled Vertex AI API. |
| Skip for now | I'll set up Google Cloud later. I'll use a Gemini API key as fallback instead. |

If they skip GCP, note that they MUST provide a Gemini API key in Step 3 and warn that validation scripts and Vertex-based image generation won't work without GCP.

### 2.2 — ElevenLabs (required)

ElevenLabs powers all voiceover generation. There is no alternative backend for this.

```
=== ElevenLabs Setup ===

1. Go to https://elevenlabs.io/
2. Click "Sign up" and create an account (Google/GitHub sign-in works)
3. Choose a plan — the free tier works for testing (10 min/month)
   - For production use, the Starter plan ($5/mo) is recommended
4. Get your API key:
   - Go to https://elevenlabs.io/app/settings/api-keys
   - Click "Create API Key" or copy the existing one
   - Save it somewhere secure — you'll need it shortly
```

Use **AskUserQuestion**:

> Have you set up your ElevenLabs account and got your API key?

| Option | Description |
|--------|-------------|
| Yes, I have my API key | Ready to proceed. |
| Skip for now | I'll set up ElevenLabs later. |

### 2.3 — Google AI Studio / Gemini API key (optional fallback)

Only guide users through this if:
- They explicitly said they have a Gemini API key, OR
- They skipped Google Cloud in 2.1 (they need this as fallback)

```
=== Google AI Studio (Gemini API Key) — Optional Fallback ===

The Gemini API key is an alternative to Google Cloud for image generation.
It's simpler to set up but less capable (no Imagen 4, no validation support).

If you already set up Google Cloud above, you can skip this — Vertex AI
handles everything the Gemini API key does, and more.

To get a Gemini API key:
1. Go to https://aistudio.google.com/apikey
2. Sign in with your Google account
3. Click "Create API Key"
4. Select your Google Cloud project (or create one)
5. Copy the key — you'll need it shortly
```

### 2.4 — Together AI (optional)

Only guide users through this if they don't have an account.

```
=== Together AI — Optional ===

Together AI provides the Wan 2.7 video backend, which is ~33% cheaper
than Veo and produces a different visual style. It's completely optional.

To set up:
1. Go to https://api.together.ai/
2. Click "Sign up" and create an account
3. Get your API key:
   - Go to https://api.together.ai/settings/api-keys
   - Copy the key — you'll need it shortly
```

---

## Step 3 — Check & Install Prerequisites

Check each prerequisite. For any missing ones, offer to install them.

```bash
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

If anything is missing, use **AskUserQuestion**:

> The following prerequisites are missing: {list}. Should I install them?

| Option | Description |
|--------|-------------|
| Yes, install all (Recommended) | Install all missing prerequisites automatically. |
| Let me choose | I'll select which ones to install. |
| Skip | I'll install them myself later. |

For installation, use the appropriate commands per platform:

```bash
# macOS installs
brew install ffmpeg imagemagick node python3

# Linux (Debian/Ubuntu) installs
sudo apt-get update && sudo apt-get install -y ffmpeg imagemagick nodejs python3

# Python packages (all platforms)
pip3 install google-genai moviepy Pillow --break-system-packages

# gcloud — cannot be auto-installed, direct user to:
# https://cloud.google.com/sdk/docs/install
```

If gcloud is missing and the user chose the Vertex AI path, emphasize that they need it:

```
⚠️ gcloud CLI is required for Vertex AI authentication.
Install from: https://cloud.google.com/sdk/docs/install

After installing:
  - macOS: Run the installer, then restart your terminal
  - Linux: Extract the archive, run ./install.sh, then restart your terminal

Run /setup again after installing gcloud.
```

---

## Step 4 — Configure Authentication & API Keys

### 4.1 — Auth strategy selection

Use **AskUserQuestion**:

> How would you like to authenticate for image generation and validation?

| Option | Description |
|--------|-------------|
| Vertex AI (Recommended) | Uses Google Cloud Application Default Credentials. Supports all features: Imagen 4, Nano Banana 2, Veo 3.1, all validation scripts. Requires gcloud CLI. |
| Gemini API Key | Simpler setup, just paste a key. Works for basic image generation only. Validation scripts and Imagen 4 require Vertex AI. |
| Both | Set up Vertex AI as primary and Gemini API key as fallback. Maximum compatibility. |

Store this choice as `AUTH_STRATEGY` (vertex / gemini / both).

### 4.2 — Google Cloud configuration (if Vertex AI selected)

If AUTH_STRATEGY is `vertex` or `both`:

Use **AskUserQuestion** to collect the project ID:

> What is your Google Cloud project ID?

| Option | Description |
|--------|-------------|
| I know my project ID | I'll type it in. |
| Help me find it | Show me how to find my project ID. |

If they need help:
```
Your project ID is visible at:
  - https://console.cloud.google.com/ (in the project selector at the top)
  - Or run: gcloud config get-value project (if gcloud is already configured)

The project ID looks like: my-project-123 or edu-video-gen
It's NOT the project number (which is all digits).
```

After getting the project ID, run gcloud configuration:

```bash
# Login to Google Cloud
{GCLOUD_PATH} auth login

# Set up Application Default Credentials (this is what the scripts use)
{GCLOUD_PATH} auth application-default login

# Set the project
{GCLOUD_PATH} config set project {GCLOUD_PROJECT}

# Enable Vertex AI API (in case user didn't do it in Step 2)
{GCLOUD_PATH} services enable aiplatform.googleapis.com
```

### 4.3 — Collect API keys

Collect keys interactively. Only ask for keys relevant to the user's setup:

**Always ask — ElevenLabs (required):**

Use **AskUserQuestion**:

> Please paste your ElevenLabs API key:

| Option | Description |
|--------|-------------|
| I have it ready | I'll paste my key. |
| Skip for now | I'll add it later. Voiceover generation won't work without it. |

**If AUTH_STRATEGY is `gemini` or `both` — Gemini API key:**

Use **AskUserQuestion**:

> Please paste your Gemini API key:

| Option | Description |
|--------|-------------|
| I have it ready | I'll paste my key. |
| Skip for now | I'll add it later. |

**Always ask — Together AI (optional):**

Use **AskUserQuestion**:

> Do you have a Together AI API key? (Optional — enables the Wan 2.7 video backend)

| Option | Description |
|--------|-------------|
| Yes, I have it | I'll paste my key. |
| No, skip | I'll only use the Veo video backend. |

### 4.4 — Configure output directory

Use **AskUserQuestion**:

> Where should generated videos be saved?

| Option | Description |
|--------|-------------|
| Default (current directory) | Each video run creates a folder in whatever directory you're in when you run /edu-video. |
| Custom path | I'll specify a fixed directory like ~/Documents/edu-videos/. |

If custom path, ask the user to type it. Validate the path is writable.

### 4.5 — Write .env file

After collecting everything, write the `.env` file:

```bash
cat > "__PLUGIN_DIR__/.env" << 'EOF'
# Edu Video Gen — Configuration
# Generated by /setup on {date}
# Auth strategy: {AUTH_STRATEGY}

# Google Cloud project (required for Vertex AI)
GCLOUD_PROJECT={user_provided_or_empty}

# ElevenLabs (required for voiceover)
ELEVENLABS_API_KEY={user_provided_or_empty}

# Gemini API key (optional fallback for image generation)
GEMINI_API_KEY={user_provided_or_empty}

# Together AI (optional — Wan 2.7 video backend)
TOGETHER_API_KEY={user_provided_or_empty}

# Output directory (leave empty = use current working directory)
OUTPUT_BASE_DIR={user_provided_or_empty}
EOF
```

---

## Step 5 — Install Editor Dependencies

```bash
cd "__PLUGIN_DIR__/editor" && npm install 2>&1 | tail -3
```

---

## Step 6 — Verify Setup

Run verification of each component. Adapt checks based on AUTH_STRATEGY.

```bash
echo "=== Verification ==="

# Load env
set -a; source "__PLUGIN_DIR__/.env" 2>/dev/null; set +a

# Check ElevenLabs
if [ -n "$ELEVENLABS_API_KEY" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "xi-api-key: $ELEVENLABS_API_KEY" "https://api.elevenlabs.io/v1/user")
  [ "$STATUS" = "200" ] && echo "✅ ElevenLabs API key valid" || echo "❌ ElevenLabs API key invalid (HTTP $STATUS)"
else
  echo "⚠️ ElevenLabs API key not set — voiceover generation won't work"
fi

# Check gcloud ADC (primary auth for Vertex AI)
if python3 -c "from google.auth import default; default()" 2>/dev/null; then
  echo "✅ Google Cloud ADC configured"
else
  echo "❌ Google Cloud ADC not configured — run: gcloud auth application-default login"
fi

# Check Vertex AI access (test by listing models)
if [ -n "$GCLOUD_PROJECT" ]; then
  if python3 -c "
from google import genai
client = genai.Client(vertexai=True, project='$GCLOUD_PROJECT', location='us-central1')
models = client.models.list()
print('ok')
" 2>/dev/null | grep -q "ok"; then
    echo "✅ Vertex AI connected (project: $GCLOUD_PROJECT)"
  else
    echo "❌ Vertex AI connection failed — check project ID and ADC"
  fi
else
  echo "⚠️ GCLOUD_PROJECT not set — Vertex AI features unavailable"
fi

# Check Gemini API key (optional fallback)
if [ -n "$GEMINI_API_KEY" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY")
  [ "$STATUS" = "200" ] && echo "✅ Gemini API key valid (fallback)" || echo "❌ Gemini API key invalid (HTTP $STATUS)"
else
  echo "ℹ️  Gemini API key not set (not needed if Vertex AI is configured)"
fi

# Check Together AI (optional)
if [ -n "$TOGETHER_API_KEY" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOGETHER_API_KEY" "https://api.together.xyz/v1/models")
  [ "$STATUS" = "200" ] && echo "✅ Together AI API key valid" || echo "❌ Together AI API key invalid (HTTP $STATUS)"
else
  echo "ℹ️  Together AI not configured (optional — Wan 2.7 backend unavailable)"
fi

# Check output dir
if [ -n "$OUTPUT_BASE_DIR" ]; then
  mkdir -p "$OUTPUT_BASE_DIR" 2>/dev/null && echo "✅ Output directory: $OUTPUT_BASE_DIR" || echo "❌ Cannot create output directory: $OUTPUT_BASE_DIR"
else
  echo "ℹ️  Output directory: current working directory (default)"
fi
```

---

## Step 7 — Summary

Print final setup status. Adapt messaging based on AUTH_STRATEGY.

**If Vertex AI is configured:**

```
=== Setup Complete ===

Auth strategy:    Vertex AI (primary)
Prerequisites:    ✅ All installed
ElevenLabs:       {status}
Vertex AI:        {status} (project: {project_id})
Gemini API key:   {status — or "ℹ️ Not needed (using Vertex AI)"}
Together AI:      {status}
Output directory: {path or "current directory"}
Editor:           ✅ Dependencies installed

Vertex AI is your primary auth method. The pipeline will use:
  • generate-image-vertex.py for keyframe images (Imagen 4 / Nano Banana 2)
  • Veo 3.1 via Vertex AI for video generation
  • Gemini via Vertex AI for all validation scripts

You're ready to go! Run /edu-video to generate your first video.
```

**If only Gemini API key is configured (no Vertex AI):**

```
=== Setup Complete ===

Auth strategy:    Gemini API key (fallback mode)
Prerequisites:    ✅ All installed
ElevenLabs:       {status}
Gemini API key:   {status}
Together AI:      {status}
Output directory: {path or "current directory"}
Editor:           ✅ Dependencies installed

⚠️ Limited mode: without Vertex AI, the following features are unavailable:
  • Imagen 4 / Imagen 4 Ultra image generation
  • Clip validation, sync validation, and final review
  • Veo video generation via ADC (will use API key instead)

The pipeline will use:
  • generate-image.mjs for keyframe images (Nano Banana 2 via API key)
  • Veo via Gemini API key (if supported) or Wan 2.7 for video generation

To unlock all features, run /setup again and set up Google Cloud.
```
