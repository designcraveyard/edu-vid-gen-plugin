'use client';

import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { Timeline } from '@xzdarcy/react-timeline-editor';
import type { TimelineState } from '@xzdarcy/react-timeline-editor';
import type { TimelineAction, TimelineRow, TimelineEffect } from '@xzdarcy/timeline-engine';
import '@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css';
import { VideoClipEdit, VOClipEdit } from '@/lib/types';

// ─── Custom action type carrying our domain metadata ─────────────────────────

interface VideoActionData {
  trackType: 'video';
  clip: number;
  file: string;
  sourceDuration: number;
  trimStart: number;
  trimEnd: number;
  transitionOut: { type: string; duration: number } | null;
}

interface VOActionData {
  trackType: 'voiceover';
  clip: number;
  file: string;
  sourceDuration: number;
  trimStart: number;
  trimEnd: number;
}

type ActionData = VideoActionData | VOActionData;

interface RichTimelineAction extends TimelineAction {
  data: ActionData;
}

// ─── Track IDs ────────────────────────────────────────────────────────────────

const VIDEO_TRACK_ID = 'video-track';
const VO_TRACK_ID = 'vo-track';

// Effect IDs — one per track type
const VIDEO_EFFECT_ID = 'video-effect';
const VO_EFFECT_ID = 'vo-effect';

const EFFECTS: Record<string, TimelineEffect> = {
  [VIDEO_EFFECT_ID]: { id: VIDEO_EFFECT_ID, name: 'Video' },
  [VO_EFFECT_ID]: { id: VO_EFFECT_ID, name: 'Voiceover' },
  transEffect: { id: 'transEffect', name: 'Transition' },
  fullAudioEffect: { id: 'fullAudioEffect', name: 'Full Audio' },
};

// ─── Conversion helpers ───────────────────────────────────────────────────────

function videoClipToAction(clip: VideoClipEdit): RichTimelineAction {
  const start = clip.timelineOffset;
  const playDuration = clip.trimEnd - clip.trimStart;
  return {
    id: `video-${clip.clip}`,
    start,
    end: start + playDuration,
    effectId: VIDEO_EFFECT_ID,
    flexible: true,
    movable: true,
    data: {
      trackType: 'video',
      clip: clip.clip,
      file: clip.file,
      sourceDuration: clip.sourceDuration,
      trimStart: clip.trimStart,
      trimEnd: clip.trimEnd,
      transitionOut: clip.transitionOut,
    },
  };
}

function voClipToAction(clip: VOClipEdit): RichTimelineAction {
  const start = clip.timelineOffset;
  const playDuration = clip.trimEnd - clip.trimStart;
  return {
    id: `vo-${clip.clip}`,
    start,
    end: start + playDuration,
    effectId: VO_EFFECT_ID,
    flexible: true,
    movable: true,
    data: {
      trackType: 'voiceover',
      clip: clip.clip,
      file: clip.file,
      sourceDuration: clip.sourceDuration,
      trimStart: clip.trimStart,
      trimEnd: clip.trimEnd,
    },
  };
}

function actionToVideoClip(action: RichTimelineAction): VideoClipEdit {
  const d = action.data as VideoActionData;
  const playDuration = action.end - action.start;
  return {
    clip: d.clip,
    file: d.file,
    sourceDuration: d.sourceDuration,
    trimStart: d.trimStart,
    trimEnd: d.trimStart + playDuration,
    timelineOffset: action.start,
    transitionOut: d.transitionOut,
  };
}

function actionToVOClip(action: RichTimelineAction): VOClipEdit {
  const d = action.data as VOActionData;
  const playDuration = action.end - action.start;
  return {
    clip: d.clip,
    file: d.file,
    sourceDuration: d.sourceDuration,
    trimStart: d.trimStart,
    trimEnd: d.trimStart + playDuration,
    timelineOffset: action.start,
  };
}

// ─── Component props ──────────────────────────────────────────────────────────

interface LayerVisibility {
  transitions: boolean;
  video: boolean;
  audioClips: boolean;
  fullAudio: boolean;
}

interface TimelineTracksProps {
  videoClips: VideoClipEdit[];
  voClips: VOClipEdit[];
  totalDuration: number;
  onTimeUpdate: (time: number) => void;
  onClipSelect: (
    clip: VideoClipEdit | VOClipEdit | null,
    trackType: 'video' | 'voiceover'
  ) => void;
  onDataChange: (video: VideoClipEdit[], vo: VOClipEdit[]) => void;
  onLayerVisibilityChange?: (layers: LayerVisibility) => void;
  height?: number;
  currentTime?: number;
}

