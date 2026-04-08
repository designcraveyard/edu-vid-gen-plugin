#!/usr/bin/env python3
"""
extend-video.py — Extend a Veo-generated video with a new scene

Veo 3.1 video extension generates 7 additional seconds from the last frame
of an existing video. Chain up to 20 extensions for ~148s total.

Usage:
  # Extend an existing clip with a new scene:
  python3 extend-video.py --video clip-01.mp4 --prompt "New scene..." --output clip-01-ext.mp4

  # With audio prompt:
  python3 extend-video.py --video clip-01.mp4 --prompt "..." --audio-prompt "..." --output extended.mp4

  # Full chain from initial generation:
  python3 extend-video.py --image start-frame.jpg --prompt "First scene..." --output clip-01.mp4
  python3 extend-video.py --video clip-01.mp4 --prompt "Second scene..." --output clip-02.mp4
  python3 extend-video.py --video clip-02.mp4 --prompt "Third scene..." --output clip-03.mp4

Notes:
  - Extension adds exactly 7 seconds each time
  - Input video must be Veo-generated, MP4, 24fps, 720p/1080p
  - Max 20 extensions = 148s total (8s initial + 20×7s)
  - Cannot combine --video with --image (use one or the other)
  - Output includes native audio from --audio-prompt
  - Videos on Google servers expire after 2 days — download immediately
"""

import argparse
import sys
import os
import time

parser = argparse.ArgumentParser(description='Extend a Veo video or generate initial clip')
parser.add_argument('--video', default=None,
    help='Path to existing Veo-generated video to extend from')
parser.add_argument('--image', default=None,
    help='Start frame image for initial generation (not extension)')
parser.add_argument('--prompt', required=True,
    help='Scene description for the extension/generation')
parser.add_argument('--audio-prompt', default=None,
    help='Sound design: ambient sounds, SFX, music style')
parser.add_argument('--duration', type=int, default=8,
    help='Duration for initial generation only (4/6/8). Extensions are always 7s.')
parser.add_argument('--aspect', default='16:9',
    help='Aspect ratio (16:9 or 9:16)')
parser.add_argument('--output', required=True,
    help='Output file path')
parser.add_argument('--fast', action='store_true', default=True,
    help='Use Veo 3.1 Fast mode (default)')
parser.add_argument('--no-fast', dest='fast', action='store_false')
parser.add_argument('--seed', type=int, default=None,
    help='Seed for reproducibility (0-4294967295)')
parser.add_argument('--negative', default=None,
    help='Negative prompt — what to avoid')
args = parser.parse_args()

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("ERROR: pip3 install google-genai --break-system-packages")
    sys.exit(1)

PROJECT  = os.environ.get('GOOGLE_CLOUD_PROJECT') or os.environ.get('GCLOUD_PROJECT', '')
if not PROJECT:
    print('Error: GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT not set. Run /setup to configure.')
    sys.exit(1)
LOCATION = os.environ.get('GOOGLE_CLOUD_LOCATION', 'us-central1')
MODEL_FAST = 'veo-3.1-fast-generate-001'
MODEL_STD  = 'veo-3.1-generate-001'
MODEL      = MODEL_FAST if args.fast else MODEL_STD

if args.video and args.image:
    print("ERROR: Cannot use both --video and --image. Use --video to extend, --image for initial generation.")
    sys.exit(1)

if not args.video and not args.image:
    mode = 'text-to-video (initial)'
elif args.image:
    mode = 'image-to-video (initial)'
else:
    mode = 'video extension'

print(f"Project: {PROJECT} | Model: {MODEL}")
print(f"Mode: {mode}")

# Init client
client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)

# Build prompt
full_prompt = args.prompt
if args.audio_prompt:
    full_prompt = f"{args.prompt}\n\nSOUND DESIGN: {args.audio_prompt}"

# Build config
config = types.GenerateVideosConfig(
    aspect_ratio=args.aspect,
    person_generation='allow_all',
)

if args.seed is not None:
    config.seed = args.seed

if args.negative:
    config.negative_prompt = args.negative

# Build generation kwargs
generate_kwargs = dict(
    model=MODEL,
    prompt=full_prompt,
    config=config,
)

if args.video:
    # VIDEO EXTENSION MODE
    print(f"Extending video: {args.video}")
    with open(args.video, 'rb') as f:
        video_bytes = f.read()
    print(f"  Input video: {len(video_bytes)/1024:.0f} KB")

    generate_kwargs['video'] = types.Video(
        video_bytes=video_bytes,
        mime_type='video/mp4',
    )
    # Extension is always 7s — duration config is ignored
    print(f"  Extension duration: 7s (fixed)")

elif args.image:
    # INITIAL IMAGE-TO-VIDEO
    print(f"Start frame: {args.image}")
    mime = 'image/png' if args.image.endswith('.png') else 'image/jpeg'
    with open(args.image, 'rb') as f:
        img_bytes = f.read()
    generate_kwargs['image'] = types.Image(
        image_bytes=img_bytes,
        mime_type=mime,
    )
    duration = min(8, max(4, args.duration))
    config.duration_seconds = duration
    print(f"  Duration: {duration}s")

else:
    # TEXT-TO-VIDEO INITIAL
    duration = min(8, max(4, args.duration))
    config.duration_seconds = duration
    print(f"  Duration: {duration}s")

# Submit job
print(f"Submitting Veo job ({args.aspect})...")
if args.audio_prompt:
    print(f"  Audio: {args.audio_prompt[:80]}...")

op = client.models.generate_videos(**generate_kwargs)

print("Polling every 10s...")
poll = 0
while not op.done:
    time.sleep(10)
    poll += 1
    try:
        op = client.operations.get(op)
    except Exception as e:
        print(f"  Poll {poll} — network error: {e}")
        continue
    print(f"  Poll {poll} — done={op.done}")

if op.error:
    print(f"\nERROR: {op.error}")
    print(f"Full response: {op}")
    sys.exit(1)

if not op.result or not op.result.generated_videos:
    print(f"\nERROR: No videos in response")
    print(f"Full response: {op}")
    sys.exit(1)

# Save the video
vid = op.result.generated_videos[0]
vid_bytes = vid.video.video_bytes

if not vid_bytes:
    # May need to download from URI
    if vid.video.uri:
        print(f"Video at URI: {vid.video.uri}")
        print("ERROR: Video returned as URI, not bytes. May need GCS access.")
        sys.exit(1)
    else:
        print("ERROR: No video bytes or URI in response")
        sys.exit(1)

with open(args.output, 'wb') as f:
    f.write(vid_bytes)

size_mb = len(vid_bytes) / (1024 * 1024)
print(f"\nSaved: {args.output} ({size_mb:.1f} MB)")

# Report duration
try:
    import subprocess
    dur = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', args.output],
        capture_output=True, text=True
    ).stdout.strip()
    print(f"Duration: {dur}s")
except:
    pass
