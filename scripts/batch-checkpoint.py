#!/usr/bin/env python3
"""
batch-checkpoint.py — State tracker for batch video generation.

Reads and writes batch-status.json to track per-video progress across phases.

Usage:
  # Initialize batch status from manifest
  python3 batch-checkpoint.py --init --manifest batch.json --output-dir ./batch-output

  # Update a video's state
  python3 batch-checkpoint.py --update --video water-cycle --state IMAGING --progress "3/7 imgs" --status-file batch-status.json

  # Add cost to a video
  python3 batch-checkpoint.py --add-cost --video water-cycle --cost 100 --status-file batch-status.json

  # Mark a video as failed with error
  python3 batch-checkpoint.py --fail --video water-cycle --error "Veo 403 auth expired" --status-file batch-status.json

  # Add completed phase
  python3 batch-checkpoint.py --complete-phase --video water-cycle --phase 3 --status-file batch-status.json

  # Print status summary
  python3 batch-checkpoint.py --summary --status-file batch-status.json

  # Check if all videos are done (exit 0) or still in progress (exit 1)
  python3 batch-checkpoint.py --check-done --status-file batch-status.json
"""

import os
import sys
import json
import argparse
from datetime import datetime


VALID_STATES = [
    "PENDING", "SCRIPTING", "SCRIPT_REVIEW",
    "AUDIO", "AUDIO_REVIEW",
    "IMAGING", "IMAGE_REVIEW",
    "CLIPPING", "CLIP_REVIEW",
    "COMPOSITING", "VALIDATING",
    "DONE", "FAILED"
]


def load_status(status_file):
    """Load batch-status.json."""
    with open(status_file) as f:
        return json.load(f)


def save_status(status_file, data):
    """Save batch-status.json with updated timestamp."""
    data["last_updated"] = datetime.now().isoformat()
    # Recalculate totals
    total_cost = sum(v.get("cost_inr", 0) for v in data["videos"].values())
    data["total_cost_inr"] = total_cost
    with open(status_file, "w") as f:
        json.dump(data, f, indent=2)


def init_from_manifest(manifest_path, output_dir):
    """Create initial batch-status.json from a batch manifest."""
    with open(manifest_path) as f:
        manifest = json.load(f)

    batch = manifest["batch"]
    now = datetime.now()
    timestamp = now.strftime("%Y%m%d-%H%M%S")

    videos = {}
    for video in batch["videos"]:
        vid_id = video["id"]
        vid_dir = f"{vid_id}-{timestamp}"
        videos[vid_id] = {
            "state": "PENDING",
            "output_dir": vid_dir,
            "progress": "",
            "completed_phases": [],
            "errors": [],
            "cost_inr": 0,
        }

    status = {
        "batch_name": batch["name"],
        "manifest_path": os.path.abspath(manifest_path),
        "started_at": now.isoformat(),
        "last_updated": now.isoformat(),
        "review_mode": batch.get("review_mode", "normal"),
        "total_videos": len(batch["videos"]),
        "videos": videos,
        "total_cost_inr": 0,
    }

    status_file = os.path.join(output_dir, "batch-status.json")
    os.makedirs(output_dir, exist_ok=True)
    save_status(status_file, status)
    print(f"Initialized batch status: {status_file}")
    print(f"  Batch: {batch['name']}")
    print(f"  Videos: {len(videos)}")
    for vid_id, info in videos.items():
        print(f"    {vid_id} -> {info['output_dir']}/")
    return status_file


def update_state(status_file, video_id, state, progress=None):
    """Update a video's state and optional progress string."""
    data = load_status(status_file)
    if video_id not in data["videos"]:
        print(f"Unknown video id: {video_id}")
        sys.exit(1)
    if state not in VALID_STATES:
        print(f"Invalid state: {state}. Must be one of: {VALID_STATES}")
        sys.exit(1)

    data["videos"][video_id]["state"] = state
    if progress is not None:
        data["videos"][video_id]["progress"] = progress
    save_status(status_file, data)
    print(f"  {video_id}: state -> {state}" + (f" ({progress})" if progress else ""))


def add_cost(status_file, video_id, cost):
    """Add cost (INR) to a video's running total."""
    data = load_status(status_file)
    if video_id not in data["videos"]:
        print(f"Unknown video id: {video_id}")
        sys.exit(1)

    data["videos"][video_id]["cost_inr"] += cost
    save_status(status_file, data)
    print(f"  {video_id}: +Rs {cost} (total: Rs {data['videos'][video_id]['cost_inr']})")


def fail_video(status_file, video_id, error):
    """Mark a video as FAILED with error message."""
    data = load_status(status_file)
    if video_id not in data["videos"]:
        print(f"Unknown video id: {video_id}")
        sys.exit(1)

    data["videos"][video_id]["state"] = "FAILED"
    data["videos"][video_id]["errors"].append({
        "time": datetime.now().isoformat(),
        "message": error,
    })
    save_status(status_file, data)
    print(f"  {video_id}: FAILED — {error}")


