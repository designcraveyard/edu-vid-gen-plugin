#!/usr/bin/env node
/**
 * rebuild-timeline.mjs
 * Validates and renumbers timeline.json after manual edits.
 * Checks:
 *   - No clip durations outside Veo's 5–8s range
 *   - No large gaps between consecutive clip audio boundaries
 *   - audio_end - audio_start matches declared duration within tolerance
 *
 * Usage: node rebuild-timeline.mjs --timeline ./audio/timeline.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
const get  = (flag, def = null) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const timelinePath = get('--timeline');
if (!timelinePath) {
  console.error('Usage: node rebuild-timeline.mjs --timeline ./audio/timeline.json');
  process.exit(1);
}

const timeline = JSON.parse(readFileSync(resolve(timelinePath), 'utf8'));
const clips    = timeline.clips;
let hasErrors  = false;

console.log(`Validating ${clips.length} clips in ${resolve(timelinePath)}...\n`);

clips.forEach((clip, idx) => {
  // Renumber sequentially
  clip.clip = idx + 1;

  const audioSpan = clip.audio_end - clip.audio_start;
  const warnings  = [];
  const errors    = [];

  // Duration must be in Veo's valid range
  if (clip.duration < 5) errors.push(`duration ${clip.duration}s < Veo min (5s)`);
  if (clip.duration > 8) errors.push(`duration ${clip.duration}s > Veo max (8s)`);

  // Audio span vs declared duration — warn if they differ by more than 1.5s
  if (Math.abs(audioSpan - clip.duration) > 1.5) {
    warnings.push(`audio span ${audioSpan.toFixed(2)}s vs declared duration ${clip.duration}s (diff > 1.5s)`);
  }

  // Gap from previous clip
  if (idx > 0) {
    const gap = clip.audio_start - clips[idx - 1].audio_end;
    if (Math.abs(gap) > 0.1) {
      warnings.push(`${gap > 0 ? 'gap' : 'overlap'} of ${Math.abs(gap).toFixed(3)}s with previous clip`);
    }
  }

  const status = errors.length ? '❌' : warnings.length ? '⚠️ ' : '✅';
  const phrasePreview = (clip.phrases || []).map(p => `"${(p.text || '').slice(0, 30)}"`).join(' | ');
  console.log(`  ${status} Clip ${String(clip.clip).padStart(2)}: ${clip.duration}s  (${clip.audio_start.toFixed(2)}–${clip.audio_end.toFixed(2)}s)`);
  if (phrasePreview) console.log(`         ${phrasePreview}`);
  errors.forEach(e  => { console.log(`         ERROR: ${e}`); hasErrors = true; });
  warnings.forEach(w => console.log(`         WARN:  ${w}`));
});

const totalAudio = clips[clips.length - 1]?.audio_end ?? 0;
const totalVeo   = clips.reduce((sum, c) => sum + c.duration, 0);

// Update summary fields
timeline.total_clips          = clips.length;
timeline.total_audio_duration = parseFloat(totalAudio.toFixed(3));

console.log(`\nTotal audio duration: ${totalAudio.toFixed(1)}s`);
console.log(`Total Veo duration:   ${totalVeo}s  (${clips.length} clips × avg ${(totalVeo / clips.length).toFixed(1)}s)`);

if (hasErrors) {
  console.error('\n❌ Errors found — fix before proceeding to Veo generation.');
  process.exit(1);
}

writeFileSync(resolve(timelinePath), JSON.stringify(timeline, null, 2));
console.log(`\n✅ timeline.json validated and saved: ${resolve(timelinePath)}`);
console.log('\nNext: slice audio at these boundaries:');
console.log(`  node slice-audio.mjs --timeline ${resolve(timelinePath)} --audio <path/to/full-vo.mp3> --output-dir <audio-dir>`);
