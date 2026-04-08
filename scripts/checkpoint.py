#!/usr/bin/env python3
"""
checkpoint.py — Phase gate validator for edu-video-gen pipeline.
Checks all required artifacts exist before phase transitions.

Usage:
  python3 checkpoint.py --phase 2 --output-dir /path/to/project
  python3 checkpoint.py --phase 2.5 --output-dir /path/to/project
  python3 checkpoint.py --phase 3 --output-dir /path/to/project
  python3 checkpoint.py --phase 4 --output-dir /path/to/project
  python3 checkpoint.py --phase 5 --output-dir /path/to/project

Exit codes: 0 = all pass, 1 = any fail
"""

import os
import sys
import json
import argparse


def fmt_size(path):
    """Return human-readable file size string."""
    try:
        size = os.path.getsize(path)
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} TB"
    except Exception:
        return "?"


def check(label, ok, detail="", warn=False):
    """Print a single check result. Returns True if passed."""
    if ok:
        icon = "✅"
        print(f"  {icon} {label}{(' — ' + detail) if detail else ''}")
    elif warn:
        icon = "⚠️ "
        print(f"  {icon} WARNING: {label}{(' — ' + detail) if detail else ''}")
    else:
        icon = "❌"
        print(f"  {icon} {label}{(' — ' + detail) if detail else ''}")
    return ok


def load_timeline(output_dir):
    """Load and return timeline.json, or None on failure."""
    timeline_path = os.path.join(output_dir, "audio", "timeline.json")
    if not os.path.exists(timeline_path):
        return None, timeline_path
    try:
        with open(timeline_path) as f:
            return json.load(f), timeline_path
    except Exception as e:
        return None, timeline_path


def nn(n):
    """Zero-padded two-digit string."""
    return str(n).zfill(2)


# ── Phase validators ──────────────────────────────────────────────────────────

def phase2(output_dir):
    print("\n[Phase 2] Checking script artifacts...")
    failures = 0

    script_path = os.path.join(output_dir, "script.md")
    exists = os.path.exists(script_path)
    detail = fmt_size(script_path) if exists else "NOT FOUND"
    if not check("script.md exists", exists, detail):
        failures += 1

    return failures


def phase25(output_dir):
    print("\n[Phase 2.5] Checking audio-first pipeline artifacts...")
    failures = 0

    # timeline.json
    timeline, timeline_path = load_timeline(output_dir)
    tl_exists = timeline is not None
    detail = fmt_size(timeline_path) if os.path.exists(timeline_path) else "NOT FOUND"
    if not check("audio/timeline.json exists", tl_exists, detail):
        failures += 1
        print("    Cannot verify slice count without timeline.json")

    # full-vo.mp3
    vo_path = os.path.join(output_dir, "audio", "full-vo.mp3")
    vo_exists = os.path.exists(vo_path)
    detail = fmt_size(vo_path) if vo_exists else "NOT FOUND"
    if not check("audio/full-vo.mp3 exists", vo_exists, detail):
        failures += 1

    # slice-NN.mp3 files
    if tl_exists:
        total_clips = timeline.get("total_clips", 0)
        print(f"  Checking {total_clips} audio slices (from timeline.total_clips={total_clips})...")
        for i in range(1, total_clips + 1):
            slice_path = os.path.join(output_dir, "audio", f"slice-{nn(i)}.mp3")
            exists = os.path.exists(slice_path)
            detail = fmt_size(slice_path) if exists else "NOT FOUND"
            if not check(f"audio/slice-{nn(i)}.mp3", exists, detail):
                failures += 1

    return failures


