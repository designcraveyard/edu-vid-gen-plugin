#!/usr/bin/env node
/**
 * generate-audio-timeline.mjs
 * Generates full narration VO + word-level timestamps, then clusters phrases into
 * clip groups of 5–8s (Veo's supported range). Outputs:
 *   - audio/full-vo.mp3                — the actual rendered audio
 *   - audio/full-vo-timestamps.json    — raw ElevenLabs character-level alignment data
 *   - audio/timeline.json              — the editable clip plan (review before Veo generation)
 *
 * Usage:
 *   ELEVENLABS_API_KEY="..." node generate-audio-timeline.mjs \
 *     --text "Full narration text here" \
 *     --output-dir ./audio \
 *     --voice "ecp3DWciuUyW7BYM7II1" \
 *     [--model eleven_v3] [--stability 0.5] [--speed 0.98] [--language hi]
 *     [--min-clip 5] [--max-clip 8] [--gap-threshold 0.3]
 *     [--dict-id ID] [--dict-version VER]   — pronunciation dictionary (up to 3, comma-separated)
 *     [--text-normalization auto|on|off]     — controls number/abbreviation expansion
 *
 * After reviewing timeline.json, run:
 *   node rebuild-timeline.mjs --timeline ./audio/timeline.json
 * Then slice audio:
 *   node slice-audio.mjs --timeline ./audio/timeline.json --audio ./audio/full-vo.mp3 --output-dir ./audio
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const args = process.argv.slice(2);
const get = (flag, def = null) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error('Error: ELEVENLABS_API_KEY environment variable is not set.');
  console.error('Set it with: export ELEVENLABS_API_KEY="your-key-here"');
  process.exit(1);
}

const text         = get('--text');
const outputDir    = get('--output-dir', './audio');
const voice        = get('--voice', 'ecp3DWciuUyW7BYM7II1');  // Anika — default for Hinglish
const model        = get('--model', 'eleven_v3');
const stability    = parseFloat(get('--stability', '0.5'));
const speed        = parseFloat(get('--speed', '0.98'));
const language     = get('--language', 'hi');
const minClip      = parseFloat(get('--min-clip', '5'));
const maxClip      = parseFloat(get('--max-clip', '8'));
const gapThreshold = parseFloat(get('--gap-threshold', '0.3')); // seconds — inter-word gap that signals phrase boundary
const dictIds      = get('--dict-id', null);                     // pronunciation dictionary ID(s), comma-separated
const dictVersions = get('--dict-version', null);                // pronunciation dictionary version(s), comma-separated
const textNorm     = get('--text-normalization', 'auto');        // auto | on | off

if (!text) {
  console.error('Usage: node generate-audio-timeline.mjs --text "..." --output-dir ./audio');
  console.error('  Optional: --voice ID --model eleven_v3 --stability 0.5 --speed 0.98 --language hi');
  console.error('  Optional: --min-clip 5 --max-clip 8 --gap-threshold 0.3');
  console.error('  Optional: --dict-id ID[,ID2] --dict-version VER[,VER2] --text-normalization auto|on|off');
  process.exit(1);
}

// ── Build pronunciation dictionary locators ─────────────────────────────────
const pronDictLocators = [];
if (dictIds) {
  const ids = dictIds.split(',');
  const vers = dictVersions ? dictVersions.split(',') : [];
  for (let i = 0; i < ids.length; i++) {
    pronDictLocators.push({
      pronunciation_dictionary_id: ids[i].trim(),
      version_id: vers[i]?.trim() || null,
    });
  }
}

const BASE = 'https://api.elevenlabs.io/v1';

mkdirSync(resolve(outputDir), { recursive: true });

console.log(`Generating full VO with timestamps...`);
console.log(`  Voice:  ${voice}`);
console.log(`  Model:  ${model}`);
console.log(`  Speed:  ${speed}  Stability: ${stability}`);
console.log(`  Text:   "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
console.log(`  Length: ${text.length} chars`);
console.log(`  Text normalization: ${textNorm}`);
if (pronDictLocators.length > 0) {
  console.log(`  Pronunciation dictionaries: ${pronDictLocators.map(d => d.pronunciation_dictionary_id).join(', ')}`);
}
console.log();

// ── Call ElevenLabs /with-timestamps ────────────────────────────────────────
const res = await fetch(`${BASE}/text-to-speech/${voice}/with-timestamps`, {
  method: 'POST',
  headers: {
    'xi-api-key': API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text,
    model_id: model,
    language_code: language,
    voice_settings: {
      stability,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
      speed,
    },
    apply_text_normalization: textNorm,
    ...(pronDictLocators.length > 0 && {
      pronunciation_dictionary_locators: pronDictLocators,
    }),
  }),
});

if (!res.ok) {
  const err = await res.text().catch(() => '');
  if (res.status === 429) {
    console.error('Rate limited (429). Wait 30s and retry.');
  } else if (res.status === 401) {
    console.error('Invalid API key (401). Check ELEVENLABS_API_KEY.');
  } else if (res.status === 422) {
    console.error('Validation error (422):', err);
  } else {
    console.error(`API error (${res.status}):`, err);
  }
  process.exit(1);
}

const data = await res.json();
const { audio_base64, alignment } = data;

if (!audio_base64 || !alignment) {
  console.error('Unexpected response shape:', JSON.stringify(data).slice(0, 300));
  process.exit(1);
}

// ── Save audio ───────────────────────────────────────────────────────────────
const audioPath = resolve(join(outputDir, 'full-vo.mp3'));
writeFileSync(audioPath, Buffer.from(audio_base64, 'base64'));
console.log(`Saved audio: ${audioPath}`);

// ── Save raw timestamps ──────────────────────────────────────────────────────
const tsPath = resolve(join(outputDir, 'full-vo-timestamps.json'));
writeFileSync(tsPath, JSON.stringify(alignment, null, 2));
console.log(`Saved timestamps: ${tsPath}`);

// ── Parse alignment into words ───────────────────────────────────────────────
function parseWords(alignment) {
  const chars  = alignment.characters || [];
  const starts = alignment.character_start_times_seconds || [];
  const ends   = alignment.character_end_times_seconds || [];

  const words = [];
  let current = { text: '', start: null, end: null };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const s  = starts[i];
    const e  = ends[i];

    if (ch === ' ' || ch === '\n') {
      if (current.text.trim()) {
        words.push({ text: current.text.trim(), start: current.start, end: current.end });
        current = { text: '', start: null, end: null };
      }
    } else {
      if (current.start === null) current.start = s;
      current.text += ch;
      current.end = e;
    }
  }
  if (current.text.trim()) {
    words.push({ text: current.text.trim(), start: current.start, end: current.end });
  }
  return words;
}

// ── Group words into phrases ─────────────────────────────────────────────────
// Phrase boundary: inter-word gap > gapThreshold OR sentence-ending punctuation (.!?)
function parsePhrases(words, gapThreshold) {
  const phrases = [];
  if (words.length === 0) return phrases;

  let current = { words: [words[0]], start: words[0].start, end: words[0].end };

  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const curr = words[i];
    const gap  = curr.start - prev.end;
    // Strip quotes/brackets before checking for sentence-ending punctuation
    const prevEndsWithStop = /[.!?]$/.test(prev.text.replace(/["""''')\]]/g, ''));
    const isBoundary = gap > gapThreshold || prevEndsWithStop;

    if (isBoundary) {
      phrases.push({
        text:     current.words.map(w => w.text).join(' '),
        start:    current.start,
        end:      current.end,
        duration: current.end - current.start,
      });
      current = { words: [curr], start: curr.start, end: curr.end };
    } else {
      current.words.push(curr);
      current.end = curr.end;
    }
  }
  // Push last phrase
  phrases.push({
    text:     current.words.map(w => w.text).join(' '),
    start:    current.start,
    end:      current.end,
    duration: current.end - current.start,
  });
  return phrases;
}

// ── Cluster phrases into clip groups (greedy 5–8s) ──────────────────────────
// Never split mid-sentence unless a single sentence > maxClip.
// Merge any resulting clip < minClip into the previous one.
function clusterPhrases(phrases, minClip, maxClip) {
  const clips = [];
  let current = { phrases: [], start: null, end: null };

  const flush = () => {
    if (current.phrases.length === 0) return;
    const dur        = current.end - current.start;
    const durationInt = Math.min(maxClip, Math.max(minClip, Math.round(dur)));
    clips.push({
      phrases:    current.phrases,
      audio_start: parseFloat(current.start.toFixed(3)),
      audio_end:   parseFloat(current.end.toFixed(3)),
      raw_duration: parseFloat(dur.toFixed(3)),
      duration:   durationInt,
    });
    current = { phrases: [], start: null, end: null };
  };

  for (const phrase of phrases) {
    const projectedDur = current.start !== null
      ? (phrase.end - current.start)
      : phrase.duration;

    // If adding this phrase would exceed maxClip, flush the current cluster first
    if (current.start !== null && projectedDur > maxClip) {
      flush();
    }

    if (current.start === null) current.start = phrase.start;
    current.end = phrase.end;
    current.phrases.push(phrase);
  }
  flush();

  // Merge any clip < minClip into the previous one (keeps Veo in valid range)
  for (let i = clips.length - 1; i >= 0; i--) {
    if (clips[i].raw_duration < minClip && i > 0) {
      const prev = clips[i - 1];
      const curr = clips[i];
      prev.phrases.push(...curr.phrases);
      prev.audio_end    = curr.audio_end;
      prev.raw_duration = prev.audio_end - prev.audio_start;
      prev.duration     = Math.min(maxClip, Math.max(minClip, Math.round(prev.raw_duration)));
      clips.splice(i, 1);
    }
  }

  return clips;
}

// ── Run parsing + clustering ─────────────────────────────────────────────────
const words = parseWords(alignment);
console.log(`\nParsed ${words.length} words.`);

const phrases = parsePhrases(words, gapThreshold);
console.log(`Detected ${phrases.length} phrases.`);

const clusters = clusterPhrases(phrases, minClip, maxClip);
console.log(`Grouped into ${clusters.length} clips.`);

const totalAudioDuration = words.length > 0
  ? parseFloat(words[words.length - 1].end.toFixed(3))
  : 0;

// ── Build timeline.json ──────────────────────────────────────────────────────
const timeline = {
  voice,
  model,
  stability,
  speed,
  language,
  total_audio_duration: totalAudioDuration,
  total_clips: clusters.length,
  clips: clusters.map((c, idx) => ({
    clip:             idx + 1,
    duration:         c.duration,           // integer seconds — Veo clip duration
    audio_start:      c.audio_start,        // slice full-vo.mp3 from here
    audio_end:        c.audio_end,          // to here
    phrases:          c.phrases.map(p => ({
      text:  p.text,
      start: parseFloat(p.start.toFixed(3)),
      end:   parseFloat(p.end.toFixed(3)),
    })),
    visual_suggestion: c.phrases.map(p => p.text).join(' '), // edit this for image/Veo prompts
  })),
};

const timelinePath = resolve(join(outputDir, 'timeline.json'));
writeFileSync(timelinePath, JSON.stringify(timeline, null, 2));

// ── Print summary ────────────────────────────────────────────────────────────
console.log('\n🎬 Timeline generated:');
console.log(`   Total audio:  ${totalAudioDuration.toFixed(1)}s`);
console.log(`   Total clips:  ${timeline.total_clips}`);
console.log(`   Clip range:   ${minClip}–${maxClip}s per clip\n`);

timeline.clips.forEach(c => {
  const phrasePreview = c.phrases.map(p => `"${p.text.slice(0, 35)}"`).join(' | ');
  const warn = c.duration < minClip || c.duration > maxClip ? ' ⚠️ OUT OF RANGE' : '';
  console.log(`  Clip ${String(c.clip).padStart(2)}: ${c.duration}s  (audio ${c.audio_start.toFixed(2)}–${c.audio_end.toFixed(2)}s) — ${phrasePreview}${warn}`);
});

console.log(`\nSaved: ${timelinePath}`);
console.log('\nNext steps:');
console.log('  1. Review timeline.json — merge/split/adjust clips as needed');
console.log('  2. Validate: node rebuild-timeline.mjs --timeline ' + timelinePath);
console.log('  3. Slice:    node slice-audio.mjs --timeline ' + timelinePath + ' --audio ' + audioPath + ' --output-dir ' + resolve(outputDir));
