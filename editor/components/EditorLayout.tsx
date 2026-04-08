'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ProjectData, VideoClipEdit, VOClipEdit, EditedTimeline, TransitionType, MediaFile } from '@/lib/types';
import type { LayerVisibility } from './TimelineTracks';
import TimelineTracks from './TimelineTracks';
import VideoPreview from './VideoPreview';
import PropertiesPanel from './PropertiesPanel';
import ExportBar from './ExportBar';

interface EditorLayoutProps {
  project: ProjectData;
}

// ─── Init helpers ─────────────────────────────────────────────────────────────

function initVideoClips(project: ProjectData): VideoClipEdit[] {
  let offset = 0;
  return project.videoFiles.map((vf) => {
    // Match this video file to its timeline clip by clipNum
    const timelineClip = project.timeline.clips.find(c => c.clip === vf.clipNum);
    const timelineOffset = timelineClip?.audio_start ?? offset;
    const clip: VideoClipEdit = {
      clip: vf.clipNum,
      file: `clips/${vf.name}`,
      sourceDuration: vf.duration,
      trimStart: 0,
      trimEnd: vf.duration,
      timelineOffset,
      transitionOut: null,
    };
    offset = timelineOffset + vf.duration;
    return clip;
  });
}

function initVOClips(project: ProjectData): VOClipEdit[] {
  return project.audioFiles.map((af) => {
    // Match by clipNum to timeline clips for audio_start offset.
    // Audio files may be named slice-XX.mp3 (audio-first) or vo-XX.mp3 (legacy).
    const timelineClip = project.timeline.clips.find(c => c.clip === af.clipNum);
    const timelineOffset = timelineClip?.audio_start ?? 0;

    return {
      clip: af.clipNum,
      file: `audio/${af.name}`,
      sourceDuration: af.duration,
      trimStart: 0,
      trimEnd: af.duration,
      timelineOffset,
    };
  });
}

// ─── buildEditedTimeline helper ───────────────────────────────────────────────

