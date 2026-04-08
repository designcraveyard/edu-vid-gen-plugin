# Audio Tags & Voice Reference

ElevenLabs v3 audio tags, Hindi pronunciation fixes, and voice selection. Loaded on demand from Phase 2 and 2.5.

---

## ElevenLabs v3 Audio Tags

Audio tags are words in `[square brackets]` that control voice expression. They work **ONLY with `eleven_v3`** — other models speak them literally.

Tags are case-insensitive (lowercase recommended). Place them BEFORE the text they affect.

### Emotional Tags

| Tag | Effect | Educational use |
|-----|--------|----------------|
| `[happy]` | Joyful, positive | Fun facts, discoveries |
| `[excited]` | Enthusiastic energy | Wow moments, reveals |
| `[curious]` | Wondering, questioning | Opening hooks, questions |
| `[warm]` | Friendly, inviting | Introductions, welcomes |
| `[sad]` | Melancholy, somber | Serious topics (pollution, history) |
| `[nervous]` | Anxious, uncertain | Building suspense |
| `[mischievously]` | Playful, cheeky | Fun asides, jokes |

### Delivery Tags

| Tag | Effect | Educational use |
|-----|--------|----------------|
| `[whispers]` / `[whispering]` | Intimate, low volume | Secrets, small details |
| `[shouts]` / `[shouting]` | Loud, dramatic | Key facts, important rules |
| `[speaking softly]` | Gentle, quiet | Calming explanations |

### Pacing Tags

| Tag | Effect | Educational use |
|-----|--------|----------------|
| `[pause]` | Brief silence | Before important reveal |
| `[breathes]` | Audible breath | Natural transition |
| `[continues after a beat]` | Slight delay then resume | After a question |
| `[rushed]` | Fast speaking | Excitement buildup |
| `[slows down]` | Deliberate pacing | Key concept emphasis |
| `[deliberate]` | Careful, measured | Definitions, formulas |

### Sound/Action Tags

| Tag | Effect | Educational use |
|-----|--------|----------------|
| `[sighs]` | Audible sigh | Awe, wonder |
| `[laughs]` | Light laughter | Humor, fun facts |
| `[gasps]` | Surprise sound | Discovery moments |

### Combination Rules

- Tags can be combined: `[nervously][whispers]` = nervous whispering
- One tag affects text until the next tag or end of segment
- Don't over-tag — 2-3 tags per 8s segment is ideal
- Punctuation also affects delivery: ellipses (...) add weight, CAPS increase emphasis

---

## Auto-Tagging Rules for Educational Narration

When writing narration for `eleven_v3`, apply automatically:

| Context | Tag | Example |
|---------|-----|---------|
| Opening hook | `[curious]` or `[warm]` | `[curious] Have you ever wondered why the sky is blue?` |
| Key reveals / "wow" moments | `[pause]` + `[excited]` | `[pause] [excited] And guess what? These two angles are always equal!` |
| Definitions / rules | `[deliberate]` | `[deliberate] This bouncing of light is called reflection.` |
| Fun facts / asides | `[mischievously]` or `[happy]` | `[mischievously] So technically, you're seeing old light!` |
| Scene transitions | `[warm]` or no tag | `[warm] Now let's see what happens when...` |
| Closing / summary | `[happy]` or `[warm]` | `[happy] So next time you look in a mirror, remember...` |
| Questions to viewer | `[curious]` | `[curious] But what happens when light hits a rough surface?` |

---

## Hindi Devanagari Substitution Table

ElevenLabs mispronounces romanized Hindi — especially retroflex sounds. **Fix: embed Devanagari directly.** With `--language hi`, the model reads mixed Roman+Devanagari correctly.

