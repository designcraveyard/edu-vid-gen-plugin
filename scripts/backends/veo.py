"""
Veo 3.1 backend — Google Vertex AI / Gemini API.
Extracted from generate-video.py with zero behavior change.
"""

import os
import sys
import time

def init_client(args):
    """Initialize google-genai client. Returns (client, model_name)."""
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        print("ERROR: pip3 install google-genai --break-system-packages")
        sys.exit(1)

    PROJECT  = os.environ.get('GOOGLE_CLOUD_PROJECT') or os.environ.get('GCLOUD_PROJECT', '')
    LOCATION = os.environ.get('GOOGLE_CLOUD_LOCATION', 'us-central1')
    MODEL_STANDARD = 'veo-3.1-generate-001'
    MODEL_FAST     = 'veo-3.1-fast-generate-001'
    MODEL          = MODEL_FAST if args.fast else MODEL_STANDARD

    api_key = args.api_key or os.environ.get('GEMINI_API_KEY')
    if api_key:
        client = genai.Client(api_key=api_key)
        print("Auth: Gemini API key (AI Studio)")
    else:
        client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)
        print("Auth: Vertex AI ADC")

    print(f"Project: {PROJECT} | Model: {MODEL}")
    return client, MODEL


def load_image(path):
    from google.genai import types
    mime = 'image/png' if path.endswith('.png') else 'image/jpeg'
    with open(path, 'rb') as f:
        data = f.read()
    return types.Image(image_bytes=data, mime_type=mime)


def generate(client, model, args, start_image_path, end_image_path, duration):
    """Submit Veo job, poll, download result. Returns output path."""
    from google.genai import types

    start_image = load_image(start_image_path) if start_image_path else None
    end_image   = load_image(end_image_path) if end_image_path else None

    # Build prompt
    full_prompt = args.prompt
    if args.audio_prompt:
        full_prompt = f"{args.prompt}\n\nSOUND DESIGN: {args.audio_prompt}"

    mode = 'text-to-video' if not start_image else ('start+end frame interpolation' if end_image else 'start frame only')
    print(f"Mode: {mode}")
    print(f"Submitting Veo job ({duration}s, {args.aspect})...")
    if args.audio_prompt:
        print(f"Audio prompt: {args.audio_prompt}")

    person_gen = "allow_all" if not start_image else "allow_adult"
    config = types.GenerateVideosConfig(
        aspect_ratio=args.aspect,
        duration_seconds=duration,
        number_of_videos=1,
        person_generation=person_gen,
    )
    if end_image:
        config.last_frame = end_image

    # Reference images
    if args.reference and not start_image:
        ref_type = types.VideoGenerationReferenceType.STYLE if args.reference_type == 'STYLE' else types.VideoGenerationReferenceType.ASSET
        ref_images = []
        for ref_path in args.reference:
            ref_img = load_image(ref_path)
            ref_images.append(types.VideoGenerationReferenceImage(
                image=ref_img,
                reference_type=ref_type,
            ))
            print(f"  Reference ({args.reference_type}): {ref_path}")
        config.reference_images = ref_images
    elif args.reference and start_image:
        print("WARNING: --reference ignored when --image is used (Veo doesn't support both)")

    generate_kwargs = dict(model=model, prompt=full_prompt, config=config)
    if start_image:
        generate_kwargs['image'] = start_image

    op = client.models.generate_videos(**generate_kwargs)

    # Poll
    print(f"Job submitted. Polling every 10s...")
    poll = 0
    while not op.done:
        poll += 1
        time.sleep(10)
        op = client.operations.get(op)
        print(f"  Polling {poll} — done={op.done}")

    print("Job complete!")

    # Extract video
    videos = op.result.generated_videos if op.result else []
    if not videos:
        print("ERROR: No videos in response")
        print(op)
        sys.exit(1)

    video = videos[0].video
    if video.uri:
        import urllib.request
        print(f"Downloading from URI: {video.uri}")
        urllib.request.urlretrieve(video.uri, args.output)
    elif video.video_bytes:
        with open(args.output, 'wb') as f:
            f.write(video.video_bytes)
    else:
        print("ERROR: No video data in response")
        print(op.result)
        sys.exit(1)

    size_mb = os.path.getsize(args.output) / 1024 / 1024
    print(f"Saved: {args.output} ({size_mb:.2f} MB)")
    return args.output
