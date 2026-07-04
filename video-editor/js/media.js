"use strict";

// ---------------------------------------------------------------------------
// Media import, probing, thumbnails, bin UI, source monitor.
// Files never leave the machine: they become object URLs in this tab.
// ---------------------------------------------------------------------------

const Media = window.Media = {};

Media.typeOf = function (file) {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  const ext = file.name.split(".").pop().toLowerCase();
  if (["mp4", "webm", "mov", "mkv", "avi", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext)) return "audio";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "image";
  return null;
};

Media.importFiles = async function (files) {
  const results = [];
  for (const file of files) {
    const type = Media.typeOf(file);
    if (!type) { toast(`Unsupported file: ${file.name}`); continue; }

    // Relink an offline item (restored from a saved project) by name+type
    const offline = App.media.find((m) => m.offline && m.name === file.name && m.type === type);
    const item = offline || {
      id: uid("media"), name: file.name, type,
      duration: 0, hasAudio: type !== "image",
      width: 0, height: 0, thumb: null, title: null,
    };
    item.file = file;
    item.url = URL.createObjectURL(file);
    item.offline = false;

    try {
      await Media.probe(item);
      if (!offline) App.media.push(item);
      results.push(item);
      if (item.hasAudio) Media.computePeaks(item); // async, redraws when done
    } catch (err) {
      URL.revokeObjectURL(item.url);
      toast(`Could not read ${file.name}`);
      console.error("import failed", file.name, err);
    }
  }
  Media.renderBin();
  Player.invalidate();
  scheduleAutosave();
  if (results.length) toast(`Imported ${results.length} item(s)`);
  return results;
};

Media.probe = function (item) {
  return new Promise((resolve, reject) => {
    if (item.type === "image") {
      const img = new Image();
      img.onload = () => {
        item.width = img.naturalWidth; item.height = img.naturalHeight;
        item.duration = 5; item.hasAudio = false; item.img = img;
        item.thumb = Media.thumbFromSource(img, img.naturalWidth, img.naturalHeight);
        resolve();
      };
      img.onerror = reject;
      img.src = item.url;
      return;
    }
    const el = document.createElement(item.type === "audio" ? "audio" : "video");
    el.preload = "auto";
    el.src = item.url;
    el.onerror = () => reject(new Error("decode error"));
    el.onloadedmetadata = async () => {
      let dur = el.duration;
      if (!isFinite(dur)) {
        // streamed/recorded files (e.g. screen captures) report Infinity until
        // seeked far past the end — the standard workaround
        dur = await new Promise((res) => {
          const onDur = () => {
            if (isFinite(el.duration)) {
              el.removeEventListener("durationchange", onDur);
              res(el.duration);
            }
          };
          el.addEventListener("durationchange", onDur);
          el.currentTime = 1e7;
          setTimeout(() => { el.removeEventListener("durationchange", onDur); res(el.duration || 0); }, 3000);
        });
        el.currentTime = 0;
        if (!isFinite(dur)) dur = 0;
      }
      item.duration = dur;
      if (item.type === "video") {
        item.width = el.videoWidth; item.height = el.videoHeight;
        const at = Math.min(0.5, el.duration / 2);
        const onSeeked = () => {
          item.thumb = Media.thumbFromSource(el, el.videoWidth, el.videoHeight);
          el.removeEventListener("seeked", onSeeked);
          resolve();
        };
        el.addEventListener("seeked", onSeeked);
        el.currentTime = at;
        setTimeout(() => resolve(), 3000); // don't hang on odd files
      } else {
        resolve();
      }
    };
  });
};

Media.thumbFromSource = function (src, sw, sh) {
  const c = document.createElement("canvas");
  c.width = 96; c.height = 54;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  if (sw && sh) {
    const f = Math.min(c.width / sw, c.height / sh);
    ctx.drawImage(src, (c.width - sw * f) / 2, (c.height - sh * f) / 2, sw * f, sh * f);
  }
  return c.toDataURL("image/jpeg", 0.6);
};

