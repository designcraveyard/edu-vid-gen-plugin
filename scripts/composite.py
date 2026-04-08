#!/usr/bin/env python3
"""
composite.py — MoviePy timestamp compositor for VO-driven video pipeline.

Places clips at their VO timestamps from timeline.json. VO is the master clock.
Transitions ADD duration, never eat it.
"""

import argparse
import json
import math
import subprocess
import sys
import os
import numpy as np

from moviepy import (
    VideoFileClip, AudioFileClip, ImageClip,
    CompositeVideoClip, CompositeAudioClip,
    concatenate_audioclips, concatenate_videoclips, vfx
)


def parse_args():
    p = argparse.ArgumentParser(description="MoviePy timestamp compositor")
    p.add_argument("--clips-dir", required=True, help="Directory with clip-NN.mp4 files")
    p.add_argument("--timeline", required=True, help="Path to timeline.json")
    p.add_argument("--vo-audio", required=True, help="Path to full-vo.mp3")
    p.add_argument("--output", required=True, help="Output path for final video")
    p.add_argument("--veo-tcs-dir", default=None, help="Optional directory with Veo transition clips (tc-NN.mp4)")
    p.add_argument("--sfx-volume", type=float, default=0.35, help="Veo SFX volume (default 0.35)")
    p.add_argument("--ambient", default=None, help="Path to ambient loop MP3 file")
    p.add_argument("--ambient-volume", type=float, default=0.15, help="Ambient loop volume (default 0.15)")
    return p.parse_args()


def get_clip_path(clips_dir, clip_num):
    return os.path.join(clips_dir, f"clip-{clip_num:02d}.mp4")


def get_tc_path(tcs_dir, tc_num):
    if tcs_dir is None:
        return None
    path = os.path.join(tcs_dir, f"tc-{tc_num:02d}.mp4")
    return path if os.path.exists(path) else None


