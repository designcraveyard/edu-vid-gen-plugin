#!/usr/bin/env python3
"""
validate-manifest.py — Pre-flight validation + cost estimation for batch.json manifests.

Usage:
  python3 validate-manifest.py --manifest batch.json
  python3 validate-manifest.py --manifest batch.json --json-output

Exit codes: 0 = valid, 1 = errors found
"""

import os
import sys
import json
import argparse
from datetime import datetime


# ── Cost constants (INR) ─────────────────────────────────────────────────────

VEO_FAST_PER_SEC = 12.6      # Rs per second, veo-3.1-fast
VEO_STANDARD_PER_SEC = 33.6  # Rs per second, veo-3.1-generate
ELEVENLABS_PER_VIDEO = 25    # Rs approx per 60s video
GEMINI_PER_VIDEO = 5         # Rs approx (images + validation)
DEFAULT_CLIP_DURATION = 8    # seconds

# ── Schema validation ────────────────────────────────────────────────────────

REQUIRED_BATCH_FIELDS = ["name", "defaults", "videos"]
REQUIRED_DEFAULT_FIELDS = ["class", "narration_language", "visual_style",
                           "character_mode", "duration_seconds", "aspect_ratio"]
REQUIRED_VIDEO_FIELDS = ["id", "topic"]

VALID_STYLES = ["Pixar", "Clay", "2D Flat", "Doodle", "Watercolour", "Photorealistic"]
VALID_CHAR_MODES = ["human", "abstract", "none"]
VALID_ASPECTS = ["16:9", "9:16"]
VALID_DURATIONS = [60, 90]
VALID_STRATEGIES = ["ac_tc", "extend"]
VALID_VEO_MODES = ["fast", "standard"]
VALID_REVIEW_MODES = ["normal", "auto"]
VALID_AMBIENT = ["forest", "rain", "ocean", "space", "underwater",
                 "workshop", "lab", "garden", "auto", "none"]


