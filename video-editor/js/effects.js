"use strict";

// ---------------------------------------------------------------------------
// Effect Controls panel — Premiere's fixed effects (Motion, Opacity, Speed,
// Volume) plus filter effects, chroma key, transitions, title text and
// keyframing, all bound live to the selected clip.
//
// Keyframing works like Premiere's stopwatch: the ◆ button toggles a keyframe
// at the playhead; once a property has keyframes, moving its slider writes a
// keyframe at the playhead instead of changing the static value.
// ---------------------------------------------------------------------------

const Effects = window.Effects = {};

// slider row; kfSpec = {clip, prop} makes the property keyframable
Effects.sliderRow = function (label, min, max, step, get, set, unit = "", kfSpec = null) {
  const hasKf = () => kfSpec && kfList(kfSpec.clip, kfSpec.prop).length > 0;
  const readVal = () => hasKf()
    ? propValue(kfSpec.clip, kfSpec.prop, App.ui.playhead)
    : get();

  const val = el("span", { class: "fx-val", text: `${Math.round(readVal() * 100) / 100}${unit}` });
  const input = el("input", { type: "range", min, max, step, value: readVal() });
  let armed = false;
  input.addEventListener("input", () => {
    if (!armed) { pushHistory(); armed = true; }
    const v = parseFloat(input.value);
    if (hasKf()) {
      const c = kfSpec.clip;
      const srcT = clamp(clipLocalTime(c, App.ui.playhead), c.in, c.out);
      kfUpsert(c, kfSpec.prop, srcT, v);
    } else {
      set(v);
    }
    val.textContent = `${v}${unit}`;
    Player.invalidate();
    scheduleAutosave();
  });
  input.addEventListener("change", () => { armed = false; Timeline.render(); });

  const row = el("div", { class: "fx-row" }, el("label", { text: label }), input, val);

  if (kfSpec) {
    const count = kfList(kfSpec.clip, kfSpec.prop).length;
    const kfBtn = el("button", {
      class: "kf-btn" + (count ? " on" : ""),
      text: "◆",
      title: count
        ? `${count} keyframe(s) — click to add/remove one at the playhead`
        : "Add a keyframe at the playhead (animates this property)",
      onclick: () => { kfToggleAtPlayhead(kfSpec.clip, kfSpec.prop); },
    });
    row.appendChild(kfBtn);
    if (count) {
      row.appendChild(el("button", {
        class: "kf-btn clear", text: "✕", title: "Remove ALL keyframes on this property",
        onclick: () => {
          pushHistory();
          kfSpec.clip.kf[kfSpec.prop] = [];
          afterModelChange();
        },
      }));
      // easing curve for the animation between keyframes
      const easeSel = el("select", { class: "ease-select", title: "Easing between keyframes" },
        ...Object.keys(EASING).map((e2) => el("option", { value: e2, text: e2 })));
      easeSel.value = (kfSpec.clip.kfEase && kfSpec.clip.kfEase[kfSpec.prop]) || "linear";
      easeSel.addEventListener("change", () => {
        pushHistory();
        kfSpec.clip.kfEase = kfSpec.clip.kfEase || {};
        kfSpec.clip.kfEase[kfSpec.prop] = easeSel.value;
        Player.invalidate();
        scheduleAutosave();
      });
      const wrap = el("div", {},
        row,
        el("div", { class: "fx-row ease-row" }, el("label", { text: "↳ easing" }), easeSel));
      return wrap;
    }
  }
  return row;
};

Effects.checkboxRow = function (label, get, set) {
  const input = el("input", { type: "checkbox" });
  input.checked = !!get();
  input.addEventListener("change", () => {
    pushHistory();
    set(input.checked ? 1 : 0);
    Player.invalidate();
    scheduleAutosave();
  });
  return el("div", { class: "fx-row" }, el("label", { text: label }), input);
};