Media.createTitle = function () {
  const item = {
    id: uid("media"), name: "Title " + (App.media.filter((m) => m.type === "title").length + 1),
    type: "title", duration: 5, hasAudio: false, width: 0, height: 0,
    thumb: null, url: null, offline: false,
    title: DEFAULT_TITLE(),
  };
  App.media.push(item);
  Media.renderBin();
  scheduleAutosave();
  toast("Title created — drag it onto a video track, then edit the text in Effect Controls");
  return item;
};

// --------------------------- audio waveforms -------------------------------

// Decode the file's audio and keep ~50 peak buckets per second for the
// timeline waveform. Fire-and-forget; silently skips files with no audio.
Media.computePeaks = async function (item) {
  if (!item.file || item.file.size > 300 * 1024 * 1024) return;
  try {
    const buf = await item.file.arrayBuffer();
    const octx = new OfflineAudioContext(1, 44100, 44100);
    const audio = await octx.decodeAudioData(buf);
    const ch = audio.getChannelData(0);
    const rate = 50;
    const n = Math.max(1, Math.ceil(audio.duration * rate));
    const per = Math.max(1, Math.floor(ch.length / n));
    const peaks = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let m = 0;
      const s = i * per, e = Math.min(s + per, ch.length);
      for (let j = s; j < e; j += 8) {
        const a = Math.abs(ch[j]);
        if (a > m) m = a;
      }
      peaks[i] = m;
    }
    item.peaks = peaks;
    item.peaksRate = rate;
    Timeline.render();
  } catch (e) { /* no decodable audio track — that's fine */ }
};

// ------------------------ webcam / screen recording -------------------------

const Recorder = window.Recorder = {
  active: null,

  async toggle(kind) {
    if (this.active) return this.stop();
    try {
      const stream = kind === "screen"
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: "video/webm" });
        const n = App.media.filter((m) => m.name.startsWith("Recording")).length + 1;
        await Media.importFiles([new File([blob], `Recording ${n}.webm`, { type: "video/webm" })]);
      };
      // stop when the user ends a screen share from the browser UI
      stream.getVideoTracks()[0].addEventListener("ended", () => this.stop());
      rec.start(200);
      this.active = { rec, kind };
      this.updateButtons();
      toast(kind === "screen" ? "Recording your screen — click the button again to stop" : "Recording webcam — click the button again to stop");
    } catch (e) {
      toast("Recording unavailable: " + e.message);
    }
  },

  stop() {
    if (!this.active) return;
    this.active.rec.stop();
    this.active = null;
    this.updateButtons();
  },

  updateButtons() {
    const cam = $("#btnRecCam"), scr = $("#btnRecScreen");
    cam.classList.toggle("recording", !!this.active && this.active.kind === "webcam");
    scr.classList.toggle("recording", !!this.active && this.active.kind === "screen");
    cam.textContent = this.active && this.active.kind === "webcam" ? "■ Stop" : "⏺ Camera";
    scr.textContent = this.active && this.active.kind === "screen" ? "■ Stop" : "⏺ Screen";
  },
};

// ------------------------------- bin UI -----------------------------------

Media.renderBin = function () {
  const list = $("#binList");
  list.innerHTML = "";
  $("#binDrop").style.display = App.media.length ? "none" : "flex";
  for (const m of App.media) {
    const icon = { video: "🎬", audio: "🎵", image: "🖼️", title: "🅃" }[m.type];
    const row = el("div", {
      class: "bin-item" + (m.offline ? " offline" : ""),
      draggable: "true",
      "data-media-id": m.id,
      title: m.offline ? "Offline — re-import a file with this name to relink" : "Drag to the timeline, or double-click to open in the Source Monitor",
    });
    const thumb = el("div", { class: "bin-thumb" });
    if (m.thumb) {
      const img = new Image(); img.src = m.thumb; thumb.appendChild(img);
    } else {
      thumb.textContent = icon;
    }
    row.appendChild(thumb);
    row.appendChild(el("div", { class: "bin-meta" },
      el("div", { class: "bin-name", text: m.name }),
      el("div", { class: "bin-sub", text: m.offline ? "OFFLINE" : `${m.type} · ${formatDuration(m.duration)}` }),
    ));
    row.appendChild(el("button", {
      class: "bin-del", text: "✕", title: "Remove from project (deletes its timeline clips too)",
      onclick: (e) => {
        e.stopPropagation();
        Media.remove(m.id);
      },
    }));
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/x-gritcut-media", m.id);
      e.dataTransfer.effectAllowed = "copy";
    });
    row.addEventListener("dblclick", () => Media.openInSource(m.id));
    row.addEventListener("click", () => {
      $$(".bin-item").forEach((n) => n.classList.remove("selected"));
      row.classList.add("selected");
    });
    list.appendChild(row);
  }
};

