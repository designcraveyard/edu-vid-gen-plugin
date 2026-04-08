#!/usr/bin/env python3
"""
generate-video.py — Multi-backend video generation (Veo 3.1, Wan 2.7)
Usage: python3 generate-video.py --backend wan --image start.jpg --prompt "..." --duration 8 --output clip.mp4
Auth:
  - veo: GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC (or --api-key / GEMINI_API_KEY)
  - wan: TOGETHER_API_KEY
"""

import argparse
import sys
import os

parser = argparse.ArgumentParser()
parser.add_argument('--backend', default='veo', choices=['veo', 'wan'],
    help='Video generation backend: veo (Google Veo 3.1, $0.15/sec) or wan (Alibaba Wan 2.7 via Together AI, $0.10/sec). Default: veo')
parser.add_argument('--image', default=None, help='Start frame image (optional; omit for text-to-video mode)')
parser.add_argument('--end-frame', default=None)
parser.add_argument('--prompt', required=True)
parser.add_argument('--audio-prompt', default=None,
    help='Sound design description: ambient sounds, sound effects, voice tone, accent, music style. '
         'Veo 3.1 generates native audio from this. Wan 2.7 auto-generates audio (prompt appended to visual prompt).')
parser.add_argument('--duration', type=int, default=8)
parser.add_argument('--aspect', default='9:16')
parser.add_argument('--output', required=True)
parser.add_argument('--fast', action='store_true', default=True,
    help='[Veo only] Use Veo 3.1 Fast mode ($0.15/sec). Default: on. Use --no-fast for standard.')
parser.add_argument('--no-fast', dest='fast', action='store_false',
    help='[Veo only] Use standard Veo 3.1 mode ($0.40/sec)')
parser.add_argument('--reference', default=None, action='append',
    help='Reference image for character/style consistency (can pass multiple).')
parser.add_argument('--reference-type', default='STYLE', choices=['STYLE', 'ASSET'],
    help='Reference type: STYLE (visual style) or ASSET (specific subject). Default: STYLE')
parser.add_argument('--api-key', default=None,
    help='[Veo only] Gemini API key (uses AI Studio). If omitted, uses Vertex AI ADC.')
args = parser.parse_args()

if args.end_frame and not args.image:
    print("ERROR: --end-frame requires --image")
    sys.exit(1)

# Clamp duration per backend
if args.backend == 'veo':
    duration = min(8, max(4, args.duration))
elif args.backend == 'wan':
    duration = min(15, max(2, args.duration))
else:
    duration = args.duration

# Import and run the selected backend
# Add scripts dir to path so backends package is importable
scripts_dir = os.path.dirname(os.path.abspath(__file__))
if scripts_dir not in sys.path:
    sys.path.insert(0, scripts_dir)

from backends import get_backend
backend = get_backend(args.backend)

print(f"Backend: {args.backend}")
client, model = backend.init_client(args)
backend.generate(client, model, args, args.image, args.end_frame, duration)
