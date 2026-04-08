# Prompting Reference

Heavy reference for image and Veo video prompt construction. Loaded on demand from Phases 2, 3, and 4.

---

## Image Prompt Building (Phase 3)

### Prompt Template

```
A {STYLE} educational illustration for {CLASS} students.
{CHARACTER_DESCRIPTION — exact same wording every frame for consistency}.
Scene: {scene_description}. {visual_notes}.
High quality, vibrant, clear for young learners, {style-specific descriptors}.
{ASPECT} orientation.
TEXT RULES: This is a cinematic animation frame, NOT an infographic or poster. Do NOT render any explanatory text, numbered lists, bullet points, paragraphs, definitions, captions, subtitles, or descriptive sentences in the image. {TEXT_ALLOWANCE}. The narration audio will explain the concept — the image must be purely visual.
```

### Style-Specific Descriptors

| Style | Descriptors |
|-------|------------|
| 3D Pixar/Disney | warm cinematic lighting, subsurface scattering, expressive characters |
| 3D Clay animation | clay texture, stop-motion aesthetic, studio lighting, handcrafted details |
| 2D Flat animation | bold outlines, flat colours, vector art style, clean geometry |
| Doodle/Whiteboard | black marker lines on white background, hand-drawn, sketch style |
| Watercolour/Painterly | soft watercolour washes, paper texture, painterly, loose brushstrokes |
| Photorealistic | photorealistic, National Geographic quality, natural lighting, detailed |

### Character Description Rules

- Define each named character with a precise visual description (shape, colour, eyes, expressions, limbs)
- This SAME description must appear **verbatim** in EVERY image prompt and video prompt
- Example: "Droppy is a round teardrop body, bright cerulean blue, white circular highlight upper-left, large round black eyes with shine dots, small curved smile, two tiny stubby arms."

### BEFORE-State Rules (Critical)

Keyframes are the starting point for Veo animation. If the keyframe shows the climax, Veo has nowhere to go.

| Scene type | Keyframe must show | NOT this |
|-----------|-------------------|----------|
| Dramatic event (explosion, burst, crack) | Moment BEFORE — tension, anticipation, setup | The explosion with seeds flying |
| Progressive reveal (diagram building, growth) | Empty/initial state | Completed result |
| Text labels in frame | Text-free version, or accept Veo will distort text | N/A |

If you have a climax-state keyframe from Phase 3, generate a NEW "pre-action" start frame:
```bash
GEMINI_API_KEY="$GEMINI_API_KEY" node __PLUGIN_DIR__/scripts/generate-image.mjs \
  --prompt "{description of the BEFORE state — no action yet, setup only}" \
  --output "{OUTPUT_DIR}/images/frame-{NN}-pre-action.jpg" \
  --aspect "{ASPECT}"
sips -Z 1280 "{OUTPUT_DIR}/images/frame-{NN}-pre-action.jpg" \
  --out "{OUTPUT_DIR}/images/frame-{NN}-pre-action-small.jpg" --setProperty formatOptions 65
```

### Split-Screen Orientation Rules

Match the split direction to aspect ratio:
- **16:9 (landscape)** — split LEFT and RIGHT (vertical dividing line). Prompt: "The frame is split into LEFT HALF and RIGHT HALF..."
- **9:16 (portrait)** — split TOP and BOTTOM (horizontal dividing line). Prompt: "The frame is split into TOP HALF and BOTTOM HALF..."

Never use left/right split for 9:16 (panels too narrow). Never use top/bottom split for 16:9 (panels too short).

---

## Text in Frames — Strict Rules

AI-generated text warps and smears when Veo animates it. Frames are cinematic scenes, NOT infographics.

| Frame type | Text allowed | Example |
|-----------|-------------|---------|
| Character scene (action, emotion) | **ZERO text** | Motu eating leaf, Chidiya swooping — pure visual storytelling |
| Concept label scene (one key term) | **ONE keyword only** (2-3 words max) | "PRODUCER" or "FOOD CHAIN" — single bold label |
| Diagram/chain scene | **Character names as small labels only** | Arrows with tiny names, NO definitions beside them |

### TEXT RULES Anti-Prompt (append to EVERY image and Veo prompt)

```
TEXT RULES: This is a cinematic animation frame, NOT an infographic or poster. Do NOT render any explanatory text, numbered lists, bullet points, paragraphs, definitions, captions, subtitles, or descriptive sentences in the image. {TEXT_ALLOWANCE}. The narration audio will explain the concept — the image must be purely visual.
```

**TEXT_ALLOWANCE variants:**
- `"No text whatsoever in the image"` — action/emotion scenes
- `"Only the single word '{KEYWORD}' may appear as a bold floating label"` — concept scenes
- `"Only short character names as tiny labels near arrows"` — diagram scenes

---

## Veo Prompt Structure (Phase 4)

### Building the Word-Synced Beat Map

For word-level sync, use character-level timestamps from `full-vo-timestamps.json`:

1. Parse `full-vo-timestamps.json` -> build per-word start/end times
2. Filter words to this clip's audio window (`clip.audio_start` to `clip.audio_end`)
3. Rebase to clip-relative time: `word_rel = word.start - clip.audio_start`
4. Group into **beats** (1.5-3s visual windows) around key visual words (nouns, actions)
5. **Add +1s anticipation buffer** — Veo starts animating ~1s before the cued timestamp
6. Map beats to `[MM:SS-MM:SS]` prompt segments

