#!/usr/bin/env node
/**
 * generate-video.mjs — Vertex AI / Veo image-to-video
 * Usage: node generate-video.mjs --image /path/start.jpg [--end-frame /path/end.jpg] --prompt "..." --duration 8 --aspect 9:16 --output /path/clip.mp4
 *
 * Auth: uses gcloud Application Default Credentials (run `gcloud auth application-default login` once)
 * --end-frame: optional. When provided, Veo interpolates start → end frame for seamless story clips.
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const get = (flag, def = null) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const imagePath    = get('--image');
const endFramePath = get('--end-frame');
const prompt       = get('--prompt');
const duration     = parseInt(get('--duration', '8'), 10);
const aspect       = get('--aspect', '9:16');
const output       = get('--output');

if (!imagePath || !prompt || !output) {
  console.error('Usage: node generate-video.mjs --image <path> [--end-frame <path>] --prompt "..." --duration <sec> --aspect <ratio> --output <path>');
  process.exit(1);
}

// --- Config ---
const GCLOUD      = process.env.GCLOUD_PATH || `${process.env.HOME}/Downloads/google-cloud-sdk/bin/gcloud`;
const PROJECT_ID  = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
if (!PROJECT_ID) { console.error('Error: GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT not set. Run /setup to configure.'); process.exit(1); }
const LOCATION    = 'us-central1';
const MODEL       = 'veo-3.1-generate-001';
const BASE        = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models`;

const clampedDuration = Math.min(8, Math.max(4, duration));

// Read images
const imageBuffer = readFileSync(imagePath);
const imageB64    = imageBuffer.toString('base64');
const mimeType    = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

let endFrameB64 = null;
let endMimeType = null;
if (endFramePath) {
  const endBuffer = readFileSync(endFramePath);
  endFrameB64  = endBuffer.toString('base64');
  endMimeType  = endFramePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
}

// Get Bearer token from gcloud
function getAccessToken() {
  try {
    return execSync(`${GCLOUD} auth print-access-token`, { encoding: 'utf8' }).trim();
  } catch (e) {
    throw new Error(`gcloud auth failed: ${e.message}\nRun: gcloud auth application-default login`);
  }
}

async function post(path, body, token) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
  return data;
}

async function poll(operationName, token) {
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/${operationName}`;
  for (let attempt = 1; attempt <= 60; attempt++) {
    await new Promise(r => setTimeout(r, 10_000));
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
    process.stderr.write(`  Polling ${attempt}/60 — done=${data.done ?? false}\n`);
    if (data.done) return data;
  }
  throw new Error('Timed out after 10 minutes waiting for Veo job');
}

try {
  const token = getAccessToken();
  console.log('Bearer token obtained.');

  const instance = {
    prompt,
    image: { bytesBase64Encoded: imageB64, mimeType }
  };

  if (endFrameB64) {
    instance.lastFrame = { bytesBase64Encoded: endFrameB64, mimeType: endMimeType };
    console.log('Mode: start → end frame interpolation');
  } else {
    console.log('Mode: start frame only');
  }

  console.log(`Submitting Veo job (${clampedDuration}s, ${aspect}) to Vertex AI...`);
  console.log(`Project: ${PROJECT_ID} | Model: ${MODEL}`);

  const job = await post(`${MODEL}:predictLongRunning`, {
    instances: [instance],
    parameters: {
      aspectRatio: aspect,
      durationSeconds: clampedDuration,
      sampleCount: 1
    }
  }, token);

  const operationName = job.name;
  console.log(`Operation: ${operationName}`);
  console.log('Polling every 10s (up to 10 min)...');

  const result = await poll(operationName, token);

  // Extract video — either base64 in response or URI
  const sample = result?.response?.videos?.[0] ?? result?.response?.generateVideoResponse?.generatedSamples?.[0];
  const videoB64 = sample?.video?.bytesBase64Encoded ?? sample?.bytesBase64Encoded;
  const videoUri = sample?.video?.uri ?? sample?.uri;

  if (videoB64) {
    const videoBuffer = Buffer.from(videoB64, 'base64');
    writeFileSync(output, videoBuffer);
    console.log(`Saved: ${output} (${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
  } else if (videoUri) {
    console.log(`Video URI: ${videoUri}`);
    const dlRes = await fetch(videoUri, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`);
    const videoBuffer = Buffer.from(await dlRes.arrayBuffer());
    writeFileSync(output, videoBuffer);
    console.log(`Saved: ${output} (${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    console.error('Full response:', JSON.stringify(result, null, 2));
    throw new Error('No video data in response');
  }
} catch (err) {
  console.error('Failed:', err.message);
  process.exit(1);
}