Media.remove = function (mediaId) {
  const m = findMedia(mediaId);
  if (!m) return;
  const used = App.seq.clips.filter((c) => c.mediaId === mediaId).length;
  if (used && !confirm(`Remove "${m.name}"? Its ${used} clip(s) on the timeline will be deleted too.`)) return;
  pushHistory();
  App.seq.clips = App.seq.clips.filter((c) => c.mediaId !== mediaId);
  App.media = App.media.filter((x) => x.id !== mediaId);
  if (m.url) URL.revokeObjectURL(m.url);
  if (App.ui.sourceMediaId === mediaId) {
    App.ui.sourceMediaId = null;
    $("#sourceVideo").style.display = "none";
    $("#sourceImage").style.display = "none";
    $("#sourceEmpty").style.display = "flex";
  }
  pruneTransitions();
  Media.renderBin();
  afterModelChange();
};

// --------------------------- source monitor -------------------------------

Media.openInSource = function (mediaId) {
  const m = findMedia(mediaId);
  if (!m || m.offline) return;
  App.ui.sourceMediaId = mediaId;
  App.ui.sourceIn = 0;
  App.ui.sourceOut = m.duration;
  const video = $("#sourceVideo"), image = $("#sourceImage");
  $("#sourceEmpty").style.display = "none";
  video.style.display = "none"; image.style.display = "none";
  video.pause(); video.removeAttribute("src");
  if (m.type === "video" || m.type === "audio") {
    video.src = m.url;
    video.style.display = "block";
  } else if (m.type === "image") {
    image.src = m.url;
    image.style.display = "block";
  } else if (m.type === "title") {
    $("#sourceEmpty").style.display = "flex";
    $("#sourceEmpty").innerHTML = "Titles preview in the Program Monitor";
  }
  Media.renderSourceStrip();
};

Media.renderSourceStrip = function () {
  const m = findMedia(App.ui.sourceMediaId);
  const range = $("#sourceRange");
  if (!m || !m.duration) { range.style.left = "0"; range.style.width = "0"; return; }
  const inP = (App.ui.sourceIn / m.duration) * 100;
  const outP = ((App.ui.sourceOut ?? m.duration) / m.duration) * 100;
  range.style.left = inP + "%";
  range.style.width = Math.max(0, outP - inP) + "%";
};

Media.markIn = function () {
  const v = $("#sourceVideo"), m = findMedia(App.ui.sourceMediaId);
  if (!m) return;
  App.ui.sourceIn = clamp(v.currentTime || 0, 0, (App.ui.sourceOut ?? m.duration) - 0.05);
  Media.renderSourceStrip();
};

Media.markOut = function () {
  const v = $("#sourceVideo"), m = findMedia(App.ui.sourceMediaId);
  if (!m) return;
  App.ui.sourceOut = clamp(v.currentTime || m.duration, App.ui.sourceIn + 0.05, m.duration);
  Media.renderSourceStrip();
};

// Insert the marked range at the playhead (overwrite edit, Premiere-style)
Media.insertFromSource = function () {
  const m = findMedia(App.ui.sourceMediaId);
  if (!m) return toast("Open a bin item in the Source Monitor first");
  const track = m.type === "audio" ? "A1" : "V1";
  const inPt = App.ui.sourceIn || 0;
  const outPt = App.ui.sourceOut ?? m.duration;
  Timeline.addClip(m.id, track, App.ui.playhead, inPt, outPt);
  toast(`Inserted onto ${track} at the playhead`);
};
