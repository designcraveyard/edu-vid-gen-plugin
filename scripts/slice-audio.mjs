#!/usr/bin/env node
/**
 * slice-audio.mjs
 * Slices full-vo.mp3 into per-clip audio files based on timeline.json.
 * Each slice duration exactly matches the Veo clip duration from the timeline,
 * eliminating all sync workarounds (atempo, adelay, amix complexity).
 *
 * Usage:
 *   node slice-audio.mjs \
 *     --timeline ./audio/timeline.json \
 *     --audio    ./audio/full-vo.mp3 \
 *     --output-dir ./audio
 *
 * Outputs: audio/slice-01.mp3, audio/slice-02.mp3, ... (one per clip in timeline)
 * Requires: ffmpeg
 *
 * After slicing, mix each Veo clip with its slice:
 *   ffmpeg -y -i clips/clip-01.mp4 -i audio/slice-01.mp3 \
 *     -filter_complex "[0:a]volume=0.35[veo];[1:a]volume=1.0[el];[veo][el]amix=inputs=2:duration=longest:normalize=0[aout]" \
 *     -map 0:v -map "[aout]" -c:v copy -c:a aac clips-mixed/clip-01.mp4
 * Then stitch with zero crossfade:
 *   node stitch.mjs --clips-dir clips-mixed --output final.mp4 --overlap 0 --no-audio-xfade
 */

import { execSync }                    from 'child_process';
import { readFileSync, mkdirSync }     from 'fs';
import { resolve, join }               from 'path';

const args = process.argv.slice(2);
const get  = (flag, def = null) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const timelinePath = get('--timeline');
const audioPath    = get('--audio');
const outputDir    = get('--output-dir', './audio');

if (!timelinePath || !audioPath) {
  console.error('Usage: node slice-audio.mjs --timeline ./audio/timeline.json --audio ./audio/full-vo.mp3 --output-dir ./audio');
  process.exit(1);
}

const timeline = JSON.parse(readFileSync(resolve(timelinePath), 'utf8'));
mkdirSync(resolve(outputDir), { recursive: true });

console.log(`Slicing ${timeline.total_clips} audio segments from: ${resolve(audioPath)}`);
console.log(`Output directory: ${resolve(outputDir)}\n`);

let allOk = true;

for (const clip of timeline.clips) {
  const nn      = String(clip.clip).padStart(2, '0');
  const outPath = resolve(join(outputDir, `slice-${nn}.mp3`));

  // -c copy keeps exact bytes from the mp3 stream (fast, no re-encode)
  const cmd = `ffmpeg -y -i "${resolve(audioPath)}" -ss ${clip.audio_start.toFixed(3)} -to ${clip.audio_end.toFixed(3)} -c copy "${outPath}"`;

  try {
    execSync(cmd, { stdio: 'pipe' });
    const sliceDur = (clip.audio_end - clip.audio_start).toFixed(2);
    console.log(`  ✅ slice-${nn}.mp3: ${sliceDur}s  (${clip.audio_start.toFixed(3)}s → ${clip.audio_end.toFixed(3)}s)  [Veo clip: ${clip.duration}s]`);
  } catch (err) {
    console.error(`  ❌ Failed to slice clip ${nn}:`, err.stderr?.toString().trim() || err.message);
    allOk = false;
  }
}

if (!allOk) {
  console.error('\nSome slices failed. Check ffmpeg is installed (brew install ffmpeg).');
  process.exit(1);
}

console.log(`\n✅ All ${timeline.total_clips} slices saved to ${resolve(outputDir)}`);
console.log('\nNext — mix each Veo clip with its slice (Veo SFX 35% + VO 100%):');
console.log('');
console.log('  CLIPS_DIR="clips"');
console.log('  AUDIO_DIR="' + resolve(outputDir) + '"');
console.log('  MIXED_DIR="clips-mixed"');
console.log('  mkdir -p "$MIXED_DIR"');
console.log('');
for (const clip of timeline.clips) {
  const nn = String(clip.clip).padStart(2, '0');
  console.log(`  ffmpeg -y -i "$CLIPS_DIR/clip-${nn}.mp4" -i "$AUDIO_DIR/slice-${nn}.mp3" \\`);
  console.log(`    -filter_complex "[0:a]volume=0.35[veo];[1:a]volume=1.0[el];[veo][el]amix=inputs=2:duration=longest:normalize=0[aout]" \\`);
  console.log(`    -map 0:v -map "[aout]" -c:v copy -c:a aac "$MIXED_DIR/clip-${nn}.mp4"\n`);
}
console.log('Then stitch:');
console.log('  node stitch.mjs --clips-dir "$MIXED_DIR" --output final-elevenlabs-overlay.mp4 --overlap 0 --no-audio-xfade');
