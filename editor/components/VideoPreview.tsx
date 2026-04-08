'use client';

import { useEffect, useRef, useMemo, useState } from 'react';
import { VideoClipEdit, VOClipEdit } from '../lib/types';

interface VideoPreviewProps {
  videoClips: VideoClipEdit[];
  voClips: VOClipEdit[];
  projectDir: string;
  currentTime: number;
  isPlaying: boolean;
  muteVideo?: boolean;
  playFullAudio?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  totalDuration: number;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function findActiveClip(clips: VideoClipEdit[], currentTime: number): VideoClipEdit | null {
  for (const clip of clips) {
    const clipEnd = clip.timelineOffset + (clip.trimEnd - clip.trimStart);
    if (currentTime >= clip.timelineOffset && currentTime < clipEnd) {
      return clip;
    }
  }
  return null;
}

function findActiveVO(clips: VOClipEdit[], currentTime: number): VOClipEdit | null {
  for (const clip of clips) {
    const clipEnd = clip.timelineOffset + (clip.trimEnd - clip.trimStart);
    if (currentTime >= clip.timelineOffset && currentTime < clipEnd) {
      return clip;
    }
  }
  return null;
}

// ─── Transition CSS effect mapper ──────────────────────────────────────────────
// Maps ffmpeg xfade transition names to CSS styles for the INCOMING clip.
// progress: 0 (start of transition) → 1 (end of transition).
// The outgoing clip is always fully visible underneath; the incoming clip
// reveals itself on top using these CSS properties.

interface TransitionStyle {
  opacity?: number;
  clipPath?: string;
  transform?: string;
}

function getIncomingStyle(type: string, progress: number): TransitionStyle {
  const p = Math.max(0, Math.min(1, progress));
  const pct = p * 100;

  switch (type) {
    // ── Opacity-based ──────────────────────────────────────────────
    case 'fade':
    case 'dissolve':
      return { opacity: p };

    // ── Wipes (reveal via clip-path inset) ─────────────────────────
    case 'wipeleft':
      return { clipPath: `inset(0 0 0 ${100 - pct}%)` };
    case 'wiperight':
      return { clipPath: `inset(0 ${100 - pct}% 0 0)` };
    case 'wipeup':
      return { clipPath: `inset(0 0 ${100 - pct}% 0)` };
    case 'wipedown':
      return { clipPath: `inset(${100 - pct}% 0 0 0)` };

    // ── Slides (incoming slides in from off-screen) ────────────────
    case 'slideleft':
      return { transform: `translateX(${100 - pct}%)` };
    case 'slideright':
      return { transform: `translateX(${-(100 - pct)}%)` };
    case 'slideup':
      return { transform: `translateY(${100 - pct}%)` };
    case 'slidedown':
      return { transform: `translateY(${-(100 - pct)}%)` };

    // ── Smooth (wipe + slight slide) ───────────────────────────────
    case 'smoothleft':
      return { clipPath: `inset(0 0 0 ${100 - pct}%)`, transform: `translateX(${(1 - p) * 10}%)` };
    case 'smoothright':
      return { clipPath: `inset(0 ${100 - pct}% 0 0)`, transform: `translateX(${-(1 - p) * 10}%)` };
    case 'smoothup':
      return { clipPath: `inset(0 0 ${100 - pct}% 0)`, transform: `translateY(${(1 - p) * 10}%)` };
    case 'smoothdown':
      return { clipPath: `inset(${100 - pct}% 0 0 0)`, transform: `translateY(${-(1 - p) * 10}%)` };

    // ── Circle (reveal via circle clip-path) ───────────────────────
    case 'circlecrop':
    case 'circleopen':
      return { clipPath: `circle(${pct * 0.75}% at 50% 50%)` };
    case 'circleclose': {
      const r = (1 - p) * 75;
      return { clipPath: `circle(${r}% at 50% 50%)`, opacity: r < 5 ? 0 : 1 };
    }

    // ── Rect crop ──────────────────────────────────────────────────
    case 'rectcrop': {
      const margin = (1 - p) * 50;
      return { clipPath: `inset(${margin}% ${margin}% ${margin}% ${margin}%)` };
    }

    // ── Horizontal/vertical close/open (barn door) ─────────────────
    case 'horzopen': {
      const half = (1 - p) * 50;
      return { clipPath: `inset(0 ${half}% 0 ${half}%)` };
    }
    case 'horzclose':
      return { clipPath: `inset(0 ${pct / 2}% 0 ${pct / 2}%)`, opacity: p < 0.05 ? 0 : 1 };
    case 'vertopen': {
      const halfV = (1 - p) * 50;
      return { clipPath: `inset(${halfV}% 0 ${halfV}% 0)` };
    }
    case 'vertclose':
      return { clipPath: `inset(${pct / 2}% 0 ${pct / 2}% 0)`, opacity: p < 0.05 ? 0 : 1 };

    // ── Diagonal wipes ─────────────────────────────────────────────
    case 'diagbl':
      return { clipPath: `polygon(0 ${100 - pct}%, ${pct}% 100%, 0 100%)`, opacity: p < 0.02 ? 0 : 1 };
    case 'diagbr':
      return { clipPath: `polygon(${100 - pct}% 100%, 100% ${100 - pct}%, 100% 100%)`, opacity: p < 0.02 ? 0 : 1 };
    case 'diagtl':
      return { clipPath: `polygon(0 0, ${pct}% 0, 0 ${pct}%)`, opacity: p < 0.02 ? 0 : 1 };
    case 'diagtr':
      return { clipPath: `polygon(${100 - pct}% 0, 100% 0, 100% ${pct}%)`, opacity: p < 0.02 ? 0 : 1 };

    // ── Radial ─────────────────────────────────────────────────────
    case 'radial': {
      // Simulate radial wipe with a conic-gradient mask isn't possible via
      // clip-path alone, so approximate with expanding circle + fade.
      return { clipPath: `circle(${pct * 0.8}% at 50% 50%)`, opacity: Math.min(1, p * 1.5) };
    }

    // ── Zoom in ────────────────────────────────────────────────────
    case 'zoomin':
      return { opacity: p, transform: `scale(${1 + (1 - p) * 0.3})` };

    // ── Squeeze ────────────────────────────────────────────────────
    case 'squeezeh':
      return { transform: `scaleX(${p})` };
    case 'squeezev':
      return { transform: `scaleY(${p})` };

    // ── Fallback: dissolve ─────────────────────────────────────────
    default:
      return { opacity: p };
  }
}

// For "close" transitions, the OUTGOING clip is the one that gets the effect
// (it closes down to reveal the incoming clip underneath).
function isOutgoingEffect(type: string): boolean {
  return type === 'circleclose' || type === 'horzclose' || type === 'vertclose';
}

function getOutgoingStyle(type: string, progress: number): TransitionStyle {
  const p = Math.max(0, Math.min(1, progress));

  switch (type) {
    case 'circleclose':
      return { clipPath: `circle(${(1 - p) * 75}% at 50% 50%)` };
    case 'horzclose': {
      const half = (1 - p) * 50;
      return { clipPath: `inset(0 ${50 - half}% 0 ${50 - half}%)` };
    }
    case 'vertclose': {
      const halfV = (1 - p) * 50;
      return { clipPath: `inset(${50 - halfV}% 0 ${50 - halfV}% 0)` };
    }
    default:
      return {};
  }
}

// ─── Transition state ──────────────────────────────────────────────────────────

interface TransitionInfo {
  type: string;
  progress: number;     // 0 → 1
  outgoingClip: VideoClipEdit;
  incomingClip: VideoClipEdit;
}

function findTransition(
  videoClips: VideoClipEdit[],
  currentTime: number
): TransitionInfo | null {
  for (let i = 0; i < videoClips.length - 1; i++) {
    const outClip = videoClips[i];
    if (!outClip.transitionOut || outClip.transitionOut.type === 'cut') continue;

    const clipEnd = outClip.timelineOffset + (outClip.trimEnd - outClip.trimStart);
    const transDur = outClip.transitionOut.duration;
    const transStart = clipEnd - transDur;

    if (currentTime >= transStart && currentTime < clipEnd) {
      const inClip = videoClips[i + 1];
      const progress = (currentTime - transStart) / transDur;
      return {
        type: outClip.transitionOut.type,
        progress,
        outgoingClip: outClip,
        incomingClip: inClip,
      };
    }
  }
  return null;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function VideoPreview({
  videoClips,
  voClips,
  projectDir,
  currentTime,
  isPlaying,
  muteVideo = false,
  playFullAudio = false,
  onPlay,
  onPause,
  onSeek,
  totalDuration,
}: VideoPreviewProps) {
  // Two video elements for transition cross-fades
  const videoRef = useRef<HTMLVideoElement>(null);       // primary (current/outgoing)
  const videoOverRef = useRef<HTMLVideoElement>(null);    // overlay (incoming during transition)
  const audioRef = useRef<HTMLAudioElement>(null);
  const fullAudioRef = useRef<HTMLAudioElement>(null);
  const fullAudioLoadedRef = useRef(false);
  const loadedClipIndexRef = useRef<number | null>(null);
  const loadedOverClipIndexRef = useRef<number | null>(null);
  const loadedVOIndexRef = useRef<number | null>(null);

  const activeClip = findActiveClip(videoClips, currentTime);
  const activeVO = findActiveVO(voClips, currentTime);
  const transition = useMemo(() => findTransition(videoClips, currentTime), [videoClips, currentTime]);

  // ── Primary clip switching ─────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (activeClip === null) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      loadedClipIndexRef.current = null;
      return;
    }

    const clipChanged = loadedClipIndexRef.current !== activeClip.clip;
    if (!clipChanged) return;

    const src = `/project/${activeClip.file}`;
    video.src = src;
    video.load();
    loadedClipIndexRef.current = activeClip.clip;

    const targetLocalTime = currentTime - activeClip.timelineOffset + activeClip.trimStart;
    const shouldPlay = isPlaying;

    const onCanPlay = () => {
      video.currentTime = Math.max(0, targetLocalTime);
      if (shouldPlay) {
        video.play().catch(() => {});
      }
    };

    video.addEventListener('canplay', onCanPlay, { once: true });
    return () => {
      video.removeEventListener('canplay', onCanPlay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClip?.clip, projectDir]);

  // ── Overlay clip switching (incoming clip during transition) ────────────────
  useEffect(() => {
    const video = videoOverRef.current;
    if (!video) return;

    if (!transition) {
      // No transition — hide overlay
      if (loadedOverClipIndexRef.current !== null) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        loadedOverClipIndexRef.current = null;
      }
      return;
    }

    const inClip = transition.incomingClip;
    const clipChanged = loadedOverClipIndexRef.current !== inClip.clip;
    if (!clipChanged) return;

    const src = `/project/${inClip.file}`;
    video.src = src;
    video.load();
    loadedOverClipIndexRef.current = inClip.clip;

    const targetLocalTime = currentTime - inClip.timelineOffset + inClip.trimStart;
    const shouldPlay = isPlaying;

    const onCanPlay = () => {
      video.currentTime = Math.max(0, targetLocalTime);
      if (shouldPlay) {
        video.play().catch(() => {});
      }
    };

    video.addEventListener('canplay', onCanPlay, { once: true });
    return () => {
      video.removeEventListener('canplay', onCanPlay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transition?.incomingClip.clip]);

  // ── Overlay time sync ──────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoOverRef.current;
    if (!video || !transition) return;

    const inClip = transition.incomingClip;
    const localTime = currentTime - inClip.timelineOffset + inClip.trimStart;
    const drift = Math.abs(video.currentTime - localTime);

    if (drift > 0.3) {
      video.currentTime = Math.max(0, localTime);
    }
  }, [currentTime, transition]);

