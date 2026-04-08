import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { execFileSync } from 'child_process';
import type { ProjectData, PipelineMetadata, PipelineTimeline } from './types';

function probeDuration(filePath: string): number {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'stream=duration',
      '-select_streams', 'v:0',
      '-of', 'csv=p=0',
      filePath,
    ], { encoding: 'utf-8' });
    const dur = parseFloat(out.trim());
    if (!isNaN(dur) && dur > 0) return dur;
  } catch {}
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath,
    ], { encoding: 'utf-8' });
    return parseFloat(out.trim()) || 0;
  } catch {
    return 0;
  }
}

/** Extract clip number from filename like clip-01.mp4, ac-03.mp4, tc-02.mp4, slice-05.mp3, vo-01.mp3 */
function extractClipNum(filename: string): number {
  const m = filename.match(/(?:clip|ac|tc|slice|vo)-(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Generate a minimal metadata.json from timeline.json when the real one is missing.
 * This allows the editor to open in-progress projects.
 */
function synthesizeMetadata(projectDir: string, timeline: PipelineTimeline): PipelineMetadata {
  const folderName = basename(projectDir);
  // Try to extract topic from folder name: "topic-slug-20260404-002252" → "topic slug"
  const topicMatch = folderName.match(/^(.+?)-\d{8}-\d{6}$/);
  const topic = topicMatch
    ? topicMatch[1].replace(/-v\d+$/, '').replace(/-/g, ' ')
    : folderName;

  const clipsDir = join(projectDir, 'clips');
  const clipFiles = existsSync(clipsDir)
    ? readdirSync(clipsDir).filter(f => /^(clip|ac)-\d+\.mp4$/.test(f)).sort()
    : [];

  return {
    project: {
      topic,
      class: '',
      duration_seconds: timeline.total_audio_duration || 0,
      aspect_ratio: '16:9',
      output_dir: projectDir,
    },
    clips: clipFiles.map(f => ({
      file: `clips/${f}`,
      model: 'veo-3.1-fast-generate-001',
      duration: probeDuration(join(clipsDir, f)),
      mode: 'image-to-video',
    })),
    final_videos: {},
  };
}

export function loadProject(projectDir: string): ProjectData {
  const metaPath = join(projectDir, 'metadata.json');
  const timelinePath = join(projectDir, 'audio', 'timeline.json');

  if (!existsSync(timelinePath)) throw new Error(`audio/timeline.json not found in ${projectDir}`);

  const timeline: PipelineTimeline = JSON.parse(readFileSync(timelinePath, 'utf-8'));

  // metadata.json is optional — synthesize from timeline if missing (in-progress projects)
  const metadata: PipelineMetadata = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf-8'))
    : synthesizeMetadata(projectDir, timeline);

  const clipsDir = join(projectDir, 'clips');
  const audioDir = join(projectDir, 'audio');
  const tcDir = join(projectDir, 'clips-transition');

  // ── Video clips: match clip-XX.mp4 AND ac-XX.mp4 ──────────────────────────
  const videoFiles = existsSync(clipsDir)
    ? readdirSync(clipsDir)
        .filter(f => /^(clip|ac)-\d+\.mp4$/.test(f))
        .sort((a, b) => extractClipNum(a) - extractClipNum(b))
        .map(f => ({
          name: f,
          path: join(clipsDir, f),
          duration: probeDuration(join(clipsDir, f)),
          clipNum: extractClipNum(f),
        }))
    : [];

  // ── Transition clips: tc-XX.mp4 from clips-transition/ ────────────────────
  const tcFiles = existsSync(tcDir)
    ? readdirSync(tcDir)
        .filter(f => /^tc-\d+\.mp4$/.test(f))
        .sort((a, b) => extractClipNum(a) - extractClipNum(b))
        .map(f => ({
          name: f,
          path: join(tcDir, f),
          duration: probeDuration(join(tcDir, f)),
          clipNum: extractClipNum(f),
        }))
    : [];

  // ── Audio slices: match vo-XX.mp3 AND slice-XX.mp3 ────────────────────────
  const audioFiles = existsSync(audioDir)
    ? readdirSync(audioDir)
        .filter(f => /^(vo|slice)-\d+\.mp3$/.test(f))
        .sort((a, b) => extractClipNum(a) - extractClipNum(b))
        .map(f => ({
          name: f,
          path: join(audioDir, f),
          duration: probeDuration(join(audioDir, f)),
          clipNum: extractClipNum(f),
        }))
    : [];

  // ── Ambient audio: check timeline.json and common locations ────────────────
  let ambientFile: { name: string; path: string; duration: number } | null = null;
  const timelineAny = timeline as unknown as Record<string, unknown>;
  const ambientRef = timelineAny.ambient as { path?: string } | undefined;
  if (ambientRef?.path) {
    const absAmbient = ambientRef.path.startsWith('/')
      ? ambientRef.path
      : join(projectDir, ambientRef.path);
    if (existsSync(absAmbient)) {
      ambientFile = {
        name: basename(absAmbient),
        path: absAmbient,
        duration: probeDuration(absAmbient),
      };
    }
  }
  // Fallback: check audio/ambient.mp3
  if (!ambientFile) {
    const fallbackAmbient = join(audioDir, 'ambient.mp3');
    if (existsSync(fallbackAmbient)) {
      ambientFile = {
        name: 'ambient.mp3',
        path: fallbackAmbient,
        duration: probeDuration(fallbackAmbient),
      };
    }
  }

  return {
    projectDir,
    metadata,
    timeline,
    videoFiles,
    audioFiles,
    tcFiles,
    ambientFile,
  };
}
