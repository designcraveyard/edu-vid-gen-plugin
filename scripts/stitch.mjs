#!/usr/bin/env node
/**
 * stitch.mjs
 * Usage: node stitch.mjs --clips-dir /path/clips --output /path/final.mp4 [--audio-dir /path/audio]
 * Requires: ffmpeg installed (brew install ffmpeg)
 *
 * --audio-dir: directory with vo-01.mp3, vo-02.mp3, etc.
 *   When provided, each clip is pre-mixed with its matching voiceover before stitching.
 */

import { readdirSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, resolve } from 'path';

const args = process.argv.slice(2);
const get = (flag, def = null) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const clipsDir       = get('--clips-dir');
const output         = get('--output');
const overlap        = parseFloat(get('--overlap', '0.5'));  // seconds of crossfade overlap (default 0.5s)
const audioDir       = get('--audio-dir');                   // optional: directory with vo-NN.mp3 files
const noAudioXfade   = args.includes('--no-audio-xfade');    // hard-cut audio concat, lets each clip's audio complete fully

if (!clipsDir || !output) {
  console.error('Usage: node stitch.mjs --clips-dir <path> --output <path> [--overlap 1] [--audio-dir <path>]');
  process.exit(1);
}

// ── Helper: probe duration of a media file ──────────────────────────
// Uses video-stream duration when available (important for clips where audio track
// extends beyond video — prevents xfade offsets from being calculated on audio duration)
function probeDuration(filePath) {
  try {
    const vOut = execSync(
      `ffprobe -v quiet -show_entries stream=duration -select_streams v:0 -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8' }
    );
    const vDur = parseFloat(vOut.trim());
    if (!isNaN(vDur) && vDur > 0) return vDur;
  } catch { /* fall through */ }
  try {
    const out = execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`, { encoding: 'utf-8' });
    return parseFloat(out.trim());
  } catch {
    return null;
  }
}

// Find all clip-*.mp4 files sorted alphabetically
let clips = readdirSync(clipsDir)
  .filter(f => f.match(/^clip-\d+\.mp4$/))
  .sort()
  .map(f => resolve(join(clipsDir, f)));

if (clips.length === 0) {
  console.error('No clip-*.mp4 files found in:', clipsDir);
  process.exit(1);
}

console.log(`Found ${clips.length} clips:`);
clips.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));

// ── Pre-mix voiceover audio with each clip (if --audio-dir provided) ──
if (audioDir) {
  const voFiles = readdirSync(audioDir)
    .filter(f => f.match(/^vo-\d+\.mp3$/))
    .sort()
    .map(f => resolve(join(audioDir, f)));

  if (voFiles.length === 0) {
    console.warn(`Warning: --audio-dir provided but no vo-*.mp3 files found in: ${audioDir}`);
    console.warn('Proceeding without voiceover.\n');
  } else {
    console.log(`\nMixing voiceover audio with clips (${voFiles.length} audio files):`);

    const mixedClips = [];

    for (let i = 0; i < clips.length; i++) {
      const clipPath = clips[i];
      const nn = String(i + 1).padStart(2, '0');
      const voPath = voFiles[i]; // may be undefined if fewer audio files than clips

      if (!voPath || !existsSync(voPath)) {
        // No matching voiceover — add silent audio track so stitch works
        console.log(`  clip-${nn}: no matching vo-${nn}.mp3 — adding silent audio`);
        const silentOut = resolve(join(clipsDir, `clip-${nn}-mixed.mp4`));
        execSync(
          `ffmpeg -y -i "${clipPath}" -f lavfi -i anullsrc=r=48000:cl=stereo -c:v copy -c:a aac -shortest "${silentOut}"`,
          { stdio: 'pipe' }
        );
        mixedClips.push(silentOut);
        continue;
      }

      const clipDur = probeDuration(clipPath) || 8;
      const voDur = probeDuration(voPath) || clipDur;
      const mixedOut = resolve(join(clipsDir, `clip-${nn}-mixed.mp4`));

      let audioFilter = '';

      if (voDur > clipDur * 1.15) {
        // Audio much longer than video — speed up audio (max 1.15x)
        const tempo = Math.min(voDur / clipDur, 1.15);
        audioFilter = `-filter:a "atempo=${tempo.toFixed(3)}"`;
        console.log(`  clip-${nn}: vo ${voDur.toFixed(1)}s > clip ${clipDur.toFixed(1)}s — speeding audio ${tempo.toFixed(2)}x`);
      } else if (voDur > clipDur) {
        // Audio slightly longer — speed up
        const tempo = voDur / clipDur;
        audioFilter = `-filter:a "atempo=${tempo.toFixed(3)}"`;
        console.log(`  clip-${nn}: vo ${voDur.toFixed(1)}s > clip ${clipDur.toFixed(1)}s — speeding audio ${tempo.toFixed(2)}x`);
      } else {
        console.log(`  clip-${nn}: vo ${voDur.toFixed(1)}s ≤ clip ${clipDur.toFixed(1)}s — mixing as-is`);
      }

      // Mix: take video from clip, audio from voiceover
      // -shortest removed: let audio complete naturally even if slightly > clip duration
      const mixCmd = `ffmpeg -y -i "${clipPath}" -i "${voPath}" -map 0:v -map 1:a ${audioFilter} -c:v copy -c:a aac "${mixedOut}"`;
      try {
        execSync(mixCmd, { stdio: 'pipe' });
      } catch (err) {
        console.error(`  Failed to mix clip-${nn}:`, err.message);
        console.error('  Falling back to silent clip.');
        execSync(
          `ffmpeg -y -i "${clipPath}" -f lavfi -i anullsrc=r=48000:cl=stereo -c:v copy -c:a aac -shortest "${mixedOut}"`,
          { stdio: 'pipe' }
        );
      }
      mixedClips.push(mixedOut);
    }

    // Replace clips array with mixed versions for stitching
    clips = mixedClips;
    console.log(`\nAll clips mixed with voiceover. Proceeding to stitch.\n`);
  }
}

