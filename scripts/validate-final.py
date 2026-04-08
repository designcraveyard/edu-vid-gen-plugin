#!/usr/bin/env python3
"""
validate-final.py — Full-video Gemini review for the final stitched MP4.
Evaluates VO sync, junction smoothness, style, narrative, text contamination.

Exit codes:
  0 = SHIP  (overall >= 8, vo_sync >= 8, drift < 1.0s, ship_ready = true)
  1 = HOLD  (any score < 7 or drift > 1.0s)
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Full-video Gemini review of final stitched MP4")
    parser.add_argument("--video", required=True, help="Path to final video mp4")
    parser.add_argument("--timeline", required=True, help="Path to timeline.json")
    parser.add_argument("--output-dir", required=True, help="Project output directory")
    parser.add_argument("--model", default="gemini-2.5-flash", help="Gemini model")
    parser.add_argument("--project", default=os.environ.get("GCLOUD_PROJECT", ""), help="GCP project")
    return parser.parse_args()


def get_video_duration(video_path: str) -> float:
    """Extract video duration via ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")
    fmt = json.loads(result.stdout).get("format", {})
    duration = float(fmt.get("duration", 0))
    if duration > 0:
        return duration
    # Fallback: streams
    cmd2 = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        video_path
    ]
    result2 = subprocess.run(cmd2, capture_output=True, text=True)
    if result2.returncode == 0:
        for stream in json.loads(result2.stdout).get("streams", []):
            if stream.get("codec_type") == "video":
                d = float(stream.get("duration", 0))
                if d > 0:
                    return d
    raise RuntimeError("Could not determine video duration from ffprobe")


def strip_audio_tags(text: str) -> str:
    """Strip [audio tags] like [warm], [pause], [excited] from VO text."""
    return re.sub(r'\[.*?\]', '', text).strip()


def build_narration_text(timeline: dict) -> str:
    """
    Build timestamped narration text from timeline.json clips.
    Format: [0.0s-2.6s] Socho, tumhare paas ek poori roti hai.
    """
    lines = []
    for clip in timeline.get("clips", []):
        for phrase in clip.get("phrases", []):
            start = phrase.get("start", 0)
            end = phrase.get("end", 0)
            text = strip_audio_tags(phrase.get("text", ""))
            if text:
                lines.append(f"[{start:.1f}s-{end:.1f}s] {text}")
    return "\n".join(lines)


def build_junction_list(timeline: dict) -> list:
    """Return list of clip boundary timestamps (end of each clip except last)."""
    clips = timeline.get("clips", [])
    junctions = []
    for i, clip in enumerate(clips[:-1]):
        t = clip.get("audio_end", 0)
        junctions.append({
            "index": i + 1,
            "at": round(t, 2),
            "from_clip": clip.get("clip"),
            "to_clip": clips[i + 1].get("clip"),
        })
    return junctions


def run_gemini_review(video_path: str, timeline: dict, model: str, project: str) -> dict:
    """Upload video to Gemini inline and request structured quality review."""
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        print("[ERROR] google-genai not installed. Run: pip3 install google-genai --break-system-packages")
        sys.exit(1)

    print(f"\n[Gemini] Uploading video for review ({Path(video_path).stat().st_size / 1024 / 1024:.1f} MB)...")

    with open(video_path, "rb") as f:
        video_bytes = f.read()

    narration_text = build_narration_text(timeline)
    junctions = build_junction_list(timeline)
    junction_str = "\n".join(
        f"  Junction {j['index']}: at {j['at']}s (clip {j['from_clip']} → clip {j['to_clip']})"
        for j in junctions
    )
    total_clips = timeline.get("total_clips", len(timeline.get("clips", [])))

    prompt = f"""You are reviewing a final stitched educational video (Hindi language, for school students).
The video has {total_clips} clips stitched together.

Full narration with timestamps (audio tags already stripped):
{narration_text}

Clip boundaries (junctions to assess):
{junction_str}

Watch the entire video carefully, then respond ONLY with valid JSON (no markdown fences):
{{
  "overall_score": <integer 1-10>,
  "vo_sync_score": <integer 1-10, how well visuals match spoken narration throughout>,
  "junction_score": <integer 1-10, overall smoothness at all clip boundaries>,
  "style_score": <integer 1-10, visual style consistency across all clips>,
  "narrative_score": <integer 1-10, how well the video tells a coherent educational story>,
  "text_contamination_timestamps": [<list of "Xs" strings where on-screen text appears, empty if none>],
  "worst_moment": <string, timestamp and description of the single worst moment, e.g. "12.5s: abrupt cut with style mismatch">,
  "junction_notes": [
    {{"junction": 1, "at": <seconds>, "assessment": <"smooth"/"acceptable"/"jarring">, "note": <string>}},
    ...one entry per junction...
  ],
  "ship_ready": <boolean, true if video is ready to deliver to a student/teacher>,
  "issues": [<list of specific issues found, empty if none>],
  "summary": <string, 1-2 sentence overall assessment>
}}

Scoring guides:
- vo_sync_score 9-10: visuals perfectly follow the narration beat-by-beat
- junction_score 9-10: all cuts are seamless, no jarring transitions
- style_score 9-10: fully consistent art style, lighting, character design
- narrative_score 9-10: story arc is clear, concept is taught effectively
- ship_ready: set true only if overall_score >= 7 AND no critical issues
"""

    client = genai.Client(vertexai=True, project=project, location="us-central1")
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

    return json.loads(response_text)


