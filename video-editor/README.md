# GritCut — a Premiere-Pro-style video editor that runs 100% locally

GritCut is a non-linear video editor modeled on Adobe Premiere Pro's core
workflow. It runs entirely in your browser — **no install, no server, no
internet, and your files never leave your machine.**

## Run it on Windows 11

1. Get this folder onto your laptop (clone the repo or download it as a ZIP
   from GitHub and extract it).
2. Open the `video-editor` folder.
3. **Double-click `index.html`.** It opens in Microsoft Edge or Chrome and the
   full editor loads. That's it — no setup of any kind.

> Tip: press `F11` for full-screen; the layout is designed for a laptop screen.

## The workflow (same as Premiere)

1. **Import** — click *Import Media* (or drag files into the Project panel):
   MP4/WebM/MOV video, MP3/WAV audio, PNG/JPG images.
2. **Preview & mark** — double-click a bin item to open it in the **Source
   Monitor**, press `I`/`O` to mark In/Out, then *Insert ↓* to place it at the
   playhead. Or just drag items straight onto the timeline.
3. **Edit** — drag clips between tracks (V1–V3 video on top of each other,
   A1–A3 audio), trim clip edges, split with the **Razor** (`C`) or
   *Split @ Playhead* (`Ctrl+K`), *Ripple Delete* to close gaps, snap (`S`),
   zoom (`+`/`−`).
4. **Effects** — select a clip and use **Effect Controls**: Motion
   (position/scale/rotation), Opacity + fades, color (brightness, contrast,
   saturation, hue, blur, grayscale, sepia, invert), Volume, Speed.
5. **Transitions** — select a clip and add a *Cross Dissolve* or *Dip to
   Black* at either cut. Double-click a transition on the timeline to remove it.
6. **Titles** — *New Title* creates a text clip; drag it onto V2/V3 above your
   footage and edit the text in Effect Controls.
7. **Export** — renders the sequence through the same engine to a real video
   file (WebM everywhere; MP4 where the browser supports it) straight into
   your Downloads folder.
8. **Save/Open Project** — the edit is saved as a small `.json` file
   (media relinks by file name when you re-import, like Premiere's offline
   media). The project also autosaves inside the browser tab.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` / `→` | Step one frame |
| `Home` / `End` | Go to start / end |
| `C` / `V` | Razor / Selection tool |
| `Ctrl+K` | Split at playhead |
| `Delete` (`Shift+Delete`) | Delete (ripple delete) selected clip |
| `Ctrl+D` | Duplicate selected clip |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `I` / `O` | Mark In / Out in the Source Monitor |
| `S` | Toggle snapping |
| `+` / `−` | Zoom timeline |
| `Ctrl+S` | Save project |

## Architecture / testing

See [PLAN.md](PLAN.md) for the research into how Premiere Pro works and how
each concept maps to this implementation. The automated end-to-end suite lives
in `tests/` (Node + Playwright): it imports real generated footage, edits the
timeline, verifies composited pixels and audio routing, runs a real export and
validates the produced file.

```bash
cd video-editor/tests
node make-fixtures.mjs   # generates test clips with ffmpeg
node run-tests.mjs       # runs the end-to-end suite in Chromium
```

## Known v1 limits

- Export renders in real time (a 60 s sequence takes ~60 s).
- No keyframed parameters yet (fade in/out handles cover the common case);
  no nested sequences, proxies or multicam.
- A video clip's audio travels with the clip (there is no separate linked
  audio clip on an A track); audio *files* go on A1–A3.