def validate_manifest(manifest_path):
    """Validate batch.json and return (errors, warnings, data)."""
    errors = []
    warnings = []

    # ── File exists and is valid JSON ─────────────────────────────────────
    if not os.path.exists(manifest_path):
        return [f"Manifest file not found: {manifest_path}"], [], None

    try:
        with open(manifest_path) as f:
            raw = json.load(f)
    except json.JSONDecodeError as e:
        return [f"Invalid JSON: {e}"], [], None

    # ── Top-level structure ───────────────────────────────────────────────
    if "batch" not in raw:
        return ["Missing top-level 'batch' key"], [], None

    batch = raw["batch"]

    for field in REQUIRED_BATCH_FIELDS:
        if field not in batch:
            errors.append(f"Missing required field: batch.{field}")

    if errors:
        return errors, warnings, None

    # ── Defaults validation ───────────────────────────────────────────────
    defaults = batch["defaults"]
    for field in REQUIRED_DEFAULT_FIELDS:
        if field not in defaults:
            errors.append(f"Missing required default: batch.defaults.{field}")

    if defaults.get("visual_style") and defaults["visual_style"] not in VALID_STYLES:
        errors.append(f"Invalid visual_style: '{defaults['visual_style']}'. Must be one of: {VALID_STYLES}")

    if defaults.get("character_mode") and defaults["character_mode"] not in VALID_CHAR_MODES:
        errors.append(f"Invalid character_mode: '{defaults['character_mode']}'. Must be one of: {VALID_CHAR_MODES}")

    if defaults.get("aspect_ratio") and defaults["aspect_ratio"] not in VALID_ASPECTS:
        errors.append(f"Invalid aspect_ratio: '{defaults['aspect_ratio']}'. Must be one of: {VALID_ASPECTS}")

    if defaults.get("duration_seconds") and defaults["duration_seconds"] not in VALID_DURATIONS:
        errors.append(f"Invalid duration_seconds: {defaults['duration_seconds']}. Must be one of: {VALID_DURATIONS}")

    if defaults.get("video_strategy") and defaults["video_strategy"] not in VALID_STRATEGIES:
        errors.append(f"Invalid video_strategy: '{defaults['video_strategy']}'. Must be one of: {VALID_STRATEGIES}")

    if defaults.get("veo_mode") and defaults["veo_mode"] not in VALID_VEO_MODES:
        errors.append(f"Invalid veo_mode: '{defaults['veo_mode']}'. Must be one of: {VALID_VEO_MODES}")

    if defaults.get("ambient_category") and defaults["ambient_category"] not in VALID_AMBIENT:
        errors.append(f"Invalid ambient_category: '{defaults['ambient_category']}'. Must be one of: {VALID_AMBIENT}")

    # ── Review mode ───────────────────────────────────────────────────────
    review_mode = batch.get("review_mode", "normal")
    if review_mode not in VALID_REVIEW_MODES:
        errors.append(f"Invalid review_mode: '{review_mode}'. Must be one of: {VALID_REVIEW_MODES}")

    # ── Shared characters ─────────────────────────────────────────────────
    shared_chars = batch.get("shared_characters", [])
    char_names = set()
    for i, char in enumerate(shared_chars):
        if "name" not in char:
            errors.append(f"shared_characters[{i}]: missing 'name'")
        else:
            if char["name"] in char_names:
                errors.append(f"Duplicate shared character name: '{char['name']}'")
            char_names.add(char["name"])
        if "description" not in char and not char.get("reuse_from"):
            errors.append(f"shared_characters[{i}]: must have 'description' or 'reuse_from'")

    # ── Videos validation ─────────────────────────────────────────────────
    videos = batch["videos"]
    if not videos:
        errors.append("batch.videos is empty — need at least one video")

    video_ids = set()
    for i, video in enumerate(videos):
        prefix = f"videos[{i}]"

        for field in REQUIRED_VIDEO_FIELDS:
            if field not in video:
                errors.append(f"{prefix}: missing required field '{field}'")

        vid_id = video.get("id")
        if vid_id:
            if vid_id in video_ids:
                errors.append(f"{prefix}: duplicate id '{vid_id}'")
            video_ids.add(vid_id)
            # Check for filesystem-safe id
            if "/" in vid_id or "\\" in vid_id or " " in vid_id:
                errors.append(f"{prefix}: id '{vid_id}' contains invalid characters (no slashes or spaces)")

        # Validate overrides against known fields
        overrides = video.get("overrides", {})
        if overrides.get("visual_style") and overrides["visual_style"] not in VALID_STYLES:
            errors.append(f"{prefix}.overrides: invalid visual_style '{overrides['visual_style']}'")
        if overrides.get("duration_seconds") and overrides["duration_seconds"] not in VALID_DURATIONS:
            errors.append(f"{prefix}.overrides: invalid duration_seconds {overrides['duration_seconds']}")
        if overrides.get("aspect_ratio") and overrides["aspect_ratio"] not in VALID_ASPECTS:
            errors.append(f"{prefix}.overrides: invalid aspect_ratio '{overrides['aspect_ratio']}'")

        # Validate character references
        for char_name in video.get("characters", []):
            if char_name not in char_names:
                errors.append(f"{prefix}: references undefined character '{char_name}' (not in shared_characters)")

        # Warn if narration_text is very short
        narration = video.get("narration_text")
        if narration and len(narration.split()) < 30:
            warnings.append(f"{prefix}: narration_text is very short ({len(narration.split())} words) — may not fill duration")

    return errors, warnings, batch