def ffprobe_duration(path):
    """Get duration via ffprobe."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path],
            capture_output=True, text=True
        )
        info = json.loads(result.stdout)
        return float(info["format"]["duration"])
    except Exception:
        return None


def main():
    args = parse_args()

    # Load timeline
    with open(args.timeline) as f:
        timeline = json.load(f)

    clips_data = timeline["clips"]
    total_duration = clips_data[-1]["audio_end"]

    print(f"Timeline: {len(clips_data)} clips, total VO duration: {total_duration:.3f}s")

    # Detect video size from first clip
    probe_clip = VideoFileClip(get_clip_path(args.clips_dir, clips_data[0]["clip"]))
    video_size = probe_clip.size  # (width, height)
    print(f"Video size: {video_size[0]}x{video_size[1]}")
    probe_clip.close()

    video_layers = []
    audio_layers = []

    # Load VO as master audio
    vo_audio = AudioFileClip(args.vo_audio)
    audio_layers.append(vo_audio)

    for i, cd in enumerate(clips_data):
        clip_num = cd["clip"]
        audio_start = cd["audio_start"]
        audio_end = cd["audio_end"]
        vo_segment_dur = audio_end - audio_start

        clip_path = get_clip_path(args.clips_dir, clip_num)
        if not os.path.exists(clip_path):
            print(f"WARNING: {clip_path} not found, skipping")
            continue

        print(f"  clip-{clip_num:02d}: start={audio_start:.3f}s, vo_dur={vo_segment_dur:.3f}s", end="")

        vclip = VideoFileClip(clip_path)
        clip_video_dur = vclip.duration
        print(f", video_dur={clip_video_dur:.3f}s")

        # Determine how long this clip needs to cover
        if i + 1 < len(clips_data):
            next_start = clips_data[i + 1]["audio_start"]
        else:
            next_start = total_duration

        needed_dur = next_start - audio_start

        # Extract SFX audio from clip (Veo native audio)
        if vclip.audio is not None:
            sfx = vclip.audio.with_volume_scaled(args.sfx_volume)
            sfx = sfx.with_start(audio_start)
            audio_layers.append(sfx)

        # If video is shorter than needed, extend with freeze frame
        if clip_video_dur < needed_dur - 0.1:
            freeze_dur = needed_dur - clip_video_dur
            print(f"    -> extending by {freeze_dur:.3f}s (freeze last frame)")

            # Get last frame
            last_frame = vclip.get_frame(clip_video_dur - 0.04)
            freeze = ImageClip(last_frame).with_duration(freeze_dur)

            # Try Ken Burns subtle zoom on freeze
            try:
                freeze = freeze.resized(lambda t: 1 + 0.03 * (t / freeze_dur))
                # Ensure output size matches
                freeze = freeze.with_position("center")
            except Exception:
                print("    -> Ken Burns failed, using static freeze")

            # Concatenate clip + freeze
            vclip_extended = concatenate_videoclips([vclip, freeze])
            vclip = vclip_extended
        else:
            # Trim if video is longer than needed (unless it's the last clip)
            if i + 1 < len(clips_data) and clip_video_dur > needed_dur + 0.5:
                vclip = vclip.subclipped(0, needed_dur)

        # Strip audio from video layer (we mix separately)
        vclip = vclip.without_audio()

        # Place at timeline position
        vclip = vclip.with_start(audio_start)
        video_layers.append(vclip)

        # Insert transition clip if available
        if i + 1 < len(clips_data) and args.veo_tcs_dir:
            tc_path = get_tc_path(args.veo_tcs_dir, clip_num)
            if tc_path:
                tc = VideoFileClip(tc_path).without_audio()
                # Place TC in the gap between this clip's video end and next clip start
                tc_start = audio_start + clip_video_dur
                if tc_start < next_start:
                    tc = tc.with_start(tc_start)
                    video_layers.append(tc)
                    print(f"    -> TC-{clip_num:02d} at {tc_start:.3f}s")

    # Composite all video layers
    print(f"\nCompositing {len(video_layers)} video layers...")
    final_video = CompositeVideoClip(video_layers, size=(video_size[0], video_size[1]))
    final_video = final_video.with_duration(total_duration)

    # Add ambient loop layer if provided
    if args.ambient and os.path.exists(args.ambient):
        ambient = AudioFileClip(args.ambient)
        loops_needed = math.ceil(total_duration / ambient.duration)
        ambient_looped = concatenate_audioclips([ambient] * loops_needed).subclipped(0, total_duration)
        ambient_looped = ambient_looped.with_volume_scaled(args.ambient_volume)
        audio_layers.append(ambient_looped)
        print(f"Ambient layer: {args.ambient} ({ambient.duration:.1f}s x{loops_needed} loops, vol={args.ambient_volume})")
    elif args.ambient:
        print(f"WARNING: Ambient file not found: {args.ambient}")

    # Composite all audio layers
    print(f"Mixing {len(audio_layers)} audio layers...")
    final_audio = CompositeAudioClip(audio_layers)
    final_video = final_video.with_audio(final_audio)

    # Write output
    print(f"\nWriting to {args.output}...")
    final_video.write_videofile(
        args.output,
        codec="libx264",
        audio_codec="aac",
        fps=24,
        preset="fast",
        logger="bar"
    )

    # Duration verification
    actual_dur = ffprobe_duration(args.output)
    if actual_dur:
        drift = abs(actual_dur - total_duration)
        print(f"\nExpected duration: {total_duration:.3f}s")
        print(f"Actual duration:  {actual_dur:.3f}s")
        print(f"Drift:            {drift:.3f}s")
        if drift > 0.5:
            print("WARNING: Drift exceeds 0.5s!")
        else:
            print("OK: Drift within tolerance.")
    else:
        print("WARNING: Could not verify duration via ffprobe.")

    # Cleanup
    for vl in video_layers:
        try:
            vl.close()
        except Exception:
            pass
    vo_audio.close()

    print("Done.")


if __name__ == "__main__":
    main()
