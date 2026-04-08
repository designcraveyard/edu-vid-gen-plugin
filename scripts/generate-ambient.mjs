#!/usr/bin/env node
/**
 * generate-ambient.mjs — Generate ambient audio loop via ElevenLabs Sound Effects API.
 *
 * Usage:
 *   ELEVENLABS_API_KEY="..." node generate-ambient.mjs \
 *     --prompt "gentle forest ambience with birds and light breeze, seamless loop" \
 *     --duration 30 \
 *     --output audio/ambient-generated.mp3
 */

import { writeFileSync } from "fs";
import { parseArgs } from "util";

const { values: args } = parseArgs({
  options: {
    prompt:    { type: "string" },
    duration:  { type: "string", default: "30" },
    output:    { type: "string", default: "ambient.mp3" },
    influence: { type: "string", default: "0.3" },
  },
});

if (!args.prompt) {
  console.error("Usage: node generate-ambient.mjs --prompt '...' [--duration 30] [--output ambient.mp3]");
  process.exit(1);
}

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ERROR: ELEVENLABS_API_KEY not set");
  process.exit(1);
}

const duration = parseFloat(args.duration);
if (duration < 0.5 || duration > 30) {
  console.error("ERROR: Duration must be 0.5–30 seconds");
  process.exit(1);
}

console.log(`Generating ambient loop: "${args.prompt}" (${duration}s, loop=true)`);

const response = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
  method: "POST",
  headers: {
    "xi-api-key": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    text: args.prompt,
    model_id: "eleven_text_to_sound_v2",
    duration_seconds: duration,
    prompt_influence: parseFloat(args.influence),
    loop: true,
  }),
});

if (!response.ok) {
  const err = await response.text();
  console.error(`ERROR ${response.status}: ${err}`);
  process.exit(1);
}

const buffer = Buffer.from(await response.arrayBuffer());
writeFileSync(args.output, buffer);
console.log(`Saved: ${args.output} (${(buffer.length / 1024).toFixed(1)} KB)`);