Example beat map (vegetative propagation clip, VO 7.5s in 8s clip):
```
Words:  0.00-2.07 "Woh grow karte hain doosre parts se"  -> intro
        2.78-4.23 "roots jaise gajar,"                    -> CARROT focus
        4.31-5.91 "stems jaise aloo,"                     -> POTATO focus
        5.96-7.51 "leaves jaise bryophyllum!"              -> BRYOPHYLLUM focus

Beat map (+1s buffer):
  [00:00-00:04] Intro — both veggies STATIC, character bounces
  [00:04-00:05] Carrot glows (lands at ~3s with anticipation = matches "gajar" at 3.47)
  [00:05-00:06] Potato glows (lands at ~4s = matches "aloo" at 5.15)
  [00:06-00:08] Both active + brightening
```

### Timestamp-Structured Visual Prompt Template

Use the official `[MM:SS-MM:SS]` multi-shot format — ~96% temporal accuracy vs vague timing.

```
[00:00-00:XX] {scene description}. {key elements} are completely STILL, FROZEN, no glow, no movement yet. {Character name} is the ONLY thing moving — {busy work: bounces, looks around, waves, tilts head}. Camera holds steady.

[00:XX-00:YY] NOW {first key visual activates} — {describe the action with urgency}. {Character} turns and points at it. {Other elements stay dim}.

[00:YY-00:ZZ] The {focus} JUMPS to {second visual} — {describe action}. {Character} swings to point at it.

[00:ZZ-00:08] {Crescendo or outro — both sides active, brightening, character proud}.

{STYLE} animation, {mood}, educational.
NO TEXT. NO WORDS. NO LABELS. NO TITLES. NO CAPTIONS. NO SUBTITLES.
```

### Key Prompt-Engineering Rules

1. **Intro segments: STATIC + busy character** — Explicitly say "completely STILL, FROZEN, no glow, no animation" for elements that shouldn't move yet. Give the character busy work (bouncing, looking around, waving) to occupy Veo's animation budget and prevent premature element animation.

2. **+1s anticipation buffer** — Veo starts animating ~1s before the cued timestamp. Push visual cues 1s later than the actual word timestamp. Critical visual words should be spoken DURING the visual beat, not before.

3. **Urgency words at transitions** — Use "NOW", "SUDDENLY", "JUMPS" at beat boundaries for sharper transitions. Without urgency words, Veo blends gradually.

4. **Audio prompt reinforces timing** — Include explicit time markers: "quiet for first 4 seconds, then sudden pop at 4 seconds when X glows, second pop at 5 seconds when Y activates".

### Audio Prompt (Veo SFX Only)

ElevenLabs VO is overlaid in Phase 5 at 100% volume. Veo audio is SFX + music only at 35%.

```
{Quiet ambient for first N seconds with subtle character sounds}, {timed SFX matching beat boundaries: "sudden pop at X seconds when Y activates"}, {music mood building throughout}
```

**Rules:**
- NEVER put narration text in the Veo audio prompt
- Strip ElevenLabs audio tags (`[excited]`, `[pause]` etc.) from all text before using in Veo prompts
- SFX should match the visual beat map timing

### Activity Clip Rules

- Use `--image` (start frame) but NEVER `--end-frame` on activity clips
- End-frame interpolation is too aggressive — eats 3-4s of activity time by morphing toward the target prematurely
- Veo image-to-video supported durations: **[4, 6, 8] seconds only** — never pass 5s or 7s

### Copyright-Safe Prompting (Critical for Adapted Works)

When generating video clips for stories based on copyrighted works (Jungle Book, fairy tales with trademarked adaptations, etc.), Veo's copyright filter blocks character names. **All Veo prompts must be name-free.**

**Rewrite strategy:**
1. Replace every character name with a visual description
2. Use "the character in the start frame" or "as shown" to anchor identity
3. Start frame images carry character identity — Veo animates what it sees

**Example rewrites for Jungle Book:**
```
❌ "Mowgli runs joyfully alongside the wolf pack through moonlit jungle"
✅ "The small animated jungle character with spiky dark hair and leaf wrap runs joyfully alongside wolves through moonlit jungle"

❌ "Shere Khan roars at the cave entrance"  
✅ "The massive striped tiger villain roars at the cave entrance"

❌ "Baloo steps forward and speaks"
✅ "The large friendly brown bear steps forward confidently"

❌ "Bagheera emerges from shadows"
✅ "The sleek black panther with emerald-green eyes emerges from shadows"
```

**Build a name→description map in Phase 2** (video brief) and apply it automatically when writing Veo prompts in Phase 4. Image prompts (Gemini/Imagen) can still use names.

### Generation Mode by CHARACTER_MODE

| Mode | Veo flags | Why |
|------|-----------|-----|
| `human` | Text-to-video only (omit `--image`/`--end-frame`) | Veo blocks image-to-video for human faces |
| `abstract` | Image-to-video with `--image` | Abstract characters are safe |
| `none` | Image-to-video with `--image` + optional `--end-frame` for TCs | Best quality |

### Clip Prompt Save Template

```bash
cat > "{OUTPUT_DIR}/prompts/clip-{NN}_prompt.md" << 'PROMPT_EOF'
# Clip Prompt — Clip {NN}

## Beat Map
{beat_map_table}

## Visual Prompt
{full_visual_prompt}

## Audio Prompt
{full_audio_prompt}

## Settings
- Model: veo-3.1-fast-generate-001
- Duration: {clip.duration}s
- Aspect: {ASPECT}
- Start frame: frame-{NN}-small.jpg (or pre-action frame if climax start)
- End frame: none (activity clips never use --end-frame)
PROMPT_EOF
```
