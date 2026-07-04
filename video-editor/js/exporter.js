"use strict";

// ---------------------------------------------------------------------------
// Export: renders the sequence through the same compositor/audio graph into a
// MediaRecorder (canvas.captureStream + mixed audio), fully on-device.
// Also: project save / open / autosave. Project files store the edit
// structure; media relinks by file name on re-import (Premiere-style
// offline media).
// ---------------------------------------------------------------------------

const Exporter = window.Exporter = {
  active: null, // {recorder, chunks, canvas, streamDest, progressTimer}

  formats() {
    const candidates = [
      ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "MP4 (H.264 + AAC)"],
      ["video/mp4", "MP4"],
      ["video/webm;codecs=vp9,opus", "WebM (VP9 + Opus)"],
      ["video/webm;codecs=vp8,opus", "WebM (VP8 + Opus)"],
      ["video/webm", "WebM"],
    ];
    return candidates.filter(([mime]) =>
      window.MediaRecorder && MediaRecorder.isTypeSupported(mime));
  },

  fastAvailable() {
    return !!(window.VideoEncoder && window.AudioEncoder && window.VideoFrame && window.AudioData);
  },

  openDialog() {
    if (!App.seq.clips.length) return toast("Timeline is empty — nothing to export");
    if (!window.MediaRecorder && !this.fastAvailable()) return toast("This browser supports neither export engine");
    // engine choice: frame-accurate WebCodecs render vs. real-time capture
    const eng = $("#exportEngine");
    eng.innerHTML = "";
    if (this.fastAvailable()) {
      eng.appendChild(el("option", { value: "fast", text: "Fast render (frame-accurate)" }));
    }
    if (window.MediaRecorder) {
      eng.appendChild(el("option", { value: "realtime", text: "Real-time capture (compatible)" }));
    }
    const syncFormat = () => {
      $("#exportFormat").disabled = eng.value === "fast";
      $("#exportInfo").textContent = eng.value === "fast"
        ? "Renders frame by frame with WebCodecs into a WebM file — usually faster than real time."
        : `Sequence length ${formatDuration(sequenceEnd())} — real-time render (~${Math.ceil(sequenceEnd())}s).`;
    };
    eng.onchange = syncFormat;
    const sel = $("#exportFormat");
    sel.innerHTML = "";
    for (const [mime, label] of this.formats()) {
      sel.appendChild(el("option", { value: mime, text: label }));
    }
    // resolution choices follow the sequence's aspect ratio
    const res = $("#exportRes");
    res.innerHTML = "";
    res.appendChild(el("option", { value: "project", text: `Project (${App.settings.width}×${App.settings.height})` }));
    const even = (n) => Math.max(2, Math.round(n / 2) * 2);
    for (const h of [1080, 720, 480]) {
      if (h >= App.settings.height) continue;
      const w = even((App.settings.width * h) / App.settings.height);
      res.appendChild(el("option", { value: `${w}x${h}`, text: `${w} × ${h}` }));
    }
    $("#exportProgress").style.width = "0%";
    syncFormat();
    $("#exportDialog").classList.add("open");
  },

  closeDialog() { $("#exportDialog").classList.remove("open"); },

  start() {
    if (this.active || App.exporting) return;
    if ($("#exportEngine").value === "fast") return this.fastExport();
    const mime = $("#exportFormat").value;
    const resVal = $("#exportRes").value;
    let w = App.settings.width, h = App.settings.height;
    if (resVal !== "project") [w, h] = resVal.split("x").map(Number);

    AudioEngine.resume();
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    const target = { canvas, ctx };
    Player.renderTargets.push(target);

    const streamDest = AudioEngine.ctx.createMediaStreamDestination();
    AudioEngine.master.connect(streamDest);
    AudioEngine.monitor.gain.value = 0; // don't blast the speakers while rendering

    const stream = canvas.captureStream(App.settings.fps);
    for (const track of streamDest.stream.getAudioTracks()) stream.addTrack(track);

    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    } catch (e) {
      this.cleanup(target, streamDest);
      return toast("Could not start the encoder: " + e.message);
    }
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    const total = sequenceEnd();
    const progressTimer = setInterval(() => {
      $("#exportProgress").style.width = clamp((App.ui.playhead / total) * 100, 0, 100) + "%";
    }, 100);

    this.active = { recorder, chunks, target, streamDest, progressTimer, mime };
    $("#exportStart").disabled = true;
    $("#exportStart").textContent = "Rendering…";

    Player.pause();
    Player.seek(0);
    recorder.start(200);
    Player.onSequenceEnd = () => this.finish(false);
    // small delay so the first frame is captured
    setTimeout(() => Player.play(), 120);
  },

  finish(cancelled) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    Player.onSequenceEnd = null;
    Player.pause();
    clearInterval(a.progressTimer);

    a.recorder.onstop = () => {
      this.cleanup(a.target, a.streamDest);
      $("#exportStart").disabled = false;
      $("#exportStart").textContent = "Start Export";
      if (cancelled) { this.closeDialog(); return toast("Export cancelled"); }
      const blob = new Blob(a.chunks, { type: a.mime.split(";")[0] });
      const ext = a.mime.includes("mp4") ? "mp4" : "webm";
      const name = ($("#exportName").value || "my-video") + "." + ext;
      App.lastExport = { blob, size: blob.size, type: blob.type, name };
      downloadBlob(blob, name);
      this.closeDialog();
      toast(`Exported ${name} (${(blob.size / 1024 / 1024).toFixed(1)} MB) — check your Downloads`);
    };
    a.recorder.stop();
  },

  cleanup(target, streamDest) {
    Player.renderTargets = Player.renderTargets.filter((t) => t !== target);
    try { AudioEngine.master.disconnect(streamDest); } catch (e) {}
    AudioEngine.monitor.gain.value = 1;
  },

  cancel() {
    if (App.exporting) { this.cancelFast = true; return; }
    if (this.active) this.finish(true);
    else this.closeDialog();
  },

  // -------------------- fast render (WebCodecs + own muxer) -----------------

  // Decode every audio-bearing clip and mix the whole sequence offline —
  // deterministic and much faster than real time. Reproduces volume
  // keyframes, fades, filters and track mutes.
  async renderAudioMix(totalDur) {
    const RATE = 48000;
    const clips = App.seq.clips.filter((c) => {
      const m = findMedia(c.mediaId);
      const track = findTrack(c.track);
      return m && !m.offline && m.hasAudio && m.file && track && !track.muted;
    });
    if (!clips.length) return null;

    // cache decoded buffers on the media items
    for (const c of clips) {
      const m = findMedia(c.mediaId);
      if (m.audioBuffer48) continue;
      try {
        const octx = new OfflineAudioContext(2, 1, RATE);
        m.audioBuffer48 = await octx.decodeAudioData(await m.file.arrayBuffer());
      } catch (e) { m.audioBuffer48 = null; }
    }

    const len = Math.max(1, Math.ceil(totalDur * RATE));
    const off = new OfflineAudioContext(2, len, RATE);
    let any = false;
    for (const c of clips) {
      const m = findMedia(c.mediaId);
      if (!m.audioBuffer48) continue;
      any = true;
      const src = off.createBufferSource();
      src.buffer = m.audioBuffer48;
      src.playbackRate.value = c.speed;
      const gain = off.createGain();
      const bass = off.createBiquadFilter();
      bass.type = "lowshelf"; bass.frequency.value = 200; bass.gain.value = c.audio.bass;
      const treble = off.createBiquadFilter();
      treble.type = "highshelf"; treble.frequency.value = 3000; treble.gain.value = c.audio.treble;
      const hp = off.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = c.audio.highpass > 0 ? c.audio.highpass : 10;
      const lp = off.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = c.audio.lowpass > 0 ? c.audio.lowpass : 22050;
      src.connect(gain); gain.connect(bass); bass.connect(treble);
      treble.connect(hp); hp.connect(lp); lp.connect(off.destination);

      // volume envelope (keyframes + fades) sampled every 20 ms
      const end = Math.min(clipEnd(c), totalDur);
      const v0 = (propValue(c, "volume", c.start) / 100) * Compositor.fadeFactor(c, c.start);
      gain.gain.setValueAtTime(v0, Math.max(0, c.start));
      for (let t = c.start + 0.02; t < end; t += 0.02) {
        const v = (propValue(c, "volume", t) / 100) * Compositor.fadeFactor(c, t);
        gain.gain.linearRampToValueAtTime(v, t);
      }
      src.start(Math.max(0, c.start), c.in, c.out - c.in);
    }
    if (!any) return null;
    return off.startRendering();
  },

  // seek every relevant video element to its exact frame time and wait
  async seekAllForFrame(t) {
    const waits = [];
    for (const clip of App.seq.clips) {
      const media = findMedia(clip.mediaId);
      if (!media || media.type !== "video" || media.offline) continue;
      const pad = Player.activePad(clip);
      if (t < clip.start - pad || t >= clipEnd(clip) + pad) continue;
      const entry = Pool.get(clip);
      if (!entry) continue;
      const elv = entry.el;
      const local = clamp(clipLocalTime(clip, t), 0, Math.max(0, media.duration - 0.03));
      if (elv.readyState === 0) {
        waits.push(new Promise((res) => {
          const done = () => { elv.removeEventListener("loadeddata", done); res(); };
          elv.addEventListener("loadeddata", done);
          setTimeout(done, 800);
        }));
      }
      if (Math.abs(elv.currentTime - local) > 0.004) {
        waits.push(new Promise((res) => {
          const done = () => { elv.removeEventListener("seeked", done); res(); };
          elv.addEventListener("seeked", done);
          setTimeout(done, 500); // never hang the render on a bad seek
          try { elv.currentTime = local; } catch { done(); }
        }));
      }
    }
    await Promise.all(waits);
  },

  async fastExport() {
    const total = sequenceEnd();
    if (total <= 0) return toast("Timeline is empty");
    const resVal = $("#exportRes").value;
    let w = App.settings.width, h = App.settings.height;
    if (resVal !== "project") [w, h] = resVal.split("x").map(Number);
    const fps = App.settings.fps;
    const frames = Math.ceil(total * fps);

    App.exporting = true;
    this.cancelFast = false;
    Player.pause();
    const startBtn = $("#exportStart");
    startBtn.disabled = true;
    const setProgress = (p, label) => {
      $("#exportProgress").style.width = (p * 100).toFixed(1) + "%";
      startBtn.textContent = label;
    };
    const t0 = performance.now();

    let venc = null, aenc = null;
    try {
      // --- audio: offline mixdown, then encode to opus ---
      setProgress(0, "Mixing audio…");
      const mix = await this.renderAudioMix(total);
      const audioChunks = [];
      let opusHeader = null;
      if (mix) {
        aenc = new AudioEncoder({
          output: (c, meta) => {
            audioChunks.push(c);
            if (meta && meta.decoderConfig && meta.decoderConfig.description) {
              opusHeader = new Uint8Array(meta.decoderConfig.description.slice
                ? meta.decoderConfig.description : new Uint8Array(meta.decoderConfig.description));
            }
          },
          error: (e) => console.warn("audio encoder", e),
        });
        aenc.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
        const CHUNK = 4800; // 100 ms
        for (let f = 0; f < mix.length; f += CHUNK) {
          const n = Math.min(CHUNK, mix.length - f);
          const data = new Float32Array(n * 2);
          for (let ch = 0; ch < 2; ch++) {
            data.set(mix.getChannelData(Math.min(ch, mix.numberOfChannels - 1)).subarray(f, f + n), ch * n);
          }
          const ad = new AudioData({
            format: "f32-planar", sampleRate: 48000, numberOfFrames: n,
            numberOfChannels: 2, timestamp: Math.round((f / 48000) * 1e6), data,
          });
          aenc.encode(ad);
          ad.close();
        }
        await aenc.flush();
      }

      // --- video: frame-accurate render ---
      let codec = "vp09.00.10.08", codecId = "V_VP9";
      const support = await VideoEncoder.isConfigSupported({ codec, width: w, height: h });
      if (!support.supported) { codec = "vp8"; codecId = "V_VP8"; }
      const videoChunks = [];
      let vencError = null;
      venc = new VideoEncoder({
        output: (c) => videoChunks.push(c),
        error: (e) => { vencError = e; },
      });
      venc.configure({
        codec, width: w, height: h,
        bitrate: Math.min(12_000_000, Math.max(1_000_000, Math.round(w * h * fps * 0.12))),
        framerate: fps,
      });

      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      const programCtx = $("#programCanvas").getContext("2d");

      for (let i = 0; i < frames; i++) {
        if (this.cancelFast) throw new Error("cancelled");
        if (vencError) throw vencError;
        const t = i / fps;
        App.ui.playhead = t;
        await this.seekAllForFrame(t);
        ctx.save();
        ctx.setTransform(w / App.settings.width, 0, 0, h / App.settings.height, 0, 0);
        Compositor.drawFrame(ctx, t);
        ctx.restore();
        // mirror progress into the program monitor
        programCtx.save();
        programCtx.setTransform($("#programCanvas").width / w, 0, 0, $("#programCanvas").height / h, 0, 0);
        programCtx.drawImage(canvas, 0, 0);
        programCtx.restore();
        const vf = new VideoFrame(canvas, {
          timestamp: Math.round((i * 1e6) / fps),
          duration: Math.round(1e6 / fps),
        });
        venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
        vf.close();
        while (venc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
        if (i % 5 === 0) {
          setProgress(i / frames, `Rendering… ${Math.round((i / frames) * 100)}%`);
          await new Promise((r) => setTimeout(r, 0)); // keep the UI alive
        }
      }
      await venc.flush();

      // --- mux ---
      setProgress(1, "Writing file…");
      const blob = Muxer.buildWebM({
        width: w, height: h, codecId, fps,
        durationMs: total * 1000,
        videoChunks,
        audio: audioChunks.length ? {
          chunks: audioChunks,
          codecPrivate: opusHeader || Muxer.opusHead(2, 48000),
          channels: 2, sampleRate: 48000,
        } : null,
      });
      const name = ($("#exportName").value || "my-video") + ".webm";
      App.lastExport = { blob, size: blob.size, type: blob.type, name };
      downloadBlob(blob, name);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      toast(`Exported ${name} (${(blob.size / 1024 / 1024).toFixed(1)} MB) in ${secs}s — check your Downloads`);
      this.closeDialog();
    } catch (e) {
      if (String(e.message) === "cancelled") toast("Export cancelled");
      else { console.error(e); toast("Export failed: " + e.message); }
    } finally {
      try { if (venc && venc.state !== "closed") venc.close(); } catch {}
      try { if (aenc && aenc.state !== "closed") aenc.close(); } catch {}
      App.exporting = false;
      this.cancelFast = false;
      startBtn.disabled = false;
      startBtn.textContent = "Start Export";
      Player.seek(0);
    }
  },
};

