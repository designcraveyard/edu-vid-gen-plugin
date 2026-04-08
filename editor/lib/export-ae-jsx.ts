import type { EditedTimeline, VideoClipEdit, VOClipEdit } from '@/lib/types';
import { resolve } from 'path';

export function generateAEScript(timeline: EditedTimeline): string {
  const fps = timeline.framerate;

  function absPath(relativePath: string): string {
    // Escape backslashes for JS string in ExtendScript
    return resolve(timeline.projectDir, relativePath).replace(/\\/g, '\\\\');
  }

  // Build the lines array — ES3 JavaScript (var, string concat, no arrow fns)
  const lines: string[] = [];

  lines.push('(function() {');
  lines.push('  var fps = ' + fps + ';');
  lines.push('  var compDuration = ' + timeline.totalDuration + ';');
  lines.push('');
  lines.push('  // Create composition');
  lines.push('  var comp = app.project.items.addComp(');
  lines.push('    "Edited Timeline",');
  lines.push('    1920, 1080,');
  lines.push('    1,'); // pixel aspect ratio
  lines.push('    compDuration,');
  lines.push('    fps');
  lines.push('  );');
  lines.push('');
  lines.push('  var importOpts;');
  lines.push('  var footageItem;');
  lines.push('  var layer;');
  lines.push('  var opacityProp;');
  lines.push('  var ease;');
  lines.push('');

  // ── VIDEO CLIPS (added in reverse order so clip-1 is on top) ──────────────
  lines.push('  // ── VIDEO CLIPS (added in reverse so clip-1 sits above clip-2) ──');

  const videoClips = timeline.tracks.video;
  for (let i = videoClips.length - 1; i >= 0; i--) {
    const clip: VideoClipEdit = videoClips[i];
    const compOffset = clip.timelineOffset;
    const trimStart = clip.trimStart;
    const trimEnd = clip.trimEnd;
    const visibleDuration = trimEnd - trimStart;
    const filePath = absPath(clip.file);
    const layerVar = 'videoLayer' + clip.clip;

    lines.push('');
    lines.push('  // Video clip ' + clip.clip);
    lines.push('  importOpts = new ImportOptions(File("' + filePath + '"));');
    lines.push('  footageItem = app.project.importFile(importOpts);');
    lines.push('  var ' + layerVar + ' = comp.layers.add(footageItem);');
    // startTime maps source frame 0 to comp timeline position
    lines.push('  ' + layerVar + '.startTime = ' + (compOffset - trimStart) + ';');
    lines.push('  ' + layerVar + '.inPoint  = ' + compOffset + ';');
    lines.push('  ' + layerVar + '.outPoint = ' + (compOffset + visibleDuration) + ';');

    // Cross dissolve on the OUTGOING clip: keyframe opacity 100→0 over transition duration
    if (clip.transitionOut && clip.transitionOut.type !== 'cut') {
      const trans = clip.transitionOut;
      const fadeStart = compOffset + visibleDuration - trans.duration;
      const fadeEnd = compOffset + visibleDuration;

      lines.push('');
      lines.push('  // Cross dissolve out for clip ' + clip.clip + ' (' + trans.type + ')');
      lines.push('  opacityProp = ' + layerVar + '.property("ADBE Transform Group").property("ADBE Opacity");');
      lines.push('  opacityProp.setValueAtTime(' + fadeStart + ', 100);');
      lines.push('  opacityProp.setValueAtTime(' + fadeEnd + ', 0);');
      // Apply Easy Ease to both keyframes (index 1 and 2, 1-based)
      lines.push('  ease = new KeyframeEase(0, 33);');
      lines.push('  opacityProp.setTemporalEaseAtKey(1, [ease], [ease]);');
      lines.push('  opacityProp.setTemporalEaseAtKey(2, [ease], [ease]);');
    }
  }

  // ── VO CLIPS ───────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('  // ── VOICEOVER CLIPS ──');

  for (const vo of timeline.tracks.voiceover) {
    const compOffset = vo.timelineOffset;
    const trimStart = vo.trimStart;
    const trimEnd = vo.trimEnd;
    const visibleDuration = trimEnd - trimStart;
    const filePath = absPath(vo.file);
    const layerVar = 'voLayer' + vo.clip;

    lines.push('');
    lines.push('  // VO clip ' + vo.clip);
    lines.push('  importOpts = new ImportOptions(File("' + filePath + '"));');
    lines.push('  footageItem = app.project.importFile(importOpts);');
    lines.push('  var ' + layerVar + ' = comp.layers.add(footageItem);');
    lines.push('  ' + layerVar + '.startTime = ' + (compOffset - trimStart) + ';');
    lines.push('  ' + layerVar + '.inPoint  = ' + compOffset + ';');
    lines.push('  ' + layerVar + '.outPoint = ' + (compOffset + visibleDuration) + ';');
  }

  lines.push('');
  lines.push('  // Open the composition in the viewer');
  lines.push('  comp.openInViewer();');
  lines.push('  alert("Timeline imported successfully! ' + videoClips.length + ' video clips, ' + timeline.tracks.voiceover.length + ' VO clips.");');
  lines.push('})();');

  return lines.join('\n');
}
