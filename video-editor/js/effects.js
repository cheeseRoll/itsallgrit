"use strict";

// ---------------------------------------------------------------------------
// Effect Controls panel — Premiere's fixed effects (Motion, Opacity, Speed,
// Volume) plus color filter effects, fades, transitions and title text,
// all bound live to the selected clip.
// ---------------------------------------------------------------------------

const Effects = window.Effects = {};

// slider row bound to a getter/setter; commits one undo step per drag
Effects.sliderRow = function (label, min, max, step, get, set, unit = "") {
  const val = el("span", { class: "fx-val", text: `${get()}${unit}` });
  const input = el("input", { type: "range", min, max, step, value: get() });
  let armed = false;
  input.addEventListener("input", () => {
    if (!armed) { pushHistory(); armed = true; }
    set(parseFloat(input.value));
    val.textContent = `${parseFloat(input.value)}${unit}`;
    Player.invalidate();
    scheduleAutosave();
  });
  input.addEventListener("change", () => { armed = false; Timeline.render(); });
  return el("div", { class: "fx-row" },
    el("label", { text: label }), input, val);
};

Effects.section = function (title, ...rows) {
  return el("div", { class: "fx-section" },
    el("div", { class: "fx-section-title", text: title }), ...rows);
};

function renderEffectControls() {
  const host = $("#effectControls");
  host.innerHTML = "";
  const clip = findClip(App.ui.selectedClipId);
  if (!clip) {
    host.appendChild(el("div", { class: "monitor-empty", style: "padding:24px 10px", },
      el("span", { text: "Select a clip on the timeline to edit its effects" })));
    return;
  }
  const media = findMedia(clip.mediaId);
  const isVideoTrack = findTrack(clip.track).kind === "video";
  const S = Effects.sliderRow;

  host.appendChild(el("div", { class: "fx-clip-name", text: media ? media.name : "(missing media)" }));

  if (media && media.type === "title") {
    const ta = el("textarea", { rows: 3 });
    ta.value = media.title.text;
    ta.addEventListener("input", () => {
      media.title.text = ta.value;
      Player.invalidate(); scheduleAutosave();
    });
    const color = el("input", { type: "color", value: media.title.color });
    color.addEventListener("input", () => { media.title.color = color.value; Player.invalidate(); scheduleAutosave(); });
    host.appendChild(Effects.section("Text",
      ta,
      el("div", { class: "fx-row" }, el("label", { text: "Color" }), color),
      S("Size", 12, 300, 1, () => media.title.fontSize, (v) => media.title.fontSize = v, "px"),
      S("Text X", -640, 640, 1, () => media.title.x, (v) => media.title.x = v, "px"),
      S("Text Y", -360, 360, 1, () => media.title.y, (v) => media.title.y = v, "px"),
    ));
  }

  if (isVideoTrack) {
    host.appendChild(Effects.section("Motion",
      S("Position X", -1280, 1280, 1, () => clip.transform.x, (v) => clip.transform.x = v, "px"),
      S("Position Y", -720, 720, 1, () => clip.transform.y, (v) => clip.transform.y = v, "px"),
      S("Scale", 5, 400, 1, () => clip.transform.scale, (v) => clip.transform.scale = v, "%"),
      S("Rotation", -180, 180, 1, () => clip.transform.rotation, (v) => clip.transform.rotation = v, "°"),
    ));
    host.appendChild(Effects.section("Opacity",
      S("Opacity", 0, 100, 1, () => clip.opacity, (v) => clip.opacity = v, "%"),
      S("Fade In", 0, 5, 0.1, () => clip.fadeIn, (v) => clip.fadeIn = v, "s"),
      S("Fade Out", 0, 5, 0.1, () => clip.fadeOut, (v) => clip.fadeOut = v, "s"),
    ));
    host.appendChild(Effects.section("Color & Filters",
      S("Brightness", 0, 300, 1, () => clip.fx.brightness, (v) => clip.fx.brightness = v, "%"),
      S("Contrast", 0, 300, 1, () => clip.fx.contrast, (v) => clip.fx.contrast = v, "%"),
      S("Saturation", 0, 300, 1, () => clip.fx.saturate, (v) => clip.fx.saturate = v, "%"),
      S("Hue", -180, 180, 1, () => clip.fx.hue, (v) => clip.fx.hue = v, "°"),
      S("Blur", 0, 40, 0.5, () => clip.fx.blur, (v) => clip.fx.blur = v, "px"),
      S("Grayscale", 0, 100, 1, () => clip.fx.grayscale, (v) => clip.fx.grayscale = v, "%"),
      S("Sepia", 0, 100, 1, () => clip.fx.sepia, (v) => clip.fx.sepia = v, "%"),
      S("Invert", 0, 100, 1, () => clip.fx.invert, (v) => clip.fx.invert = v, "%"),
    ));
    const resetBtn = el("button", {
      class: "fx-reset", text: "Reset color & motion",
      onclick: () => {
        pushHistory();
        clip.fx = DEFAULT_FX();
        clip.transform = DEFAULT_TRANSFORM();
        clip.opacity = 100;
        afterModelChange();
      },
    });
    host.appendChild(resetBtn);

    // transitions
    const transSel = el("select", {},
      el("option", { value: "dissolve", text: "Cross Dissolve" }),
      el("option", { value: "dipblack", text: "Dip to Black" }));
    host.appendChild(Effects.section("Transitions",
      el("div", { class: "fx-row" }, el("label", { text: "Type" }), transSel),
      el("div", { class: "fx-btn-row" },
        el("button", { text: "At clip start", onclick: () => Timeline.addTransition(transSel.value, "start") }),
        el("button", { text: "At clip end", onclick: () => Timeline.addTransition(transSel.value, "end") }),
      ),
      el("div", { class: "dim", style: "font-size:11px;padding:2px 0",
        text: "Needs an adjacent clip at the cut; otherwise a fade is used." }),
    ));
  }

  if (media && media.hasAudio) {
    host.appendChild(Effects.section("Audio",
      S("Volume", 0, 200, 1, () => clip.volume, (v) => clip.volume = v, "%"),
    ));
  }

  // speed / duration (not for stills — trim those instead)
  if (media && (media.type === "video" || media.type === "audio")) {
    host.appendChild(Effects.section("Speed / Duration",
      S("Speed", 0.25, 4, 0.25, () => clip.speed, (v) => { clip.speed = v; }, "×"),
      el("div", { class: "dim", style: "font-size:11px", text: "Clip length on the timeline updates with speed." }),
    ));
  }
}