  // ── Overlay play/pause sync ────────────────────────────────────────────────
  useEffect(() => {
    const video = videoOverRef.current;
    if (!video) return;

    if (!transition) {
      if (!video.paused) video.pause();
      return;
    }

    if (isPlaying && video.paused) {
      video.play().catch(() => {});
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [isPlaying, transition]);

  // ── Primary time sync ─────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || activeClip === null) return;

    const localTime = currentTime - activeClip.timelineOffset + activeClip.trimStart;
    const drift = Math.abs(video.currentTime - localTime);

    if (drift > 0.3) {
      video.currentTime = Math.max(0, localTime);
    }
  }, [currentTime, activeClip]);

  // ── Primary play/pause sync ────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || activeClip === null) return;

    if (isPlaying && video.paused) {
      video.play().catch(() => {});
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [isPlaying, activeClip]);

  // ── VO audio clip switching ────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (activeVO === null) {
      audio.pause();
      audio.removeAttribute('src');
      loadedVOIndexRef.current = null;
      return;
    }

    if (loadedVOIndexRef.current !== activeVO.clip) {
      const src = `/project/${activeVO.file}`;
      audio.src = src;
      audio.load();
      loadedVOIndexRef.current = activeVO.clip;

      const localTime = currentTime - activeVO.timelineOffset + activeVO.trimStart;
      audio.addEventListener('canplay', () => {
        audio.currentTime = Math.max(0, localTime);
        if (isPlaying) audio.play().catch(() => {});
      }, { once: true });
    }
  }, [activeVO?.clip]);

  // ── VO time sync ───────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || activeVO === null) return;

    const localTime = currentTime - activeVO.timelineOffset + activeVO.trimStart;
    if (Math.abs(audio.currentTime - localTime) > 0.3) {
      audio.currentTime = Math.max(0, localTime);
    }
  }, [currentTime, activeVO]);

  // ── VO play/pause sync ─────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (activeVO === null) {
      audio.pause();
      return;
    }

    if (isPlaying && audio.paused) {
      audio.play().catch(() => {});
    } else if (!isPlaying && !audio.paused) {
      audio.pause();
    }
  }, [isPlaying, activeVO]);

  // ── Full Audio (full-vo.mp3) playback ──────────────────────────────────────
  useEffect(() => {
    const audio = fullAudioRef.current;
    if (!audio) return;
    if (playFullAudio && !fullAudioLoadedRef.current) {
      audio.src = `/project/audio/full-vo.mp3`;
      audio.load();
      fullAudioLoadedRef.current = true;
    }
  }, [playFullAudio]);

  useEffect(() => {
    const audio = fullAudioRef.current;
    if (!audio || !playFullAudio) {
      audio?.pause();
      return;
    }
    if (Math.abs(audio.currentTime - currentTime) > 0.3) {
      audio.currentTime = Math.max(0, currentTime);
    }
  }, [currentTime, playFullAudio]);

  useEffect(() => {
    const audio = fullAudioRef.current;
    if (!audio || !playFullAudio) {
      audio?.pause();
      return;
    }
    if (isPlaying && audio.paused) {
      audio.play().catch(() => {});
    } else if (!isPlaying && !audio.paused) {
      audio.pause();
    }
  }, [isPlaying, playFullAudio]);

  // ── Compute transition styles ──────────────────────────────────────────────
  const primaryStyle: React.CSSProperties = { display: activeClip ? 'block' : 'none' };
  const overlayStyle: React.CSSProperties = { display: 'none' };
  let transLabel = '';

  if (transition) {
    const { type, progress } = transition;
    const useOutgoing = isOutgoingEffect(type);
    transLabel = `${type} ${Math.round(progress * 100)}%`;

    if (useOutgoing) {
      // "Close" effects: outgoing clip gets the shrinking effect, incoming is fully visible underneath
      const outStyle = getOutgoingStyle(type, progress);
      primaryStyle.clipPath = outStyle.clipPath;
      if (outStyle.opacity !== undefined) primaryStyle.opacity = outStyle.opacity;
      // Show incoming clip underneath (z-index lower)
      overlayStyle.display = 'block';
      overlayStyle.zIndex = 0;
      primaryStyle.zIndex = 1;
    } else {
      // Normal: incoming clip reveals on top with effect
      const inStyle = getIncomingStyle(type, progress);
      overlayStyle.display = 'block';
      overlayStyle.opacity = inStyle.opacity ?? 1;
      overlayStyle.clipPath = inStyle.clipPath;
      overlayStyle.transform = inStyle.transform;
      overlayStyle.zIndex = 1;
      primaryStyle.zIndex = 0;
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handlePlayPause = () => (isPlaying ? onPause() : onPlay());

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSeek(parseFloat(e.target.value));
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 h-full">

      {/* Video viewport */}
      <div className="relative flex-1 min-h-0 bg-black overflow-hidden">

        {/* Primary video (current/outgoing clip) */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-contain"
          style={primaryStyle}
          playsInline
          preload="auto"
          muted={muteVideo}
        />

        {/* Overlay video (incoming clip during transitions) */}
        <video
          ref={videoOverRef}
          className="absolute inset-0 w-full h-full object-contain"
          style={overlayStyle}
          playsInline
          preload="auto"
          muted
        />

        {/* Hidden audio elements for VO playback */}
        <audio ref={audioRef} preload="auto" />
        <audio ref={fullAudioRef} preload="auto" />

        {/* Transition indicator overlay */}
        {transition && (
          <div className="absolute top-2 right-2 px-2 py-1 rounded bg-amber-500/80 pointer-events-none" style={{ zIndex: 10 }}>
            <span className="text-[10px] font-bold text-amber-950 uppercase">
              {transLabel}
            </span>
          </div>
        )}

        {/* Empty-state overlay */}
        {!activeClip && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="font-mono text-xs text-zinc-600">
              no clip at {formatTime(currentTime)}
            </span>
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="flex flex-col gap-2 px-3 py-2 border-t border-zinc-800">

        {/* Seek slider */}
        <input
          type="range"
          min={0}
          max={totalDuration || 1}
          step={0.05}
          value={currentTime}
          onChange={handleSliderChange}
          className="w-full h-1 accent-indigo-500 cursor-pointer"
        />

        {/* Play/Pause button + time readout */}
        <div className="flex items-center gap-3">
          <button
            onClick={handlePlayPause}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="flex items-center justify-center w-8 h-8 rounded bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 transition-colors text-white flex-shrink-0"
          >
            {isPlaying ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
                <rect x="2"   y="1" width="3.5" height="12" rx="1" />
                <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
                <path d="M3 1.5 12 7 3 12.5z" />
              </svg>
            )}
          </button>

          <span className="font-mono text-xs text-zinc-300 tabular-nums select-none">
            {formatTime(currentTime)}&nbsp;/&nbsp;{formatTime(totalDuration)}
          </span>

          {activeClip && (
            <span className="ml-auto font-mono text-xs text-zinc-500 tabular-nums select-none">
              clip&nbsp;{activeClip.clip}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