def phase3(output_dir):
    print("\n[Phase 3] Checking keyframe image artifacts...")
    failures = 0

    timeline, timeline_path = load_timeline(output_dir)
    if timeline is None:
        print(f"  ❌ Cannot load timeline.json — cannot verify image count")
        return 1

    total_clips = timeline.get("total_clips", 0)
    print(f"  Checking {total_clips} keyframe images (from timeline.total_clips={total_clips})...")

    for i in range(1, total_clips + 1):
        # Full-size frame
        frame_path = os.path.join(output_dir, "images", f"frame-{nn(i)}.jpg")
        exists = os.path.exists(frame_path)
        detail = fmt_size(frame_path) if exists else "NOT FOUND"
        if not check(f"images/frame-{nn(i)}.jpg", exists, detail):
            failures += 1

        # Small frame (compressed for Veo)
        small_path = os.path.join(output_dir, "images", f"frame-{nn(i)}-small.jpg")
        exists = os.path.exists(small_path)
        detail = fmt_size(small_path) if exists else "NOT FOUND"
        if not check(f"images/frame-{nn(i)}-small.jpg", exists, detail):
            failures += 1

    return failures


def phase4(output_dir):
    print("\n[Phase 4] Checking clip generation artifacts...")
    failures = 0

    timeline, timeline_path = load_timeline(output_dir)
    if timeline is None:
        print(f"  ❌ Cannot load timeline.json — cannot verify clip count")
        return 1

    total_clips = timeline.get("total_clips", 0)
    print(f"  Checking {total_clips} clips (from timeline.total_clips={total_clips})...")

    for i in range(1, total_clips + 1):
        # clip-NN.mp4
        clip_path = os.path.join(output_dir, "clips", f"clip-{nn(i)}.mp4")
        exists = os.path.exists(clip_path)
        detail = fmt_size(clip_path) if exists else "NOT FOUND"
        if not check(f"clips/clip-{nn(i)}.mp4", exists, detail):
            failures += 1

        # prompts/clip-NN_prompt.md
        prompt_path = os.path.join(output_dir, "prompts", f"clip-{nn(i)}_prompt.md")
        exists = os.path.exists(prompt_path)
        detail = fmt_size(prompt_path) if exists else "NOT FOUND"
        if not check(f"prompts/clip-{nn(i)}_prompt.md", exists, detail):
            failures += 1

        # .validation/clip-NN.json
        val_path = os.path.join(output_dir, ".validation", f"clip-{nn(i)}.json")
        val_exists = os.path.exists(val_path)
        if not val_exists:
            if not check(f".validation/clip-{nn(i)}.json", False, "NOT FOUND"):
                failures += 1
        else:
            try:
                with open(val_path) as f:
                    val_data = json.load(f)
                # Support both flat format (sync_score at top) and nested (layer2_gemini.sync_score)
                sync_score = val_data.get("sync_score")
                if sync_score is None and "layer2_gemini" in val_data:
                    sync_score = val_data["layer2_gemini"].get("sync_score")
                text_contamination = val_data.get("text_contamination", False)
                if not text_contamination and "layer2_gemini" in val_data:
                    text_contamination = val_data["layer2_gemini"].get("text_contamination", False)

                score_ok = sync_score is not None and sync_score >= 7
                score_detail = f"sync_score={sync_score}" if sync_score is not None else "sync_score missing"
                if not check(f".validation/clip-{nn(i)}.json (sync_score >= 7)", score_ok, score_detail):
                    failures += 1

                # text_contamination is a warning only
                if text_contamination:
                    check(
                        f"clip-{nn(i)} text_contamination detected",
                        False,
                        "review clip for visible text artifacts",
                        warn=True
                    )

            except Exception as e:
                if not check(f".validation/clip-{nn(i)}.json (readable)", False, f"parse error: {e}"):
                    failures += 1

    return failures


