#!/usr/bin/env node
/**
 * enhance-for-print.mjs — Prepare AI-generated images for professional print
 *
 * Usage:
 *   node enhance-for-print.mjs --input frame-01.jpg --output frame-01-print.tiff [--dpi 300] [--format tiff]
 *   node enhance-for-print.mjs --dir ./images --output-dir ./print [--dpi 300] [--format tiff]
 *
 * What it does:
 *   1. Upscales to target DPI (default 300) at the original aspect ratio
 *   2. Converts color profile from sRGB → CMYK (using ImageMagick's built-in CMYK profile)
 *   3. Optimizes luminance (auto-levels) and contrast (sigmoidal contrast boost)
 *   4. Sharpens for print (unsharp mask tuned for offset/inkjet)
 *   5. Outputs as TIFF (lossless, CMYK-safe) or high-quality JPEG
 *
 * Requires: ImageMagick 7 (brew install imagemagick)
 */

import { readdirSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join, basename, extname, resolve } from 'path';

const args = process.argv.slice(2);
const get = (flag, def = null) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const inputFile  = get('--input');
const outputFile = get('--output');
const inputDir   = get('--dir');
const outputDir  = get('--output-dir');
const dpi        = parseInt(get('--dpi', '300'), 10);
const format     = get('--format', 'tiff').toLowerCase();
const skipCmyk   = args.includes('--skip-cmyk');

if (!inputFile && !inputDir) {
  console.error('Usage:');
  console.error('  Single: node enhance-for-print.mjs --input <file> --output <file> [--dpi 300] [--format tiff]');
  console.error('  Batch:  node enhance-for-print.mjs --dir <dir> --output-dir <dir> [--dpi 300] [--format tiff]');
  console.error('');
  console.error('Options:');
  console.error('  --dpi <number>     Target DPI (default: 300)');
  console.error('  --format <format>  Output format: tiff or jpeg (default: tiff)');
  console.error('  --skip-cmyk        Keep RGB color space (skip CMYK conversion)');
  process.exit(1);
}

// Check ImageMagick is installed
try {
  execSync('magick --version', { stdio: 'pipe' });
} catch {
  console.error('Error: ImageMagick 7 not found. Install with: brew install imagemagick');
  process.exit(1);
}

/**
 * Enhance a single image for print output.
 * Pipeline: resize → auto-level → sigmoidal contrast → unsharp mask → CMYK → output
 */
function enhanceForPrint(input, output) {
  const ext = format === 'jpeg' ? '.jpg' : '.tiff';
  if (!output.endsWith(ext) && !output.endsWith('.tif') && !output.endsWith('.jpg')) {
    output = output.replace(/\.[^.]+$/, ext);
  }

  // Get current image dimensions
  const identify = execSync(`magick identify -format "%w %h" "${input}"`, { encoding: 'utf-8' }).trim();
  const [origW, origH] = identify.split(' ').map(Number);

  // Calculate target pixel dimensions for the given DPI
  // Assume the image should be at least 8x10 inches at target DPI (common print size)
  // But preserve the original if it's already large enough
  const minLongSide = Math.max(dpi * 10, origW, origH); // at least 10 inches at target DPI
  const scale = minLongSide / Math.max(origW, origH);
  const targetW = Math.round(origW * scale);
  const targetH = Math.round(origH * scale);

  console.log(`  Source: ${origW}x${origH}px → Target: ${targetW}x${targetH}px @ ${dpi} DPI`);

  // Build ImageMagick pipeline
  const steps = [
    `magick "${input}"`,
    // 1. Upscale with Lanczos (best for print upscaling)
    `-filter Lanczos -resize ${targetW}x${targetH}`,
    // 2. Set DPI metadata
    `-density ${dpi} -units PixelsPerInch`,
    // 3. Auto-level: stretches histogram to use full tonal range
    `-auto-level`,
    // 4. Sigmoidal contrast: gentle S-curve that enhances midtones without clipping
    //    (3x50% is moderate — not as harsh as linear contrast)
    `-sigmoidal-contrast 3,50%`,
    // 5. Unsharp mask tuned for print (radius 1.5, amount 0.7, threshold 2)
    //    Print needs more sharpening than screen because ink spreads on paper
    `-unsharp 1.5x1+0.7+0.02`,
  ];

  // 6. CMYK conversion (unless skipped)
  if (!skipCmyk && format === 'tiff') {
    steps.push(
      // Convert to CMYK using ImageMagick's built-in CMYK profile
      `-colorspace CMYK`,
      // Embed the profile for prepress software compatibility
      `-type ColorSeparation`,
    );
  }

  // 7. Output format settings
  if (format === 'tiff') {
    steps.push(
      // LZW compression (lossless, widely supported by prepress)
      `-compress LZW`,
    );
  } else {
    steps.push(
      // High quality JPEG for proofing
      `-quality 95`,
    );
  }

  steps.push(`"${output}"`);

  const cmd = steps.join(' \\\n  ');
  try {
    execSync(cmd, { stdio: 'pipe' });
    const sizeKB = Math.round(execSync(`stat -f%z "${output}"`, { encoding: 'utf-8' }).trim() / 1024);
    console.log(`  Saved: ${output} (${(sizeKB / 1024).toFixed(1)} MB)`);
    return true;
  } catch (err) {
    console.error(`  Error processing ${input}:`, err.stderr?.toString() || err.message);
    return false;
  }
}

// ── Single file mode ──────────────────────────────────────────────
if (inputFile) {
  if (!existsSync(inputFile)) {
    console.error(`File not found: ${inputFile}`);
    process.exit(1);
  }

  const out = outputFile || inputFile.replace(/\.[^.]+$/, `-print.${format === 'jpeg' ? 'jpg' : 'tiff'}`);
  console.log(`Enhancing for print: ${inputFile}`);
  const ok = enhanceForPrint(inputFile, out);
  process.exit(ok ? 0 : 1);
}

// ── Batch directory mode ──────────────────────────────────────────
if (inputDir) {
  if (!existsSync(inputDir)) {
    console.error(`Directory not found: ${inputDir}`);
    process.exit(1);
  }

  const outDir = outputDir || join(inputDir, 'print');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // Find all frame-*.jpg files (skip already-compressed -small.jpg)
  const files = readdirSync(inputDir)
    .filter(f => /^frame-\d+\.jpg$/i.test(f))
    .sort();

  if (files.length === 0) {
    console.error(`No frame-*.jpg files found in: ${inputDir}`);
    process.exit(1);
  }

  console.log(`\nEnhancing ${files.length} images for print (${dpi} DPI, ${format.toUpperCase()}, ${skipCmyk ? 'RGB' : 'CMYK'}):\n`);

  let success = 0;
  for (const file of files) {
    const input = resolve(join(inputDir, file));
    const outName = file.replace(/\.jpg$/i, `-print.${format === 'jpeg' ? 'jpg' : 'tiff'}`);
    const output = resolve(join(outDir, outName));

    console.log(`[${success + 1}/${files.length}] ${file}`);
    if (enhanceForPrint(input, output)) success++;
    console.log('');
  }

  console.log(`\nDone! ${success}/${files.length} images enhanced.`);
  console.log(`Output: ${outDir}`);
  process.exit(success === files.length ? 0 : 1);
}