def complete_phase(status_file, video_id, phase):
    """Add a phase to a video's completed_phases list."""
    data = load_status(status_file)
    if video_id not in data["videos"]:
        print(f"Unknown video id: {video_id}")
        sys.exit(1)

    phases = data["videos"][video_id]["completed_phases"]
    if phase not in phases:
        phases.append(phase)
    save_status(status_file, data)
    print(f"  {video_id}: completed phase {phase}")


def print_summary(status_file):
    """Print batch status summary table."""
    data = load_status(status_file)

    done = sum(1 for v in data["videos"].values() if v["state"] == "DONE")
    failed = sum(1 for v in data["videos"].values() if v["state"] == "FAILED")
    active = data["total_videos"] - done - failed

    print(f"\n{'='*62}")
    print(f"  BATCH: {data['batch_name']}  |  {data['total_videos']} videos  |  Rs {data['total_cost_inr']}")
    print(f"  Done: {done}  |  Active: {active}  |  Failed: {failed}")
    print(f"{'='*62}")
    print(f"  {'Video':<20} {'State':<14} {'Progress':<14} {'Cost':>8}")
    print(f"  {'─'*58}")

    for vid_id, info in data["videos"].items():
        state_icon = {
            "DONE": "DONE",
            "FAILED": "FAIL",
        }.get(info["state"], info["state"])

        print(f"  {vid_id:<20} {state_icon:<14} {info['progress']:<14} {info['cost_inr']:>6} Rs")

        if info["errors"]:
            for err in info["errors"]:
                print(f"    {err['message']}")

    print(f"  {'─'*58}")
    print(f"  {'TOTAL':<20} {'':14} {'':14} {data['total_cost_inr']:>6} Rs")
    print(f"{'='*62}\n")


def check_done(status_file):
    """Exit 0 if all videos are DONE or FAILED, 1 if any still in progress."""
    data = load_status(status_file)
    terminal = {"DONE", "FAILED"}
    all_done = all(v["state"] in terminal for v in data["videos"].values())

    if all_done:
        done = sum(1 for v in data["videos"].values() if v["state"] == "DONE")
        failed = sum(1 for v in data["videos"].values() if v["state"] == "FAILED")
        print(f"Batch complete: {done} done, {failed} failed")
        sys.exit(0)
    else:
        active = [vid for vid, v in data["videos"].items() if v["state"] not in terminal]
        print(f"Batch in progress: {len(active)} video(s) still active")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Batch status tracker for edu-vid-gen")

    # Actions (mutually exclusive)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--init", action="store_true", help="Initialize from manifest")
    group.add_argument("--update", action="store_true", help="Update video state")
    group.add_argument("--add-cost", action="store_true", help="Add cost to video")
    group.add_argument("--fail", action="store_true", help="Mark video as failed")
    group.add_argument("--complete-phase", action="store_true", help="Mark phase as completed")
    group.add_argument("--summary", action="store_true", help="Print status summary")
    group.add_argument("--check-done", action="store_true", help="Check if batch is complete")

    # Parameters
    parser.add_argument("--manifest", help="Path to batch.json (for --init)")
    parser.add_argument("--output-dir", help="Batch output directory (for --init)")
    parser.add_argument("--status-file", help="Path to batch-status.json")
    parser.add_argument("--video", help="Video id")
    parser.add_argument("--state", help="New state")
    parser.add_argument("--progress", help="Progress string (e.g. '3/7 imgs')")
    parser.add_argument("--cost", type=float, help="Cost to add (INR)")
    parser.add_argument("--error", help="Error message (for --fail)")
    parser.add_argument("--phase", help="Phase identifier (e.g. '2.5', '3')")

    args = parser.parse_args()

    if args.init:
        if not args.manifest or not args.output_dir:
            parser.error("--init requires --manifest and --output-dir")
        init_from_manifest(args.manifest, args.output_dir)

    elif args.update:
        if not args.status_file or not args.video or not args.state:
            parser.error("--update requires --status-file, --video, and --state")
        update_state(args.status_file, args.video, args.state, args.progress)

    elif args.add_cost:
        if not args.status_file or not args.video or args.cost is None:
            parser.error("--add-cost requires --status-file, --video, and --cost")
        add_cost(args.status_file, args.video, args.cost)

    elif args.fail:
        if not args.status_file or not args.video or not args.error:
            parser.error("--fail requires --status-file, --video, and --error")
        fail_video(args.status_file, args.video, args.error)

    elif args.complete_phase:
        if not args.status_file or not args.video or not args.phase:
            parser.error("--complete-phase requires --status-file, --video, and --phase")
        complete_phase(args.status_file, args.video, args.phase)

    elif args.summary:
        if not args.status_file:
            parser.error("--summary requires --status-file")
        print_summary(args.status_file)

    elif args.check_done:
        if not args.status_file:
            parser.error("--check-done requires --status-file")
        check_done(args.status_file)


if __name__ == "__main__":
    main()