function buildEditedTimeline(
  project: ProjectData,
  videoClips: VideoClipEdit[],
  voClips: VOClipEdit[],
  totalDuration: number,
): EditedTimeline {
  return {
    sourceTimeline: 'audio/timeline.json',
    sourceMetadata: 'metadata.json',
    projectDir: project.projectDir,
    framerate: 30,
    tracks: { video: videoClips, voiceover: voClips },
    totalDuration,
  };
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function postJSON(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EditorLayout({ project }: EditorLayoutProps) {
  const [videoClips, setVideoClips] = useState<VideoClipEdit[]>(() => initVideoClips(project));
  const [voClips, setVOClips] = useState<VOClipEdit[]>(() => initVOClips(project));
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(190);
  const resizingRef = useRef(false);
  const [selectedClip, setSelectedClip] = useState<VideoClipEdit | VOClipEdit | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<'video' | 'voiceover' | null>(null);
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    transitions: true, video: true, audioClips: true, fullAudio: true,
  });

  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Total duration: max of all clip end times ──────────────────────────────
  const totalDuration = Math.max(
    0,
    ...videoClips.map((c) => c.timelineOffset + (c.trimEnd - c.trimStart)),
    ...voClips.map((c) => c.timelineOffset + (c.trimEnd - c.trimStart)),
  );

  // ── Playback interval at 30fps ─────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setCurrentTime((t) => {
          const next = t + 1 / 30;
          if (next >= totalDuration) {
            setIsPlaying(false);
            return 0;
          }
          return next;
        });
      }, 1000 / 30);
    } else {
      if (playIntervalRef.current !== null) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }

    return () => {
      if (playIntervalRef.current !== null) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [isPlaying, totalDuration]);

  // ── Spacebar play/pause ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        setIsPlaying(p => !p);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Callbacks ──────────────────────────────────────────────────────────────

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleClipSelect = useCallback(
    (clip: VideoClipEdit | VOClipEdit | null, trackType: 'video' | 'voiceover') => {
      setSelectedClip(clip);
      setSelectedTrack(clip ? trackType : null);
    },
    [],
  );

  const handleDataChange = useCallback((video: VideoClipEdit[], vo: VOClipEdit[]) => {
    setVideoClips(video);
    setVOClips(vo);
  }, []);

  const handleTransitionChange = useCallback(
    (clipNum: number, type: TransitionType, duration: number) => {
      setVideoClips((prev) =>
        prev.map((c) =>
          c.clip === clipNum
            ? { ...c, transitionOut: type === 'cut' ? null : { type, duration } }
            : c,
        ),
      );
      // Keep selectedClip in sync if it's the one being changed.
      setSelectedClip((prev) => {
        if (!prev || prev.clip !== clipNum || !('transitionOut' in prev)) return prev;
        return { ...prev, transitionOut: type === 'cut' ? null : { type, duration } };
      });
    },
    [],
  );

  const handleApplyTransitionToAll = useCallback(
    (type: TransitionType, duration: number) => {
      setVideoClips((prev) =>
        prev.map((c) => ({ ...c, transitionOut: { type, duration } })),
      );
    },
    [],
  );

  const handleSave = useCallback(async (): Promise<void> => {
    const timeline = buildEditedTimeline(project, videoClips, voClips, totalDuration);
    await postJSON('/api/save-timeline', timeline);
  }, [project, videoClips, voClips, totalDuration]);

  const handleRender = useCallback(async (): Promise<void> => {
    await handleSave();
    await postJSON('/api/render', { projectDir: project.projectDir });
  }, [handleSave, project.projectDir]);

  const handleExportXML = useCallback(async (): Promise<void> => {
    await handleSave();
    await postJSON('/api/export-xml', { projectDir: project.projectDir });
  }, [handleSave, project.projectDir]);

  const handleExportAE = useCallback(async (): Promise<void> => {
    await handleSave();
    await postJSON('/api/export-ae', { projectDir: project.projectDir });
  }, [handleSave, project.projectDir]);

  // ── Derived display values ─────────────────────────────────────────────────
  const topic = project.metadata.project.topic;
  const classLevel = project.metadata.project.class;
  const folderName = project.projectDir.split('/').filter(Boolean).pop() ?? project.projectDir;

  // ── File list for left sidebar ──────────────────────────────────────────────
  const projectFiles = [
    ...project.videoFiles.map(f => ({ name: f.name, type: 'video' as const, path: `clips/${f.name}` })),
    ...project.tcFiles.map(f => ({ name: f.name, type: 'tc' as const, path: `clips-transition/${f.name}` })),
    ...project.audioFiles.map(f => ({ name: f.name, type: 'audio' as const, path: `audio/${f.name}` })),
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 overflow-hidden">

      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0">
        {/* Left sidebar toggle */}
        <button
          onClick={() => setShowLeftSidebar(p => !p)}
          className={`p-1 rounded text-xs ${showLeftSidebar ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
          title="Toggle file browser"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="4" height="12" rx="1" opacity="0.6"/><rect x="6" y="2" width="9" height="12" rx="1" opacity="0.3"/></svg>
        </button>

        <h1 className="text-sm font-semibold text-zinc-100 truncate">
          {topic}
          {classLevel && (
            <span className="ml-2 text-xs font-normal text-zinc-400">{classLevel}</span>
          )}
        </h1>
        <span className="ml-auto font-mono text-xs text-zinc-500 truncate" title={project.projectDir}>
          {folderName}
        </span>

        {/* Right sidebar toggle */}
        <button
          onClick={() => setShowRightSidebar(p => !p)}
          className={`p-1 rounded text-xs ${showRightSidebar ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
          title="Toggle properties"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="9" height="12" rx="1" opacity="0.3"/><rect x="11" y="2" width="4" height="12" rx="1" opacity="0.6"/></svg>
        </button>
      </header>

      {/* Main area: file browser + preview + properties */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left sidebar — File Browser */}
        {showLeftSidebar && (
          <div className="w-56 shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-900/50">
            <div className="px-3 py-2 border-b border-zinc-800">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Project Files</p>
            </div>
            <div className="p-1">
              {/* Video clips */}
              <p className="px-2 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Video Clips</p>
              {projectFiles.filter(f => f.type === 'video').map(f => (
                <div key={f.path} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800 cursor-pointer group">
                  <span className="w-2 h-2 rounded-sm bg-blue-500 shrink-0" />
                  <span className="text-xs text-zinc-300 truncate group-hover:text-zinc-100">{f.name}</span>
                </div>
              ))}
              {/* Transition clips */}
              {projectFiles.some(f => f.type === 'tc') && (
                <>
                  <p className="px-2 py-1 mt-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Transition Clips</p>
                  {projectFiles.filter(f => f.type === 'tc').map(f => (
                    <div key={f.path} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800 cursor-pointer group">
                      <span className="w-2 h-2 rounded-sm bg-amber-500 shrink-0" />
                      <span className="text-xs text-zinc-300 truncate group-hover:text-zinc-100">{f.name}</span>
                    </div>
                  ))}
                </>
              )}
              {/* Audio / VO */}
              <p className="px-2 py-1 mt-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Audio / VO</p>
              {projectFiles.filter(f => f.type === 'audio').map(f => (
                <div key={f.path} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800 cursor-pointer group">
                  <span className="w-2 h-2 rounded-sm bg-green-500 shrink-0" />
                  <span className="text-xs text-zinc-300 truncate group-hover:text-zinc-100">{f.name}</span>
                </div>
              ))}
              {/* Full VO */}
              <p className="px-2 py-1 mt-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Full Audio</p>
              <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800 cursor-pointer group">
                <span className="w-2 h-2 rounded-sm bg-purple-500 shrink-0" />
                <span className="text-xs text-zinc-300 truncate group-hover:text-zinc-100">full-vo.mp3</span>
              </div>
              {/* Ambient */}
              {project.ambientFile && (
                <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800 cursor-pointer group">
                  <span className="w-2 h-2 rounded-sm bg-teal-500 shrink-0" />
                  <span className="text-xs text-zinc-300 truncate group-hover:text-zinc-100">{project.ambientFile.name}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Video preview */}
        <div className="flex-1 min-w-0 p-3">
          <VideoPreview
            videoClips={videoClips}
            voClips={layerVisibility.audioClips ? voClips : []}
            projectDir={project.projectDir}
            currentTime={currentTime}
            isPlaying={isPlaying}
            muteVideo={!layerVisibility.video}
            playFullAudio={layerVisibility.fullAudio}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onSeek={setCurrentTime}
            totalDuration={totalDuration}
          />
        </div>

        {/* Right sidebar — Properties panel */}
        {showRightSidebar && (
          <div className="w-72 shrink-0 border-l border-zinc-800 overflow-y-auto">
            <PropertiesPanel
              selectedClip={selectedClip}
              selectedTrack={selectedTrack}
              onTransitionChange={handleTransitionChange}
              onApplyTransitionToAll={handleApplyTransitionToAll}
            />
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="shrink-0 h-1.5 cursor-row-resize bg-zinc-800 hover:bg-blue-600 active:bg-blue-500 transition-colors"
        onMouseDown={(e) => {
          e.preventDefault();
          resizingRef.current = true;
          const startY = e.clientY;
          const startH = timelineHeight;
          const onMove = (ev: MouseEvent) => {
            if (!resizingRef.current) return;
            const delta = startY - ev.clientY;
            setTimelineHeight(Math.max(80, Math.min(500, startH + delta)));
          };
          const onUp = () => {
            resizingRef.current = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }}
      />

      {/* Timeline */}
      <div className="shrink-0 px-3 pb-1" style={{ height: timelineHeight }}>
        <TimelineTracks
          videoClips={videoClips}
          voClips={voClips}
          totalDuration={totalDuration}
          onTimeUpdate={handleTimeUpdate}
          onClipSelect={handleClipSelect}
          onDataChange={handleDataChange}
          onLayerVisibilityChange={setLayerVisibility}
          height={timelineHeight}
          currentTime={currentTime}
        />
      </div>

      {/* Export bar */}
      <ExportBar
        projectDir={project.projectDir}
        onSave={handleSave}
        onRender={handleRender}
        onExportXML={handleExportXML}
        onExportAE={handleExportAE}
      />
    </div>
  );
}
