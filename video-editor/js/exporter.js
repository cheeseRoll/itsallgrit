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

  openDialog() {
    if (!App.seq.clips.length) return toast("Timeline is empty — nothing to export");
    if (!window.MediaRecorder) return toast("This browser does not support MediaRecorder export");
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
    const dur = sequenceEnd();
    $("#exportInfo").textContent =
      `Sequence length ${formatDuration(dur)} — renders in real time (~${Math.ceil(dur)}s).`;
    $("#exportDialog").classList.add("open");
  },

  closeDialog() { $("#exportDialog").classList.remove("open"); },

  start() {
    if (this.active) return;
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
    if (this.active) this.finish(true);
    else this.closeDialog();
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