| Romanized | Use instead | Why |
|-----------|-------------|-----|
| kapde / kapdon / kapda | कपड़े / कपड़ों / कपड़ा | `ड़` retroflex D sounds like 'l' in Roman |
| pahnate / pehno | पहनते / पहनो | aspirated 'h' mispronounced |
| thand | ठंड | nasal retroflex misread |
| ghaghra-choli | घाघरा-चोली | 'gh' cluster mispronounced |
| dhoye / dhoe | धोए | voiced aspirate 'dh' |
| sukhaaye | सुखाए | long vowel lost |
| zaroori | ज़रूरी | 'z' sound missing |
| pehnaawa | पहनावा | aspirated cluster |
| kahaani | कहानी | long vowel |
| baarish | बारिश | long 'aa' |
| paani | पानी | long 'aa' + nasal |
| bhojan / khana | भोजन / खाना | aspirated 'bh'/'kh' |
| prakaash / roshni | प्रकाश / रोशनी | conjunct 'pr' cluster |
| vayu / hawa | वायु / हवा | 'v' read as English 'v' not Hindi |
| prithvi / dharti | पृथ्वी / धरती | conjunct + retroflex |
| ped / pedh | पेड़ | retroflex `ड़` |
| gadha / gadhe | गधा / गधे | aspirated 'dh' misread |
| pakshi / chidiya | पक्षी / चिड़िया | conjunct 'ksh' + retroflex |
| phool / phoolo | फूल / फूलों | aspirated 'ph' read as English 'f' |
| suraj / sooraj | सूरज | long 'oo' |
| chandrama / chaand | चंद्रमा / चाँद | nasal + long vowel |
| samundar / sagar | समुंदर / सागर | nasal 'n' |
| pahad / parbat | पहाड़ / पर्वत | retroflex `ड़` + conjunct |
| mitti | मिट्टी | geminate retroflex 'tt' |
| koshika / koshikaayen | कोशिका / कोशिकाएं | long vowel endings |

### When to use Devanagari

- **Always** for Hindi words with: retroflex (`ड़`, `ठ`, `ढ`), aspirated (`भ`, `घ`, `फ`, `ध`), nasal (`ं`, `ँ`), conjuncts (`क्ष`, `प्र`, `त्र`)
- **Always** for long vowels that matter: `aa` → `ा`, `oo` → `ू`, `ee` → `ी`
- **Skip** for common short words ElevenLabs gets right: `hai`, `ka`, `ki`, `ko`, `se`, `par`, `aur`

**Do NOT use ElevenLabs Pronunciation Dictionaries for Hindi** — alias rules make pronunciation WORSE. Devanagari inline embedding is the correct approach.

### For English technical terms

If ElevenLabs mispronounces English words (rare), use a pronunciation dictionary:
- Create via dashboard or API: `POST /v1/pronunciation-dictionaries/add-from-rules`
- Alias rules: `{"string_to_replace": "GIF", "type": "alias", "alias": "jiff"}`
- IPA rules: `{"string_to_replace": "nginx", "type": "phoneme", "phoneme": "ˈɛndʒɪnˌɛks", "alphabet": "ipa"}`
- Pass dictionary to script: `--dict-id {ID} --dict-version {VER}`
- Max 3 dictionaries per request

---

## Voice Selection

### Default Voices (Indian accent)

| Language | Voice | Voice ID | Notes |
|----------|-------|----------|-------|
| Hinglish | Anika | `ecp3DWciuUyW7BYM7II1` | Animated, friendly Indian female |
| Hindi | Anika | `ecp3DWciuUyW7BYM7II1` | Same voice, pure Hindi works well |
| English | Anika | `ecp3DWciuUyW7BYM7II1` | Indian English accent |

### Discovering Alternatives

```bash
ELEVENLABS_API_KEY="$ELEVENLABS_API_KEY" node __PLUGIN_DIR__/scripts/generate-voiceover.mjs --list-voices
```

Fetches YOUR voices first (cloned/saved), falls back to all voices if you have none.

### Model Comparison

| Model | Audio tags | Languages | Cost | Best for |
|-------|-----------|-----------|------|----------|
| `eleven_v3` | Yes | Multi | Standard | Educational content (most expressive) |
| `eleven_multilingual_v2` | **No** (spoken literally) | 29 | Standard | Stable multi-language |
| `eleven_flash_v2_5` | **No** (spoken literally) | Multi | 50% cheaper | Fast iteration, budget |

### Default Settings

- Model: `eleven_v3`
- Stability: `0.5` (lower = more expressive)
- Speed: `0.98`
- Language flag: `--language hi` for Hinglish/Hindi, `--language en` for English