console.log(`Stitching ${clips.length} clips:`);
clips.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));

// Build ffmpeg command
let cmd;

if (overlap > 0 && clips.length > 1) {
  // Use xfade filter for video crossfade transitions
  const xfadeMode = noAudioXfade ? 'hard-cut audio (--no-audio-xfade)' : 'audio crossfade';
  console.log(`\nUsing ${overlap}s video crossfade, ${xfadeMode}\n`);

  const inputs = clips.map(c => `-i "${c}"`).join(' ');
  const filterParts = [];
  const n = clips.length;

  // Probe actual clip durations
  const durations = clips.map(c => probeDuration(c) || 8);
  console.log('Clip durations:', durations.map((d, i) => `clip-${String(i+1).padStart(2,'0')}: ${d.toFixed(2)}s`).join(', '));

  if (noAudioXfade) {
    // ── Video: xfade chain ────────────────────────────────────────────
    for (let i = 0; i < n - 1; i++) {
      const vIn  = i === 0 ? '[0:v]' : `[v${i}]`;
      const vOut = i === n - 2 ? '[vout]' : `[v${i + 1}]`;
      const offset = durations.slice(0, i + 1).reduce((a, b) => a + b, 0) - (i + 1) * overlap;
      filterParts.push(`${vIn}[${i + 1}:v]xfade=transition=fade:duration=${overlap}:offset=${offset}${vOut}`);
    }

    // ── Audio: hard-cut concat (each clip's audio plays fully, no blending) ─
    // Each audio stream is labeled [0:a], [1:a], ... then fed into concat
    const audioInputs = Array.from({ length: n }, (_, i) => `[${i}:a]`).join('');
    filterParts.push(`${audioInputs}concat=n=${n}:v=0:a=1[aout]`);

  } else {
    // ── Original: xfade video + acrossfade audio ──────────────────────
    for (let i = 0; i < n - 1; i++) {
      const vIn  = i === 0 ? '[0:v]' : `[v${i}]`;
      const vOut = i === n - 2 ? '[vout]' : `[v${i + 1}]`;
      const aIn  = i === 0 ? '[0:a]' : `[a${i}]`;
      const aOut = i === n - 2 ? '[aout]' : `[a${i + 1}]`;
      const offset = durations.slice(0, i + 1).reduce((a, b) => a + b, 0) - (i + 1) * overlap;
      filterParts.push(`${vIn}[${i + 1}:v]xfade=transition=fade:duration=${overlap}:offset=${offset}${vOut}`);
      filterParts.push(`${aIn}[${i + 1}:a]acrossfade=d=${overlap}${aOut}`);
    }
  }

  const filterComplex = filterParts.join(';');
  cmd = `ffmpeg -y ${inputs} -filter_complex "${filterComplex}" -map "[vout]" -map "[aout]" -c:v libx264 -preset fast -crf 18 -c:a aac "${resolve(output)}"`;
} else {
  // Simple concat (no overlap)
  const concatList = clips.map(c => `file '${c}'`).join('\n');
  const concatFile = '/tmp/edu_video_concat.txt';
  writeFileSync(concatFile, concatList);
  cmd = `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c copy "${resolve(output)}"`;
}

console.log(`Running: ${cmd}\n`);

try {
  execSync(cmd, { stdio: 'inherit' });
  console.log(`\nDone! Output: ${resolve(output)}`);
} catch (err) {
  console.error('ffmpeg failed:', err.message);
  process.exit(1);
}
