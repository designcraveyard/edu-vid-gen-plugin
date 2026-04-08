#!/usr/bin/env python3
"""
validate-clip.py — Per-clip validation with two-layer verification:
  Layer 1: ffprobe (instant, free) — duration check vs VO
  Layer 2: Gemini 2.5 Flash — visual sync analysis
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Validate a generated video clip against timeline.json")
    parser.add_argument("--clip", required=True, help="Path to clip mp4")
    parser.add_argument("--clip-num", required=True, type=int, help="Clip number (1-indexed)")
    parser.add_argument("--timeline", required=True, help="Path to timeline.json")
    parser.add_argument("--output-dir", required=True, help="Project output directory")
    parser.add_argument("--model", default="gemini-2.5-flash", help="Gemini model")
    parser.add_argument("--project", default=os.environ.get("GCLOUD_PROJECT", ""), help="GCP project")
    parser.add_argument("--skip-gemini", action="store_true", help="Skip Gemini layer (ffprobe only)")
    return parser.parse_args()


def get_video_duration(clip_path: str) -> float:
    """Extract video duration via ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        clip_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")
    data = json.loads(result.stdout)
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video":
            duration = float(stream.get("duration", 0))
            if duration > 0:
                return duration
    # Fallback: use format duration
    cmd2 = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        clip_path
    ]
    result2 = subprocess.run(cmd2, capture_output=True, text=True)
    if result2.returncode == 0:
        fmt = json.loads(result2.stdout).get("format", {})
        duration = float(fmt.get("duration", 0))
        if duration > 0:
            return duration
    raise RuntimeError("Could not determine video duration from ffprobe")