Effects.colorRow = function (label, get, set) {
  const input = el("input", { type: "color", value: get() });
  input.addEventListener("input", () => {
    set(input.value);
    Player.invalidate();
    scheduleAutosave();
  });
  return el("div", { class: "fx-row" }, el("label", { text: label }), input);
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
    host.appendChild(el("div", { class: "monitor-empty", style: "padding:24px 10px" },
      el("span", { text: "Select a clip on the timeline to edit its effects" })));
    return;
  }
  const media = findMedia(clip.mediaId);
  const isVideoTrack = findTrack(clip.track).kind === "video";
  const S = Effects.sliderRow;
  const kf = (prop) => ({ clip, prop });

  host.appendChild(el("div", { class: "fx-clip-name", text: media ? media.name : "(missing media)" }));
  host.appendChild(el("div", { class: "fx-btn-row", style: "margin-bottom:8px" },
    el("button", { text: "Copy attributes", title: "Copy this clip's effects/motion/volume", onclick: copyAttributes }),
    el("button", { text: "Paste attributes", title: "Paste attributes copied from another clip", onclick: pasteAttributes }),
  ));

  if (media && media.type === "title") {
    const ta = el("textarea", { rows: 3 });
    ta.value = media.title.text;
    ta.addEventListener("input", () => {
      media.title.text = ta.value;
      Player.invalidate(); scheduleAutosave();
    });
    const fontSel = el("select", {},
      ...["system-ui", "Arial", "Georgia", "Impact", "Courier New", "Times New Roman", "Comic Sans MS"]
        .map((f) => el("option", { value: f, text: f })));
    fontSel.value = media.title.font || "system-ui";
    fontSel.addEventListener("change", () => { media.title.font = fontSel.value; Player.invalidate(); scheduleAutosave(); });
    host.appendChild(Effects.section("Text",
      ta,
      el("div", { class: "fx-row" }, el("label", { text: "Font" }), fontSel),
      Effects.colorRow("Color", () => media.title.color, (v) => media.title.color = v),
      S("Size", 12, 300, 1, () => media.title.fontSize, (v) => media.title.fontSize = v, "px"),
      S("Text X", -960, 960, 1, () => media.title.x, (v) => media.title.x = v, "px"),
      S("Text Y", -540, 540, 1, () => media.title.y, (v) => media.title.y = v, "px"),
      S("Outline", 0, 24, 1, () => media.title.outlineWidth, (v) => media.title.outlineWidth = v, "px"),
      Effects.colorRow("Outline color", () => media.title.outlineColor, (v) => media.title.outlineColor = v),
      Effects.checkboxRow("Background", () => media.title.bg, (v) => media.title.bg = !!v),
      Effects.colorRow("Bg color", () => media.title.bgColor, (v) => media.title.bgColor = v),
    ));

    const animOpts = (withType) => ["none", "fade", "slide-up", "slide-down", "pop", ...(withType ? ["typewriter"] : [])]
      .map((a) => el("option", { value: a, text: a }));
    const inSel = el("select", {}, ...animOpts(true));
    inSel.value = media.title.animIn || "none";
    inSel.addEventListener("change", () => { media.title.animIn = inSel.value; Player.invalidate(); scheduleAutosave(); });
    const outSel = el("select", {}, ...animOpts(false));
    outSel.value = media.title.animOut || "none";
    outSel.addEventListener("change", () => { media.title.animOut = outSel.value; Player.invalidate(); scheduleAutosave(); });
    host.appendChild(Effects.section("Text Animation",
      el("div", { class: "fx-row" }, el("label", { text: "Animate in" }), inSel),
      el("div", { class: "fx-row" }, el("label", { text: "Animate out" }), outSel),
      S("Duration", 0.2, 2, 0.1, () => media.title.animDur, (v) => media.title.animDur = v, "s"),
    ));
  }

  if (isVideoTrack) {
    host.appendChild(Effects.section("Motion",
      S("Position X", -1920, 1920, 1, () => clip.transform.x, (v) => clip.transform.x = v, "px", kf("x")),
      S("Position Y", -1080, 1080, 1, () => clip.transform.y, (v) => clip.transform.y = v, "px", kf("y")),
      S("Scale", 5, 400, 1, () => clip.transform.scale, (v) => clip.transform.scale = v, "%", kf("scale")),
      S("Rotation", -180, 180, 1, () => clip.transform.rotation, (v) => clip.transform.rotation = v, "°", kf("rotation")),
    ));
    host.appendChild(Effects.section("Opacity",
      S("Opacity", 0, 100, 1, () => clip.opacity, (v) => clip.opacity = v, "%", kf("opacity")),
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
      S("Vignette", 0, 100, 1, () => clip.fx.vignette, (v) => clip.fx.vignette = v, "%"),
    ));

    if (media && (media.type === "video" || media.type === "image")) {
      host.appendChild(Effects.section("Chroma Key (green screen)",
        Effects.checkboxRow("Enable", () => clip.fx.keyEnabled, (v) => clip.fx.keyEnabled = v),
        Effects.colorRow("Key color", () => clip.fx.keyColor, (v) => clip.fx.keyColor = v),
        S("Similarity", 0, 100, 1, () => clip.fx.keySimilarity, (v) => clip.fx.keySimilarity = v, "%"),
        S("Smoothness", 0, 100, 1, () => clip.fx.keySmooth, (v) => clip.fx.keySmooth = v, "%"),
      ));
    }

    const resetBtn = el("button", {
      class: "fx-reset", text: "Reset color & motion",
      onclick: () => {
        pushHistory();
        clip.fx = DEFAULT_FX();
        clip.transform = DEFAULT_TRANSFORM();
        clip.opacity = 100;
        clip.kf = {};
        afterModelChange();
      },
    });
    host.appendChild(resetBtn);

    const transSel = el("select", {},
      el("option", { value: "dissolve", text: "Cross Dissolve" }),
      el("option", { value: "dipblack", text: "Dip to Black" }),
      el("option", { value: "wipe", text: "Wipe" }),
      el("option", { value: "push", text: "Push" }));
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
      S("Volume", 0, 200, 1, () => clip.volume, (v) => clip.volume = v, "%", kf("volume")),
      S("Bass", -24, 24, 1, () => clip.audio.bass, (v) => clip.audio.bass = v, "dB"),
      S("Treble", -24, 24, 1, () => clip.audio.treble, (v) => clip.audio.treble = v, "dB"),
      S("High-pass", 0, 4000, 10, () => clip.audio.highpass, (v) => clip.audio.highpass = v, "Hz"),
      S("Low-pass", 0, 20000, 50, () => clip.audio.lowpass, (v) => clip.audio.lowpass = v, "Hz"),
      el("div", { class: "dim", style: "font-size:11px", text: "0 Hz = filter off. High-pass removes rumble; low-pass removes hiss." }),
      el("div", { class: "fx-btn-row" },
        el("button", {
          text: "Crossfade at cut →", title: "Fade this clip out and the next clip in (0.5s each)",
          onclick: () => Effects.audioCrossfade(clip),
        }),
      ),
    ));
  }

  if (media && (media.type === "video" || media.type === "audio")) {
    host.appendChild(Effects.section("Speed / Duration",
      S("Speed", 0.25, 4, 0.25, () => clip.speed, (v) => { clip.speed = v; }, "×"),
      el("div", { class: "dim", style: "font-size:11px", text: "Clip length on the timeline updates with speed." }),
    ));
  }
}

Effects.audioCrossfade = function (clip) {
  const next = clipsOnTrack(clip.track).find((c) =>
    c.id !== clip.id && Math.abs(c.start - clipEnd(clip)) < 0.02);
  if (!next) return toast("No adjacent clip after this one");
  pushHistory();
  clip.fadeOut = Math.max(clip.fadeOut, 0.5);
  next.fadeIn = Math.max(next.fadeIn, 0.5);
  afterModelChange();
  toast("Crossfade added (0.5s out / 0.5s in)");
};
