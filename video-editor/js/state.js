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
    // Transition at a cut point: {id, track,
    //   type:'dissolve'|'dipblack'|'wipe'|'push', at, duration}
    transitions: [],
    // Sequence markers: {id, t}
    markers: [],
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
  vignette: 0,
  keyEnabled: 0, keyColor: "#00ff00", keySimilarity: 28, keySmooth: 12,
});

const DEFAULT_TITLE = () => ({
  text: "Your text here", fontSize: 72, color: "#ffffff", bold: true,
  x: 0, y: 0, font: "system-ui", outlineWidth: 0, outlineColor: "#000000",
  bg: false, bgColor: "#000000",
  animIn: "none", animOut: "none", animDur: 0.7,
});

const DEFAULT_TRANSFORM = () => ({ x: 0, y: 0, scale: 100, rotation: 0 });

const DEFAULT_AUDIO = () => ({ bass: 0, treble: 0, lowpass: 0, highpass: 0 });

// easing curves applied between keyframes (per property, via clip.kfEase)
const EASING = {
  linear: (p) => p,
  easeIn: (p) => p * p,
  easeOut: (p) => 1 - (1 - p) * (1 - p),
  easeInOut: (p) => (p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2),
  hold: () => 0,
};

function makeClip(mediaId, track, start, inPt, outPt) {
  return {
    id: uid("clip"), mediaId, track,
    start, in: inPt, out: outPt,
    speed: 1, volume: 100, opacity: 100, fadeIn: 0, fadeOut: 0,
    transform: DEFAULT_TRANSFORM(), fx: DEFAULT_FX(), kf: {}, kfEase: {},
    audio: DEFAULT_AUDIO(),
  };
}

// fill in fields added after a project was saved (forward compatibility)
function migrateClip(c) {
  c.fx = { ...DEFAULT_FX(), ...(c.fx || {}) };
  c.transform = { ...DEFAULT_TRANSFORM(), ...(c.transform || {}) };
  c.audio = { ...DEFAULT_AUDIO(), ...(c.audio || {}) };
  c.kf = c.kf || {};
  c.kfEase = c.kfEase || {};
  c.speed = c.speed ?? 1;
  c.volume = c.volume ?? 100;
  c.opacity = c.opacity ?? 100;
  c.fadeIn = c.fadeIn ?? 0;
  c.fadeOut = c.fadeOut ?? 0;
  return c;
}

// ---------------------------------------------------------------------------
// Keyframes. Each keyframable property can hold [{t, v}] where t is a time in
// SOURCE seconds (like in/out), so keyframes survive trims, moves and speed
// changes. When a property has keyframes they win over the static value.
// ---------------------------------------------------------------------------
const KEYFRAMABLE = {
  x: { get: (c) => c.transform.x, set: (c, v) => (c.transform.x = v) },
  y: { get: (c) => c.transform.y, set: (c, v) => (c.transform.y = v) },
  scale: { get: (c) => c.transform.scale, set: (c, v) => (c.transform.scale = v) },
  rotation: { get: (c) => c.transform.rotation, set: (c, v) => (c.transform.rotation = v) },
  opacity: { get: (c) => c.opacity, set: (c, v) => (c.opacity = v) },
  volume: { get: (c) => c.volume, set: (c, v) => (c.volume = v) },
};

function kfList(clip, prop) {
  clip.kf = clip.kf || {};
  return (clip.kf[prop] = clip.kf[prop] || []);
}

// evaluated value of a property at timeline time t
function propValue(clip, prop, t) {
  const staticVal = KEYFRAMABLE[prop].get(clip);
  const list = clip.kf && clip.kf[prop];
  if (!list || !list.length) return staticVal;
  const s = clipLocalTime(clip, t);
  if (s <= list[0].t) return list[0].v;
  const last = list[list.length - 1];
  if (s >= last.t) return last.v;
  const ease = EASING[(clip.kfEase && clip.kfEase[prop]) || "linear"] || EASING.linear;
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i], b = list[i + 1];
    if (s >= a.t && s <= b.t) {
      const p = ease((s - a.t) / Math.max(b.t - a.t, 1e-9));
      return a.v + (b.v - a.v) * p;
    }
  }
  return last.v;
}

function kfFindIndex(clip, prop, srcT) {
  const tol = 0.5 / App.settings.fps;
  return kfList(clip, prop).findIndex((k) => Math.abs(k.t - srcT) <= tol);
}

function kfUpsert(clip, prop, srcT, v) {
  const list = kfList(clip, prop);
  const i = kfFindIndex(clip, prop, srcT);
  if (i >= 0) list[i].v = v;
  else {
    list.push({ t: srcT, v });
    list.sort((a, b) => a.t - b.t);
  }
}

// toggle a keyframe at the playhead; returns true if one now exists there
function kfToggleAtPlayhead(clip, prop) {
  const srcT = clamp(clipLocalTime(clip, App.ui.playhead), clip.in, clip.out);
  const i = kfFindIndex(clip, prop, srcT);
  pushHistory();
  if (i >= 0) {
    kfList(clip, prop).splice(i, 1);
    afterModelChange();
    return false;
  }
  kfUpsert(clip, prop, srcT, propValue(clip, prop, App.ui.playhead));
  afterModelChange();
  return true;
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

// ------------------------------ markers ------------------------------------

function addMarker() {
  App.seq.markers = App.seq.markers || [];
  App.seq.markers.push({ id: uid("mark"), t: App.ui.playhead });
  Timeline.drawRuler();
  scheduleAutosave();
  toast("Marker added (Shift+M removes the nearest one)");
}

function removeNearestMarker() {
  const ms = App.seq.markers || [];
  if (!ms.length) return;
  let best = 0;
  for (let i = 1; i < ms.length; i++) {
    if (Math.abs(ms[i].t - App.ui.playhead) < Math.abs(ms[best].t - App.ui.playhead)) best = i;
  }
  ms.splice(best, 1);
  Timeline.drawRuler();
  scheduleAutosave();
}

// --------------------------- clip clipboard --------------------------------

function copySelectedClip() {
  const clip = findClip(App.ui.selectedClipId);
  if (!clip) return toast("Select a clip to copy");
  App.clipboard = JSON.stringify(clip);
  toast("Clip copied — Ctrl+V pastes it at the playhead");
}

function pasteClip() {
  if (!App.clipboard) return toast("Nothing copied yet");
  const src = JSON.parse(App.clipboard);
  if (!findMedia(src.mediaId)) return toast("The copied clip's media is gone");
  pushHistory();
  const copy = migrateClip(src);
  copy.id = uid("clip");
  copy.start = App.ui.playhead;
  resolveOverwrite(copy.track, copy.start, copy.start + clipDur(copy), copy.id);
  App.seq.clips.push(copy);
  App.ui.selectedClipId = copy.id;
  afterModelChange();
}

function copyAttributes() {
  const clip = findClip(App.ui.selectedClipId);
  if (!clip) return;
  App.attrClipboard = JSON.stringify({
    fx: clip.fx, transform: clip.transform, opacity: clip.opacity,
    volume: clip.volume, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut,
    speed: clip.speed, kf: clip.kf,
  });
  toast("Attributes copied");
}

function pasteAttributes() {
  const clip = findClip(App.ui.selectedClipId);
  if (!clip) return;
  if (!App.attrClipboard) return toast("Copy attributes from another clip first");
  pushHistory();
  Object.assign(clip, JSON.parse(App.attrClipboard));
  afterModelChange();
  toast("Attributes pasted");
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
