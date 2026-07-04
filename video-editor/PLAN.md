# GritCut — a Premiere-Pro-style video editor that runs 100% locally

## Part 1 — Research: how Adobe Premiere Pro works

Adobe Premiere Pro is a **non-linear editor (NLE)**. Its architecture breaks down
into a handful of core concepts, and every feature in the app hangs off one of them:

### 1.1 Project & media management
- A **Project** is a database of *references* to media files on disk (video, audio,
  stills, graphics). Media is never modified — editing is fully non-destructive.
- The **Project panel** (media bin) shows imported items with thumbnails, duration,
  frame rate and format metadata. Items can be organized into bins.

### 1.2 Sequences, tracks and clips
- A **Sequence** is a timeline with its own settings (resolution, frame rate).
- A sequence contains stacked **video tracks** (V1, V2, V3…) and **audio tracks**
  (A1, A2, A3…). Higher video tracks render *on top of* lower ones.
- A **clip instance** on the timeline is a lightweight object that points at a
  project media item plus an **in point / out point** into the source, a position
  on the timeline, and per-clip parameters (transform, effects, speed, volume).
- Track headers support **mute / solo / lock** per track.

### 1.3 Monitors and the editing workflow
- The **Source monitor** previews a bin item; the editor marks In/Out (`I`/`O`)
  and performs an **insert** or **overwrite** edit into the sequence.
- The **Program monitor** shows the composited output of the sequence at the
  playhead, with transport controls (play/pause, step frame, timecode).
- Core timeline tools: **Selection (V)**, **Razor (C)** to split clips, edge
  **trimming**, **ripple delete** to close gaps, **snapping (S)**, zoom.

### 1.4 Effects pipeline
- Each clip has **fixed effects** (Motion: position/scale/rotation; Opacity;
  Speed/Duration; Volume) plus any added filter effects (color correction, blur…).
- The **Effect Controls panel** edits the selected clip's parameters.
- **Transitions** (cross dissolve, dip to black…) live at cut points between two
  clips and blend the outgoing and incoming frames over a duration.
- **Titles/graphics** are generated clips (Essential Graphics) rendered like media.

### 1.5 Playback engine (Mercury) & export
- On every frame, the engine determines the active clip on each track at time *t*,
  decodes that frame, applies the clip's effect stack, and composites the tracks
  top-down. Audio clips route through per-clip gain → track mixer → master.
- **Export** (Media Encoder) renders the sequence frame-by-frame through the same
  pipeline and muxes it with mixed-down audio into a delivery file.

## Part 2 — The plan: mapping every core concept to local web tech

Rebuilding Premiere's literal codebase (C++, millions of lines, proprietary) is not
feasible for anyone. What *is* feasible — and what this project does — is
implementing the same NLE architecture on the web platform so it runs entirely
locally on a Windows 11 laptop: **double-click `index.html`, everything runs in the
browser, no server, no install, no upload — files never leave the machine.**

| Premiere concept        | Local implementation                                        |
|-------------------------|-------------------------------------------------------------|
| Media decode            | `<video>` / `<audio>` / `<img>` elements + object URLs      |
| Project panel           | Media bin with generated thumbnails + metadata              |
| Sequence/tracks/clips   | Pure-JS data model (`state.js`), non-destructive clip refs  |
| Source monitor + In/Out | Dedicated video element, I/O marking, insert edit           |
| Program monitor         | Canvas-2D compositor: tracks drawn bottom→top each frame    |
| Fixed effects (Motion…) | Canvas transforms (translate/scale/rotate) + globalAlpha    |
| Filter effects          | `ctx.filter` (brightness/contrast/saturate/hue/blur/…)      |
| Transitions             | Cut-point objects; both clips drawn with alpha ramp         |
| Titles                  | Text clips rendered via canvas text                         |
| Audio mixer             | WebAudio graph: clip gain → track gain → master + VU meter  |
| Playback clock          | `AudioContext.currentTime`-driven master clock + rAF        |
| Export / Media Encoder  | `canvas.captureStream()` + mixed audio → `MediaRecorder`    |
| Project files           | JSON save/download + open, autosave to `localStorage`       |
| Undo/redo               | Snapshot history of the sequence model                      |

