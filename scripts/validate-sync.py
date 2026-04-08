#!/usr/bin/env python3
"""
validate-sync.py — Self-healing sync analysis via subtitle overlay + Gemini 2.5 Pro.

Overlays karaoke subtitles on the composite video, uploads to Gemini Pro for
deep word-level sync analysis, and produces a sync-report with per-clip scores
and fixable_issues for the self-healing loop.

Exit codes:
  0 = PASS  (overall_sync_score >= threshold, no clip < 5)
  1 = FAIL  (needs intervention or fallback)
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path


def parse_args():
    p = argparse.ArgumentParser(description="Subtitle overlay + Gemini Pro sync analysis")
    p.add_argument("--video", required=True, help="Path to final composite video")
    p.add_argument("--timestamps", required=True, help="Path to full-vo-timestamps.json")
    p.add_argument("--timeline", required=True, help="Path to timeline.json")
    p.add_argument("--vo-audio", required=True, help="Path to full-vo.mp3")
    p.add_argument("--output-dir", required=True, help="Project output directory")
    p.add_argument("--attempt", type=int, default=1, help="Attempt number (1-3)")
    p.add_argument("--model", default="gemini-2.5-pro", help="Gemini model for sync analysis")
    p.add_argument("--project", default=os.environ.get("GCLOUD_PROJECT", ""), help="GCP project")
    p.add_argument("--sync-threshold", type=int, default=7, help="Minimum overall sync score to PASS")
    p.add_argument("--compositor", default="vo-first", help="Which compositor produced the video")
    p.add_argument("--skip-subtitle", action="store_true", help="Skip subtitle overlay (use raw video)")
    return p.parse_args()


def get_script_dir():
    """Return directory containing this script (for sibling script paths)."""
    return str(Path(__file__).parent)


def generate_subtitle_overlay(video_path, timestamps_path, audio_path, output_path):
    """Run generate-subtitle-video.py in overlay mode on the full video."""
    script = os.path.join(get_script_dir(), "generate-subtitle-video.py")
    cmd = [
        sys.executable, script,
        "--timestamps", timestamps_path,
        "--audio", audio_path,
        "--video", video_path,
        "--output", output_path,
    ]
    print(f"  Running subtitle overlay...")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        print(f"  [WARN] Subtitle generation failed: {result.stderr[:500]}")
        return False
    print(f"  Subtitled video: {output_path}")
    return True


def strip_audio_tags(text):
    return re.sub(r'\[.*?\]', '', text).strip()


def build_clip_boundaries(timeline):
    """Build human-readable clip boundary descriptions from timeline."""
    lines = []
    clips = timeline.get("clips", [])
    for i, clip in enumerate(clips):
        clip_num = clip.get("clip", i + 1)
        start = clip.get("audio_start", 0)
        end = clip.get("audio_end", 0)
        # Collect narration text from phrases
        phrases = clip.get("phrases", [])
        narration = " ".join(strip_audio_tags(p.get("text", "")) for p in phrases).strip()
        if not narration:
            narration = strip_audio_tags(clip.get("text", ""))
        lines.append(f"Clip {clip_num} [{start:.1f}s - {end:.1f}s]: \"{narration}\"")
    return "\n".join(lines)


def upload_via_file_api(client, video_path):
    """Upload video via Gemini File API for large files."""
    from google.genai import types

    print(f"  Uploading via File API ({Path(video_path).stat().st_size / 1024 / 1024:.1f} MB)...")
    uploaded = client.files.upload(file=video_path)

    # Poll until file is ready
    while uploaded.state.name == "PROCESSING":
        print(f"  File processing...")
        time.sleep(5)
        uploaded = client.files.get(name=uploaded.name)

    if uploaded.state.name != "ACTIVE":
        raise RuntimeError(f"File upload failed: state={uploaded.state.name}")

    print(f"  File ready: {uploaded.name}")
    return uploaded


def run_sync_analysis(video_path, timeline, model, project):
    """Upload video to Gemini and request structured sync analysis."""
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        print("[ERROR] google-genai not installed. Run: pip3 install google-genai --break-system-packages")
        sys.exit(1)

    client = genai.Client(vertexai=True, project=project, location="us-central1")

    clip_boundaries = build_clip_boundaries(timeline)
    total_clips = timeline.get("total_clips", len(timeline.get("clips", [])))

    # Use File API for reliability with large videos
    uploaded_file = upload_via_file_api(client, video_path)

    prompt = f"""You are a voiceover-to-visual synchronization specialist reviewing an educational video.