export type { LayerVisibility };

// ─── Layer config ───────────────────────────────────────────────────────────

const LAYER_CONFIG = [
  { id: 'transitions', label: 'Transitions', color: '#f59e0b', key: 'transitions' as const },
  { id: VIDEO_TRACK_ID, label: 'Video', color: '#3b82f6', key: 'video' as const },
  { id: VO_TRACK_ID, label: 'Audio Clips', color: '#22c55e', key: 'audioClips' as const },
  { id: 'full-audio', label: 'Full Audio', color: '#a855f7', key: 'fullAudio' as const },
] as const;

// ─── Custom action renderer ───────────────────────────────────────────────────

function renderAction(action: TimelineAction, row: TimelineRow): React.ReactNode {
  const rich = action as RichTimelineAction;

  // Transition track items
  if (row.id === 'transitions') {
    const transOut = (rich.data as VideoActionData)?.transitionOut;
    const type = transOut?.type ?? '?';
    return (
      <div
        className="flex items-center justify-center h-full w-full rounded cursor-pointer"
        style={{ backgroundColor: '#f59e0b', border: '1px solid #d97706' }}
        title={`${type} (${transOut?.duration ?? 0}s)`}
      >
        <span className="text-amber-950 text-[10px] font-bold uppercase truncate select-none px-1">
          {type}
        </span>
      </div>
    );
  }

  // Full audio track
  if (row.id === 'full-audio') {
    return (
      <div
        className="flex items-center h-full w-full rounded px-2 cursor-pointer"
        style={{ backgroundColor: '#a855f7', border: '1px solid #9333ea' }}
        title="full-vo.mp3"
      >
        <span className="text-white text-xs font-medium truncate leading-none select-none">
          full-vo.mp3
        </span>
      </div>
    );
  }

  // Video and VO tracks
  const isVideo = rich.data?.trackType === 'video';
  const label = rich.data
    ? `${isVideo ? 'Clip' : 'VO'} ${rich.data.clip} — ${rich.data.file.split('/').pop()}`
    : action.id;

  const bg = isVideo ? '#3b82f6' : '#22c55e';
  const border = isVideo ? '#2563eb' : '#16a34a';

  const hasTransition = isVideo && rich.data && (rich.data as VideoActionData).transitionOut &&
    (rich.data as VideoActionData).transitionOut!.type !== 'cut';
  const transType = hasTransition ? (rich.data as VideoActionData).transitionOut!.type : null;

  return (
    <div
      className="flex items-center h-full w-full overflow-hidden rounded px-2 cursor-pointer relative"
      style={{ backgroundColor: bg, border: `1px solid ${border}`, boxSizing: 'border-box' }}
      title={label}
    >
      <span className="text-white text-xs font-medium truncate leading-none select-none">
        {label}
      </span>
      {hasTransition && (
        <div
          className="absolute right-0 top-0 h-full flex items-center justify-center"
          style={{ width: 24, background: 'linear-gradient(90deg, transparent 0%, rgba(251,191,36,0.5) 100%)', borderLeft: '2px solid rgba(251,191,36,0.7)' }}
          title={`→ ${transType}`}
        >
          <span className="text-amber-200 text-[8px] font-bold select-none">
            {transType?.substring(0, 3).toUpperCase()}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TimelineTracks({
  videoClips,
  voClips,
  onTimeUpdate,
  onClipSelect,
  onDataChange,
  onLayerVisibilityChange,
  height,
  currentTime,
  totalDuration,
}: TimelineTracksProps) {
  const timelineRef = useRef<TimelineState>(null);
  const [scaleWidth, setScaleWidth] = useState(160);
  const [labelPanelWidth, setLabelPanelWidth] = useState(120);
  const labelResizingRef = useRef(false);
  const [layers, setLayers] = useState<LayerVisibility>({
    transitions: true,
    video: true,
    audioClips: true,
    fullAudio: true,
  });

  const toggleLayer = useCallback((key: keyof LayerVisibility) => {
    setLayers(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Notify parent of layer visibility changes outside the state updater
  useEffect(() => {
    onLayerVisibilityChange?.(layers);
  }, [layers, onLayerVisibilityChange]);

  // ── Sync playhead from parent currentTime ─────────────────────────────────
  useEffect(() => {
    const ref = timelineRef.current;
    if (!ref || currentTime === undefined) return;
    const engineTime = ref.getTime();
    if (Math.abs(engineTime - currentTime) > 0.05) {
      ref.setTime(currentTime);
    }
  }, [currentTime]);

  // ── Build transition actions from video clips ─────────────────────────────
  const transitionActions: RichTimelineAction[] = useMemo(() => {
    const actions: RichTimelineAction[] = [];
    for (let i = 0; i < videoClips.length - 1; i++) {
      const clip = videoClips[i];
      if (clip.transitionOut && clip.transitionOut.type !== 'cut') {
        const clipEnd = clip.timelineOffset + (clip.trimEnd - clip.trimStart);
        const dur = clip.transitionOut.duration;
        actions.push({
          id: `trans-${i}`,
          start: clipEnd - dur / 2,
          end: clipEnd + dur / 2,
          effectId: 'transEffect',
          flexible: true,
          movable: false,
          data: {
            trackType: 'video',
            clip: clip.clip,
            file: clip.file,
            sourceDuration: dur,
            trimStart: 0,
            trimEnd: dur,
            transitionOut: clip.transitionOut,
          },
        });
      }
    }
    return actions;
  }, [videoClips]);

  // ── Build editor rows — 4 layers (filtered by visibility) ─────────────────
  const editorData: TimelineRow[] = useMemo(() => {
    const rows: TimelineRow[] = [];
    if (layers.transitions) {
      rows.push({ id: 'transitions', actions: transitionActions });
    }
    if (layers.video) {
      rows.push({ id: VIDEO_TRACK_ID, actions: videoClips.map(videoClipToAction) });
    }
    if (layers.audioClips) {
      rows.push({ id: VO_TRACK_ID, actions: voClips.map(voClipToAction) });
    }
    if (layers.fullAudio) {
      rows.push({
        id: 'full-audio',
        actions: [{
          id: 'full-vo',
          start: 0,
          end: totalDuration,
          effectId: 'fullAudioEffect',
          flexible: false,
          movable: false,
          data: {
            trackType: 'voiceover' as const,
            clip: 0,
            file: 'audio/full-vo.mp3',
            sourceDuration: totalDuration,
            trimStart: 0,
            trimEnd: totalDuration,
          },
        } as RichTimelineAction],
      });
    }
    return rows;
  }, [videoClips, voClips, transitionActions, layers, totalDuration]);

  // ── Subscribe to engine time events ───────────────────────────────────────
  useEffect(() => {
    const ref = timelineRef.current;
    if (!ref) return;

    const handleTick = ({ time }: { time: number }) => onTimeUpdate(time);
    const handleSet = ({ time }: { time: number }) => onTimeUpdate(time);

    ref.listener.on('setTimeByTick', handleTick);
    ref.listener.on('afterSetTime', handleSet);

    return () => {
      ref.listener.off('setTimeByTick', handleTick);
      ref.listener.off('afterSetTime', handleSet);
    };
  }, [onTimeUpdate]);

  // ── onChange: convert rows back to domain clips ──────────────────────────
  const handleChange = useCallback(
    (rows: TimelineRow[]) => {
      const videoRow = rows.find((r) => r.id === VIDEO_TRACK_ID);
      const voRow = rows.find((r) => r.id === VO_TRACK_ID);

      const newVideoClips: VideoClipEdit[] = (videoRow?.actions ?? []).map((a) =>
        actionToVideoClip(a as RichTimelineAction)
      );
      const newVOClips: VOClipEdit[] = (voRow?.actions ?? []).map((a) =>
        actionToVOClip(a as RichTimelineAction)
      );

      onDataChange(newVideoClips, newVOClips);
    },
    [onDataChange]
  );

  // ── Multi-select state ───────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Mark selected actions in editorData
  const editorDataWithSelection = useMemo(() => {
    if (selectedIds.size === 0) return editorData;
    return editorData.map(row => ({
      ...row,
      actions: row.actions.map(a => ({
        ...a,
        selected: selectedIds.has(a.id),
      })),
    }));
  }, [editorData, selectedIds]);

  // ── onClickAction: fire onClipSelect + handle Shift multi-select ────────
  const handleClickAction = useCallback(
    (
      e: React.MouseEvent<HTMLElement, MouseEvent>,
      { action, row }: { action: TimelineAction; row: TimelineRow; time: number }
    ) => {
      const rich = action as RichTimelineAction;

      // Shift+click = toggle multi-select
      if (e.shiftKey) {
        setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(action.id)) {
            next.delete(action.id);
          } else {
            next.add(action.id);
          }
          return next;
        });
        return;
      }

      // Normal click = single select
      setSelectedIds(new Set([action.id]));

      if (!rich.data) {
        onClipSelect(null, 'video');
        return;
      }
      if (row.id === VIDEO_TRACK_ID) {
        onClipSelect(actionToVideoClip(rich), 'video');
      } else {
        onClipSelect(actionToVOClip(rich), 'voiceover');
      }
    },
    [onClipSelect]
  );

  // ── Which layers are visible (for label rendering) ─────────────────────────
  const visibleLayers = LAYER_CONFIG.filter(l => layers[l.key]);

  return (
    <div className="flex flex-col w-full bg-slate-900 rounded overflow-hidden border border-slate-700">
      {/* Header bar: title + zoom */}
      <div className="flex items-center px-3 py-1.5 bg-slate-800 border-b border-slate-700 gap-4">
        <span className="text-slate-300 text-xs font-semibold uppercase tracking-wide">Timeline</span>
        <div className="flex items-center gap-2 ml-4">
          <button onClick={() => setScaleWidth(w => Math.max(40, w - 30))} className="px-1.5 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300">−</button>
          <span className="text-xs text-slate-400 w-8 text-center">{Math.round(scaleWidth / 160 * 100)}%</span>
          <button onClick={() => setScaleWidth(w => Math.min(500, w + 30))} className="px-1.5 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300">+</button>
        </div>
        {/* Layer legend */}
        <div className="flex items-center gap-3 ml-auto">
          {LAYER_CONFIG.map(l => (
            <button
              key={l.key}
              onClick={() => toggleLayer(l.key)}
              className={`flex items-center gap-1.5 text-xs transition-opacity ${layers[l.key] ? 'opacity-100' : 'opacity-30'}`}
              title={`${layers[l.key] ? 'Hide' : 'Show'} ${l.label}`}
            >
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: l.color }} />
              <span className="text-slate-400">{l.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Timeline body: labels + editor */}
      <div
        className="flex w-full overflow-hidden"
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setScaleWidth(w => Math.max(40, Math.min(500, w - e.deltaY)));
          }
        }}
      >
        {/* Track labels with checkboxes + horizontal resize handle */}
        <div className="flex shrink-0">
          <div className="flex flex-col select-none" style={{ width: labelPanelWidth, minWidth: 80 }}>
            {/* Ruler spacer */}
            <div style={{ height: 32 }} />
            {/* Layer rows — always show all 4, checkbox controls visibility */}
            {LAYER_CONFIG.map(l => (
              <div
                key={l.key}
                className={`flex items-center gap-2 px-2 text-xs ${layers[l.key] ? 'text-white' : 'text-zinc-500'}`}
                style={{ height: 32, backgroundColor: '#1e293b', borderBottom: '1px solid #334155' }}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={layers[l.key]}
                  onChange={() => toggleLayer(l.key)}
                  className="w-3.5 h-3.5 shrink-0 rounded accent-blue-500 cursor-pointer"
                  style={{ accentColor: l.color }}
                />
                {/* Color dot */}
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: l.color, opacity: layers[l.key] ? 1 : 0.3 }}
                />
                {/* Label */}
                <span className={`truncate font-medium ${layers[l.key] ? '' : 'line-through opacity-50'}`}>
                  {l.label}
                </span>
              </div>
            ))}
          </div>
          {/* Horizontal resize handle */}
          <div
            className="w-1 cursor-col-resize bg-slate-700 hover:bg-blue-500 active:bg-blue-400 transition-colors shrink-0"
            onMouseDown={(e) => {
              e.preventDefault();
              labelResizingRef.current = true;
              const startX = e.clientX;
              const startW = labelPanelWidth;
              const onMove = (ev: MouseEvent) => {
                if (!labelResizingRef.current) return;
                setLabelPanelWidth(Math.max(80, Math.min(250, startW + ev.clientX - startX)));
              };
              const onUp = () => {
                labelResizingRef.current = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
              };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          />
        </div>

        <div className="flex-1 overflow-hidden">
          <Timeline
            ref={timelineRef}
            editorData={editorDataWithSelection}
            effects={EFFECTS}
            onChange={handleChange}
            onClickAction={handleClickAction}
            getActionRender={renderAction}
            rowHeight={32}
            scale={1}
            scaleWidth={scaleWidth}
            scaleSplitCount={8}
            startLeft={0}
            gridSnap
            dragLine
            autoScroll
            style={{ width: '100%', height: height ? height - 30 : 100, backgroundColor: '#0f172a' }}
          />
        </div>
      </div>
    </div>
  );
}
