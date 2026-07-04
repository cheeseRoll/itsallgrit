"use strict";

// ---------------------------------------------------------------------------
// Timeline panel: ruler, track lanes, clip divs, playhead, and all pointer
// interactions (scrub, drag-move, edge trim, razor, drop-from-bin, snapping).
// ---------------------------------------------------------------------------

const Timeline = window.Timeline = {
  RULER_H: 26,
  laneHeight: (kind) => (kind === "video" ? 48 : 34),

  drag: null,           // active pointer interaction state
  _renderQueued: false,

  duration() { return Math.max(sequenceEnd() + 30, 120); },
  pps() { return App.ui.pxPerSec; },

  init() {
    const headers = $("#trackHeaders");
    headers.innerHTML = "";
    headers.appendChild(el("div", { class: "th-ruler-spacer", style: `height:${this.RULER_H}px` }));
    for (const track of App.seq.tracks) {
      const h = el("div", {
        class: `track-header ${track.kind}`,
        style: `height:${this.laneHeight(track.kind)}px`,
        "data-track": track.id,
      },
        el("span", { class: "th-name", text: track.id }),
        el("button", {
          class: "th-mute" + (track.muted ? " on" : ""),
          text: "M",
          title: "Mute track",
          onclick: () => {
            track.muted = !track.muted;
            Timeline.init();
            Player.invalidate();
          },
        }),
      );
      headers.appendChild(h);
    }
    this.render();
  },

  render() {
    const inner = $("#timelineInner");
    const lanes = $("#lanes");
    const width = this.duration() * this.pps();
    inner.style.width = width + "px";
    lanes.innerHTML = "";

    for (const track of App.seq.tracks) {
      const lane = el("div", {
        class: `lane ${track.kind}` + (track.muted ? " muted" : ""),
        style: `height:${this.laneHeight(track.kind)}px`,
        "data-track": track.id,
        "data-kind": track.kind,
      });
      for (const clip of clipsOnTrack(track.id)) {
        lane.appendChild(this.clipDiv(clip, track));
      }
      for (const tr of App.seq.transitions.filter((x) => x.track === track.id)) {
        lane.appendChild(this.transitionDiv(tr));
      }
      lanes.appendChild(lane);
    }
    this.drawRuler();
    this.updatePlayheadUI();
  },

  scheduleRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    requestAnimationFrame(() => { this._renderQueued = false; this.render(); });
  },

  clipDiv(clip, track) {
    const media = findMedia(clip.mediaId);
    const div = el("div", {
      class: `clip ${media ? media.type : "missing"}`
        + (clip.id === App.ui.selectedClipId ? " selected" : "")
        + (media && media.offline ? " offline" : ""),
      style: `left:${clip.start * this.pps()}px;width:${Math.max(4, clipDur(clip) * this.pps())}px`,
      "data-clip-id": clip.id,
      title: media ? media.name : "missing media",
    },
      el("div", { class: "clip-handle left" }),
      el("div", { class: "clip-label", text: (media ? media.name : "?") + (clip.speed !== 1 ? ` ×${clip.speed}` : "") }),
      el("div", { class: "clip-handle right" }),
    );
    if (clip.fadeIn > 0) div.appendChild(el("div", { class: "clip-fade in", style: `width:${clip.fadeIn / clip.speed * this.pps()}px` }));
    if (clip.fadeOut > 0) div.appendChild(el("div", { class: "clip-fade out", style: `width:${clip.fadeOut / clip.speed * this.pps()}px` }));
    if (track.kind === "audio" && media && media.peaks) {
      div.insertBefore(this.waveformCanvas(clip, media, track), div.children[1]);
    }
    // keyframe indicator: a dot per animated property
    const kfProps = Object.keys(clip.kf || {}).filter((p) => clip.kf[p] && clip.kf[p].length);
    if (kfProps.length) {
      div.appendChild(el("div", { class: "clip-kf-badge", title: `Animated: ${kfProps.join(", ")}`, text: "◆" }));
    }
    return div;
  },

  waveformCanvas(clip, media, track) {
    const wPx = Math.min(Math.max(2, Math.round(clipDur(clip) * this.pps())), 4000);
    const hPx = this.laneHeight(track.kind) - 10;
    const canvas = el("canvas", { class: "clip-wave", width: wPx, height: hPx });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    const rate = media.peaksRate || 50;
    const mid = hPx / 2;
    for (let x = 0; x < wPx; x++) {
      const srcT = clip.in + (x / wPx) * (clip.out - clip.in);
      const peak = media.peaks[Math.min(media.peaks.length - 1, Math.floor(srcT * rate))] || 0;
      const h = Math.max(1, peak * (hPx - 2));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
    return canvas;
  },

  transitionDiv(tr) {
    const left = (tr.at - tr.duration / 2) * this.pps();
    const div = el("div", {
      class: "transition",
      style: `left:${left}px;width:${tr.duration * this.pps()}px`,
      title: `${tr.type === "dipblack" ? "Dip to Black" : "Cross Dissolve"} (${tr.duration}s) — double-click to remove`,
      "data-transition-id": tr.id,
    }, el("span", { text: tr.type === "dipblack" ? "◆" : "✕" }));
    div.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      pushHistory();
      App.seq.transitions = App.seq.transitions.filter((x) => x.id !== tr.id);
      afterModelChange();
      toast("Transition removed");
    });
    return div;
  },

  drawRuler() {
    const scroll = $("#timelineScroll");
    const canvas = $("#ruler");
    const w = scroll.clientWidth;
    if (canvas.width !== w) canvas.width = w;
    canvas.style.transform = `translateX(${scroll.scrollLeft}px)`;
    const ctx = canvas.getContext("2d");
    const pps = this.pps();
    ctx.fillStyle = "#1b1d22";
    ctx.fillRect(0, 0, w, this.RULER_H);
    ctx.fillStyle = "#8a8f98";
    ctx.font = "10px system-ui";
    ctx.textBaseline = "top";
    // adaptive tick spacing: aim for a major tick every ~90px
    const steps = [0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
    const step = steps.find((s) => s * pps >= 70) || 600;
    const t0 = Math.floor(scroll.scrollLeft / pps / step) * step;
    for (let t = t0; t * pps < scroll.scrollLeft + w; t += step) {
      const x = t * pps - scroll.scrollLeft;
      ctx.fillRect(x, 14, 1, 12);
      ctx.fillText(timecode(t, App.settings.fps).slice(3), x + 3, 3);
      const minor = step / 5;
      for (let m = 1; m < 5; m++) {
        ctx.fillRect(x + m * minor * pps, 20, 1, 6);
      }
    }
    // sequence markers
    for (const m of App.seq.markers || []) {
      const x = m.t * pps - scroll.scrollLeft;
      if (x < -10 || x > w + 10) continue;
      ctx.fillStyle = "#3fb950";
      ctx.fillRect(x, 0, 2, this.RULER_H);
      ctx.beginPath();
      ctx.moveTo(x + 2, 0); ctx.lineTo(x + 9, 5); ctx.lineTo(x + 2, 10);
      ctx.fill();
    }
  },

  zoomFit() {
    const scroll = $("#timelineScroll");
    const dur = Math.max(sequenceEnd(), 10);
    App.ui.pxPerSec = clamp((scroll.clientWidth - 40) / dur, 2, 400);
    this.render();
    scroll.scrollLeft = 0;
  },

  updatePlayheadUI() {
    const ph = $("#playhead");
    ph.style.left = App.ui.playhead * this.pps() + "px";
    if (Player.playing) {
      const scroll = $("#timelineScroll");
      const x = App.ui.playhead * this.pps();
      if (x < scroll.scrollLeft || x > scroll.scrollLeft + scroll.clientWidth - 60) {
        scroll.scrollLeft = Math.max(0, x - 100);
      }
    }
  },

  // ------------------------------ snapping ---------------------------------

  snapPoints(excludeClipId) {
    const pts = [0, App.ui.playhead];
    for (const c of App.seq.clips) {
      if (c.id === excludeClipId) continue;
      pts.push(c.start, clipEnd(c));
    }
    return pts;
  },

  snapTime(t, excludeClipId) {
    if (!App.ui.snap) return Math.max(0, t);
    const threshold = 8 / this.pps();
    let best = t, bestD = threshold;
    for (const p of this.snapPoints(excludeClipId)) {
      const d = Math.abs(p - t);
      if (d < bestD) { best = p; bestD = d; }
    }
    return Math.max(0, best);
  },

  // --------------------------- model operations ----------------------------

  addClip(mediaId, trackId, start, inPt, outPt) {
    const media = findMedia(mediaId);
    const track = findTrack(trackId);
    if (!media || !track) return null;
    const wantKind = media.type === "audio" ? "audio" : "video";
    if (track.kind !== wantKind) {
      toast(`${media.type} clips go on ${wantKind === "audio" ? "audio (A)" : "video (V)"} tracks`);
      return null;
    }
    pushHistory();
    inPt = inPt ?? 0;
    outPt = outPt ?? Math.min(media.duration, mediaMaxOut(media));
    const clip = makeClip(mediaId, trackId, Math.max(0, start), inPt, outPt);
    resolveOverwrite(trackId, clip.start, clipEnd(clip), clip.id);
    App.seq.clips.push(clip);
    App.ui.selectedClipId = clip.id;
    afterModelChange();
    return clip;
  },

  splitClip(clip, t) {
    if (t - clip.start < 0.04 || clipEnd(clip) - t < 0.04) return false;
    const cutLocal = clipLocalTime(clip, t);
    const right = structuredClone(clip);
    right.id = uid("clip");
    right.in = cutLocal;
    right.start = t;
    right.fadeIn = 0;
    clip.out = cutLocal;
    clip.fadeOut = 0;
    App.seq.clips.push(right);
    return true;
  },

  splitAtPlayhead() {
    const t = App.ui.playhead;
    const targets = App.seq.clips.filter((c) => t > c.start && t < clipEnd(c));
    if (!targets.length) return toast("No clip under the playhead");
    pushHistory();
    for (const c of targets) this.splitClip(c, t);
    afterModelChange();
  },

  deleteSelected(ripple = false) {
    const clip = findClip(App.ui.selectedClipId);
    if (!clip) return toast("Select a clip first");
    pushHistory();
    const dur = clipDur(clip);
    App.seq.clips = App.seq.clips.filter((c) => c.id !== clip.id);
    if (ripple) {
      for (const c of App.seq.clips) {
        if (c.track === clip.track && c.start >= clipEnd(clip) - 0.001) c.start -= dur;
      }
    }
    pruneTransitions();
    App.ui.selectedClipId = null;
    afterModelChange();
  },

  duplicateSelected() {
    const clip = findClip(App.ui.selectedClipId);
    if (!clip) return;
    pushHistory();
    const copy = structuredClone(clip);
    copy.id = uid("clip");
    copy.start = clipEnd(clip);
    resolveOverwrite(clip.track, copy.start, copy.start + clipDur(copy), copy.id);
    App.seq.clips.push(copy);
    App.ui.selectedClipId = copy.id;
    afterModelChange();
  },

  addTransition(type, edge) {
    const clip = findClip(App.ui.selectedClipId);
    if (!clip) return toast("Select a clip first");
    const media = findMedia(clip.mediaId);
    if (findTrack(clip.track).kind !== "video") return toast("Transitions apply to video clips");
    const at = edge === "start" ? clip.start : clipEnd(clip);
    const neighbor = clipsOnTrack(clip.track).find((c) =>
      c.id !== clip.id && Math.abs((edge === "start" ? clipEnd(c) : c.start) - at) < 0.02);
    if (!neighbor) {
      // no adjacent clip at that cut: fall back to a fade
      pushHistory();
      if (edge === "start") clip.fadeIn = Math.max(clip.fadeIn, 1);
      else clip.fadeOut = Math.max(clip.fadeOut, 1);
      afterModelChange();
      return toast("No adjacent clip at that cut — added a 1s fade instead");
    }
    pushHistory();
    App.seq.transitions = App.seq.transitions.filter((tr) => !(tr.track === clip.track && Math.abs(tr.at - at) < 0.02));
    App.seq.transitions.push({ id: uid("trans"), track: clip.track, type, at, duration: 1 });
    afterModelChange();
    toast(`${type === "dipblack" ? "Dip to Black" : "Cross Dissolve"} added at the cut`);
  },

  setZoom(factor) {
    const scroll = $("#timelineScroll");
    const centerT = (scroll.scrollLeft + scroll.clientWidth / 2) / this.pps();
    App.ui.pxPerSec = clamp(App.ui.pxPerSec * factor, 8, 400);
    this.render();
    scroll.scrollLeft = Math.max(0, centerT * this.pps() - scroll.clientWidth / 2);
    this.drawRuler();
  },

  // ---------------------------- pointer wiring -----------------------------

  timeFromEvent(e) {
    const scroll = $("#timelineScroll");
    const rect = scroll.getBoundingClientRect();
    return (e.clientX - rect.left + scroll.scrollLeft) / this.pps();
  },

  wire() {
    const scroll = $("#timelineScroll");
    scroll.addEventListener("scroll", () => this.drawRuler());
    window.addEventListener("resize", () => this.drawRuler());

    scroll.addEventListener("pointerdown", (e) => {
      const clipDivEl = e.target.closest(".clip");
      if (clipDivEl) {
        const clip = findClip(clipDivEl.dataset.clipId);
        if (!clip) return;
        App.ui.selectedClipId = clip.id;
        renderEffectControls();
        if (App.ui.tool === "razor") {
          const t = this.snapTime(this.timeFromEvent(e), null);
          pushHistory();
          if (this.splitClip(clip, t)) afterModelChange();
          else { App.history.undo.pop(); this.render(); }
          return;
        }
        const isLeft = e.target.classList.contains("left");
        const isRight = e.target.classList.contains("right");
        this.drag = {
          mode: isLeft ? "trim-l" : isRight ? "trim-r" : "move",
          clipId: clip.id,
          grabOffset: this.timeFromEvent(e) - clip.start,
          snapshot: snapshotSeq(),
          moved: false,
        };
        this.render();
        e.preventDefault();
        return;
      }
      // empty area / ruler: scrub
      this.drag = { mode: "scrub", moved: false };
      Player.seek(this.snapTime(this.timeFromEvent(e), null));
    });

    window.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const d = this.drag;
      if (d.mode === "scrub") {
        Player.seek(clamp(this.timeFromEvent(e), 0, this.duration()));
        return;
      }
      const clip = findClip(d.clipId);
      if (!clip) return;
      const media = findMedia(clip.mediaId);
      d.moved = true;

      if (d.mode === "move") {
        clip.start = this.snapTime(this.timeFromEvent(e) - d.grabOffset, clip.id);
        // allow moving to another lane of the same kind
        const laneEl = document.elementFromPoint(e.clientX, e.clientY)?.closest(".lane");
        if (laneEl) {
          const track = findTrack(laneEl.dataset.track);
          const wantKind = media.type === "audio" ? "audio" : "video";
          if (track && track.kind === wantKind) clip.track = track.id;
        }
      } else if (d.mode === "trim-l") {
        const maxStart = clipEnd(clip) - 0.05;
        let newStart = clamp(this.snapTime(this.timeFromEvent(e), clip.id), 0, maxStart);
        // can't trim earlier than the source's beginning
        const minStart = clip.start - clip.in / clip.speed;
        newStart = Math.max(newStart, minStart);
        clip.in += (newStart - clip.start) * clip.speed;
        clip.start = newStart;
      } else if (d.mode === "trim-r") {
        const minEnd = clip.start + 0.05;
        const maxEnd = clip.start + (mediaMaxOut(media) - clip.in) / clip.speed;
        const newEnd = clamp(this.snapTime(this.timeFromEvent(e), clip.id), minEnd, maxEnd);
        clip.out = clip.in + (newEnd - clip.start) * clip.speed;
      }
      this.scheduleRender();
      if (!Player.playing) Player.invalidate();
    });

    window.addEventListener("pointerup", () => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      if (d.mode === "scrub" || !d.moved) return;
      const clip = findClip(d.clipId);
      if (clip && d.mode === "move") {
        resolveOverwrite(clip.track, clip.start, clipEnd(clip), clip.id);
      }
      // commit: the pre-drag snapshot becomes the undo step
      App.history.undo.push(d.snapshot);
      App.history.redo.length = 0;
      pruneTransitions();
      afterModelChange();
    });

    // drops from the bin
    $("#lanes").addEventListener("dragover", (e) => {
      if (e.dataTransfer.types.includes("text/x-gritcut-media")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    });
    $("#lanes").addEventListener("drop", (e) => {
      const mediaId = e.dataTransfer.getData("text/x-gritcut-media");
      if (!mediaId) return;
      e.preventDefault();
      const laneEl = e.target.closest(".lane") || document.elementFromPoint(e.clientX, e.clientY)?.closest(".lane");
      if (!laneEl) return;
      const t = this.snapTime(this.timeFromEvent(e), null);
      this.addClip(mediaId, laneEl.dataset.track, t);
    });
  },
};

function renderTimeline() { Timeline.render(); }
