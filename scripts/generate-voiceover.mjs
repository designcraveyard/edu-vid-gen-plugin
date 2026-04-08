#!/usr/bin/env node
/**
 * generate-voiceover.mjs — ElevenLabs Text-to-Speech
 * Usage:
 *   node generate-voiceover.mjs --text "..." --output /path/to/vo.mp3 [--voice "Rachel"] [--model "eleven_v3"]
 *   node generate-voiceover.mjs --list-voices
 * Requires: ELEVENLABS_API_KEY env var, ffprobe (optional, for duration reporting)
 */

import { writeFileSync } from 'fs';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const get = (flag, def = null) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
const has = (flag) => args.includes(flag);

const API_KEY = process.env.ELEVENLABS_API_KEY;
const BASE    = 'https://api.elevenlabs.io/v1';

if (!API_KEY) {
  console.error('Error: ELEVENLABS_API_KEY environment variable is not set.');
  console.error('Set it with: export ELEVENLABS_API_KEY="your-key-here"');
  process.exit(1);
}

// ── Well-known voice shortcuts ──────────────────────────────────────
const VOICE_SHORTCUTS = {
  'rachel':  '21m00Tcm4TlvDq8ikWAM',
  'adam':    'pNInz6obpgDQGcFmaJgB',
  'bella':   'EXAVITQu4vr4xnSDxMaL',
  // Indian voices (ElevenLabs voice library)
  'manav':   '6MoEUz34rbRrmmyxgRm4',   // warm charming Indian male — storytelling
  'adarsh':  'Y6nOpHQlW4lnf9GRRc8f',   // emotive Hindi, depth & warmth
  'laksh':   'X0Kc6dUd5Kws5uwEyOnL',   // soft young Indian, child-friendly
  'viraj':   '3AMU7jXQuQa3oRvRqUmb',   // expressive storyteller, rich modulation
  'anika':   'ecp3DWciuUyW7BYM7II1',   // Anika — animated friendly Indian female (default Hinglish)
  'kuber':   'Fp5Srt21KB9q0OUBvpZv',   // deep warm Indian social media style
  'nina':    'GUskjoz2EB74Wamu3r3D',   // Nina — warm Indian female
};

// ── Helper: fetch with auth ─────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'xi-api-key': API_KEY,
      ...options.headers,
    },
  });
  return res;
}

// ── List voices mode ────────────────────────────────────────────────
if (has('--list-voices')) {
  const formatVoice = (v, source = '') => {
    const labels = v.labels || {};
    const accent = labels.accent || 'unknown';
    const gender = labels.gender || '?';
    const desc = labels.description || '';
    const useCase = labels.use_case || '';
    const tag = source ? ` [${source}]` : '';
    return `  ${v.name.padEnd(22)} ${v.voice_id}  ${gender.padEnd(8)} accent: ${accent.padEnd(12)} ${desc} ${useCase ? `(${useCase})` : ''}${tag}`;
  };

  // Step 1: Fetch "My Voices" first (user's own cloned/saved voices)
  console.log('Fetching your voices...\n');
  let myVoices = [];
  try {
    const myRes = await apiFetch('/voices?show_legacy=false');
    if (myRes.ok) {
      const myData = await myRes.json();
      myVoices = (myData.voices || []).filter(v => {
        const cat = (v.category || '').toLowerCase();
        return cat === 'cloned' || cat === 'generated' || cat === 'professional';
      });
    }
  } catch (e) { /* ignore, fall through */ }

  if (myVoices.length > 0) {
    console.log(`⭐ Your voices (${myVoices.length}):`);
    myVoices.forEach(v => console.log(formatVoice(v, v.category)));
    console.log('');
    console.log(`Total: ${myVoices.length} personal voices.\n`);
    console.log('Usage: --voice "Name" or --voice "voice_id"');
    process.exit(0);
  }

  // Step 2: No personal voices — fetch all voices, show Indian-accent ones first
  console.log('No personal voices found. Fetching all available voices...\n');
  const res = await apiFetch('/voices');

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`API error (${res.status}):`, JSON.stringify(err, null, 2));
    process.exit(1);
  }

  const data = await res.json();
  const voices = data.voices || [];

  if (voices.length === 0) {
    console.error('No voices found. Check your API key and account.');
    process.exit(1);
  }

  // Separate Indian-accented voices from others
  const indianVoices = voices.filter(v => {
    const labels = v.labels || {};
    const accent = (labels.accent || '').toLowerCase();
    const desc = (labels.description || '').toLowerCase();
    return accent.includes('indian') || accent.includes('hindi') || desc.includes('indian');
  });

  const otherVoices = voices.filter(v => !indianVoices.includes(v));

  if (indianVoices.length > 0) {
    console.log(`🇮🇳 Indian voices (${indianVoices.length}):`);
    indianVoices.forEach(v => console.log(formatVoice(v)));
    console.log('');
  }

  console.log(`🌍 All other voices (${otherVoices.length}):`);
  otherVoices.slice(0, 30).forEach(v => console.log(formatVoice(v)));
  if (otherVoices.length > 30) {
    console.log(`  ... and ${otherVoices.length - 30} more`);
  }

  console.log(`\nTotal: ${voices.length} voices available.`);
  console.log('Usage: --voice "Name" or --voice "voice_id"');
  process.exit(0);
}

