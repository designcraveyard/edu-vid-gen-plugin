import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { EditedTimeline, VideoClipEdit, VOClipEdit } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function probeDuration(filePath: string): number {
  try {
    const out = execSync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8' }
    );
    return parseFloat(out.trim()) || 0;
  } catch {
    return 0;
  }
}

/** Resolve a path that may be absolute or relative-to-projectDir */
function resolvePath(projectDir: string, file: string): string {
  if (path.isAbsolute(file)) return file;
  return path.join(projectDir, file);
}

/** Seconds → milliseconds string for adelay, e.g. "3200|3200" */
function toAdelayMs(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  return `${ms}|${ms}`;
}

/** Write a concat demuxer list file and return its path */
function writeConcatList(tmpDir: string, files: string[]): string {
  const listPath = path.join(tmpDir, 'concat-list.txt');
  const content = files.map((f) => `file '${f}'`).join('\n');
  fs.writeFileSync(listPath, content, 'utf-8');
  return listPath;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function renderFromEditedTimeline(projectDir: string): string {
  // 1. Read edited-timeline.json
  const timelinePath = path.join(projectDir, 'edited-timeline.json');
  if (!fs.existsSync(timelinePath)) {
    throw new Error(`edited-timeline.json not found in ${projectDir}`);
  }
  const timeline: EditedTimeline = JSON.parse(
    fs.readFileSync(timelinePath, 'utf-8')
  );

  const outputPath = path.join(projectDir, 'final-edited.mp4');
  const tmpDir = path.join(projectDir, '_render-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  const videoClips: VideoClipEdit[] = timeline.tracks.video;
  const voClips: VOClipEdit[] = timeline.tracks.voiceover;

  try {
    if (videoClips.length === 0) {
      throw new Error('No video clips in timeline');
    }

    // -----------------------------------------------------------------------
    // Single-clip fast path
    // -----------------------------------------------------------------------
    if (videoClips.length === 1) {
      renderSingleClip(projectDir, videoClips[0], voClips, outputPath);
      return outputPath;
    }

    // -----------------------------------------------------------------------
    // Detect whether any clip has a non-cut transition out
    // -----------------------------------------------------------------------
    const hasXfade = videoClips.some(
      (c) => c.transitionOut && c.transitionOut.type !== 'cut'
    );

    if (hasXfade) {
      renderWithXfade(projectDir, tmpDir, videoClips, voClips, outputPath);
    } else {
      renderWithConcat(projectDir, tmpDir, videoClips, voClips, outputPath);
    }

    return outputPath;
  } finally {
    // Clean up temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Single-clip renderer
// ---------------------------------------------------------------------------

function renderSingleClip(
  projectDir: string,
  clip: VideoClipEdit,
  voClips: VOClipEdit[],
  outputPath: string
): void {
  const clipFile = resolvePath(projectDir, clip.file);
  const trimDuration = clip.trimEnd - clip.trimStart;

  if (voClips.length === 0) {
    // No VO — add silent audio
    const cmd = [
      'ffmpeg -y',
      `-ss ${clip.trimStart} -t ${trimDuration} -i "${clipFile}"`,
      '-f lavfi -i anullsrc=r=48000:cl=stereo',
      '-map 0:v -map 1:a',
      '-c:v libx264 -preset fast -crf 18',
      '-c:a aac -shortest',
      `"${outputPath}"`,
    ].join(' ');
    execSync(cmd, { stdio: 'pipe' });
  } else if (voClips.length === 1) {
    const voFile = resolvePath(projectDir, voClips[0].file);
    const cmd = [
      'ffmpeg -y',
      `-ss ${clip.trimStart} -t ${trimDuration} -i "${clipFile}"`,
      `-i "${voFile}"`,
      '-map 0:v -map 1:a',
      '-c:v libx264 -preset fast -crf 18',
      '-c:a aac -shortest',
      `"${outputPath}"`,
    ].join(' ');
    execSync(cmd, { stdio: 'pipe' });
  } else {
    // Multiple VO segments — use adelay + amix
    const voArgs = voClips
      .map((v) => `-i "${resolvePath(projectDir, v.file)}"`)
      .join(' ');

    const adelayFilters = voClips
      .map(
        (v, i) =>
          `[${i + 1}:a]adelay=${toAdelayMs(v.timelineOffset)}[a${i}]`
      )
      .join(';');

    const amixInputs = voClips.map((_, i) => `[a${i}]`).join('');
    const amixFilter = `${amixInputs}amix=inputs=${voClips.length}:duration=longest[aout]`;

    const filterComplex = `${adelayFilters};${amixFilter}`;

    const cmd = [
      'ffmpeg -y',
      `-ss ${clip.trimStart} -t ${trimDuration} -i "${clipFile}"`,
      voArgs,
      `-filter_complex "${filterComplex}"`,
      '-map 0:v -map "[aout]"',
      '-c:v libx264 -preset fast -crf 18',
      '-c:a aac -shortest',
      `"${outputPath}"`,
    ].join(' ');
    execSync(cmd, { stdio: 'pipe' });
  }
}

// ---------------------------------------------------------------------------
// Multi-clip concat (no xfade transitions)
// ---------------------------------------------------------------------------

function renderWithConcat(
  projectDir: string,
  tmpDir: string,
  videoClips: VideoClipEdit[],
  voClips: VOClipEdit[],
  outputPath: string
): void {
  // Step 1: Re-encode each trimmed clip to a temp file
  const tempClipPaths: string[] = [];

  for (let i = 0; i < videoClips.length; i++) {
    const clip = videoClips[i];
    const srcFile = resolvePath(projectDir, clip.file);
    const trimDuration = clip.trimEnd - clip.trimStart;
    const tempPath = path.join(tmpDir, `clip-${String(i).padStart(2, '0')}.mp4`);

    const cmd = [
      'ffmpeg -y',
      `-ss ${clip.trimStart} -t ${trimDuration} -i "${srcFile}"`,
      '-c:v libx264 -preset fast -crf 18',
      '-an',
      `"${tempPath}"`,
    ].join(' ');
    execSync(cmd, { stdio: 'pipe' });
    tempClipPaths.push(tempPath);
  }

  // Step 2: Concat video-only
  const listPath = writeConcatList(tmpDir, tempClipPaths);
  const concatVideoPath = path.join(tmpDir, 'concat-video.mp4');
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${concatVideoPath}"`,
    { stdio: 'pipe' }
  );

  // Step 3: Mix VO on top
  mixVoiceover(concatVideoPath, projectDir, voClips, outputPath);
}

// ---------------------------------------------------------------------------
// Multi-clip xfade renderer
// ---------------------------------------------------------------------------

function renderWithXfade(
  projectDir: string,
  tmpDir: string,
  videoClips: VideoClipEdit[],
  voClips: VOClipEdit[],
  outputPath: string
): void {
  // Build ffmpeg inputs
  const inputs: string[] = videoClips.map((clip) => {
    const srcFile = resolvePath(projectDir, clip.file);
    const trimDuration = clip.trimEnd - clip.trimStart;
    return `-ss ${clip.trimStart} -t ${trimDuration} -i "${srcFile}"`;
  });

  // Build xfade filter chain
  // offset = sum of (trimmed durations up to clip i) minus cumulative transition durations
  const filterParts: string[] = [];
  let prevLabel = '[0:v]';
  let cumulativeOffset = 0; // total timeline offset into the stitched video

  for (let i = 0; i < videoClips.length - 1; i++) {
    const clip = videoClips[i];
    const trimDuration = clip.trimEnd - clip.trimStart;
    cumulativeOffset += trimDuration;

    const transition = clip.transitionOut;
    const transType =
      transition && transition.type !== 'cut' ? transition.type : 'fade';
    const transDur =
      transition && transition.type !== 'cut' ? transition.duration : 0;

    // xfade offset: when the transition should start (relative to start of stitched output)
    const xfadeOffset = cumulativeOffset - transDur;
    const nextLabel =
      i === videoClips.length - 2 ? '[vout]' : `[v${i + 1}]`;

    filterParts.push(
      `${prevLabel}[${i + 1}:v]xfade=transition=${transType}:duration=${transDur}:offset=${xfadeOffset}${nextLabel}`
    );
    prevLabel = nextLabel;

    // Subtract this transition duration from the next clip's contribution
    cumulativeOffset -= transDur;
  }

  // If only one clip ended up with no transition (edge case), label it
  const filterComplex =
    filterParts.length > 0 ? filterParts.join(';') : `[0:v]copy[vout]`;

  const videoOnlyPath = path.join(tmpDir, 'xfade-video.mp4');
  const cmd = [
    'ffmpeg -y',
    inputs.join(' '),
    `-filter_complex "${filterComplex}"`,
    '-map "[vout]"',
    '-c:v libx264 -preset fast -crf 18',
    '-an',
    `"${videoOnlyPath}"`,
  ].join(' ');
  execSync(cmd, { stdio: 'pipe' });

  // Mix VO on top of the stitched video
  mixVoiceover(videoOnlyPath, projectDir, voClips, outputPath);
}

// ---------------------------------------------------------------------------
// VO mixing helper — takes a video-only file and mixes VO segments onto it
// ---------------------------------------------------------------------------

function mixVoiceover(
  videoOnlyPath: string,
  projectDir: string,
  voClips: VOClipEdit[],
  outputPath: string
): void {
  if (voClips.length === 0) {
    // Add silent track
    execSync(
      [
        'ffmpeg -y',
        `-i "${videoOnlyPath}"`,
        '-f lavfi -i anullsrc=r=48000:cl=stereo',
        '-map 0:v -map 1:a',
        '-c:v copy -c:a aac -shortest',
        `"${outputPath}"`,
      ].join(' '),
      { stdio: 'pipe' }
    );
    return;
  }

  if (voClips.length === 1) {
    const voFile = resolvePath(projectDir, voClips[0].file);
    const delayMs = toAdelayMs(voClips[0].timelineOffset);
    execSync(
      [
        'ffmpeg -y',
        `-i "${videoOnlyPath}"`,
        `-i "${voFile}"`,
        `-filter_complex "[1:a]adelay=${delayMs}[aout]"`,
        '-map 0:v -map "[aout]"',
        '-c:v copy -c:a aac -shortest',
        `"${outputPath}"`,
      ].join(' '),
      { stdio: 'pipe' }
    );
    return;
  }

  // Multiple VO segments
  const voInputArgs = voClips
    .map((v) => `-i "${resolvePath(projectDir, v.file)}"`)
    .join(' ');

  const adelayParts = voClips
    .map(
      (v, i) =>
        `[${i + 1}:a]adelay=${toAdelayMs(v.timelineOffset)}[a${i}]`
    )
    .join(';');

  const amixInputLabels = voClips.map((_, i) => `[a${i}]`).join('');
  const amixFilter = `${amixInputLabels}amix=inputs=${voClips.length}:duration=longest[aout]`;

  const filterComplex = `${adelayParts};${amixFilter}`;

  execSync(
    [
      'ffmpeg -y',
      `-i "${videoOnlyPath}"`,
      voInputArgs,
      `-filter_complex "${filterComplex}"`,
      '-map 0:v -map "[aout]"',
      '-c:v copy -c:a aac -shortest',
      `"${outputPath}"`,
    ].join(' '),
    { stdio: 'pipe' }
  );
}