def phase5(output_dir):
    print("\n[Phase 5] Checking final video artifacts...")
    failures = 0

    # Final video — accept common names
    candidates = ["final.mp4", "final-elevenlabs-overlay.mp4", "final-composite.mp4"]
    found_final = None
    for name in candidates:
        path = os.path.join(output_dir, name)
        if os.path.exists(path):
            found_final = path
            break

    if found_final:
        check("Final video exists", True, f"{os.path.basename(found_final)} — {fmt_size(found_final)}")
    else:
        if not check(
            "Final video exists (final.mp4 / final-elevenlabs-overlay.mp4 / final-composite.mp4)",
            False,
            "NOT FOUND"
        ):
            failures += 1

    # .validation/sync-report.json (self-healing sync analysis)
    sync_path = os.path.join(output_dir, ".validation", "sync-report.json")
    sync_exists = os.path.exists(sync_path)
    if not sync_exists:
        # Check for any sync-report-attempt-N.json with PASS verdict
        val_dir = os.path.join(output_dir, ".validation")
        if os.path.isdir(val_dir):
            for fname in sorted(os.listdir(val_dir)):
                if fname.startswith("sync-report-attempt-") and fname.endswith(".json"):
                    try:
                        with open(os.path.join(val_dir, fname)) as f:
                            data = json.load(f)
                        if data.get("verdict") == "PASS":
                            sync_exists = True
                            sync_path = os.path.join(val_dir, fname)
                            break
                    except Exception:
                        pass

    if not sync_exists:
        if not check(".validation/sync-report.json (sync analysis)", False, "NOT FOUND"):
            failures += 1
    else:
        try:
            with open(sync_path) as f:
                sync_data = json.load(f)
            verdict = sync_data.get("verdict", "FAIL")
            score = sync_data.get("overall_sync_score", 0)
            attempt = sync_data.get("attempt", "?")
            detail = f"verdict={verdict}, score={score}/10, attempt={attempt}"
            if not check(".validation/sync-report (PASS)", verdict == "PASS", detail):
                failures += 1
        except Exception as e:
            if not check(".validation/sync-report (readable)", False, f"parse error: {e}"):
                failures += 1

    # .validation/final-review.json (ship-readiness)
    review_path = os.path.join(output_dir, ".validation", "final-review.json")
    review_exists = os.path.exists(review_path)
    if not review_exists:
        if not check(".validation/final-review.json", False, "NOT FOUND"):
            failures += 1
    else:
        try:
            with open(review_path) as f:
                review_data = json.load(f)

            ship_ready = review_data.get("ship_ready")
            if ship_ready is None and "gemini_review" in review_data:
                ship_ready = review_data["gemini_review"].get("ship_ready")
            detail = f"ship_ready={ship_ready}"
            if not check(".validation/final-review.json (ship_ready)", bool(ship_ready), detail):
                failures += 1

        except Exception as e:
            if not check(".validation/final-review.json (readable)", False, f"parse error: {e}"):
                failures += 1

    return failures


# ── Main ──────────────────────────────────────────────────────────────────────

PHASE_MAP = {
    "2": phase2,
    "2.5": phase25,
    "3": phase3,
    "4": phase4,
    "5": phase5,
}


def main():
    parser = argparse.ArgumentParser(
        description="Phase gate validator for edu-video-gen pipeline"
    )
    parser.add_argument(
        "--phase",
        required=True,
        choices=list(PHASE_MAP.keys()),
        help="Phase completing: 2, 2.5, 3, 4, or 5"
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Project output directory"
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        help="Output results as JSON (for batch mode consumption)"
    )
    args = parser.parse_args()

    output_dir = os.path.expanduser(args.output_dir)
    if not os.path.isdir(output_dir):
        if args.json_output:
            print(json.dumps({"phase": args.phase, "passed": False, "failures": 1, "error": f"Directory not found: {output_dir}"}))
        else:
            print(f"❌ Output directory does not exist: {output_dir}")
        sys.exit(1)

    if not args.json_output:
        print(f"\n{'='*60}")
        print(f"  Checkpoint — Phase {args.phase}")
        print(f"  Directory: {output_dir}")
        print(f"{'='*60}")

    validator = PHASE_MAP[args.phase]
    failures = validator(output_dir)

    if args.json_output:
        print(json.dumps({"phase": args.phase, "passed": failures == 0, "failures": failures}))
    else:
        print(f"\n{'='*60}")
        if failures == 0:
            print(f"  ✅ Phase {args.phase} PASSED — all checks OK")
        else:
            print(f"  ❌ Phase {args.phase} FAILED — {failures} check(s) failed")
        print(f"{'='*60}\n")

    sys.exit(0 if failures == 0 else 1)


if __name__ == "__main__":
    main()
