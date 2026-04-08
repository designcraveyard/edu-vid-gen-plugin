/** A single video clip on the timeline */
export interface VideoClipEdit {
  clip: number;
  file: string;            // relative path: "clips/clip-01.mp4"
  sourceDuration: number;  // original duration in seconds
  trimStart: number;       // seconds into source to start (default 0)
  trimEnd: number;         // seconds into source to end (default sourceDuration)
  timelineOffset: number;  // position on the timeline in seconds
  transitionOut: {
    type: string;          // "cut" | "fade" | "dissolve" | "wipeleft" | etc.
    duration: number;      // seconds
  } | null;
}

/** A single VO segment on the timeline */
export interface VOClipEdit {
  clip: number;
  file: string;            // relative path: "audio/vo-01.mp3"
  sourceDuration: number;
  trimStart: number;
  trimEnd: number;
  timelineOffset: number;
}

/** The full edited timeline written to edited-timeline.json */
export interface EditedTimeline {
  sourceTimeline: string;
  sourceMetadata: string;
  projectDir: string;
  framerate: number;
  tracks: {
    video: VideoClipEdit[];
    voiceover: VOClipEdit[];
  };
  totalDuration: number;
}

/** Pipeline's existing timeline.json clip entry */
export interface PipelineClip {
  clip: number;
  duration: number;
  audio_start: number;
  audio_end: number;
  phrases: { text: string; start: number; end: number }[];
  visual_suggestion: string;
}

/** Pipeline's existing timeline.json root */
export interface PipelineTimeline {
  voice: string;
  model: string;
  total_audio_duration: number;
  total_clips: number;
  clips: PipelineClip[];
}

/** Pipeline's metadata.json clip entry */
export interface MetadataClipEntry {
  file: string;
  model: string;
  duration: number;
  mode: string;
  start_frame?: string;
  end_frame?: string;
}

/** Pipeline's metadata.json root (subset of fields we need) */
export interface PipelineMetadata {
  project: {
    topic: string;
    class: string;
    duration_seconds: number;
    aspect_ratio: string;
    output_dir: string;
  };
  clips: MetadataClipEntry[];
  final_videos: Record<string, string>;
}

/** A media file discovered in the project */
export interface MediaFile {
  name: string;
  path: string;
  duration: number;
  clipNum: number;
}

/** What the load-project API returns */
export interface ProjectData {
  projectDir: string;
  metadata: PipelineMetadata;
  timeline: PipelineTimeline;
  videoFiles: MediaFile[];
  audioFiles: MediaFile[];
  tcFiles: MediaFile[];
  ambientFile: { name: string; path: string; duration: number } | null;
}

/** Available transition types (matches ffmpeg xfade transitions) */
export const TRANSITIONS = [
  'cut', 'fade', 'dissolve', 'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
  'circlecrop', 'rectcrop', 'circleclose', 'circleopen',
  'horzclose', 'horzopen', 'vertclose', 'vertopen',
  'diagbl', 'diagbr', 'diagtl', 'diagtr',
  'radial', 'zoomin', 'squeezeh', 'squeezev',
] as const;
export type TransitionType = (typeof TRANSITIONS)[number];
