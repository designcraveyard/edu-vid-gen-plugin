#!/usr/bin/env node
/**
 * generate-image.mjs — Gemini API / Nano Banana 2 (gemini-3.1-flash-image-preview)
 * Usage: node generate-image.mjs --prompt "..." --output /path/to/frame.jpg [--aspect 9:16]
 */

import { writeFileSync, readFileSync } from 'fs';

const args = process.argv.slice(2);
const get = (flag, def = null) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const prompt    = get('--prompt');
const output    = get('--output');
const aspect    = get('--aspect', '9:16');
const reference = get('--reference');  // optional reference image for character consistency
const editSrc   = get('--edit');       // source image to edit (image editing mode)

if (!prompt || !output) {
  console.error('Usage: node generate-image.mjs --prompt "..." --output <path> [--aspect 9:16] [--reference <image_path>] [--edit <image_to_edit>]');
  process.exit(1);
}

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Error: GEMINI_API_KEY not set. Run /setup to configure.'); process.exit(1); }
const MODEL   = 'gemini-3.1-flash-image-preview';
const URL     = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Build parts based on mode: edit, reference, or plain generation
const parts = [];

if (editSrc) {
  // Image editing mode: send source image + edit instruction
  try {
    const imgData = readFileSync(editSrc);
    const base64  = imgData.toString('base64');
    const mime    = editSrc.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    parts.push({ inlineData: { mimeType: mime, data: base64 } });
    parts.push({ text: `Edit this image: ${prompt}` });
    console.log(`Editing image: ${editSrc}`);
  } catch (err) {
    console.error(`Error reading edit source: ${err.message}`);
    process.exit(1);
  }
} else if (reference) {
  // Reference mode: send reference image for character consistency + generation prompt
  try {
    const imgData = readFileSync(reference);
    const base64  = imgData.toString('base64');
    const mime    = reference.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    parts.push({ inlineData: { mimeType: mime, data: base64 } });
    parts.push({ text: `Use the person/character in this reference image for visual consistency. ${prompt}` });
    console.log(`Using reference image: ${reference}`);
  } catch (err) {
    console.warn(`Warning: Could not read reference image (${err.message}), proceeding without it.`);
    parts.push({ text: prompt });
  }
} else {
  parts.push({ text: prompt });
}

const body = {
  contents: [{ parts }],
  generationConfig: {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: { aspectRatio: aspect, imageSize: '2K' }
  }
};

try {
  console.log(`Generating image (${MODEL}, ${aspect})...`);

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
    console.error('API error:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  // Find the image part in the response
  const resParts = data?.candidates?.[0]?.content?.parts ?? [];
  const imgPart = resParts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imgPart) {
    console.error('No image in response:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const imgBuffer = Buffer.from(imgPart.inlineData.data, 'base64');
  writeFileSync(output, imgBuffer);
  console.log(`Saved: ${output} (${(imgBuffer.length / 1024).toFixed(1)} KB)`);
} catch (err) {
  console.error('Request failed:', err.message);
  process.exit(1);
}