def main():
    args = parse_args()

    print(f"\n{'='*60}")
    print(f"validate-final.py — Full Video Review")
    print(f"{'='*60}")
    print(f"  Video:      {args.video}")
    print(f"  Timeline:   {args.timeline}")
    print(f"  Output dir: {args.output_dir}")
    print(f"  Model:      {args.model}")

    # Load timeline
    with open(args.timeline) as f:
        timeline = json.load(f)

    # Step 1: Duration check
    print("\n[Step 1] Checking video duration via ffprobe...")
    video_duration = get_video_duration(args.video)
    clips = timeline.get("clips", [])
    last_clip = clips[-1] if clips else {}
    timeline_end = last_clip.get("audio_end", 0)
    drift = abs(video_duration - timeline_end)

    print(f"  Video duration:   {video_duration:.3f}s")
    print(f"  Timeline end:     {timeline_end:.3f}s  (clip {last_clip.get('clip')} audio_end)")
    print(f"  Drift:            {drift:.3f}s")

    if drift > 1.0:
        print(f"  [WARN] Drift {drift:.3f}s exceeds 1.0s threshold")
    else:
        print(f"  [OK] Drift within 1.0s threshold")

    # Step 2: Gemini review
    print("\n[Step 2] Running Gemini full-video review...")
    gemini_result = run_gemini_review(args.video, timeline, args.model, args.project)

    overall_score = gemini_result.get("overall_score", 0)
    vo_sync_score = gemini_result.get("vo_sync_score", 0)
    junction_score = gemini_result.get("junction_score", 0)
    style_score = gemini_result.get("style_score", 0)
    narrative_score = gemini_result.get("narrative_score", 0)
    ship_ready = gemini_result.get("ship_ready", False)

    print(f"\n  Scores:")
    print(f"    overall_score:   {overall_score}/10")
    print(f"    vo_sync_score:   {vo_sync_score}/10")
    print(f"    junction_score:  {junction_score}/10")
    print(f"    style_score:     {style_score}/10")
    print(f"    narrative_score: {narrative_score}/10")
    print(f"    ship_ready:      {ship_ready}")

    text_timestamps = gemini_result.get("text_contamination_timestamps", [])
    if text_timestamps:
        print(f"  [WARN] Text contamination at: {', '.join(text_timestamps)}")
    else:
        print(f"  Text contamination: none")

    worst = gemini_result.get("worst_moment", "")
    if worst:
        print(f"  Worst moment: {worst}")

    print(f"\n  Junction notes:")
    for jn in gemini_result.get("junction_notes", []):
        assessment = jn.get("assessment", "")
        note = jn.get("note", "")
        at = jn.get("at", "?")
        j_idx = jn.get("junction", "?")
        print(f"    Junction {j_idx} @ {at}s [{assessment}]: {note}")

    issues = gemini_result.get("issues", [])
    if issues:
        print(f"\n  Issues:")
        for issue in issues:
            print(f"    - {issue}")

    print(f"\n  Summary: {gemini_result.get('summary', '')}")

    # Step 3: Determine exit code
    # SHIP: overall >= 8, vo_sync >= 8, drift < 1.0s, ship_ready = true
    # HOLD: any score < 7 or drift > 1.0s
    scores = [overall_score, vo_sync_score, junction_score, style_score, narrative_score]
    any_below_7 = any(s < 7 for s in scores)
    high_drift = drift > 1.0

    if overall_score >= 8 and vo_sync_score >= 8 and not high_drift and ship_ready:
        verdict = "SHIP"
        exit_code = 0
    else:
        verdict = "HOLD"
        exit_code = 1

    print(f"\n{'='*60}")
    print(f"VERDICT: {verdict} (exit code {exit_code})")
    if exit_code == 1:
        reasons = []
        if overall_score < 8:
            reasons.append(f"overall_score={overall_score} < 8")
        if vo_sync_score < 8:
            reasons.append(f"vo_sync_score={vo_sync_score} < 8")
        if high_drift:
            reasons.append(f"drift={drift:.3f}s > 1.0s")
        if not ship_ready:
            reasons.append("ship_ready=false")
        if any_below_7:
            low = [f"{n}={s}" for n, s in zip(
                ["overall", "vo_sync", "junction", "style", "narrative"], scores
            ) if s < 7]
            reasons.append(f"scores below 7: {', '.join(low)}")
        print(f"HOLD reasons: {'; '.join(reasons)}")
    print(f"{'='*60}\n")

    # Step 4: Save report
    validation_dir = Path(args.output_dir) / ".validation"
    validation_dir.mkdir(exist_ok=True)
    output_path = validation_dir / "final-review.json"

    report = {
        "video_path": args.video,
        "timeline_path": args.timeline,
        "model": args.model,
        "video_duration": round(video_duration, 3),
        "timeline_end": round(timeline_end, 3),
        "drift": round(drift, 3),
        "gemini_review": gemini_result,
        "verdict": verdict,
        "exit_code": exit_code,
    }

    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"Validation report saved: {output_path}")

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
