#!/usr/bin/env node
/**
 * generate-zoom.mjs — Ken Burns zoom effect on a still frame
 *
 * Creates a slow zoom-in or zoom-out video from a single image using ffmpeg.
 * Zero API cost — pure ffmpeg. Great for fillers, extenders, and breathing moments.
 *
 * Usage:
 *   node generate-zoom.mjs --input frame-03.jpg --output zoom-03.mp4 --duration 4 --direction in
 *   node generate-zoom.mjs --input frame-03.jpg --output zoom-03.mp4 --duration 4 --direction out
 *   node generate-zoom.mjs --input frame-03.jpg --output zoom-03.mp4 --direction in --focus top
 *
 * Batch mode (all frames in a directory):
 *   node generate-zoom.mjs --dir ./images --output-dir ./zooms --duration 4 --direction in
 *
 * Clip mode (extract first/last frames from video clips, then zoom):
 *   node generate-zoom.mjs --clips-dir ./clips --output-dir ./zooms --duration 4
 *   → Extracts first & last frame from each clip-XX.mp4
 *   → Generates zoom-in on last frame (end extender) + zoom-out on first frame (start extender)
 *
 * Both mode (images + clips together):
 *   node generate-zoom.mjs --dir ./images --clips-dir ./clips --output-dir ./zooms --duration 4
 *
 * Options:
 *   --input       Single input image
 *   --output      Output video path
 *   --dir         Batch mode: directory of images (processes all *.jpg)
 *   --clips-dir   Clip mode: directory of clip-XX.mp4 files (extracts first/last frames)
 *   --output-dir  Batch mode: output directory
 *   --duration    Duration in seconds (default: 4)
 *   --direction   "in" (zoom into center) or "out" (zoom out from center) (default: in)
 *                 In clip mode, both directions are auto-generated (in for last frame, out for first)
 *   --focus       Zoom focus point: center, top, bottom, left, right (default: center)
 *   --speed       Zoom speed multiplier (default: 1.0, higher = more zoom)
 *   --fps         Output framerate (default: 30)
 *   --aspect      Output aspect ratio: "9:16" or "16:9" (default: auto-detect from input)
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, readdirSync } from "fs";
import path from "path";

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function flag(name, def = undefined) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  return args[i + 1];
}
function hasFlag(name) {
  return args.indexOf(`--${name}`) !== -1;
}

const input = flag("input");
const output = flag("output");
const dir = flag("dir");
const clipsDir = flag("clips-dir");
const outputDir = flag("output-dir");
const duration = parseFloat(flag("duration", "4"));
const direction = flag("direction", "in"); // "in" or "out"
const focus = flag("focus", "center"); // center, top, bottom, left, right
const speed = parseFloat(flag("speed", "1.0"));
const fps = parseInt(flag("fps", "30"));
const aspectOverride = flag("aspect");

if (!input && !dir && !clipsDir) {
  console.error("ERROR: Provide --input <image>, --dir <folder>, or --clips-dir <folder>");
  process.exit(1);
}

// ── Check ffmpeg ─────────────────────────────────────────────────────────────

try {
  execSync("which ffmpeg", { stdio: "ignore" });
} catch {
  console.error("ERROR: ffmpeg not found. Install with: brew install ffmpeg");
  process.exit(1);
}

// ── Zoom filter builder ──────────────────────────────────────────────────────

function getImageDimensions(imgPath) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0",
    imgPath,
  ], { encoding: "utf-8" });
  const [w, h] = result.stdout.trim().split(",").map(Number);
  return { w, h };
}

function buildZoomFilter(imgPath, dirOverride) {
  const dir = dirOverride || direction;
  const { w, h } = getImageDimensions(imgPath);

  // Determine output resolution
  let outW, outH;
  if (aspectOverride === "16:9") {
    outW = 1920; outH = 1080;
  } else if (aspectOverride === "9:16") {
    outW = 1080; outH = 1920;
  } else {
    // Auto-detect from image
    if (w > h) { outW = 1920; outH = 1080; }
    else { outW = 1080; outH = 1920; }
  }

  const totalFrames = duration * fps;

  // Zoom range: 1.0 to ~1.15 (subtle, cinematic)
  const zoomAmount = 0.15 * speed;
  const zoomPerFrame = zoomAmount / totalFrames;

  let zoomExpr, xExpr, yExpr;

  if (dir === "in") {
    // Zoom in: start at 1.0, end at 1.0 + zoomAmount
    zoomExpr = `min(1+${zoomPerFrame}*on,${1 + zoomAmount})`;
  } else {
    // Zoom out: start at 1.0 + zoomAmount, end at 1.0
    zoomExpr = `max(${1 + zoomAmount}-${zoomPerFrame}*on,1)`;
  }

  // Focus point determines pan position
  // In zoompan: x and y are the top-left corner of the visible region
  // iw and ih are the input dimensions, zoom is the current zoom level
  switch (focus) {
    case "top":
      xExpr = "iw/2-(iw/zoom/2)";
      yExpr = "0";
      break;
    case "bottom":
      xExpr = "iw/2-(iw/zoom/2)";
      yExpr = "ih-(ih/zoom)";
      break;
    case "left":
      xExpr = "0";
      yExpr = "ih/2-(ih/zoom/2)";
      break;
    case "right":
      xExpr = "iw-(iw/zoom)";
      yExpr = "ih/2-(ih/zoom/2)";
      break;
    case "center":
    default:
      xExpr = "iw/2-(iw/zoom/2)";
      yExpr = "ih/2-(ih/zoom/2)";
      break;
  }

  // zoompan filter: processes the image frame by frame with zoom and pan
  const filter = [
    `scale=${outW * 4}:${outH * 4}`,  // upscale for smooth zoom
    `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${outW}x${outH}:fps=${fps}`,
  ].join(",");

  return { filter, outW, outH };
}

// ── Extract frames from video clips ──────────────────────────────────────────

function getVideoDuration(videoPath) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    videoPath,
  ], { encoding: "utf-8" });
  return parseFloat(result.stdout.trim());
}

function extractFrame(videoPath, timestamp, outPath) {
  const result = spawnSync("ffmpeg", [
    "-y", "-ss", String(timestamp),
    "-i", videoPath,
    "-frames:v", "1",
    "-q:v", "2",
    outPath,
  ], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  return result.status === 0;
}

function extractClipFrames(clipsDirPath, extractDir) {
  if (!existsSync(extractDir)) mkdirSync(extractDir, { recursive: true });

  const clips = readdirSync(clipsDirPath)
    .filter((f) => /^clip-\d+\.mp4$/i.test(f))
    .sort();

  if (clips.length === 0) {
    console.error(`ERROR: No clip-*.mp4 files found in ${clipsDirPath}`);
    return [];
  }

  console.log(`\n🎞️  Extracting first/last frames from ${clips.length} clips...\n`);

  const extracted = [];
  for (const clip of clips) {
    const num = clip.match(/clip-(\d+)/)[1];
    const clipPath = path.join(clipsDirPath, clip);
    const dur = getVideoDuration(clipPath);

    // First frame (at 0.05s to skip any black frame)
    const firstPath = path.join(extractDir, `clip-${num}-first.jpg`);
    // Last frame (0.1s before end to avoid blank)
    const lastPath = path.join(extractDir, `clip-${num}-last.jpg`);

    const okFirst = extractFrame(clipPath, 0.05, firstPath);
    const okLast = extractFrame(clipPath, Math.max(0, dur - 0.1), lastPath);

    if (okFirst) console.log(`   ✅ clip-${num} first frame → ${firstPath}`);
    else console.log(`   ❌ clip-${num} first frame FAILED`);
    if (okLast) console.log(`   ✅ clip-${num} last frame  → ${lastPath}`);
    else console.log(`   ❌ clip-${num} last frame FAILED`);

    extracted.push({ num, firstPath: okFirst ? firstPath : null, lastPath: okLast ? lastPath : null });
  }

  return extracted;
}

// ── Generate single zoom clip ────────────────────────────────────────────────

function generateZoom(imgPath, outPath, dirOverride) {
  const dir = dirOverride || direction;
  if (!existsSync(imgPath)) {
    console.error(`ERROR: Image not found: ${imgPath}`);
    return false;
  }

  const { filter } = buildZoomFilter(imgPath, dir);

  const cmd = [
    "ffmpeg", "-y",
    "-loop", "1",
    "-i", imgPath,
    "-vf", filter,
    "-t", String(duration),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "medium",
    "-crf", "18",
    outPath,
  ];

  console.log(`🎬 Generating ${dir === "in" ? "zoom-in" : "zoom-out"} | ${duration}s | focus: ${focus} | speed: ${speed}x`);
  console.log(`   Input:  ${imgPath}`);
  console.log(`   Output: ${outPath}`);

  const result = spawnSync(cmd[0], cmd.slice(1), {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    console.error(`ERROR: ffmpeg failed:\n${result.stderr}`);
    return false;
  }

  console.log(`   ✅ Done`);
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const outDirPath = outputDir || (dir ? path.join(dir, "zooms") : (clipsDir ? path.join(clipsDir, "..", "zooms") : null));
let totalSuccess = 0;
let totalAttempts = 0;

// ── Image batch mode (--dir) ─────────────────────────────────────────────────

if (dir) {
  if (!existsSync(dir)) {
    console.error(`ERROR: Directory not found: ${dir}`);
    process.exit(1);
  }

  if (!existsSync(outDirPath)) mkdirSync(outDirPath, { recursive: true });

  const images = readdirSync(dir)
    .filter((f) => /^frame-\d+\.jpg$/i.test(f))
    .sort();

  if (images.length === 0) {
    console.error(`ERROR: No frame-*.jpg files found in ${dir}`);
    process.exit(1);
  }

  console.log(`\n📁 Image batch: ${images.length} frames → ${outDirPath}\n`);

  for (const img of images) {
    const num = img.match(/frame-(\d+)/)[1];
    const outName = `zoom-${direction}-frame-${num}.mp4`;
    totalAttempts++;
    if (generateZoom(path.join(dir, img), path.join(outDirPath, outName))) totalSuccess++;
  }
}

// ── Clip mode (--clips-dir) ──────────────────────────────────────────────────

if (clipsDir) {
  if (!existsSync(clipsDir)) {
    console.error(`ERROR: Clips directory not found: ${clipsDir}`);
    process.exit(1);
  }

  if (!existsSync(outDirPath)) mkdirSync(outDirPath, { recursive: true });

  // Extract frames into a temp subfolder
  const extractDir = path.join(outDirPath, "_extracted-frames");
  const extracted = extractClipFrames(clipsDir, extractDir);

  console.log(`\n📁 Clip zoom batch: ${extracted.length} clips → ${outDirPath}\n`);

  for (const { num, firstPath, lastPath } of extracted) {
    // Zoom-OUT on first frame → use as scene opener / start extender
    if (firstPath) {
      totalAttempts++;
      const outName = `zoom-out-clip-${num}-start.mp4`;
      console.log(`\n── Clip ${num} start (zoom-out) ──`);
      if (generateZoom(firstPath, path.join(outDirPath, outName), "out")) totalSuccess++;
    }

    // Zoom-IN on last frame → use as scene closer / end extender
    if (lastPath) {
      totalAttempts++;
      const outName = `zoom-in-clip-${num}-end.mp4`;
      console.log(`\n── Clip ${num} end (zoom-in) ──`);
      if (generateZoom(lastPath, path.join(outDirPath, outName), "in")) totalSuccess++;
    }
  }
}

// ── Single mode (--input) ────────────────────────────────────────────────────

if (!dir && !clipsDir) {
  if (!output) {
    console.error("ERROR: --output is required in single mode");
    process.exit(1);
  }

  const singleOutDir = path.dirname(output);
  if (!existsSync(singleOutDir)) mkdirSync(singleOutDir, { recursive: true });

  const ok = generateZoom(input, output);
  process.exit(ok ? 0 : 1);
}

// ── Summary ──────────────────────────────────────────────────────────────────

if (totalAttempts > 0) {
  console.log(`\n✅ Generated ${totalSuccess}/${totalAttempts} zoom clips in ${outDirPath}`);
  process.exit(totalSuccess === totalAttempts ? 0 : 1);
}