### Feature checklist (v1 scope — all built and tested)
- [x] Import video / audio / images via picker and drag-drop; thumbnails + duration
- [x] Source monitor with In/Out marks and *Insert at playhead*
- [x] Timeline: 3 video + 3 audio tracks, ruler with timecode, zoom, snapping
- [x] Clip operations: drag-move (across tracks), edge trim, razor split at cut or
      playhead, delete, ripple delete, copy/duplicate
- [x] Track mute; clip-level volume, speed/duration
- [x] Program monitor: real-time composite playback, scrub, frame step, timecode
- [x] Effect Controls: Motion (position/scale/rotation), Opacity, color effects
      (brightness/contrast/saturation/hue/blur/grayscale/sepia/invert)
- [x] Transitions: Cross Dissolve and Dip to Black at cut points; fade in/out
- [x] Title tool: text, size, color, position; rendered as timeline clips
- [x] Audio: per-clip gain, per-track mute, live master VU meter
- [x] Undo / redo (Ctrl+Z / Ctrl+Shift+Z)
- [x] Keyboard shortcuts: Space, C, V, S, I/O, Del, ←/→ frame step, Home/End, +/−
- [x] Project save (.gritcut.json) / open / autosave
- [x] Export to WebM (VP8/VP9 + Opus; MP4 where the browser supports it) with
      resolution choice — rendered through the same compositor, in real time

### v2 additions (all built and tested)
- [x] **Keyframe animation** for Position X/Y, Scale, Rotation, Opacity and
      Volume — Premiere-style: the ◆ button toggles a keyframe at the playhead;
      once a property is animated, slider moves write keyframes. Keyframes are
      anchored to *source* time so they survive trims, moves and speed changes.
- [x] **Chroma key (green screen)** with key color, similarity and smoothness
- [x] **Vignette** effect; **Wipe** and **Push** transitions; audio crossfade
- [x] **Audio waveforms** drawn on audio clips in the timeline
- [x] **Webcam and screen recording** straight into the project bin
- [x] **Timeline markers** (M / Shift+M), zoom-to-fit
- [x] **Copy/paste clips** (Ctrl+C/V) and **paste attributes** between clips
- [x] **Richer titles**: font choice, outline, background box
- [x] **Sequence settings**: 1080p/720p/SD, vertical 9:16 (Shorts/Reels),
      square 1:1, at 24/30/60 fps — switchable mid-edit
- [x] **Save frame** exports the current program frame as a PNG
- [x] Bin management (remove media safely), export resolutions follow the
      sequence aspect ratio

### v3 additions (all built and tested)
- [x] **Fast render engine**: frame-accurate faster-than-real-time export via
      WebCodecs (`VideoEncoder` VP9/VP8 + `AudioEncoder` Opus) muxed by a
      from-scratch WebM/Matroska writer (`js/muxer.js` — EBML header, Info,
      Tracks with OpusHead CodecPrivate, Clusters of SimpleBlocks). Audio is
      mixed deterministically with an `OfflineAudioContext` reproducing volume
      keyframes, fades, filters and track mutes. The real-time MediaRecorder
      path remains as a "compatible" engine choice.
- [x] **Keyframe easing** per animated property: linear, easeIn, easeOut,
      easeInOut, hold.
- [x] **Title animation presets**: fade / slide-up / slide-down / pop /
      typewriter, in and out, with adjustable duration.
- [x] **Per-clip audio filters**: bass & treble shelves, high-pass, low-pass —
      applied identically in live playback and in the export mixdown.

### Remaining known limits (honest list)
- No bezier curve editor (five easing presets instead); no nested sequences,
  proxies, multicam, or Lumetri scopes.
- Fast render writes WebM (VP9/VP8+Opus). MP4/H.264 output is available via
  the real-time engine where the browser supports it.

## Part 3 — Build / test loop
1. Scaffold app (`index.html`, `css/`, `js/` as plain scripts so `file://` works
   on Windows without any server or build step).
2. Implement model → media import → timeline → compositor/playback → effects →
   transitions/titles → audio graph → export → persistence.
3. Generate real test footage with ffmpeg (two color-bar clips with distinct
   audio tones, one still image).
4. Automated end-to-end suite (Playwright + Chromium, `tests/run-tests.mjs`):
   import real files, edit the timeline, verify composited pixels, verify audio
   routing, run a real export and check the produced video file, save/re-open the
   project. Fix → re-run until green.
5. Manual-use instructions for Windows 11 in `video-editor/README.md`.
