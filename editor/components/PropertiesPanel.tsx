'use client';

import { useState } from 'react';
import { VideoClipEdit, VOClipEdit, TRANSITIONS, TransitionType } from '../lib/types';

interface PropertiesPanelProps {
  selectedClip: VideoClipEdit | VOClipEdit | null;
  selectedTrack: 'video' | 'voiceover' | null;
  onTransitionChange: (clipNum: number, type: TransitionType, duration: number) => void;
  onApplyTransitionToAll: (type: TransitionType, duration: number) => void;
}

function isVideoClip(clip: VideoClipEdit | VOClipEdit): clip is VideoClipEdit {
  return 'transitionOut' in clip;
}

function fmt(seconds: number): string {
  return seconds.toFixed(2) + 's';
}

export default function PropertiesPanel({
  selectedClip,
  selectedTrack,
  onTransitionChange,
  onApplyTransitionToAll,
}: PropertiesPanelProps) {
  const [defaultTransType, setDefaultTransType] = useState<TransitionType>('dissolve');
  const [defaultTransDur, setDefaultTransDur] = useState(0.5);

  if (!selectedClip) {
    return (
      <div className="flex flex-col gap-4 p-4 text-zinc-200 text-sm h-full overflow-y-auto">
        <p className="text-zinc-500 text-xs">
          Click a clip on the timeline to see its properties
        </p>
        <hr className="border-zinc-700" />
        <div>
          <p className="text-zinc-400 text-xs uppercase tracking-wider mb-3 font-semibold">
            Default Transition
          </p>
          <div className="mb-3">
            <label className="text-zinc-500 text-xs uppercase tracking-wider block mb-1">Type</label>
            <select
              value={defaultTransType}
              onChange={e => setDefaultTransType(e.target.value as TransitionType)}
              className="w-full bg-zinc-700 border border-zinc-600 text-zinc-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-blue-500"
            >
              {TRANSITIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {defaultTransType !== 'cut' && (
            <div className="mb-3">
              <label className="text-zinc-500 text-xs uppercase tracking-wider block mb-1">
                Duration <span className="text-zinc-300 font-mono normal-case">{defaultTransDur.toFixed(1)}s</span>
              </label>
              <input
                type="range" min={0.1} max={2} step={0.1}
                value={defaultTransDur}
                onChange={e => setDefaultTransDur(parseFloat(e.target.value))}
                className="w-full accent-blue-500 cursor-pointer"
              />
            </div>
          )}
          {defaultTransType !== 'cut' && (
            <button
              onClick={() => onApplyTransitionToAll(defaultTransType, defaultTransDur)}
              className="w-full px-3 py-2 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
            >
              Apply "{defaultTransType}" to all clips
            </button>
          )}
        </div>
      </div>
    );
  }

  const trimmedDuration = selectedClip.trimEnd - selectedClip.trimStart;
  const isVideo = isVideoClip(selectedClip);
  const transitionOut = isVideo ? (selectedClip as VideoClipEdit).transitionOut : null;
  const currentTransitionType: TransitionType = (transitionOut?.type as TransitionType) ?? 'cut';
  const currentTransitionDuration: number = transitionOut?.duration ?? 0.5;

  function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    onTransitionChange(
      selectedClip!.clip,
      e.target.value as TransitionType,
      currentTransitionDuration,
    );
  }

  function handleDurationChange(e: React.ChangeEvent<HTMLInputElement>) {
    onTransitionChange(
      selectedClip!.clip,
      currentTransitionType,
      parseFloat(e.target.value),
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 text-zinc-200 text-sm h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
            selectedTrack === 'video'
              ? 'bg-blue-700 text-blue-100'
              : 'bg-emerald-700 text-emerald-100'
          }`}
        >
          {selectedTrack === 'video' ? 'Video' : 'Voiceover'}
        </span>
        <span className="text-zinc-400 text-xs">Clip {selectedClip.clip}</span>
      </div>

      {/* File name */}
      <div>
        <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">File</p>
        <p className="text-zinc-200 font-mono text-xs break-all leading-relaxed">
          {selectedClip.file}
        </p>
      </div>

      {/* Timing grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Source Duration</p>
          <p className="text-zinc-200 font-mono">{fmt(selectedClip.sourceDuration)}</p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Trimmed Duration</p>
          <p className="text-zinc-200 font-mono">{fmt(trimmedDuration)}</p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Timeline Offset</p>
          <p className="text-zinc-200 font-mono">{fmt(selectedClip.timelineOffset)}</p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Trim In</p>
          <p className="text-zinc-200 font-mono">{fmt(selectedClip.trimStart)}</p>
        </div>
      </div>

      {/* Transition section — video clips only */}
      {isVideo && (
        <>
          <hr className="border-zinc-700" />

          <div>
            <p className="text-zinc-400 text-xs uppercase tracking-wider mb-3 font-semibold">
              Transition Out
            </p>

            {/* Type dropdown */}
            <div className="mb-3">
              <label className="text-zinc-500 text-xs uppercase tracking-wider block mb-1">
                Type
              </label>
              <select
                value={currentTransitionType}
                onChange={handleTypeChange}
                className="w-full bg-zinc-700 border border-zinc-600 text-zinc-200 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                {TRANSITIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Duration slider — hidden when transition is cut */}
            {currentTransitionType !== 'cut' && (
              <div className="mb-3">
                <label className="text-zinc-500 text-xs uppercase tracking-wider block mb-1">
                  Duration&nbsp;
                  <span className="text-zinc-300 font-mono normal-case">
                    {currentTransitionDuration.toFixed(1)}s
                  </span>
                </label>
                <input
                  type="range"
                  min={0.1}
                  max={2}
                  step={0.1}
                  value={currentTransitionDuration}
                  onChange={handleDurationChange}
                  className="w-full accent-blue-500 cursor-pointer"
                />
                <div className="flex justify-between text-zinc-600 text-xs mt-0.5">
                  <span>0.1s</span>
                  <span>2.0s</span>
                </div>
              </div>
            )}

            {/* Apply to All button */}
            {currentTransitionType !== 'cut' && (
              <button
                onClick={() => onApplyTransitionToAll(currentTransitionType, currentTransitionDuration)}
                className="w-full px-3 py-1.5 text-xs font-medium rounded bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600/30 hover:border-blue-500/60 transition-colors"
              >
                Apply "{currentTransitionType}" to all clips
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
