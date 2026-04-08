#!/usr/bin/env python3
"""
composite-video-first.py — Video-first MoviePy compositor.

Video is the master clock. ACs and TCs are concatenated sequentially with
0.75s crossfade dissolves. VO slices are placed at each AC's calculated
start time. Final video duration >= VO duration.

3-layer audio stack:
  1. VO slices at AC start times (100%)
  2. Veo SFX per clip (configurable, default 35%)
  3. Ambient loop to total video length (configurable, default 15%)
"""

import argparse
import json
import math
import subprocess
import sys
import os

from moviepy import (
    VideoFileClip, AudioFileClip, ImageClip,
    CompositeVideoClip, CompositeAudioClip,
    concatenate_audioclips, concatenate_videoclips, vfx
)


def parse_args():
    p = argparse.ArgumentParser(description="Video-first MoviePy compositor")
    p.add_argument("--clips-dir", required=True, help="Directory with clip-NN.mp4 files")
    p.add_argument("--timeline", required=True, help="Path to timeline.json")
    p.add_argument("--vo-audio", required=True, help="Path to full-vo.mp3")
    p.add_argument("--vo-slices-dir", default=None, help="Directory with slice-NN.mp3 files (defaults to same dir as vo-audio)")
    p.add_argument("--output", required=True, help="Output path for final video")
    p.add_argument("--veo-tcs-dir", default=None, help="Directory with Veo transition clips (tc-NN.mp4)")
    p.add_argument("--sfx-volume", type=float, default=0.35, help="Veo SFX volume (default 0.35)")
    p.add_argument("--ambient", default=None, help="Path to ambient loop MP3 file")
    p.add_argument("--ambient-volume", type=float, default=0.15, help="Ambient loop volume (default 0.15)")
    p.add_argument("--xfade", type=float, default=0.75, help="Crossfade duration in seconds (default 0.75)")
    return p.parse_args()


def ffprobe_duration(path):
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
    XFADE = args.xfade

    # Load timeline
    with open(args.timeline) as f:
        timeline = json.load(f)

    clips_data = timeline["clips"]
    n_clips = len(clips_data)
    vo_duration = clips_data[-1]["audio_end"]

    # Resolve VO slices directory
    vo_slices_dir = args.vo_slices_dir or os.path.dirname(args.vo_audio)

    print(f"Timeline: {n_clips} clips, VO duration: {vo_duration:.3f}s")
    print(f"Crossfade: {XFADE}s")

    # ── Step 1: Build segment list [AC1, TC1, AC2, TC2, ..., ACn] ──

    segments = []  # list of (type, path, clip_num)
    for i, cd in enumerate(clips_data):
        clip_num = cd["clip"]
        clip_path = os.path.join(args.clips_dir, f"clip-{clip_num:02d}.mp4")
        if not os.path.exists(clip_path):
            print(f"ERROR: {clip_path} not found")
            sys.exit(1)
        segments.append(("AC", clip_path, clip_num))

        # Add TC after every AC except the last
        if i < n_clips - 1 and args.veo_tcs_dir:
            tc_path = os.path.join(args.veo_tcs_dir, f"tc-{clip_num:02d}.mp4")
            if os.path.exists(tc_path):
                segments.append(("TC", tc_path, clip_num))
            else:
                print(f"  WARNING: TC-{clip_num:02d} not found at {tc_path}, skipping transition")

    print(f"\nSegment order ({len(segments)} segments):")
    for seg_type, seg_path, seg_num in segments:
        dur = ffprobe_duration(seg_path) or 0
        print(f"  {seg_type}-{seg_num:02d}: {os.path.basename(seg_path)} ({dur:.1f}s)")

    # ── Step 2: Load clips, extract SFX, apply crossfade effects ──

    video_clips = []
    sfx_layers = []
    segment_starts = []
    running = 0.0

    for i, (seg_type, seg_path, seg_num) in enumerate(segments):
        vclip = VideoFileClip(seg_path)
        segment_starts.append(running)

        # Extract SFX audio before stripping
        if vclip.audio is not None:
            sfx = vclip.audio.with_volume_scaled(args.sfx_volume)
            sfx = sfx.with_start(running)
            sfx_layers.append(sfx)

        # Strip audio from video
        vclip = vclip.without_audio()

        # Apply crossfade effects
        if i > 0:
            vclip = vclip.with_effects([vfx.CrossFadeIn(XFADE)])
        if i < len(segments) - 1:
            vclip = vclip.with_effects([vfx.CrossFadeOut(XFADE)])

        video_clips.append(vclip)

        # Advance running time (subtract overlap for all but last)
        if i < len(segments) - 1:
            running += vclip.duration - XFADE
        else:
            running += vclip.duration

    total_video_duration = running
    print(f"\nTotal video duration: {total_video_duration:.3f}s (VO: {vo_duration:.3f}s, delta: {total_video_duration - vo_duration:+.3f}s)")

    # ── Step 3: Concatenate video with crossfade padding ──

    print(f"\nConcatenating {len(video_clips)} video segments with padding={-XFADE}...")
    final_video = concatenate_videoclips(video_clips, padding=-XFADE, method="compose")

    # ── Step 4: Place VO slices at AC start times ──

    audio_layers = []

    # Find AC indices and their start times
    ac_index = 0
    for i, (seg_type, seg_path, seg_num) in enumerate(segments):
        if seg_type == "AC":
            slice_path = os.path.join(vo_slices_dir, f"slice-{seg_num:02d}.mp3")
            if os.path.exists(slice_path):
                vo_slice = AudioFileClip(slice_path)
                vo_slice = vo_slice.with_start(segment_starts[i])
                audio_layers.append(vo_slice)
                print(f"  VO slice-{seg_num:02d} at {segment_starts[i]:.3f}s ({vo_slice.duration:.1f}s)")
            else:
                print(f"  WARNING: {slice_path} not found")
            ac_index += 1

    # ── Step 5: Add SFX layers ──

    audio_layers.extend(sfx_layers)
    print(f"\nSFX layers: {len(sfx_layers)} (volume: {args.sfx_volume})")

    # ── Step 6: Add ambient loop ──

    if args.ambient and os.path.exists(args.ambient):
        ambient = AudioFileClip(args.ambient)
        loops_needed = math.ceil(total_video_duration / ambient.duration)
        ambient_looped = concatenate_audioclips([ambient] * loops_needed).subclipped(0, total_video_duration)
        ambient_looped = ambient_looped.with_volume_scaled(args.ambient_volume)
        audio_layers.append(ambient_looped)
        print(f"Ambient: {args.ambient} ({ambient.duration:.1f}s x{loops_needed} loops, vol={args.ambient_volume})")
    elif args.ambient:
        print(f"WARNING: Ambient file not found: {args.ambient}")

    # ── Step 7: Composite and write ──

    print(f"\nMixing {len(audio_layers)} audio layers...")
    final_audio = CompositeAudioClip(audio_layers)
    final_video = final_video.with_audio(final_audio)

    print(f"Writing to {args.output}...")
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
        print(f"\nExpected: {total_video_duration:.3f}s")
        print(f"Actual:   {actual_dur:.3f}s")
        print(f"Drift:    {abs(actual_dur - total_video_duration):.3f}s")
    else:
        print("WARNING: Could not verify duration via ffprobe.")

    # Cleanup
    for vc in video_clips:
        try:
            vc.close()
        except Exception:
            pass

    print("Done.")


if __name__ == "__main__":
    main()
