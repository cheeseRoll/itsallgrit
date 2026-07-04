"use strict";

// ---------------------------------------------------------------------------
// Playback engine ("Mercury, but make it web"):
//  - every timeline clip gets its own <video>/<audio> element (so two clips of
//    the same source can overlap in a transition)
//  - audio graph: clip gain -> track gain -> master -> analyser -> speakers,
//    with a tap for export recording
//  - the compositor draws video tracks bottom-up (V1 under V2 under V3) with
//    per-clip motion/opacity/filters, transitions and title rendering
// ---------------------------------------------------------------------------

const AudioEngine = window.AudioEngine = {
  ctx: null, master: null, analyser: null, monitor: null, trackGains: {},

  init() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.monitor = this.ctx.createGain();
    this.master.connect(this.analyser);
    this.analyser.connect(this.monitor);
    this.monitor.connect(this.ctx.destination);
    for (const t of App.seq.tracks) {
      const g = this.ctx.createGain();
      g.connect(this.master);
      this.trackGains[t.id] = g;
    }
    return this.ctx;
  },

  resume() {
    this.init();
    if (this.ctx.state === "suspended") this.ctx.resume();
  },

  levelPeak() {
    if (!this.analyser) return 0;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128);
    return peak;
  },
};

// --------------------- per-clip playback element pool ----------------------

const Pool = window.Pool = {
  entries: new Map(), // clipId -> {el, gain, srcNode, mediaId}

  get(clip) {
    let entry = this.entries.get(clip.id);
    const media = findMedia(clip.mediaId);
    if (entry && entry.mediaId === clip.mediaId) return entry;
    if (entry) this.dispose(clip.id);
    if (!media || media.offline || (media.type !== "video" && media.type !== "audio")) return null;

    const elc = document.createElement(media.type === "audio" ? "audio" : "video");
    elc.preload = "auto";
    elc.src = media.url;
    elc.addEventListener("seeked", () => { if (!Player.playing) Player.requestStaticDraw(); });
    elc.addEventListener("loadeddata", () => { if (!Player.playing) Player.requestStaticDraw(); });
    entry = { el: elc, mediaId: clip.mediaId, gain: null, srcNode: null };
    this.entries.set(clip.id, entry);
    return entry;
  },

  connectAudio(clip, entry) {
    if (entry.srcNode || !AudioEngine.ctx) return;
    const media = findMedia(clip.mediaId);
    if (!media || !media.hasAudio) return;
    try {
      entry.srcNode = AudioEngine.ctx.createMediaElementSource(entry.el);
      entry.gain = AudioEngine.ctx.createGain();
      entry.srcNode.connect(entry.gain);
      const trackGain = AudioEngine.trackGains[clip.track] || AudioEngine.master;
      entry.gain.connect(trackGain);
      entry.trackId = clip.track;
    } catch (e) { console.warn("audio connect failed", e); }
  },

  retrack(clip, entry) {
    if (!entry.gain || entry.trackId === clip.track) return;
    entry.gain.disconnect();
    entry.gain.connect(AudioEngine.trackGains[clip.track] || AudioEngine.master);
    entry.trackId = clip.track;
  },

  dispose(clipId) {
    const entry = this.entries.get(clipId);
    if (!entry) return;
    entry.el.pause();
    entry.el.removeAttribute("src");
    if (entry.gain) entry.gain.disconnect();
    if (entry.srcNode) entry.srcNode.disconnect();
    this.entries.delete(clipId);
  },

  gc() {
    const live = new Set(App.seq.clips.map((c) => c.id));
    for (const id of [...this.entries.keys()]) {
      if (!live.has(id)) this.dispose(id);
    }
    for (const id of [...Compositor._keyCanvases.keys()]) {
      if (!live.has(id)) Compositor._keyCanvases.delete(id);
    }
  },
};

// ------------------------------ compositor ---------------------------------

