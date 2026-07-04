"use strict";

// ---------------------------------------------------------------------------
// App bootstrap: wire panels, buttons and keyboard shortcuts.
// ---------------------------------------------------------------------------

function setTool(tool) {
  App.ui.tool = tool;
  $("#toolSelect").classList.toggle("active", tool === "select");
  $("#toolRazor").classList.toggle("active", tool === "razor");
  $("#lanes").classList.toggle("razor-mode", tool === "razor");
}

function newProject() {
  if (App.seq.clips.length && !confirm("Start a new project? Unsaved work is kept only in this tab's autosave.")) return;
  for (const id of [...Pool.entries.keys()]) Pool.dispose(id);
  App.media = [];
  App.seq.clips = [];
  App.seq.transitions = [];
  for (const t of App.seq.tracks) t.muted = false;
  App.ui.playhead = 0;
  App.ui.selectedClipId = null;
  App.ui.sourceMediaId = null;
  App.history.undo.length = 0;
  App.history.redo.length = 0;
  try { localStorage.removeItem("gritcut_autosave"); } catch (e) {}
  Media.renderBin();
  Timeline.init();
  afterModelChange();
  toast("New project");
}

function wireUI() {
  // top bar
  $("#btnImport").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", (e) => {
    Media.importFiles([...e.target.files]);
    e.target.value = "";
  });
  $("#btnNewTitle").addEventListener("click", () => Media.createTitle());
  $("#btnUndo").addEventListener("click", undo);
  $("#btnRedo").addEventListener("click", redo);
  $("#btnSave").addEventListener("click", () => Project.save());
  $("#btnOpen").addEventListener("click", () => $("#projectInput").click());
  $("#projectInput").addEventListener("change", (e) => {
    if (e.target.files[0]) Project.openFile(e.target.files[0]);
    e.target.value = "";
  });
  $("#btnNewProject").addEventListener("click", newProject);
  $("#btnExport").addEventListener("click", () => Exporter.openDialog());
  $("#exportStart").addEventListener("click", () => Exporter.start());
  $("#exportCancel").addEventListener("click", () => Exporter.cancel());
  $("#btnRecCam").addEventListener("click", () => Recorder.toggle("webcam"));
  $("#btnRecScreen").addEventListener("click", () => Recorder.toggle("screen"));

  // sequence settings
  $("#btnSettings").addEventListener("click", () => {
    if (Exporter.active) return toast("Finish the export first");
    $("#seqPreset").value = `${App.settings.width}x${App.settings.height}`;
    $("#seqFps").value = String(App.settings.fps);
    $("#settingsDialog").classList.add("open");
  });
  $("#settingsCancel").addEventListener("click", () => $("#settingsDialog").classList.remove("open"));
  $("#settingsApply").addEventListener("click", () => {
    const [w, h] = $("#seqPreset").value.split("x").map(Number);
    App.settings.width = w;
    App.settings.height = h;
    App.settings.fps = parseInt($("#seqFps").value, 10);
    $("#settingsDialog").classList.remove("open");
    Player.init();
    Player.invalidate();
    scheduleAutosave();
    toast(`Sequence is now ${w}×${h} @ ${App.settings.fps}fps`);
  });

  // save current frame as PNG
  $("#btnSaveFrame").addEventListener("click", () => {
    Player.drawNow();
    $("#programCanvas").toBlob((blob) => {
      if (!blob) return toast("Could not capture the frame");
      App.lastFrame = blob;
      downloadBlob(blob, `frame-${timecode(App.ui.playhead, App.settings.fps).replaceAll(":", "-")}.png`);
      toast("Frame saved to your Downloads");
    }, "image/png");
  });

  // bin drop zone + import by dropping anywhere on the bin
  const binPanel = $("#binPanel");
  binPanel.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  });
  binPanel.addEventListener("drop", (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    Media.importFiles([...e.dataTransfer.files]);
  });

  // source monitor
  $("#srcPlay").addEventListener("click", () => {
    const v = $("#sourceVideo");
    if (v.style.display === "none") return;
    if (v.paused) { v.play(); $("#srcPlay").textContent = "❚❚"; }
    else { v.pause(); $("#srcPlay").textContent = "►"; }
  });
  $("#sourceVideo").addEventListener("timeupdate", () => {
    const v = $("#sourceVideo");
    $("#sourceTC").textContent = timecode(v.currentTime || 0, App.settings.fps);
    const m = findMedia(App.ui.sourceMediaId);
    if (m && m.duration) {
      $("#sourcePlayheadMark").style.left = (v.currentTime / m.duration) * 100 + "%";
    }
  });
  $("#sourceVideo").addEventListener("pause", () => { $("#srcPlay").textContent = "►"; });
  $("#srcMarkIn").addEventListener("click", () => Media.markIn());
  $("#srcMarkOut").addEventListener("click", () => Media.markOut());
  $("#srcInsert").addEventListener("click", () => Media.insertFromSource());

  // program transport
  $("#btnPlay").addEventListener("click", () => Player.toggle());
  $("#btnStepBack").addEventListener("click", () => Player.stepFrame(-1));
  $("#btnStepFwd").addEventListener("click", () => Player.stepFrame(1));
  $("#btnGoStart").addEventListener("click", () => { Player.pause(); Player.seek(0); });
  $("#btnGoEnd").addEventListener("click", () => { Player.pause(); Player.seek(sequenceEnd()); });

  // timeline toolbar
  $("#toolSelect").addEventListener("click", () => setTool("select"));
  $("#toolRazor").addEventListener("click", () => setTool("razor"));
  $("#btnSplitPlayhead").addEventListener("click", () => Timeline.splitAtPlayhead());
  $("#btnRippleDelete").addEventListener("click", () => Timeline.deleteSelected(true));
  $("#btnSnap").addEventListener("click", () => {
    App.ui.snap = !App.ui.snap;
    $("#btnSnap").classList.toggle("active", App.ui.snap);
  });
  $("#btnZoomIn").addEventListener("click", () => Timeline.setZoom(1.5));
  $("#btnZoomOut").addEventListener("click", () => Timeline.setZoom(1 / 1.5));
  $("#btnZoomFit").addEventListener("click", () => Timeline.zoomFit());
  $("#btnMarker").addEventListener("click", addMarker);

  // keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const k = e.key.toLowerCase();
    if (e.code === "Space") { e.preventDefault(); Player.toggle(); }
    else if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && k === "k") { e.preventDefault(); Timeline.splitAtPlayhead(); }
    else if ((e.ctrlKey || e.metaKey) && k === "d") { e.preventDefault(); Timeline.duplicateSelected(); }
    else if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); Project.save(); }
    else if ((e.ctrlKey || e.metaKey) && k === "c") { e.preventDefault(); copySelectedClip(); }
    else if ((e.ctrlKey || e.metaKey) && k === "v") { e.preventDefault(); pasteClip(); }
    else if (k === "m" && e.shiftKey) removeNearestMarker();
    else if (k === "m") addMarker();
    else if (k === "delete" || k === "backspace") { e.preventDefault(); Timeline.deleteSelected(e.shiftKey); }
    else if (k === "c") setTool("razor");
    else if (k === "v") setTool("select");
    else if (k === "s") { App.ui.snap = !App.ui.snap; $("#btnSnap").classList.toggle("active", App.ui.snap); }
    else if (k === "i") Media.markIn();
    else if (k === "o") Media.markOut();
    else if (k === "arrowleft") { e.preventDefault(); Player.stepFrame(-1); }
    else if (k === "arrowright") { e.preventDefault(); Player.stepFrame(1); }
    else if (k === "home") { Player.pause(); Player.seek(0); }
    else if (k === "end") { Player.pause(); Player.seek(sequenceEnd()); }
    else if (k === "+" || k === "=") Timeline.setZoom(1.5);
    else if (k === "-") Timeline.setZoom(1 / 1.5);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  Player.init();
  Timeline.init();
  Timeline.wire();
  Media.renderBin();
  wireUI();
  setTool("select");
  if (tryRestoreAutosave()) {
    // Project.load already toasts about offline media
  }
});