// ── Generate voiceover mode ─────────────────────────────────────────
const text       = get('--text');
const output     = get('--output');
const voiceIn    = get('--voice', 'Rachel');
const model      = get('--model', 'eleven_v3');
const stability  = parseFloat(get('--stability', '0.65'));   // 0.45=max expressive, 0.65=natural, 0.75=robust
const speed      = parseFloat(get('--speed', '0.95'));       // slightly slower for clarity
const language   = get('--language', 'hi');                  // "hi" for Hinglish/Hindi code-switching
const prevText   = get('--prev-text', null);                 // context from previous segment for prosody continuity
const nextText   = get('--next-text', null);                 // context of next segment
const dictId     = get('--dict-id', null);                   // pronunciation dictionary ID (from ElevenLabs dashboard)
const dictVersion = get('--dict-version', null);             // pronunciation dictionary version_id

if (!text || !output) {
  console.error('Usage: node generate-voiceover.mjs --text "..." --output <path> [--voice "Rachel"] [--model "eleven_v3"]');
  console.error('   or: node generate-voiceover.mjs --list-voices');
  process.exit(1);
}

// ── Resolve voice name → voice_id ───────────────────────────────────
let voiceId;

// Check if it looks like a voice ID (hex string, 20+ chars)
if (/^[a-zA-Z0-9]{20,}$/.test(voiceIn)) {
  voiceId = voiceIn;
  console.log(`Using voice ID: ${voiceId}`);
} else if (VOICE_SHORTCUTS[voiceIn.toLowerCase()]) {
  voiceId = VOICE_SHORTCUTS[voiceIn.toLowerCase()];
  console.log(`Using voice: ${voiceIn} (${voiceId})`);
} else {
  // Resolve by name via API
  console.log(`Resolving voice name: "${voiceIn}"...`);
  const res = await apiFetch('/voices');
  if (!res.ok) {
    console.error(`Failed to fetch voices (${res.status}). Using Rachel as fallback.`);
    voiceId = VOICE_SHORTCUTS['rachel'];
  } else {
    const data = await res.json();
    const match = (data.voices || []).find(v => v.name.toLowerCase() === voiceIn.toLowerCase());
    if (match) {
      voiceId = match.voice_id;
      console.log(`Resolved: ${match.name} → ${voiceId}`);
    } else {
      console.error(`Voice "${voiceIn}" not found. Available voices:`);
      (data.voices || []).slice(0, 10).forEach(v => console.error(`  - ${v.name} (${v.voice_id})`));
      console.error('Use --list-voices to see all options.');
      process.exit(1);
    }
  }
}

// ── Call TTS API ────────────────────────────────────────────────────
console.log(`Generating voiceover (model: ${model}, voice: ${voiceIn})...`);
console.log(`Text: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

const ttsBody = {
  text,
  model_id: model,
  language_code: language,   // enables proper Hinglish / Hindi code-switching
  voice_settings: {
    stability,               // 0.65 = Natural mode: allows audio tags to work, prevents robotic delivery
    similarity_boost: 0.75,  // sweet spot — keeps voice identity without artifacts
    style: 0.0,              // keep at 0: ElevenLabs recommends 0 for most use cases
    use_speaker_boost: true, // enhances clarity for educational/children's content
    speed,                   // 0.95 = slightly slower for clear articulation
  },
  // Prosody context — only supported on non-v3 models (eleven_multilingual_v2, etc.)
  // eleven_v3 returns 400 if these are included
  ...(prevText && model !== 'eleven_v3' && { previous_text: prevText }),
  ...(nextText && model !== 'eleven_v3' && { next_text: nextText }),
  // Pronunciation dictionary — requires pronunciation_dictionaries_read/write permission on API key
  // Usage: --dict-id <id> --dict-version <version_id>
  // Create dictionaries at: elevenlabs.io → Dashboard → Pronunciation Dictionaries
  ...(dictId && dictVersion && {
    pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: dictId, version_id: dictVersion }]
  }),
};

let res;
try {
  res = await apiFetch(`/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify(ttsBody),
  });
} catch (err) {
  console.error('Network error:', err.message);
  process.exit(1);
}

// Handle errors with retry for rate limits
if (!res.ok) {
  if (res.status === 429) {
    console.warn('Rate limited. Waiting 10s and retrying...');
    await new Promise(r => setTimeout(r, 10000));
    try {
      res = await apiFetch(`/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify(ttsBody),
      });
    } catch (err) {
      console.error('Retry failed:', err.message);
      process.exit(1);
    }
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    if (res.status === 401) {
      console.error('Error 401: Invalid ELEVENLABS_API_KEY. Check your key.');
    } else if (res.status === 422) {
      console.error('Error 422: Validation error —', errBody);
    } else {
      console.error(`API error (${res.status}):`, errBody);
    }
    process.exit(1);
  }
}

// ── Save audio file ─────────────────────────────────────────────────
const arrayBuf = await res.arrayBuffer();
const buffer = Buffer.from(arrayBuf);
writeFileSync(output, buffer);

const sizeKB = (buffer.length / 1024).toFixed(1);

// ── Probe duration (optional) ───────────────────────────────────────
let duration = null;
try {
  const probeOut = execSync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${output}"`,
    { encoding: 'utf-8' }
  );
  duration = parseFloat(probeOut.trim());
} catch {
  // ffprobe not available — skip duration
}

if (duration) {
  console.log(`Saved: ${output} (${duration.toFixed(1)}s, ${sizeKB} KB)`);
} else {
  console.log(`Saved: ${output} (${sizeKB} KB) — install ffprobe for duration info`);
}
