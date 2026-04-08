#!/usr/bin/env node
/**
 * extend-image.mjs — Extend an image in a specified direction for text overlays
 *
 * Uses Gemini image editing to outpaint/extend an image so the extended area
 * becomes a flat color, gradient, or softly blurred region — ideal for placing
 * legible text on top.
 *
 * Usage:
 *   node extend-image.mjs --input frame-01.jpg --output frame-01-ext.jpg \
 *     --direction right --extend-by 40 [--style gradient] [--aspect 16:9]
 *
 * Directions: left, right, top, bottom, top-left, top-right, bottom-left, bottom-right, all
 * Styles: gradient (default), flat, blur
 * --extend-by: percentage of original dimension to add (default: 30)
 *
 * Requires: GEMINI_API_KEY env var, ImageMagick (brew install imagemagick)
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, join, basename, dirname } from 'path';

const args = process.argv.slice(2);
const get = (flag, def = null) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const input     = get('--input');
const output    = get('--output');
const direction = get('--direction', 'right').toLowerCase();
const extendBy  = parseInt(get('--extend-by', '30'), 10); // percentage
const style     = get('--style', 'gradient').toLowerCase();
const aspect    = get('--aspect');

const VALID_DIRECTIONS = ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'all'];
const VALID_STYLES = ['gradient', 'flat', 'blur'];

if (!input || !output) {
  console.error('Usage: node extend-image.mjs --input <file> --output <file> --direction <dir> [--extend-by 30] [--style gradient]');
  console.error('');
  console.error('Directions: left, right, top, bottom, top-left, top-right, bottom-left, bottom-right, all');
  console.error('Styles: gradient (smooth fade to edge color), flat (solid edge color), blur (blurred extension)');
  console.error('--extend-by: percentage of image dimension to add (default: 30)');
  process.exit(1);
}

if (!VALID_DIRECTIONS.includes(direction)) {
  console.error(`Invalid direction: "${direction}". Must be one of: ${VALID_DIRECTIONS.join(', ')}`);
  process.exit(1);
}

if (!VALID_STYLES.includes(style)) {
  console.error(`Invalid style: "${style}". Must be one of: ${VALID_STYLES.join(', ')}`);
  process.exit(1);
}

if (!existsSync(input)) {
  console.error(`File not found: ${input}`);
  process.exit(1);
}

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Error: GEMINI_API_KEY not set. Run /setup to configure.'); process.exit(1); }
const MODEL   = 'gemini-3.1-flash-image-preview';
const URL     = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// ── Get image dimensions ────────────────────────────────────────────
let origW, origH;
try {
  const identify = execSync(`sips -g pixelWidth -g pixelHeight "${input}"`, { encoding: 'utf-8' });
  origW = parseInt(identify.match(/pixelWidth:\s*(\d+)/)?.[1], 10);
  origH = parseInt(identify.match(/pixelHeight:\s*(\d+)/)?.[1], 10);
} catch {
  try {
    const id = execSync(`magick identify -format "%w %h" "${input}"`, { encoding: 'utf-8' }).trim();
    [origW, origH] = id.split(' ').map(Number);
  } catch {
    console.error('Cannot determine image dimensions. Need sips or ImageMagick.');
    process.exit(1);
  }
}

console.log(`Source: ${input} (${origW}x${origH})`);
console.log(`Direction: ${direction} | Extend by: ${extendBy}% | Style: ${style}`);

// ── Calculate canvas extension ──────────────────────────────────────
const extW = Math.round(origW * extendBy / 100);
const extH = Math.round(origH * extendBy / 100);

let newW = origW, newH = origH;
let gravity = 'Center';

// Map direction to canvas extension and gravity (where original image sits)
const dirMap = {
  'right':        { w: origW + extW, h: origH,          gravity: 'West' },
  'left':         { w: origW + extW, h: origH,          gravity: 'East' },
  'top':          { w: origW,        h: origH + extH,   gravity: 'South' },
  'bottom':       { w: origW,        h: origH + extH,   gravity: 'North' },
  'top-left':     { w: origW + extW, h: origH + extH,   gravity: 'SouthEast' },
  'top-right':    { w: origW + extW, h: origH + extH,   gravity: 'SouthWest' },
  'bottom-left':  { w: origW + extW, h: origH + extH,   gravity: 'NorthEast' },
  'bottom-right': { w: origW + extW, h: origH + extH,   gravity: 'NorthWest' },
  'all':          { w: origW + extW * 2, h: origH + extH * 2, gravity: 'Center' },
};

const canvasInfo = dirMap[direction];
newW = canvasInfo.w;
newH = canvasInfo.h;
gravity = canvasInfo.gravity;

console.log(`Canvas: ${origW}x${origH} → ${newW}x${newH} (original anchored ${gravity})`);

// ── Step 1: Create extended canvas with edge-sampled fill ───────────
// We create a canvas, place the original image, then fill the extended area
// with content suited for text placement

const tmpDir = '/tmp/extend-image-' + Date.now();
mkdirSync(tmpDir, { recursive: true });

const canvasPath = join(tmpDir, 'canvas.jpg');
const maskPath = join(tmpDir, 'mask.png');

// Build the style-specific prompt for Gemini
let editPrompt;
switch (style) {
  case 'flat':
    editPrompt = `Extend this image to the ${direction === 'all' ? 'all sides' : direction}. The extended area should be a smooth solid color that matches the dominant edge color of the image. The extended area must be clean, flat, and uniform — suitable for placing text on top. Do NOT add any objects, patterns, or details in the extended area. Keep the original image content exactly as is.`;
    break;
  case 'blur':
    editPrompt = `Extend this image to the ${direction === 'all' ? 'all sides' : direction}. The extended area should be a softly blurred continuation of the edge colors, creating a smooth bokeh-like effect. The extended area must be smooth and uniform enough for text to be legible on top. Do NOT add any new objects or details in the extended area. Keep the original image content exactly as is.`;
    break;
  case 'gradient':
  default:
    editPrompt = `Extend this image to the ${direction === 'all' ? 'all sides' : direction}. The extended area should smoothly fade from the image's edge colors into a clean, uniform tone — like a gradient dissolve. The result should look natural and be suitable for placing white or dark text on the extended area. Do NOT add any objects, patterns, text, or detailed content in the extended area. Keep the original image content exactly as is.`;
    break;
}

// ── Step 2: Use canvas-extension approach ─────────────────────────
// First: create an extended canvas using ImageMagick with edge color sampling
// Then: send to Gemini for intelligent outpainting

console.log('Creating extended canvas...');

try {
  // Sample the dominant edge color from the relevant side
  let sampleCmd;
  switch (direction) {
    case 'right':
      sampleCmd = `magick "${input}" -gravity East -crop 5x100%+0+0 -scale 1x1! -format "%[hex:u.p{0,0}]" info:`;
      break;
    case 'left':
      sampleCmd = `magick "${input}" -gravity West -crop 5x100%+0+0 -scale 1x1! -format "%[hex:u.p{0,0}]" info:`;
      break;
    case 'top':
      sampleCmd = `magick "${input}" -gravity North -crop 100%x5+0+0 -scale 1x1! -format "%[hex:u.p{0,0}]" info:`;
      break;
    case 'bottom':
      sampleCmd = `magick "${input}" -gravity South -crop 100%x5+0+0 -scale 1x1! -format "%[hex:u.p{0,0}]" info:`;
      break;
    default:
      sampleCmd = `magick "${input}" -scale 1x1! -format "%[hex:u.p{0,0}]" info:`;
  }

  let edgeColor;
  try {
    edgeColor = execSync(sampleCmd, { encoding: 'utf-8' }).trim();
    console.log(`  Edge color: #${edgeColor}`);
  } catch {
    edgeColor = '000000';
  }

  // Create canvas with edge color, place original image on it
  execSync(
    `magick -size ${newW}x${newH} xc:"#${edgeColor}" "${input}" -gravity ${gravity} -composite "${canvasPath}"`,
    { stdio: 'pipe' }
  );
  console.log(`  Canvas created: ${canvasPath}`);
} catch (err) {
  // Fallback: use sips to create canvas (macOS)
  console.log('  ImageMagick canvas failed, using sips fallback...');
  execSync(`cp "${input}" "${canvasPath}"`, { stdio: 'pipe' });
  execSync(`sips --padToHeightWidth ${newH} ${newW} "${canvasPath}"`, { stdio: 'pipe' });
}

// ── Step 3: Send to Gemini for intelligent outpainting ─────────────
console.log('Sending to Gemini for intelligent outpainting...');

const imgData = readFileSync(canvasPath);
const base64 = imgData.toString('base64');
const mime = 'image/jpeg';

const body = {
  contents: [{
    parts: [
      { inlineData: { mimeType: mime, data: base64 } },
      { text: editPrompt }
    ]
  }],
  generationConfig: {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: {
      aspectRatio: aspect || `${newW}:${newH}`,
      imageSize: '2K'
    }
  }
};

try {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': API_KEY
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('Gemini API error:', JSON.stringify(data, null, 2));
    console.log('\nFalling back to local canvas (without AI outpainting)...');
    execSync(`cp "${canvasPath}" "${resolve(output)}"`, { stdio: 'pipe' });
    console.log(`Saved (local fallback): ${output}`);
    process.exit(0);
  }

  const resParts = data?.candidates?.[0]?.content?.parts ?? [];
  const imgPart = resParts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imgPart) {
    console.error('No image in Gemini response. Using local canvas fallback.');
    execSync(`cp "${canvasPath}" "${resolve(output)}"`, { stdio: 'pipe' });
    console.log(`Saved (local fallback): ${output}`);
    process.exit(0);
  }

  const imgBuffer = Buffer.from(imgPart.inlineData.data, 'base64');
  writeFileSync(resolve(output), imgBuffer);
  const sizeKB = (imgBuffer.length / 1024).toFixed(1);
  console.log(`\nSaved: ${output} (${sizeKB} KB)`);
  console.log(`Extended ${direction} by ${extendBy}% with ${style} style`);

} catch (err) {
  console.error('Request failed:', err.message);
  // Use the local canvas as fallback
  execSync(`cp "${canvasPath}" "${resolve(output)}"`, { stdio: 'pipe' });
  console.log(`Saved (local fallback): ${output}`);
}

// Cleanup temp files
try {
  execSync(`rm -rf "${tmpDir}"`, { stdio: 'pipe' });
} catch { /* ignore */ }
