# Batch Mode Reference

## Manifest Schema (`batch.json`)

```json
{
  "batch": {
    "name": "string — batch display name (required)",
    "defaults": {
      "class": "string — grade level, e.g. 'Class 5' (required)",
      "narration_language": "Hindi | English | Hinglish (required)",
      "visual_style": "Pixar | Clay | 2D Flat | Doodle | Watercolour | Photorealistic (required)",
      "character_mode": "human | abstract | none (required)",
      "duration_seconds": "60 | 90 (required)",
      "aspect_ratio": "16:9 | 9:16 (required)",
      "ambient_category": "forest | rain | ocean | space | underwater | workshop | lab | garden | auto | none (optional, default: auto)",
      "voice_id": "string — ElevenLabs voice ID (optional, default: Anika)",
      "voice_model": "eleven_v3 | eleven_multilingual_v2 | eleven_flash_v2_5 (optional, default: eleven_v3)",
      "video_strategy": "ac_tc | extend (optional, default: ac_tc)",
      "veo_mode": "fast | standard (optional, default: fast)"
    },
    "shared_characters": [
      {
        "name": "string — character name (required)",
        "description": "string — visual description for generation (required unless reuse_from set)",
        "reuse_from": "string — path to existing character dir to copy from (optional)"
      }
    ],
    "review_mode": "normal | auto (optional, default: normal)",
    "videos": [
      {
        "id": "string — filesystem-safe slug, no spaces/slashes (required)",
        "topic": "string — educational concept (required)",
        "chapter_source": "string — URL, PDF path, or text (optional)",
        "narration_text": "string — pre-written narration, null = AI writes it (optional)",
        "overrides": {
          "— any field from defaults can be overridden per video —"
        },
        "characters": ["string — names from shared_characters (optional)"],
        "priority": "number — lower = generated first (optional, default: index order)"
      }
    ]
  }
}
```

## Required vs Optional Fields

### Always required
- `batch.name`
- `batch.defaults.class`, `.narration_language`, `.visual_style`, `.character_mode`, `.duration_seconds`, `.aspect_ratio`
- `batch.videos` (non-empty array)
- Each video: `id`, `topic`

### Optional with defaults
- `review_mode`: `"normal"`
- `ambient_category`: `"auto"`
- `voice_id`: `"ecp3DWciuUyW7BYM7II1"` (Anika)
- `voice_model`: `"eleven_v3"`
- `video_strategy`: `"ac_tc"`
- `veo_mode`: `"fast"`
- `priority`: array index order

## Review Modes

### `"normal"` (default)
Pauses at 4 batch review gates:
1. After all scripts written (Phase 2)
2. After all timelines generated (Phase 2.5)
3. After all images generated (Phase 3)
4. After clips with validation failures (Phase 4)

### `"auto"`
Only pauses on failures:
- Scripts: auto-approved
- Timelines: auto-approved (warns on overflow > 1.5s)
- Images: auto-approved if Claude vision passes (no text contamination, correct aspect)
- Clips: auto-accept scores 6-7, auto-regen scores < 6 (max 2 retries), pause only on persistent failures

## State Tracking (`batch-status.json`)

Created by `batch-checkpoint.py --init`. Updated after every state transition.

### Video States (in order)

```
PENDING -> SCRIPTING -> SCRIPT_REVIEW -> AUDIO -> AUDIO_REVIEW ->
IMAGING -> IMAGE_REVIEW -> CLIPPING -> CLIP_REVIEW ->
COMPOSITING -> VALIDATING -> DONE | FAILED
```

### State File Schema

```json
{
  "batch_name": "string",
  "manifest_path": "string — absolute path to batch.json",
  "started_at": "ISO 8601 timestamp",
  "last_updated": "ISO 8601 timestamp",
  "review_mode": "normal | auto",
  "total_videos": "number",
  "videos": {
    "{video_id}": {
      "state": "one of the states above",
      "output_dir": "string — folder name (relative to repo root)",
      "progress": "string — e.g. '5/8 clips', '3/7 imgs'",
      "completed_phases": ["1", "2", "2.1", "2.5", "3", "4", "5"],
      "errors": [
        { "time": "ISO 8601", "message": "string" }
      ],
      "cost_inr": "number — running cost total"
    }
  },
  "total_cost_inr": "number — sum of all video costs"
}
```

## Resume

```bash
/batch-gen --resume path/to/batch-status.json
```

Resume procedure:
1. Load batch-status.json
2. Load manifest from `manifest_path`
3. For each video not `DONE`/`FAILED`:
   - Verify artifacts for completed phases via `checkpoint.py --json-output`
   - Resume from last incomplete phase
4. Re-enter the normal batch flow

## Cost Estimation

Calculated by `validate-manifest.py` before batch starts:

| Component | Cost per video |
|-----------|---------------|
| Veo 3.1 Fast | clips x 8s x Rs 12.6/sec |
| Veo 3.1 Standard | clips x 8s x Rs 33.6/sec |
| ElevenLabs VO | ~Rs 25 per 60s video |
| Gemini (images + validation) | ~Rs 5 per video |
| Character sheets | ~Rs 5 per shared character |

**Typical 60s video (fast mode):** 7-8 clips = ~Rs 635-730
**Typical 90s video (fast mode):** 11-12 clips = ~Rs 1,100-1,200

## Example Manifests

### Simple: 3 science videos, same style
```json
{
  "batch": {
    "name": "Class 5 Science",
    "defaults": {
      "class": "Class 5",
      "narration_language": "Hinglish",
      "visual_style": "Clay",
      "character_mode": "none",
      "duration_seconds": 60,
      "aspect_ratio": "9:16"
    },
    "videos": [
      { "id": "water-cycle", "topic": "Water Cycle" },
      { "id": "food-chain", "topic": "Food Chain" },
      { "id": "photosynthesis", "topic": "Photosynthesis" }
    ]
  }
}
```

### Advanced: shared character, mixed settings
```json
{
  "batch": {
    "name": "Mowgli Science Adventures",
    "defaults": {
      "class": "Class 4",
      "narration_language": "Hindi",
      "visual_style": "Clay",
      "character_mode": "abstract",
      "duration_seconds": 60,
      "aspect_ratio": "9:16",
      "veo_mode": "fast"
    },
    "shared_characters": [
      {
        "name": "Mowgli",
        "description": "small clay figurine boy with wild hair, brown vest, bare feet, curious wide eyes, toddler proportions with oversized head"
      }
    ],
    "review_mode": "normal",
    "videos": [
      {
        "id": "jungle-food-chain",
        "topic": "Food Chain in the Jungle",
        "characters": ["Mowgli"],
        "overrides": { "ambient_category": "forest" },
        "priority": 1
      },
      {
        "id": "water-in-jungle",
        "topic": "Water Cycle",
        "characters": ["Mowgli"],
        "overrides": { "ambient_category": "rain", "duration_seconds": 90 },
        "priority": 2
      }
    ]
  }
}
```
