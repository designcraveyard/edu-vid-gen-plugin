"""
Wan 2.7 backend — via Together AI API.
Supports text-to-video, image-to-video (via frame_images), and audio input.
Pricing: ~$0.10/sec on Together AI.
"""

import os
import sys
import time
import base64
import json

# Together AI endpoint
BASE_URL = 'https://api.together.ai/v1'

# Wan model IDs on Together AI
MODELS = {
    't2v': 'Wan-AI/wan2.7-t2v',
    'i2v': 'Wan-AI/wan2.7-i2v',     # coming soon — falls back to t2v + frame_images
}

# Aspect ratio → width/height mapping
ASPECT_MAP = {
    '16:9': (1366, 768),
    '9:16': (768, 1366),
    '1:1':  (1024, 1024),
}


def _get_api_key():
    key = os.environ.get('TOGETHER_API_KEY')
    if not key:
        print("ERROR: TOGETHER_API_KEY not set. Get one at https://api.together.ai/")
        sys.exit(1)
    return key


def _headers():
    return {
        'Authorization': f'Bearer {_get_api_key()}',
        'Content-Type': 'application/json',
    }


def _load_image_b64(path):
    """Read image file and return base64 string."""
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')


def init_client(args):
    """Validate API key and print config. Returns (api_key, model_id)."""
    key = _get_api_key()
    model = MODELS['t2v']  # default to t2v (i2v uses frame_images on t2v)
    print(f"Auth: Together AI API key")
    print(f"Model: {model}")
    return key, model


def generate(client_info, model, args, start_image_path, end_image_path, duration):
    """Submit Wan 2.7 job via Together AI, poll, download result."""
    import urllib.request

    api_key = client_info  # client_info is just the API key string

    width, height = ASPECT_MAP.get(args.aspect, (1366, 768))

    mode = 'text-to-video'
    if start_image_path and end_image_path:
        mode = 'first+last frame (FLF)'
    elif start_image_path:
        mode = 'image-to-video (start frame)'

    print(f"Mode: {mode}")
    print(f"Submitting Wan 2.7 job ({duration}s, {args.aspect} → {width}x{height})...")

    # Build request body
    body = {
        'model': model,
        'prompt': args.prompt,
        'width': width,
        'height': height,
        'seconds': str(duration),
        'fps': 24,
        'steps': 30,
        'guidance_scale': 7.5,
        'output_format': 'MP4',
    }

    # Start frame (image-to-video via frame_images)
    if start_image_path:
        frame_images = [{'input_image': _load_image_b64(start_image_path), 'frame': 0}]

        # End frame for FLF interpolation
        if end_image_path:
            last_frame_idx = duration * 24  # fps=24
            frame_images.append({'input_image': _load_image_b64(end_image_path), 'frame': last_frame_idx})
            print(f"  Start frame: {start_image_path}")
            print(f"  End frame: {end_image_path} (frame {last_frame_idx})")
        else:
            print(f"  Start frame: {start_image_path}")

        body['frame_images'] = frame_images

    # Audio prompt — Wan 2.7 auto-generates matching audio if no audio input
    if args.audio_prompt:
        print(f"Audio direction: {args.audio_prompt}")
        # Wan 2.7 on Together doesn't take --audio-prompt as text; it auto-generates audio.
        # Append audio direction to the visual prompt for best results.
        body['prompt'] = f"{args.prompt}\n\nAUDIO ATMOSPHERE: {args.audio_prompt}"

    # Reference images (style/character consistency)
    if args.reference and not start_image_path:
        body['reference_images'] = []
        for ref_path in args.reference:
            # Together AI expects URLs; encode as data URI for local files
            b64 = _load_image_b64(ref_path)
            mime = 'image/png' if ref_path.endswith('.png') else 'image/jpeg'
            body['reference_images'].append(f"data:{mime};base64,{b64}")
            print(f"  Reference: {ref_path}")

    # Submit job
    req = urllib.request.Request(
        f'{BASE_URL}/videos',
        data=json.dumps(body).encode('utf-8'),
        headers=_headers(),
        method='POST',
    )

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"ERROR: Together AI returned {e.code}: {error_body}")
        sys.exit(1)

    job_id = result.get('id')
    if not job_id:
        print(f"ERROR: No job ID in response: {result}")
        sys.exit(1)

    print(f"Job submitted: {job_id}. Polling every 10s...")

    # Poll for completion
    poll = 0
    while True:
        poll += 1
        time.sleep(10)

        poll_req = urllib.request.Request(
            f'{BASE_URL}/videos/{job_id}',
            headers=_headers(),
            method='GET',
        )
        with urllib.request.urlopen(poll_req) as resp:
            status = json.loads(resp.read())

        state = status.get('status', 'unknown')
        print(f"  Polling {poll} — status={state}")

        if state == 'completed':
            video_url = status.get('outputs', {}).get('video_url')
            if not video_url:
                print(f"ERROR: No video_url in completed response: {status}")
                sys.exit(1)

            # Download video
            print(f"Downloading from: {video_url}")
            urllib.request.urlretrieve(video_url, args.output)

            size_mb = os.path.getsize(args.output) / 1024 / 1024
            cost = status.get('outputs', {}).get('cost', 'unknown')
            print(f"Saved: {args.output} ({size_mb:.2f} MB) | Cost: ${cost}")
            return args.output

        elif state == 'failed':
            error = status.get('error', 'Unknown error')
            print(f"ERROR: Job failed: {error}")
            sys.exit(1)

        elif state == 'cancelled':
            print("ERROR: Job was cancelled")
            sys.exit(1)

    return args.output