This video has karaoke-style subtitles overlaid at the bottom. Each word highlights
(turns YELLOW) at the exact moment it is spoken in the voiceover. Use these highlights
as your timing reference for sync accuracy.

TASK: For each clip segment, evaluate whether the visual content on screen matches
what is being spoken at that exact moment. Pay special attention to:

1. When a word highlights, does the corresponding visual appear on screen?
2. Are there any moments where the subtitle highlights a concept but the visual
   shows something from a different scene (wrong visual)?
3. Are there freeze-frame moments where the visual is static while the subtitle
   keeps advancing (the words keep highlighting but the picture doesn't change)?
4. Do scene transitions (visual cuts between clips) align with sentence boundaries?
5. Is any background SFX or ambient audio competing with / masking the narrator?

VIDEO HAS {total_clips} CLIPS:
{clip_boundaries}

Respond ONLY with valid JSON (no markdown fences, no explanation):
{{
  "overall_sync_score": <integer 1-10, 10=perfect sync throughout>,
  "per_clip_sync": [
    {{
      "clip": <clip number>,
      "sync_score": <integer 1-10>,
      "word_alignment": <"excellent"/"good"/"partial"/"poor">,
      "desync_windows": [
        {{
          "start": <seconds>,
          "end": <seconds>,
          "spoken_text": <words being spoken during desync>,
          "expected_visual": <what should appear based on narration>,
          "actual_visual": <what actually appears on screen>,
          "severity": <"minor"/"major"/"critical">
        }}
      ],
      "notes": <1-2 sentence assessment>
    }}
    ...one entry per clip...
  ],
  "junction_sync": [
    {{
      "junction": <junction number>,
      "at": <seconds>,
      "visual_transition": <"smooth"/"acceptable"/"jarring">,
      "vo_continuity": <"good"/"broken">,
      "notes": <string>
    }}
    ...one per junction...
  ],
  "fixable_issues": [
    {{
      "type": <one of: "freeze_frame_overlap", "sfx_masking_vo", "ambient_too_loud",
               "desync_at_junction", "visual_wrong_scene", "style_mismatch">,
      "clip": <affected clip number or null>,
      "severity": <"minor"/"major"/"critical">,
      "description": <what is wrong>,
      "suggested_fix": <one of: "reduce_sfx_volume", "reduce_ambient_volume",
                        "regenerate_tc", "switch_to_video_first", "escalate">
    }}
  ],
  "recommendation": <"pass"/"adjust_params"/"switch_compositor"/"escalate">
}}

SYNC SCORING GUIDE:
- 9-10: Every highlighted word matches its visual perfectly. Zero freeze frames.
- 7-8: Most words match. Minor timing offset (<1s). No wrong visuals.
- 5-6: Theme matches but specific beats misaligned. Some freeze frames.
- 3-4: Significant desync. Visuals show wrong scene for 2+ seconds.
- 1-2: Completely out of sync. Visuals unrelated to narration.
"""

    print(f"  Sending to {model} for sync analysis...")
    response = client.models.generate_content(
        model=model,
        contents=[uploaded_file, prompt]
    )

    # Clean up uploaded file
    try:
        client.files.delete(name=uploaded_file.name)
    except Exception:
        pass  # Best effort cleanup

    response_text = response.text.strip()
    response_text = re.sub(r'^```json\s*', '', response_text)
    response_text = re.sub(r'^```\s*', '', response_text)
    response_text = re.sub(r'\s*```$', '', response_text)
    response_text = response_text.strip()

    return json.loads(response_text)


def main():
    args = parse_args()
    validation_dir = Path(args.output_dir) / ".validation"
    validation_dir.mkdir(exist_ok=True)

    print(f"\n{'='*60}")
    print(f"validate-sync.py — VO Sync Analysis (Attempt {args.attempt})")
    print(f"{'='*60}")
    print(f"  Video:       {args.video}")
    print(f"  Timeline:    {args.timeline}")
    print(f"  Model:       {args.model}")
    print(f"  Threshold:   {args.sync_threshold}")
    print(f"  Compositor:  {args.compositor}")

    # Step 1: Generate subtitle overlay
    subtitled_path = str(validation_dir / f"subtitled-final-attempt-{args.attempt}.mp4")

    if args.skip_subtitle:
        print("\n[Step 1] Skipping subtitle overlay (--skip-subtitle)")
        analysis_video = args.video
    else:
        print("\n[Step 1] Generating subtitle overlay...")
        success = generate_subtitle_overlay(
            args.video, args.timestamps, args.vo_audio, subtitled_path
        )
        if success:
            analysis_video = subtitled_path
        else:
            print("  [WARN] Falling back to raw video (no subtitles)")
            analysis_video = args.video

    # Step 2: Load timeline
    with open(args.timeline) as f:
        timeline = json.load(f)

    # Step 3: Run Gemini Pro sync analysis
    print(f"\n[Step 2] Running Gemini sync analysis...")
    try:
        gemini_result = run_sync_analysis(analysis_video, timeline, args.model, args.project)
    except Exception as e:
        print(f"  [ERROR] Gemini analysis failed: {e}")
        # Write failure report
        report = {
            "attempt": args.attempt,
            "compositor": args.compositor,
            "model": args.model,
            "overall_sync_score": 0,
            "verdict": "FAIL",
            "error": str(e),
            "per_clip_sync": [],
            "fixable_issues": [],
            "recommendation": "escalate"
        }
        report_path = validation_dir / f"sync-report-attempt-{args.attempt}.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nError report saved: {report_path}")
        sys.exit(1)

    # Step 4: Evaluate
    overall_score = gemini_result.get("overall_sync_score", 0)
    per_clip = gemini_result.get("per_clip_sync", [])
    any_clip_below_5 = any(c.get("sync_score", 0) < 5 for c in per_clip)
    fixable_issues = gemini_result.get("fixable_issues", [])
    recommendation = gemini_result.get("recommendation", "escalate")

    passes = overall_score >= args.sync_threshold and not any_clip_below_5
    verdict = "PASS" if passes else "FAIL"

    # Print results
    print(f"\n  Overall sync score: {overall_score}/10")
    print(f"\n  Per-clip scores:")
    for clip_sync in per_clip:
        c = clip_sync.get("clip", "?")
        s = clip_sync.get("sync_score", 0)
        align = clip_sync.get("word_alignment", "?")
        flag = " ✅" if s >= args.sync_threshold else " ⚠️" if s >= 5 else " ❌"
        print(f"    Clip {c}: {s}/10 ({align}){flag}")
        for dw in clip_sync.get("desync_windows", []):
            print(f"      ⤷ [{dw['start']:.1f}-{dw['end']:.1f}s] {dw.get('severity','?')}: "
                  f"spoken=\"{dw.get('spoken_text','')}\" → "
                  f"saw \"{dw.get('actual_visual','')}\"")

    if fixable_issues:
        print(f"\n  Fixable issues ({len(fixable_issues)}):")
        for issue in fixable_issues:
            print(f"    [{issue.get('severity','')}] {issue.get('type','')}: "
                  f"{issue.get('description','')} → fix: {issue.get('suggested_fix','')}")

    print(f"\n  Recommendation: {recommendation}")
    print(f"\n{'='*60}")
    print(f"VERDICT: {verdict} (overall={overall_score}, threshold={args.sync_threshold})")
    if any_clip_below_5:
        low_clips = [c.get("clip") for c in per_clip if c.get("sync_score", 0) < 5]
        print(f"  Clips below 5: {low_clips}")
    print(f"{'='*60}\n")

    # Step 5: Save report
    report = {
        "attempt": args.attempt,
        "compositor": args.compositor,
        "model": args.model,
        "video_path": args.video,
        "subtitled_video_path": subtitled_path if not args.skip_subtitle else None,
        "overall_sync_score": overall_score,
        "verdict": verdict,
        "sync_threshold": args.sync_threshold,
        "gemini_analysis": gemini_result,
        "per_clip_sync": per_clip,
        "junction_sync": gemini_result.get("junction_sync", []),
        "fixable_issues": fixable_issues,
        "recommendation": recommendation,
    }

    report_path = validation_dir / f"sync-report-attempt-{args.attempt}.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"Sync report saved: {report_path}")

    # If passing, also save as the canonical sync-report.json
    if passes:
        canonical = validation_dir / "sync-report.json"
        with open(canonical, "w") as f:
            json.dump(report, f, indent=2)
        print(f"Canonical report: {canonical}")

    sys.exit(0 if passes else 1)


if __name__ == "__main__":
    main()
