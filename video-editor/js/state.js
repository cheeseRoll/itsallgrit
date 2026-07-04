"use strict";

// ---------------------------------------------------------------------------
// Project / sequence data model. Editing is non-destructive: timeline clips
// only reference media items by id plus an in/out range into the source.
// ---------------------------------------------------------------------------

const App = window.App = {
  settings: { width: 1280, height: 720, fps: 30 },

  // Media items: {id, name, type: 'video'|'audio'|'image'|'title', duration,
  //   url, file, hasAudio, width, height, thumb, offline, title:{...}}
  media: [],

  seq: {
    tracks: [
      { id: "V3", kind: "video", muted: false },
      { id: "V2", kind: "video", muted: false },
      { id: "V1", kind: "video", muted: false },
      { id: "A1", kind: "audio", muted: false },
      { id: "A2", kind: "audio", muted: false },
      { id: "A3", kind: "audio", muted: false },
    ],
    // Clip instance: {id, mediaId, track, start, in, out, speed, volume,
    //   opacity, fadeIn, fadeOut, transform:{x,y,scale,rotation}, fx:{...}}
    clips: [],
    // Transition at a cut point: {id, track, type:'dissolve'|'dipblack',
    //   at, duration}
    transitions: [],
  },

  ui: {
    pxPerSec: 60,
    tool: "select",       // 'select' | 'razor'
    snap: true,
    playhead: 0,
    selectedClipId: null,
    sourceMediaId: null,
    sourceIn: 0,
    sourceOut: null,
  },
};

const DEFAULT_FX = () => ({
  brightness: 100, contrast: 100, saturate: 100, hue: 0,
  blur: 0, grayscale: 0, sepia: 0, invert: 0,
});

const DEFAULT_TRANSFORM = () => ({ x: 0, y: 0, scale: 100, rotation: 0 });

function makeClip(mediaId, track, start, inPt, outPt) {
  return {
    id: uid("clip"), mediaId, track,
    start, in: inPt, out: outPt,
    speed: 1, volume: 100, opacity: 100, fadeIn: 0, fadeOut: 0,
    transform: DEFAULT_TRANSFORM(), fx: DEFAULT_FX(),
  };
}

const findMedia = (id) => App.media.find((m) => m.id === id) || null;
const findClip = (id) => App.seq.clips.find((c) => c.id === id) || null;
const findTrack = (id) => App.seq.tracks.find((t) => t.id === id) || null;

const clipDur = (c) => (c.out - c.in) / c.speed;
const clipEnd = (c) => c.start + clipDur(c);
// timeline time -> time inside the source media
const clipLocalTime = (c, t) => c.in + (t - c.start) * c.speed;

function clipsOnTrack(trackId) {
  return App.seq.clips
    .filter((c) => c.track === trackId)
    .sort((a, b) => a.start - b.start);
}

function clipAt(trackId, t) {
  return clipsOnTrack(trackId).find((c) => t >= c.start && t < clipEnd(c)) || null;
}

function sequenceEnd() {
  return App.seq.clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0);
}

function transitionAt(trackId, t) {
  return App.seq.transitions.find((tr) =>
    tr.track === trackId && t >= tr.at - tr.duration / 2 && t < tr.at + tr.duration / 2
  ) || null;
}

// Max source length usable for a clip of this media (stills can be stretched)
function mediaMaxOut(media) {
  return (media.type === "image" || media.type === "title") ? 3600 : media.duration;
}

// ---------------------------------------------------------------------------
// Overwrite edit: placing [start, end) on a track trims/splits/removes
// whatever was there (Premiere's overwrite behavior).
// ---------------------------------------------------------------------------
function resolveOverwrite(trackId, start, end, ignoreId) {
  const doomed = [];
  const added = [];
  for (const c of clipsOnTrack(trackId)) {
    if (c.id === ignoreId) continue;
    const cEnd = clipEnd(c);
    if (cEnd <= start || c.start >= end) continue;
    if (c.start >= start && cEnd <= end) {           // fully covered
      doomed.push(c.id);
    } else if (c.start < start && cEnd > end) {      // covers the range: split
      const right = structuredClone(c);
      right.id = uid("clip");
      right.in = clipLocalTime(c, end);
      right.start = end;
      c.out = clipLocalTime(c, start);
      added.push(right);
    } else if (c.start < start) {                    // overlaps on the left
      c.out = clipLocalTime(c, start);
    } else {                                          // overlaps on the right
      c.in = clipLocalTime(c, end);
      c.start = end;
    }
  }
  App.seq.clips = App.seq.clips.filter((c) => !doomed.includes(c.id));
  App.seq.clips.push(...added);
  // transitions at cuts that no longer exist are dropped lazily on render
  pruneTransitions();
}

function pruneTransitions() {
  App.seq.transitions = App.seq.transitions.filter((tr) => {
    const outClip = clipsOnTrack(tr.track).find((c) => Math.abs(clipEnd(c) - tr.at) < 0.02);
    const inClip = clipsOnTrack(tr.track).find((c) => Math.abs(c.start - tr.at) < 0.02);
    return outClip && inClip;
  });
}

// ---------------------------------------------------------------------------
// Undo / redo — snapshot the whole sequence before each mutation.
// ---------------------------------------------------------------------------
App.history = { undo: [], redo: [] };

const snapshotSeq = () => JSON.stringify(App.seq);

function pushHistory() {
  App.history.undo.push(snapshotSeq());
  if (App.history.undo.length > 100) App.history.undo.shift();
  App.history.redo.length = 0;
}

function undo() {
  if (!App.history.undo.length) return toast("Nothing to undo");
  App.history.redo.push(snapshotSeq());
  App.seq = JSON.parse(App.history.undo.pop());
  afterModelChange();
}

function redo() {
  if (!App.history.redo.length) return toast("Nothing to redo");
  App.history.undo.push(snapshotSeq());
  App.seq = JSON.parse(App.history.redo.pop());
  afterModelChange();
}

function afterModelChange() {
  if (App.ui.selectedClipId && !findClip(App.ui.selectedClipId)) {
    App.ui.selectedClipId = null;
  }
  renderTimeline();
  renderEffectControls();
  Player.invalidate();
  scheduleAutosave();
}