const Compositor = window.Compositor = {

  filterString(fx) {
    const parts = [];
    if (fx.brightness !== 100) parts.push(`brightness(${fx.brightness}%)`);
    if (fx.contrast !== 100) parts.push(`contrast(${fx.contrast}%)`);
    if (fx.saturate !== 100) parts.push(`saturate(${fx.saturate}%)`);
    if (fx.hue !== 0) parts.push(`hue-rotate(${fx.hue}deg)`);
    if (fx.blur > 0) parts.push(`blur(${fx.blur}px)`);
    if (fx.grayscale > 0) parts.push(`grayscale(${fx.grayscale}%)`);
    if (fx.sepia > 0) parts.push(`sepia(${fx.sepia}%)`);
    if (fx.invert > 0) parts.push(`invert(${fx.invert}%)`);
    return parts.length ? parts.join(" ") : "none";
  },

  fadeFactor(clip, t) {
    let f = 1;
    const dur = clipDur(clip);
    const local = t - clip.start;
    if (clip.fadeIn > 0 && local < clip.fadeIn) f *= clamp(local / clip.fadeIn, 0, 1);
    if (clip.fadeOut > 0 && local > dur - clip.fadeOut) f *= clamp((dur - local) / clip.fadeOut, 0, 1);
    return f;
  },

  // Draw one frame of the sequence at time t into ctx (project coordinates).
  drawFrame(ctx, t) {
    const { width: W, height: H } = App.settings;
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const videoTracks = App.seq.tracks.filter((tr) => tr.kind === "video").reverse(); // V1 first
    for (const track of videoTracks) {
      if (track.muted) continue;
      const trans = transitionAt(track.id, t);
      if (trans) {
        this.drawTransition(ctx, track.id, trans, t);
      } else {
        const clip = clipAt(track.id, t);
        if (clip) this.drawClip(ctx, clip, t, 1);
      }
    }
  },

  drawTransition(ctx, trackId, tr, t) {
    const { width: W, height: H } = App.settings;
    const p = clamp((t - (tr.at - tr.duration / 2)) / tr.duration, 0, 1);
    const clips = clipsOnTrack(trackId);
    const outClip = clips.find((c) => Math.abs(clipEnd(c) - tr.at) < 0.02);
    const inClip = clips.find((c) => Math.abs(c.start - tr.at) < 0.02);
    if (tr.type === "dipblack") {
      if (p < 0.5 && outClip) this.drawClip(ctx, outClip, t, 1 - p * 2);
      if (p >= 0.5 && inClip) this.drawClip(ctx, inClip, t, p * 2 - 1);
    } else if (tr.type === "wipe") {
      if (outClip) this.drawClip(ctx, outClip, t, 1);
      if (inClip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W * p, H);
        ctx.clip();
        this.drawClip(ctx, inClip, t, 1);
        ctx.restore();
      }
    } else if (tr.type === "push") {
      if (outClip) this.drawClip(ctx, outClip, t, 1, -W * p);
      if (inClip) this.drawClip(ctx, inClip, t, 1, W * (1 - p));
    } else { // cross dissolve
      if (outClip) this.drawClip(ctx, outClip, t, 1);
      if (inClip) this.drawClip(ctx, inClip, t, p);
    }
  },

  // alphaMul: extra multiplier from a transition envelope;
  // offsetX: extra horizontal shift (push transition)
  drawClip(ctx, clip, t, alphaMul, offsetX = 0) {
    const media = findMedia(clip.mediaId);
    if (!media || media.offline) return;
    const { width: W, height: H } = App.settings;
    const alpha = alphaMul * (propValue(clip, "opacity", t) / 100) * this.fadeFactor(clip, t);
    if (alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.translate(W / 2 + propValue(clip, "x", t) + offsetX, H / 2 + propValue(clip, "y", t));
    ctx.rotate((propValue(clip, "rotation", t) * Math.PI) / 180);
    ctx.filter = this.filterString(clip.fx);

    if (media.type === "title") {
      this.drawTitle(ctx, media, W, H);
    } else {
      let src = null, sw = 0, sh = 0;
      if (media.type === "image") {
        src = media.img; sw = media.width; sh = media.height;
      } else if (media.type === "video") {
        const entry = Pool.get(clip);
        if (entry && entry.el.readyState >= 2) {
          src = entry.el; sw = entry.el.videoWidth; sh = entry.el.videoHeight;
        }
      }
      if (src && sw && sh) {
        if (clip.fx.keyEnabled) src = this.chromaKey(clip, src, sw, sh);
        const fit = Math.min(W / sw, H / sh) * (propValue(clip, "scale", t) / 100);
        const dw = sw * fit, dh = sh * fit;
        ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
        if (clip.fx.vignette > 0) {
          ctx.filter = "none";
          const g = ctx.createRadialGradient(0, 0, Math.min(dw, dh) * 0.25, 0, 0, Math.max(dw, dh) * 0.72);
          g.addColorStop(0, "rgba(0,0,0,0)");
          g.addColorStop(1, `rgba(0,0,0,${clip.fx.vignette / 100})`);
          ctx.fillStyle = g;
          ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
        }
      }
    }
    ctx.restore();
  },

  // green-screen keying: remove pixels close to the key color
  _keyCanvases: new Map(), // clipId -> {c, ctx}
  chromaKey(clip, src, sw, sh) {
    let kc = this._keyCanvases.get(clip.id);
    if (!kc) {
      const c = document.createElement("canvas");
      kc = { c, ctx: c.getContext("2d", { willReadFrequently: true }) };
      this._keyCanvases.set(clip.id, kc);
    }
    kc.c.width = sw; kc.c.height = sh;
    kc.ctx.drawImage(src, 0, 0, sw, sh);
    const img = kc.ctx.getImageData(0, 0, sw, sh);
    const d = img.data;
    const hex = clip.fx.keyColor || "#00ff00";
    const kr = parseInt(hex.slice(1, 3), 16), kg = parseInt(hex.slice(3, 5), 16), kb = parseInt(hex.slice(5, 7), 16);
    const sim = (clip.fx.keySimilarity / 100) * 255;
    const smooth = Math.max((clip.fx.keySmooth / 100) * 255, 1);
    for (let i = 0; i < d.length; i += 4) {
      const dr = d[i] - kr, dg = d[i + 1] - kg, db = d[i + 2] - kb;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db) / 1.732;
      if (dist < sim) d[i + 3] = 0;
      else if (dist < sim + smooth) d[i + 3] = Math.round(((dist - sim) / smooth) * d[i + 3]);
    }
    kc.ctx.putImageData(img, 0, 0);
    return kc.c;
  },

  drawTitle(ctx, media, W, H) {
    const tp = media.title;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${tp.bold ? "bold " : ""}${tp.fontSize}px ${tp.font || "system-ui"}, "Segoe UI", sans-serif`;
    const lines = String(tp.text).split("\n");
    const lh = tp.fontSize * 1.2;
    const y0 = tp.y - ((lines.length - 1) * lh) / 2;
    if (tp.bg) {
      const pad = tp.fontSize * 0.35;
      let maxW = 0;
      for (const line of lines) maxW = Math.max(maxW, ctx.measureText(line).width);
      ctx.fillStyle = tp.bgColor || "#000";
      ctx.fillRect(tp.x - maxW / 2 - pad, y0 - lh / 2 - pad / 2,
        maxW + pad * 2, lh * lines.length + pad);
    }
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 8;
    lines.forEach((line, i) => {
      const ly = y0 + i * lh;
      if (tp.outlineWidth > 0) {
        ctx.lineWidth = tp.outlineWidth;
        ctx.strokeStyle = tp.outlineColor || "#000";
        ctx.lineJoin = "round";
        ctx.strokeText(line, tp.x, ly);
      }
      ctx.fillStyle = tp.color;
      ctx.fillText(line, tp.x, ly);
    });
  },
};

// -------------------------------- player -----------------------------------

const Player = window.Player = {
  playing: false,
  anchorCtxTime: 0,
  anchorT: 0,
  rafId: null,
  renderTargets: [],       // [{ctx, canvas}] — program monitor plus export tap
  onSequenceEnd: null,     // set by the exporter
  _staticDrawQueued: false,

  init() {
    const canvas = $("#programCanvas");
    canvas.width = App.settings.width;
    canvas.height = App.settings.height;
    this.renderTargets = [{ canvas, ctx: canvas.getContext("2d") }];
    $("#programRes").textContent = `${App.settings.width}×${App.settings.height} @ ${App.settings.fps}fps`;
    this.drawNow();
    if (!this._meterStarted) {
      this._meterStarted = true;
      this.meterLoop();
    }
  },

  // how far outside [start,end) a clip's element must stay warm (transitions)
  activePad(clip) {
    let pad = 0;
    for (const tr of App.seq.transitions) {
      if (tr.track !== clip.track) continue;
      if (Math.abs(clipEnd(clip) - tr.at) < 0.02 || Math.abs(clip.start - tr.at) < 0.02) {
        pad = Math.max(pad, tr.duration / 2);
      }
    }
    return pad;
  },

  play() {
    if (this.playing) return;
    if (!App.seq.clips.length) return toast("Timeline is empty — drag media from the Project panel");
    AudioEngine.resume();
    if (App.ui.playhead >= sequenceEnd() - 0.01) App.ui.playhead = 0;
    this.playing = true;
    this.anchorCtxTime = AudioEngine.ctx.currentTime;
    this.anchorT = App.ui.playhead;
    $("#btnPlay").textContent = "❚❚";
    this.tick();
  },

  pause() {
    this.playing = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    for (const [, entry] of Pool.entries) entry.el.pause();
    $("#btnPlay").textContent = "►";
  },

  toggle() { this.playing ? this.pause() : this.play(); },

  seek(t) {
    // allow parking the playhead in empty timeline space past the last clip
    t = clamp(t, 0, Math.max(Timeline.duration(), sequenceEnd()));
    App.ui.playhead = t;
    if (this.playing) {
      this.anchorCtxTime = AudioEngine.ctx.currentTime;
      this.anchorT = t;
    }
    this.syncElements(t, this.playing);
    this.drawNow();
    Timeline.updatePlayheadUI();
  },

  stepFrame(dir) {
    this.pause();
    this.seek(App.ui.playhead + dir / App.settings.fps);
  },

  tick() {
    if (!this.playing) return;
    const t = this.anchorT + (AudioEngine.ctx.currentTime - this.anchorCtxTime);
    App.ui.playhead = t;
    const end = Math.max(sequenceEnd(), 0.001);
    if (t >= end) {
      App.ui.playhead = end;
      this.pause();
      this.drawNow();
      Timeline.updatePlayheadUI();
      if (this.onSequenceEnd) { const cb = this.onSequenceEnd; this.onSequenceEnd = null; cb(); }
      return;
    }
    this.syncElements(t, true);
    this.drawNow();
    Timeline.updatePlayheadUI();
    this.rafId = requestAnimationFrame(() => this.tick());
  },

  // Keep each clip's media element seeked/playing/paused correctly for time t
  syncElements(t, playing) {
    for (const clip of App.seq.clips) {
      const media = findMedia(clip.mediaId);
      if (!media || (media.type !== "video" && media.type !== "audio")) continue;
      const entry = Pool.get(clip);
      if (!entry) continue;
      const pad = this.activePad(clip);
      const active = t >= clip.start - pad && t < clipEnd(clip) + pad;
      if (!active) {
        if (!entry.el.paused) entry.el.pause();
        continue;
      }
      Pool.connectAudio(clip, entry);
      Pool.retrack(clip, entry);
      const local = clamp(clipLocalTime(clip, t), 0, Math.max(0, media.duration - 0.05));
      if (playing) {
        entry.el.playbackRate = clamp(clip.speed, 0.1, 16);
        if (entry.el.paused) {
          entry.el.currentTime = local;
          entry.el.play().catch(() => {});
        } else if (Math.abs(entry.el.currentTime - local) > 0.12) {
          entry.el.currentTime = local; // drift correction
        }
      } else {
        if (!entry.el.paused) entry.el.pause();
        if (Math.abs(entry.el.currentTime - local) > 0.02) entry.el.currentTime = local;
      }
      // live volume: clip volume × fades × track mute (audio side)
      if (entry.gain) {
        const track = findTrack(clip.track);
        const muted = track && track.muted ? 0 : 1;
        const inWindow = t >= clip.start && t < clipEnd(clip) ? 1 : 0;
        entry.gain.gain.value = (propValue(clip, "volume", t) / 100) * Compositor.fadeFactor(clip, t) * muted * inWindow;
      }
    }
  },

  drawNow() {
    const t = App.ui.playhead;
    for (const target of this.renderTargets) {
      const { ctx, canvas } = target;
      ctx.save();
      ctx.setTransform(canvas.width / App.settings.width, 0, 0, canvas.height / App.settings.height, 0, 0);
      Compositor.drawFrame(ctx, t);
      ctx.restore();
    }
    $("#programTC").textContent = timecode(t, App.settings.fps);
    $("#timelineTC").textContent = timecode(t, App.settings.fps);
  },

  requestStaticDraw() {
    if (this._staticDrawQueued) return;
    this._staticDrawQueued = true;
    requestAnimationFrame(() => {
      this._staticDrawQueued = false;
      if (!this.playing) this.drawNow();
    });
  },

  // model changed: clean pool, resync the paused frame
  invalidate() {
    Pool.gc();
    if (!this.playing) {
      this.syncElements(App.ui.playhead, false);
      this.requestStaticDraw();
    }
  },

  meterLoop() {
    const canvas = $("#vuMeter");
    const ctx = canvas.getContext("2d");
    let smooth = 0;
    const draw = () => {
      const peak = AudioEngine.levelPeak();
      smooth = Math.max(peak, smooth * 0.92);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#26282e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const w = smooth * canvas.width;
      const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
      grad.addColorStop(0, "#3fb950");
      grad.addColorStop(0.7, "#d4a72c");
      grad.addColorStop(1, "#f85149");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 2, w, canvas.height - 4);
      requestAnimationFrame(draw);
    };
    draw();
  },
};