// ------------------------- project save / open ------------------------------

const Project = window.Project = {
  serialize() {
    return JSON.stringify({
      app: "gritcut", version: 1,
      settings: App.settings,
      media: App.media.map((m) => ({
        id: m.id, name: m.name, type: m.type, duration: m.duration,
        hasAudio: m.hasAudio, width: m.width, height: m.height,
        thumb: m.thumb, title: m.title,
      })),
      seq: App.seq,
      playhead: App.ui.playhead,
    }, null, 1);
  },

  save() {
    const name = ($("#exportName").value || "project") + ".gritcut.json";
    downloadBlob(new Blob([this.serialize()], { type: "application/json" }), name);
    toast("Project saved to your Downloads");
  },

  load(json) {
    let data;
    try { data = JSON.parse(json); } catch { return toast("Not a valid project file"); }
    if (data.app !== "gritcut") return toast("Not a GritCut project file");
    App.settings = data.settings || App.settings;
    App.media = (data.media || []).map((m) => ({
      ...m,
      url: null, file: null, img: null,
      title: m.title ? { ...DEFAULT_TITLE(), ...m.title } : null,
      offline: m.type !== "title", // titles are self-contained
    }));
    App.seq = data.seq;
    App.seq.markers = App.seq.markers || [];
    App.seq.transitions = App.seq.transitions || [];
    (App.seq.clips || []).forEach(migrateClip);
    App.ui.playhead = data.playhead || 0;
    App.ui.selectedClipId = null;
    App.history.undo.length = 0;
    App.history.redo.length = 0;
    for (const id of [...Pool.entries.keys()]) Pool.dispose(id);
    Player.init(); // sequence settings (resolution/fps) may have changed
    Media.renderBin();
    Timeline.init();
    afterModelChange();
    const offline = App.media.filter((m) => m.offline).length;
    if (offline) {
      toast(`Project loaded — ${offline} media item(s) are offline. Import the same files again to relink them.`, 6000);
    } else {
      toast("Project loaded");
    }
  },

  openFile(file) {
    const reader = new FileReader();
    reader.onload = () => this.load(reader.result);
    reader.readAsText(file);
  },
};

// -------------------------------- autosave ----------------------------------

let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem("gritcut_autosave", Project.serialize()); } catch (e) {}
  }, 800);
}

function tryRestoreAutosave() {
  let saved = null;
  try { saved = localStorage.getItem("gritcut_autosave"); } catch (e) {}
  if (!saved) return false;
  try {
    const data = JSON.parse(saved);
    if (!data.seq || !data.seq.clips || !data.seq.clips.length) return false;
    Project.load(saved);
    return true;
  } catch { return false; }
}
