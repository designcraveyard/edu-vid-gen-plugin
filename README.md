# edu-vid-gen — Educational Video Generator Plugin

A Claude Code plugin that generates complete educational MP4 videos from a topic and class level. Audio-first pipeline with AI-generated visuals, voiceover, and narration.

## Features

- **Audio-first architecture** — voiceover drives clip count, timing, and transitions
- **Multi-model video backends** — Veo 3.1 (Google), Wan 2.7 (Together AI)
- **Gemini-powered validation** — per-clip sync scoring + final video quality gate
- **MoviePy compositor** — automatic transitions, VO overlay, ambient audio layers
- **Batch mode** — generate multiple videos from a single manifest
- **Timeline editor** — Next.js app for clip trimming, transition editing, NLE export

## Installation

```bash
# Clone the plugin
git clone <repo-url> edu-vid-gen-plugin

# Install into Claude Code
claude --plugin-dir /path/to/edu-vid-gen-plugin

# Run first-time setup
# Inside Claude Code, type:
/setup
```

## Prerequisites

Installed automatically by `/setup`:
- **ffmpeg** — audio/video processing
- **ImageMagick 7+** — image manipulation
- **Python 3** + `google-genai`, `moviepy`, `Pillow`
- **Node.js 18+** — script runtime
- **gcloud CLI** — Vertex AI (Veo) authentication

API keys needed:
- **ElevenLabs** — voiceover generation
- **Google Gemini** — image generation + validation
- **Together AI** (optional) — Wan 2.7 video backend
- **Google Cloud** — Veo video generation (via gcloud ADC)

## Usage

### Generate a single video
```
/edu-video
```
Interactive 6-phase pipeline. Asks for topic, class, style, and guides you through.

### Batch generate
```
/batch-gen
```
Provide a `batch.json` manifest to generate multiple videos.

### Other skills
- `/vo-sync` — Post-production compositor (existing clips + VO sync)
- `/character-regen` — Reuse a character in a new scene
- `/extend-image` — Extend images for text overlays
- `/veo-extend` — Chain video extensions for character consistency

## Cost Reference

| Backend | Cost/sec | 60s video (7 clips) |
|---------|----------|---------------------|
| Veo 3.1 Fast (default) | ₹12.6 | ~₹730 |
| Wan 2.7 | ₹8.4 | ~₹495 |
| Veo 3.1 Standard | ₹33.6 | ~₹1,910 |

## For QA / Developers

See [CLAUDE.md](CLAUDE.md) for plugin architecture, modification guide, and backend extension instructions.
