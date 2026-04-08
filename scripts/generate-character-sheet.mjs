#!/usr/bin/env node
/**
 * generate-character-sheet.mjs — Create character reference sheets via Gemini
 *
 * Generates two types of character sheets:
 *   a) Pose sheet: character in 6-8 different poses/actions
 *   b) Expression sheet: character showing 6-8 different emotions/expressions
 *
 * Also generates a "recreation prompt" — a detailed text description + reference image
 * that can reliably reproduce the character in future generations.
 *
 * Usage:
 *   node generate-character-sheet.mjs \
 *     --name "Droppy" \
 *     --description "round teardrop body, bright cerulean blue, white highlight upper-left, large round black eyes with shine dots, small curved smile, two tiny stubby arms" \
 *     --style "3D Pixar" \
 *     --type poses \
 *     --output ./characters/droppy-poses.jpg \
 *     [--reference ./images/frame-01.jpg] \
 *     [--aspect 16:9]
 *
 *   --type: poses | expressions | both
 *   --reference: existing image of the character for visual consistency
 *
 * Requires: GEMINI_API_KEY env var
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const args = process.argv.slice(2);
const get = (flag, def = null) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const name        = get('--name');
const description = get('--description');
const style       = get('--style', '3D Pixar');
const type        = get('--type', 'both').toLowerCase();
const output      = get('--output');
const reference   = get('--reference');
const aspect      = get('--aspect', '16:9');
const useVertex   = args.includes('--vertex');

if (!name || !description || !output) {
  console.error('Usage: node generate-character-sheet.mjs --name "Name" --description "..." --style "3D Pixar" --type poses|expressions|both --output <path> [--reference <image>] [--vertex]');
  process.exit(1);
}

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Error: GEMINI_API_KEY not set. Run /setup to configure.'); process.exit(1); }
const MODEL   = 'gemini-3.1-flash-image-preview';
const URL     = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// ── Pose sheet prompt ────────────────────────────────────────────────
const POSE_PROMPT = `Create a professional CHARACTER POSE REFERENCE SHEET for "${name}".

Character description: ${description}

Style: ${style} animation style.

The sheet must show the SAME character in 6 different poses/actions, arranged in a 3x2 grid on a clean white/light grey background. Each pose should be clearly separated with a thin border or spacing.

Poses to include:
1. Standing front view (neutral/default pose)
2. Walking/running (side view, mid-stride)
3. Pointing/gesturing (teaching pose)
4. Sitting/resting
5. Jumping/excited (arms up, joyful)
6. Thinking/curious (hand on chin, looking up)

CRITICAL: Every pose must show the EXACT SAME character — same colors, proportions, features, and design. Only the pose/action changes. This is a model sheet for animation consistency.

Label each pose with small text below it. Add "${name} — Pose Reference Sheet" as a title at the top.`;

// ── Expression sheet prompt ─────────────────────────────────────────
const EXPRESSION_PROMPT = `Create a professional CHARACTER EXPRESSION REFERENCE SHEET for "${name}".

Character description: ${description}

Style: ${style} animation style.

The sheet must show the SAME character's face/head in 8 different expressions, arranged in a 4x2 grid on a clean white/light grey background. Each expression should be clearly separated.

Expressions to include:
1. Happy / Smiling (default warm expression)
2. Excited / Amazed (wide eyes, big smile, sparkles)
3. Curious / Wondering (raised eyebrow, slight head tilt)
4. Surprised / Shocked (wide open mouth, raised eyebrows)
5. Sad / Disappointed (downturned mouth, droopy eyes)
6. Thinking / Focused (squinted eyes, pursed lips)
7. Laughing (closed eyes, open mouth, joyful)
8. Confused / Puzzled (one eyebrow up, slight frown)

CRITICAL: Every expression must show the EXACT SAME character — same colors, proportions, head shape, and design. Only the facial expression changes.

Label each expression with small text below it. Add "${name} — Expression Reference Sheet" as a title at the top.`;

// ── Vertex AI generation (Nano Banana 2 via generate-image-vertex.py) ───
const __dirname = dirname(fileURLToPath(import.meta.url));
const VERTEX_SCRIPT = resolve(__dirname, 'generate-image-vertex.py');

async function generateSheetViaVertex(prompt, outputPath, sheetType) {
  const dir = dirname(resolve(outputPath));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  console.log(`  Generating ${sheetType} sheet via Vertex AI (Nano Banana 2)...`);

  const cmdArgs = [
    VERTEX_SCRIPT,
    '--prompt', prompt,
    '--output', resolve(outputPath),
    '--model', 'gemini-2.5-flash-image',
    '--aspect', aspect,
  ];
  if (reference && existsSync(reference)) {
    cmdArgs.push('--reference', resolve(reference));
    console.log(`  Using reference image: ${reference}`);
  }

  try {
    execFileSync('python3', cmdArgs, { stdio: 'inherit' });
    return existsSync(resolve(outputPath));
  } catch (err) {
    console.error(`  Vertex AI generation failed: ${err.message}`);
    return false;
  }
}

async function generateSheet(prompt, outputPath, sheetType) {
  const parts = [];

  // If reference image provided, include it for visual consistency
  if (reference && existsSync(reference)) {
    try {
      const imgData = readFileSync(reference);
      const base64 = imgData.toString('base64');
      const mime = reference.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      parts.push({ inlineData: { mimeType: mime, data: base64 } });
      parts.push({ text: `This is the character "${name}" for reference. Use this exact character design.\n\n${prompt}` });
      console.log(`  Using reference image: ${reference}`);
    } catch (err) {
      console.warn(`  Warning: Could not read reference (${err.message}), proceeding without it.`);
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

  console.log(`  Generating ${sheetType} sheet...`);

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
    console.error(`  API error:`, JSON.stringify(data, null, 2));
    return false;
  }

  const resParts = data?.candidates?.[0]?.content?.parts ?? [];
  const imgPart = resParts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imgPart) {
    console.error(`  No image in response for ${sheetType} sheet.`);
    return false;
  }

  // Ensure output directory exists
  const dir = dirname(resolve(outputPath));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const imgBuffer = Buffer.from(imgPart.inlineData.data, 'base64');
  writeFileSync(resolve(outputPath), imgBuffer);
  console.log(`  Saved: ${outputPath} (${(imgBuffer.length / 1024).toFixed(1)} KB)`);
  return true;
}

// ── Generate sheets based on type ────────────────────────────────────
console.log(`\nGenerating character sheets for "${name}" (${style}):\n`);

const outDir = dirname(resolve(output));
const baseName = output.replace(/\.[^.]+$/, '');

const genFn = useVertex ? generateSheetViaVertex : generateSheet;
if (useVertex) console.log('  Mode: Vertex AI (Nano Banana 2)\n');

if (type === 'poses' || type === 'both') {
  const posesOut = type === 'both' ? `${baseName}-poses.jpg` : output;
  const ok = await genFn(POSE_PROMPT, posesOut, 'poses');
  if (!ok) console.error('  Failed to generate pose sheet.');

  if (type === 'both') {
    console.log('\n  Waiting 35s before next generation (rate limit)...');
    await new Promise(r => setTimeout(r, 35000));
  }
}

if (type === 'expressions' || type === 'both') {
  const exprOut = type === 'both' ? `${baseName}-expressions.jpg` : output;
  const ok = await genFn(EXPRESSION_PROMPT, exprOut, 'expressions');
  if (!ok) console.error('  Failed to generate expression sheet.');
}

// ── Generate recreation prompt ──────────────────────────────────────
const recreationPrompt = `# Character Recreation Prompt — ${name}

## Visual Description
${description}

## Style
${style} animation style

## Recreation Prompt (copy this verbatim into any image generation):

"${name} is a ${description}. Rendered in ${style} animation style. High quality, consistent character design, vibrant colors, expressive, suitable for children's educational content."

## Reference Images
${type === 'both' || type === 'poses' ? `- Pose sheet: ${baseName}-poses.jpg` : ''}
${type === 'both' || type === 'expressions' ? `- Expression sheet: ${baseName}-expressions.jpg` : ''}
${reference ? `- Original reference: ${reference}` : ''}

## Usage Notes
- Always use the EXACT visual description above in every prompt to maintain consistency
- Pass the pose or expression sheet as --reference when generating new frames
- For specific poses: "... in a [pose] pose, as shown in the pose reference sheet"
- For specific expressions: "... with a [expression] expression, as shown in the expression reference sheet"
`;

const promptPath = `${baseName}-recreation-prompt.md`;
writeFileSync(resolve(promptPath), recreationPrompt);
console.log(`\nRecreation prompt saved: ${promptPath}`);
console.log('\nDone! Use the recreation prompt + reference sheets for consistent character reproduction.');