def extract_last_frame(clip_path: str, output_dir: str, clip_num: int) -> str:
    """Extract the last frame of the clip for transition planning."""
    validation_dir = Path(output_dir) / ".validation"
    validation_dir.mkdir(exist_ok=True)
    last_frame_path = str(validation_dir / f"clip-{clip_num:02d}-last-frame.jpg")
    # Get duration first
    duration = get_video_duration(clip_path)
    # Extract frame 0.1s before end
    t = max(0, duration - 0.1)
    cmd = [
        "ffmpeg", "-y", "-ss", str(t), "-i", clip_path,
        "-vframes", "1", "-q:v", "2",
        last_frame_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        return last_frame_path
    return None


def get_clip_timeline_data(timeline_path: str, clip_num: int) -> dict:
    """Load timeline.json and extract data for the given clip number."""
    with open(timeline_path) as f:
        timeline = json.load(f)
    for clip in timeline.get("clips", []):
        if clip.get("clip") == clip_num:
            return clip
    raise ValueError(f"Clip {clip_num} not found in timeline.json")


def strip_audio_tags(text: str) -> str:
    """Strip [audio tags] from VO text."""
    return re.sub(r'\[.*?\]', '', text).strip()


def get_vo_text(clip_data: dict) -> str:
    """Concatenate all phrase texts for a clip into a single VO string."""
    phrases = clip_data.get("phrases", [])
    return " ".join(p.get("text", "") for p in phrases)


def run_layer1(clip_path: str, clip_data: dict, clip_num: int, output_dir: str) -> dict:
    """Layer 1: ffprobe duration check."""
    print(f"\n[Layer 1] Running ffprobe on clip-{clip_num:02d}...")

    audio_start = clip_data.get("audio_start", 0)
    audio_end = clip_data.get("audio_end", 0)
    vo_duration = audio_end - audio_start

    video_duration = get_video_duration(clip_path)
    overflow = vo_duration - video_duration

    print(f"  VO duration:    {vo_duration:.3f}s  ({audio_start:.3f}s → {audio_end:.3f}s)")
    print(f"  Video duration: {video_duration:.3f}s")
    print(f"  Overflow:       {overflow:+.3f}s")

    # Determine status
    if overflow > 2.0:
        layer1_status = "FAIL"
        print(f"  [FAIL] Overflow {overflow:.3f}s exceeds hard limit of 2.0s")
    elif overflow > 0.5:
        layer1_status = "WARN"
        print(f"  [WARN] Overflow {overflow:.3f}s exceeds warning threshold of 0.5s")
    else:
        layer1_status = "PASS"
        print(f"  [PASS] Duration OK")

    # Extract last frame
    last_frame = extract_last_frame(clip_path, output_dir, clip_num)
    if last_frame:
        print(f"  Last frame saved: {last_frame}")

    return {
        "vo_duration": round(vo_duration, 3),
        "video_duration": round(video_duration, 3),
        "overflow": round(overflow, 3),
        "status": layer1_status,
        "last_frame": last_frame,
    }


def run_layer2(clip_path: str, clip_data: dict, clip_num: int, model: str, project: str) -> dict:
    """Layer 2: Gemini visual analysis."""
    print(f"\n[Layer 2] Running Gemini analysis on clip-{clip_num:02d}...")

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        print("  [ERROR] google-genai not installed. Run: pip3 install google-genai --break-system-packages")
        return {"status": "ERROR", "error": "google-genai not installed"}

    vo_text_raw = get_vo_text(clip_data)
    vo_text_clean = strip_audio_tags(vo_text_raw)
    visual_suggestion = clip_data.get("visual_suggestion", "")

    print(f"  VO text (clean): {vo_text_clean[:100]}...")

    # Read clip bytes
    with open(clip_path, "rb") as f:
        video_bytes = f.read()

    file_size_mb = len(video_bytes) / (1024 * 1024)
    print(f"  Clip size: {file_size_mb:.2f} MB")

    # Init Gemini client with Vertex AI ADC
    client = genai.Client(vertexai=True, project=project, location="us-central1")

    prompt = f"""Analyze this educational video clip and provide a quality assessment.

The voiceover narration for this clip is:
"{vo_text_clean}"

Expected visual content: {visual_suggestion if visual_suggestion else "Not specified"}

Score the clip on the following criteria and respond ONLY with valid JSON (no markdown fences):
{{
  "sync_score": <integer 1-10, where 10=perfect sync between visuals and narration>,
  "text_contamination": <boolean, true if any on-screen text is present>,
  "text_found": <string, describe any text found or "none">,
  "style_consistent": <boolean, true if visual style is consistent throughout>,
  "has_animation": <boolean, true if there is meaningful animation/movement>,
  "visual_description": <string, 1-2 sentence description of what happens visually>,
  "narration_match": <string, "good"/"partial"/"poor" — how well visuals match the VO>,
  "issues": [<list of specific issues found, empty array if none>]
}}

Scoring guide for sync_score:
- 9-10: Visuals perfectly illustrate the narration concept
- 7-8: Good match, minor discrepancies
- 5-6: Partial match, key concept missing or wrong
- 3-4: Poor match, visuals don't support narration
- 1-2: Completely wrong content
"""

    video_part = types.Part.from_bytes(data=video_bytes, mime_type="video/mp4")

    response = client.models.generate_content(
        model=model,
        contents=[video_part, prompt]
    )

    response_text = response.text.strip()

    # Strip markdown fences if present
    response_text = re.sub(r'^```json\s*', '', response_text)
    response_text = re.sub(r'^```\s*', '', response_text)
    response_text = re.sub(r'\s*```$', '', response_text)
    response_text = response_text.strip()

    gemini_result = json.loads(response_text)

    sync_score = gemini_result.get("sync_score", 0)
    text_contamination = gemini_result.get("text_contamination", False)

    print(f"  sync_score:         {sync_score}/10")
    print(f"  text_contamination: {text_contamination}")
    print(f"  narration_match:    {gemini_result.get('narration_match', 'N/A')}")
    print(f"  visual_description: {gemini_result.get('visual_description', '')[:100]}")
    if gemini_result.get("issues"):
        print(f"  issues: {gemini_result['issues']}")

    # Determine status
    if sync_score < 5:
        layer2_status = "FAIL"
        print(f"  [FAIL] sync_score {sync_score} < 5")
    elif sync_score < 7 or text_contamination:
        layer2_status = "WARN"
        reason = f"sync_score {sync_score} < 7" if sync_score < 7 else ""
        tc_reason = "text_contamination=true" if text_contamination else ""
        combined = ", ".join(filter(None, [reason, tc_reason]))
        print(f"  [WARN] {combined}")
    else:
        layer2_status = "PASS"
        print(f"  [PASS] Gemini analysis OK")

    return {
        "status": layer2_status,
        **gemini_result
    }


def determine_final_status(layer1: dict, layer2: dict | None) -> tuple[str, int]:
    """Determine overall status and exit code."""
    statuses = [layer1["status"]]
    if layer2:
        statuses.append(layer2["status"])

    if "FAIL" in statuses:
        return "FAIL", 1
    elif "WARN" in statuses:
        return "WARN", 2
    else:
        return "PASS", 0


def main():
    args = parse_args()

    print(f"\n{'='*60}")
    print(f"validate-clip.py — Clip {args.clip_num}")
    print(f"{'='*60}")
    print(f"  Clip:     {args.clip}")
    print(f"  Timeline: {args.timeline}")

    # Load timeline data
    clip_data = get_clip_timeline_data(args.timeline, args.clip_num)

    # Layer 1: ffprobe
    layer1_result = run_layer1(args.clip, clip_data, args.clip_num, args.output_dir)

    # Layer 2: Gemini (unless skipped)
    layer2_result = None
    if not args.skip_gemini:
        layer2_result = run_layer2(args.clip, clip_data, args.clip_num, args.model, args.project)
    else:
        print("\n[Layer 2] Skipped (--skip-gemini flag)")

    # Final status
    final_status, exit_code = determine_final_status(layer1_result, layer2_result)

    print(f"\n{'='*60}")
    print(f"FINAL STATUS: {final_status} (exit code {exit_code})")
    print(f"{'='*60}\n")

    # Build output JSON
    output = {
        "clip_num": args.clip_num,
        "clip_path": args.clip,
        "clip_data": clip_data,
        "layer1_ffprobe": layer1_result,
        "layer2_gemini": layer2_result,
        "final_status": final_status,
        "exit_code": exit_code,
    }

    # Save to .validation/clip-NN.json
    validation_dir = Path(args.output_dir) / ".validation"
    validation_dir.mkdir(exist_ok=True)
    output_path = validation_dir / f"clip-{args.clip_num:02d}.json"
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Validation report saved: {output_path}")

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