def estimate_cost(batch):
    """Calculate estimated cost in INR for the batch."""
    videos = batch["videos"]
    defaults = batch["defaults"]
    veo_mode = defaults.get("veo_mode", "fast")
    veo_rate = VEO_FAST_PER_SEC if veo_mode == "fast" else VEO_STANDARD_PER_SEC

    estimates = []
    total = 0

    for video in videos:
        overrides = video.get("overrides", {})
        duration = overrides.get("duration_seconds", defaults.get("duration_seconds", 60))
        clips = duration // DEFAULT_CLIP_DURATION
        veo_cost = clips * DEFAULT_CLIP_DURATION * veo_rate
        audio_cost = ELEVENLABS_PER_VIDEO
        image_cost = GEMINI_PER_VIDEO
        video_total = veo_cost + audio_cost + image_cost

        estimates.append({
            "id": video["id"],
            "topic": video["topic"],
            "duration": duration,
            "clips": clips,
            "veo_cost": round(veo_cost),
            "audio_cost": audio_cost,
            "image_cost": image_cost,
            "total": round(video_total),
        })
        total += video_total

    # Shared character sheet cost (Gemini calls)
    char_count = len(batch.get("shared_characters", []))
    char_cost = char_count * 5  # ~Rs 5 per character sheet pair

    return estimates, round(total + char_cost), char_cost


def print_report(errors, warnings, batch, estimates, total_cost, char_cost):
    """Print human-readable validation report."""
    print(f"\n{'='*60}")
    print(f"  Batch Manifest Validation")
    print(f"{'='*60}")

    if errors:
        print(f"\n  ERRORS ({len(errors)}):")
        for err in errors:
            print(f"  {err}")

    if warnings:
        print(f"\n  WARNINGS ({len(warnings)}):")
        for warn in warnings:
            print(f"  {warn}")

    if not errors and batch:
        print(f"\n  Batch: {batch['name']}")
        print(f"  Videos: {len(batch['videos'])}")
        print(f"  Review mode: {batch.get('review_mode', 'normal')}")
        print(f"  Shared characters: {len(batch.get('shared_characters', []))}")
        print(f"  Style: {batch['defaults'].get('visual_style', 'N/A')}")
        print(f"  Veo mode: {batch['defaults'].get('veo_mode', 'fast')}")

        print(f"\n  {'─'*58}")
        print(f"  {'Video':<20} {'Clips':>6} {'Veo':>10} {'Audio':>8} {'Total':>10}")
        print(f"  {'─'*58}")
        for est in estimates:
            print(f"  {est['id']:<20} {est['clips']:>6} {est['veo_cost']:>8} Rs {est['audio_cost']:>6} Rs {est['total']:>8} Rs")
        if char_cost > 0:
            print(f"  {'characters':<20} {'':>6} {'':>10} {'':>8} {round(char_cost):>8} Rs")
        print(f"  {'─'*58}")
        print(f"  {'TOTAL':<20} {'':>6} {'':>10} {'':>8} {total_cost:>8} Rs")
        print(f"  {'─'*58}")

        # Time estimate (Veo-limited: ~75s per clip average)
        total_clips = sum(e["clips"] for e in estimates)
        est_minutes = round(total_clips * 75 / 60)
        print(f"\n  Estimated time: ~{est_minutes} min (Veo-limited, {total_clips} clips)")

    print(f"\n{'='*60}")
    if errors:
        print(f"  FAILED — {len(errors)} error(s)")
    else:
        print(f"  PASSED — manifest is valid")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(description="Validate batch.json manifest for edu-vid-gen")
    parser.add_argument("--manifest", required=True, help="Path to batch.json")
    parser.add_argument("--json-output", action="store_true", help="Output results as JSON")
    args = parser.parse_args()

    manifest_path = os.path.expanduser(args.manifest)
    errors, warnings, batch = validate_manifest(manifest_path)

    estimates, total_cost, char_cost = [], 0, 0
    if not errors and batch:
        estimates, total_cost, char_cost = estimate_cost(batch)

    if args.json_output:
        result = {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "cost_estimate": {
                "videos": estimates,
                "character_cost_inr": char_cost,
                "total_inr": total_cost,
            } if not errors else None,
        }
        print(json.dumps(result, indent=2))
    else:
        print_report(errors, warnings, batch, estimates, total_cost, char_cost)

    sys.exit(0 if not errors else 1)


if __name__ == "__main__":
    main()
