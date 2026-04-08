#!/usr/bin/env python3
"""
generate-image-vertex.py — Vertex AI image generation (Nano Banana 2 / Imagen 4)
Uses Application Default Credentials (gcloud auth application-default login)

Usage:
  python3 generate-image-vertex.py --prompt "..." --output /path/to/frame.jpg [--model gemini-2.5-flash-image] [--aspect 16:9] [--reference ref.jpg]

Models:
  gemini-2.5-flash-image         — Nano Banana 2.0 (default, best for style consistency + reference images)
  gemini-3.1-flash-image-preview — Nano Banana 2.1 preview
  imagen-4.0-generate-001        — Imagen 4 (high quality, no reference support currently)
  imagen-4.0-ultra-generate-001  — Imagen 4 Ultra
"""

import argparse
import sys
import os
import base64

from google import genai
from google.genai import types

def main():
    parser = argparse.ArgumentParser(description='Generate images via Vertex AI')
    parser.add_argument('--prompt', required=True, help='Image generation prompt')
    parser.add_argument('--output', required=True, help='Output file path')
    parser.add_argument('--model', default='gemini-2.5-flash-image', help='Model ID')
    parser.add_argument('--aspect', default='16:9', help='Aspect ratio (16:9, 9:16, 1:1)')
    parser.add_argument('--reference', help='Reference image for consistency')
    parser.add_argument('--negative', default='text, words, labels, captions, subtitles, watermark, signature, blurry, low quality', help='Negative prompt')
    args = parser.parse_args()

    # Map aspect ratio string to Vertex format
    aspect_map = {
        '16:9': '16:9',
        '9:16': '9:16',
        '1:1': '1:1',
        '4:3': '4:3',
        '3:4': '3:4',
    }
    aspect = aspect_map.get(args.aspect, '16:9')

    project_id = os.environ.get('GOOGLE_CLOUD_PROJECT') or os.environ.get('GCLOUD_PROJECT')
    if not project_id:
        print('Error: GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT not set. Run /setup to configure.')
        sys.exit(1)
    location = 'us-central1'

    print(f'Generating image via Vertex AI ({args.model}, {aspect})...')
    print(f'  Prompt: {args.prompt[:100]}...')

    client = genai.Client(
        vertexai=True,
        project=project_id,
        location=location,
    )

    if args.model.startswith('imagen'):
        # Imagen 4 — uses generate_images API
        config = types.GenerateImagesConfig(
            number_of_images=1,
            aspect_ratio=aspect,
            negative_prompt=args.negative,
            person_generation='allow_all',
            safety_filter_level='block_low_and_above',
        )

        # Add reference image if provided
        if args.reference:
            print(f'  Reference: {args.reference}')
            with open(args.reference, 'rb') as f:
                ref_bytes = f.read()
            ref_image = types.Image(image_bytes=ref_bytes)
            config.subject_reference = types.SubjectReferenceConfig(
                subject_type='SUBJECT_TYPE_DEFAULT',
                reference_images=[types.SubjectReferenceImage(
                    reference_image=ref_image,
                )]
            )

        response = client.models.generate_images(
            model=args.model,
            prompt=args.prompt,
            config=config,
        )

        if response.generated_images and len(response.generated_images) > 0:
            img = response.generated_images[0]
            img_bytes = img.image.image_bytes
            with open(args.output, 'wb') as f:
                f.write(img_bytes)
            size_kb = len(img_bytes) / 1024
            print(f'Saved: {args.output} ({size_kb:.1f} KB)')
        else:
            print('ERROR: No images generated', file=sys.stderr)
            if hasattr(response, 'filtered_reason'):
                print(f'  Filtered: {response.filtered_reason}', file=sys.stderr)
            sys.exit(1)

    else:
        # Gemini model (Nano Banana 2) — uses generate_content with image output
        contents = []

        if args.reference:
            print(f'  Reference: {args.reference}')
            with open(args.reference, 'rb') as f:
                ref_bytes = f.read()
            mime = 'image/png' if args.reference.lower().endswith('.png') else 'image/jpeg'
            contents.append(types.Part.from_bytes(data=ref_bytes, mime_type=mime))
            contents.append(types.Part.from_text(
                text=f'Use the character/subject in this reference image for visual consistency. {args.prompt}'
            ))
        else:
            contents.append(types.Part.from_text(text=args.prompt))

        response = client.models.generate_content(
            model=args.model,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=['image', 'text'],
                image_config=types.ImageConfig(
                    aspect_ratio=aspect,
                ),
            ),
        )

        # Extract image from response
        saved = False
        if not response.candidates or not response.candidates[0].content or not response.candidates[0].content.parts:
            print('ERROR: No candidates/content in response (likely safety filter)', file=sys.stderr)
            if hasattr(response, 'prompt_feedback'):
                print(f'  Feedback: {response.prompt_feedback}', file=sys.stderr)
            sys.exit(1)
        for part in response.candidates[0].content.parts:
            if hasattr(part, 'inline_data') and part.inline_data and part.inline_data.mime_type.startswith('image/'):
                img_bytes = part.inline_data.data
                with open(args.output, 'wb') as f:
                    f.write(img_bytes)
                size_kb = len(img_bytes) / 1024
                print(f'Saved: {args.output} ({size_kb:.1f} KB)')
                saved = True
                break

        if not saved:
            print('ERROR: No image in response', file=sys.stderr)
            sys.exit(1)


if __name__ == '__main__':
    main()
