# edu-vid-gen Plugin — Developer Guide

This file helps Claude Code (and QA team members) understand and modify this plugin.

## What This Plugin Does

Generates complete educational MP4 videos from a topic + class level. The pipeline:
1. Collect inputs → 2. Write video brief → 2.1. Character sheets → 2.5. Audio-first timeline → 3. Keyframe images → 4. Video clips (Veo/Wan) → 5. Composite with MoviePy → 6. Post-production

The voiceover is the **master clock** — it dictates clip count, roles (AC/TC), durations, and timing.

## Plugin Structure

```
edu-vid-gen-plugin/
├── .claude-plugin/plugin.json   # Plugin manifest
├── .env.example                 # Template for API keys
├── CLAUDE.md                    # This file (dev guide)
├── README.md                    # Installation + usage docs
├── skills/
│   ├── edu-vid-gen/             # Main video generation skill (6 phases)
│   │   ├── SKILL.md
│   │   └── references/          # Prompting, validation, audio, transitions, errors
│   ├── vo-sync/                 # Post-production compositor skill
│   ├── veo-extend/              # Veo extension chain skill
│   ├── character-regen/         # Character reuse skill
│   ├── extend-image/            # Image extension for text overlays
│   ├── batch-gen/               # Multi-video batch generation
│   │   └── references/
│   └── setup/                   # First-time setup skill (/setup)
├── scripts/                     # Pipeline scripts (Python + Node.js)
│   └── backends/                # Video generation backends (veo.py, wan.py)
└── editor/                      # Next.js timeline editor app
```

## How to Modify This Plugin

### Fixing prompts (most common)
- Image prompt template: `skills/edu-vid-gen/references/prompting.md` → "Image Prompt Building"
- Veo prompt template: `skills/edu-vid-gen/references/prompting.md` → "Veo Prompt Structure"
- Audio tags: `skills/edu-vid-gen/references/audio-tags.md`

### Fixing flow/phase issues
- Main pipeline phases: `skills/edu-vid-gen/SKILL.md`
- Batch pipeline: `skills/batch-gen/SKILL.md`
- Validation criteria: `skills/edu-vid-gen/references/validation.md`

### Adding a new video backend
1. Create `scripts/backends/{name}.py` following the pattern in `veo.py` or `wan.py`
2. Register in `scripts/backends/__init__.py`
3. Update `scripts/generate-video.py` to accept the new `--backend` value
4. Update `skills/edu-vid-gen/references/api-errors.md` with backend-specific errors

### Adding a new skill
1. Create `skills/{skill-name}/SKILL.md` with frontmatter (name, description)
2. The description field controls when Claude Code triggers the skill — make it specific

## API Keys

Keys are loaded from environment variables. Never hardcode keys in skills or scripts.

| Variable | Service | Required for |
|----------|---------|-------------|
| `ELEVENLABS_API_KEY` | ElevenLabs | Voiceover generation |
| `GEMINI_API_KEY` | Google Gemini | Image generation, validation |
| `TOGETHER_API_KEY` | Together AI | Wan 2.7 video backend |
| gcloud ADC | Google Cloud | Veo video generation |

Run `/setup` to configure these on a new machine.

## Script Path Convention

All skills reference scripts via `__PLUGIN_DIR__/scripts/`. Claude Code resolves `__PLUGIN_DIR__` to the plugin's installation path at runtime.

## Rate Limits (important for QA)

| API | Wait between calls |
|-----|-------------------|
| Gemini image | 35 seconds |
| ElevenLabs | 3 seconds |
| Veo video | 60-90 seconds |
