// End-to-end suite for GritCut. Drives the real app in Chromium over file://
// (exactly how it runs on the user's laptop): imports real media, edits the
// timeline, checks composited pixels, audio routing, a real export, and
// project persistence.
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appUrl = "file://" + path.join(here, "..", "index.html");
const fx = (n) => path.join(here, "fixtures", n);

const results = [];
let page, context, browser;
const pageErrors = [];

function ok(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}
function approx(a, b, tol, msg) {
  ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ~${b}±${tol})`);
}

async function seekAndDraw(t) {
  await page.evaluate((t) => { Player.pause(); Player.seek(t); }, t);
  await page.waitForTimeout(700); // let element seeks + static draw settle
  await page.evaluate(() => Player.drawNow());
}

async function px(x, y) {
  return page.evaluate(([x, y]) => {
    const c = document.querySelector("#programCanvas");
    const d = c.getContext("2d").getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [x, y]);
}

// scan a region for any pixel passing predicate (serialized as string)
async function scanRegion(x0, y0, w, h, predSrc) {
  return page.evaluate(([x0, y0, w, h, predSrc]) => {
    const pred = eval("(" + predSrc + ")");
    const c = document.querySelector("#programCanvas");
    const d = c.getContext("2d").getImageData(x0, y0, w, h).data;
    for (let i = 0; i < d.length; i += 4) {
      if (pred(d[i], d[i + 1], d[i + 2])) return true;
    }
    return false;
  }, [x0, y0, w, h, predSrc]);
}

const state = {}; // shared between tests (media ids, durations)

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------

test("app loads over file:// without errors", async () => {
  await page.goto(appUrl);
  await page.waitForSelector("#programCanvas");
  const title = await page.title();
  ok(title.includes("GritCut"), "title present");
  const canvasSize = await page.evaluate(() => {
    const c = document.querySelector("#programCanvas");
    return [c.width, c.height];
  });
  ok(canvasSize[0] === 1280 && canvasSize[1] === 720, "program canvas at project resolution");
});

test("imports video, audio and image media with correct metadata", async () => {
  await page.setInputFiles("#fileInput", [fx("red.webm"), fx("blue.webm"), fx("still.png"), fx("tone.wav")]);
  await page.waitForFunction(() => window.App && App.media.length === 4, null, { timeout: 20000 });
  const media = await page.evaluate(() =>
    App.media.map((m) => ({ id: m.id, name: m.name, type: m.type, duration: m.duration, offline: m.offline })));
  ok(media.every((m) => !m.offline), "all media online");
  const red = media.find((m) => m.name === "red.webm");
  const blue = media.find((m) => m.name === "blue.webm");
  const still = media.find((m) => m.name === "still.png");
  const tone = media.find((m) => m.name === "tone.wav");
  ok(red && red.type === "video", "red.webm imported as video");
  ok(blue && blue.type === "video", "blue.webm imported as video");
  ok(still && still.type === "image", "still.png imported as image");
  ok(tone && tone.type === "audio", "tone.wav imported as audio");
  ok(isFinite(red.duration) && red.duration > 3 && red.duration < 6, `red duration sane (${red.duration})`);
  approx(tone.duration, 3, 0.2, "tone.wav duration");
  const binCount = await page.locator(".bin-item").count();
  ok(binCount === 4, "bin shows 4 items");
  Object.assign(state, { red, blue, still, tone });
});

test("clips placed on the timeline composite in the program monitor", async () => {
  await page.evaluate(({ red, blue }) => {
    const r = Timeline.addClip(red.id, "V1", 0);
    Timeline.addClip(blue.id, "V1", clipEnd(r));
  }, state);
  state.cut = await page.evaluate(() => clipEnd(clipsOnTrack("V1")[0]));
  await seekAndDraw(1);
  let [r, g, b] = await px(640, 360);
  ok(r > 150 && g < 80 && b < 80, `frame at t=1 is red (${r},${g},${b})`);
  await seekAndDraw(state.cut + 1);
  [r, g, b] = await px(640, 360);
  ok(b > 150 && r < 80 && g < 80, `frame after the cut is blue (${r},${g},${b})`);
});

test("razor split at playhead + undo/redo", async () => {
  await page.evaluate(() => { Player.seek(1.5); Timeline.splitAtPlayhead(); });
  let n = await page.evaluate(() => App.seq.clips.length);
  ok(n === 3, `split produced 3 clips (got ${n})`);
  await page.evaluate(() => undo());
  n = await page.evaluate(() => App.seq.clips.length);
  ok(n === 2, `undo restored 2 clips (got ${n})`);
  await page.evaluate(() => redo());
  n = await page.evaluate(() => App.seq.clips.length);
  ok(n === 3, `redo back to 3 clips (got ${n})`);
  await page.evaluate(() => undo()); // leave 2 clips for later tests
});

test("drag & drop from bin to a timeline track", async () => {
  await page.evaluate(({ still }) => {
    const item = document.querySelector(`[data-media-id="${still.id}"]`);
    const dt = new DataTransfer();
    item.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
    const lane = document.querySelector('.lane[data-track="V2"]');
    const rect = lane.getBoundingClientRect();
    const scroll = document.querySelector("#timelineScroll");
    const x = rect.left + 10 * App.ui.pxPerSec - scroll.scrollLeft;
    const opts = { dataTransfer: dt, bubbles: true, clientX: x, clientY: rect.top + 5 };
    lane.dispatchEvent(new DragEvent("dragover", opts));
    lane.dispatchEvent(new DragEvent("drop", opts));
  }, state);
  const clip = await page.evaluate(() => clipsOnTrack("V2")[0] && {
    start: clipsOnTrack("V2")[0].start, mediaId: clipsOnTrack("V2")[0].mediaId,
  });
  ok(clip, "a clip landed on V2");
  approx(clip.start, 10, 0.5, "dropped near t=10");
  ok(clip.mediaId === state.still.id, "it is the still image");
  await seekAndDraw(11);
  const [r, g, b] = await px(640, 360);
  ok(g > 120 && r < 100 && b < 100, `still image renders green (${r},${g},${b})`);
  await page.evaluate(() => { App.ui.selectedClipId = clipsOnTrack("V2")[0].id; Timeline.deleteSelected(); });
});

test("moving a clip with the mouse (trim/move interactions)", async () => {
  await page.evaluate(() => { App.ui.snap = false; });
  const box = await page.evaluate(() => {
    const blue = clipsOnTrack("V1")[1];
    const div = document.querySelector(`[data-clip-id="${blue.id}"]`);
    const r = div.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, start: blue.start, pps: App.ui.pxPerSec };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.pps, box.y, { steps: 8 }); // +1 second
  await page.mouse.up();
  const newStart = await page.evaluate(() => clipsOnTrack("V1")[1].start);
  approx(newStart, box.start + 1, 0.3, "clip moved ~1s right");
  await page.evaluate(() => { undo(); App.ui.snap = true; });
  const back = await page.evaluate(() => clipsOnTrack("V1")[1].start);
  approx(back, box.start, 0.05, "undo restored the move");
});

test("color effects apply to the composited frame", async () => {
  await page.evaluate(() => { clipsOnTrack("V1")[0].fx.grayscale = 100; Player.invalidate(); });
  await seekAndDraw(1);
  const [r, g, b] = await px(640, 360);
  ok(Math.abs(r - g) < 12 && Math.abs(g - b) < 12, `grayscale makes r≈g≈b (${r},${g},${b})`);
  await page.evaluate(() => { clipsOnTrack("V1")[0].fx.grayscale = 0; Player.invalidate(); });
});

test("motion (scale) and opacity apply", async () => {
  await page.evaluate(() => {
    const c = clipsOnTrack("V1")[0];
    c.transform.scale = 50; Player.invalidate();
  });
  await seekAndDraw(1);
  let [r] = await px(30, 30);
  ok(r < 40, "corner is black at 50% scale");
  let [rc] = await px(640, 360);
  ok(rc > 150, "center still red at 50% scale");
  await page.evaluate(() => {
    const c = clipsOnTrack("V1")[0];
    c.transform.scale = 100; c.opacity = 0; Player.invalidate();
  });
  await seekAndDraw(1);
  [r] = await px(640, 360);
  ok(r < 30, "opacity 0 → black frame");
  await page.evaluate(() => { clipsOnTrack("V1")[0].opacity = 100; Player.invalidate(); });
});

test("cross dissolve renders a blend at the cut", async () => {
  await page.evaluate(() => {
    App.ui.selectedClipId = clipsOnTrack("V1")[0].id;
    Timeline.addTransition("dissolve", "end");
  });
  const trCount = await page.evaluate(() => App.seq.transitions.length);
  ok(trCount === 1, "transition created");
  await seekAndDraw(state.cut); // middle of the transition, p=0.5
  const [r, , b] = await px(640, 360);
  ok(r > 60 && b > 60, `mid-dissolve blends red and blue (${r},*,${b})`);
});

test("title clip renders text over video", async () => {
  await page.evaluate(() => {
    const t = Media.createTitle();
    Timeline.addClip(t.id, "V3", 0.5, 0, 2);
  });
  await seekAndDraw(1);
  const found = await scanRegion(340, 320, 600, 80, "(r,g,b)=>r>200&&g>200&&b>200");
  ok(found, "white title text found over the red frame");
  await page.evaluate(() => {
    App.ui.selectedClipId = clipsOnTrack("V3")[0].id;
    Timeline.deleteSelected();
  });
});

test("playback advances the playhead and stays in sync", async () => {
  await page.evaluate(() => { Player.seek(0.2); Player.play(); });
  await page.waitForTimeout(1200);
  const { t, playing } = await page.evaluate(() => ({ t: App.ui.playhead, playing: Player.playing }));
  ok(playing, "still playing");
  approx(t, 1.4, 0.5, "playhead advanced in real time");
  const [r] = await px(640, 360);
  ok(r > 120, "frame during playback is red");
  await page.evaluate(() => Player.pause());
});

test("audio routes to the master bus; track mute silences it", async () => {
  await page.evaluate(({ tone }) => {
    Timeline.addClip(tone.id, "A1", 0);
    // silence the video clips' embedded tones so we measure only A1
    for (const c of clipsOnTrack("V1")) c.volume = 0;
  }, state);
  await page.evaluate(() => { Player.seek(0.3); Player.play(); });
  await page.waitForTimeout(900);
  const loud = await page.evaluate(() => AudioEngine.levelPeak());
  ok(loud > 0.05, `tone is audible on the master bus (peak ${loud.toFixed(3)})`);
  await page.evaluate(() => { findTrack("A1").muted = true; });
  await page.waitForTimeout(900);
  const quiet = await page.evaluate(() => AudioEngine.levelPeak());
  ok(quiet < 0.02, `muting A1 silences the master bus (peak ${quiet.toFixed(3)})`);
  await page.evaluate(() => {
    Player.pause();
    findTrack("A1").muted = false;
    for (const c of clipsOnTrack("V1")) c.volume = 100;
  });
});

test("speed change shortens the clip and still plays", async () => {
  const { before, after } = await page.evaluate(() => {
    const c = clipsOnTrack("V1")[0];
    const before = clipDur(c);
    c.speed = 2;
    const after = clipDur(c);
    Player.invalidate(); Timeline.render();
    return { before, after };
  });
  approx(after, before / 2, 0.05, "2× speed halves timeline duration");
  await seekAndDraw(0.5);
  const [r] = await px(640, 360);
  ok(r > 120, "sped-up clip still renders");
  await page.evaluate(() => { clipsOnTrack("V1")[0].speed = 1; Player.invalidate(); Timeline.render(); });
});

test("export renders a real playable video file", async () => {
  // build a compact 4s sequence: red 0-2, blue 2-4
  await page.evaluate(({ red, blue }) => {
    App.seq.clips = [];
    App.seq.transitions = [];
    const a = Timeline.addClip(red.id, "V1", 0, 0, 2);
    Timeline.addClip(blue.id, "V1", clipEnd(a), 0, 2);
  }, state);
  await page.evaluate(() => Exporter.openDialog());
  await page.selectOption("#exportRes", "854x480");
  await page.selectOption("#exportEngine", "realtime");
  await page.evaluate(() => Exporter.start());
  await page.waitForFunction(() => !!App.lastExport, null, { timeout: 60000 });
  const info = await page.evaluate(() => ({ size: App.lastExport.size, type: App.lastExport.type }));
  ok(info.size > 20000, `export file has substance (${info.size} bytes)`);
  ok(info.type.includes("webm") || info.type.includes("mp4"), `container type ${info.type}`);

  // decode the exported file and verify duration + frames
  const check = await page.evaluate(async () => {
    const url = URL.createObjectURL(App.lastExport.blob);
    const v = document.createElement("video");
    v.src = url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; });
    if (!isFinite(v.duration)) {
      await new Promise((res) => {
        v.addEventListener("durationchange", () => { if (isFinite(v.duration)) res(); });
        v.currentTime = 1e7;
      });
    }
    const dur = v.duration;
    const sample = async (t) => {
      v.currentTime = t;
      await new Promise((res) => (v.onseeked = res));
      const c = document.createElement("canvas");
      c.width = v.videoWidth; c.height = v.videoHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(v, 0, 0);
      const d = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const early = await sample(1.0);
    const late = await sample(3.2);
    return { dur, early, late, w: v.videoWidth, h: v.videoHeight };
  });
  approx(check.dur, 4, 1.2, "exported duration ≈ sequence length");
  ok(check.w === 854 || check.w === 852, `exported at requested width (${check.w})`);
  ok(check.early[0] > 100 && check.early[2] < 100, `exported frame at 1s is red (${check.early})`);
  ok(check.late[2] > 100 && check.late[0] < 100, `exported frame at 3.2s is blue (${check.late})`);
});

test("project save, reload, autosave restore and media relink", async () => {
  const json = await page.evaluate(() => Project.serialize());
  await page.reload();
  await page.waitForSelector("#programCanvas");
  // autosave should have restored the edit structure with offline media
  const restored = await page.evaluate(() => ({
    clips: App.seq.clips.length,
    offline: App.media.filter((m) => m.offline).length,
  }));
  ok(restored.clips === 2, `autosave restored the timeline (${restored.clips} clips)`);
  ok(restored.offline >= 2, "media is offline after reload (files can't persist)");
  // explicit project-file load path
  await page.evaluate((j) => Project.load(j), json);
  const clips = await page.evaluate(() => App.seq.clips.length);
  ok(clips === 2, "project file loads the same timeline");
  // relink by re-importing the same files
  await page.setInputFiles("#fileInput", [fx("red.webm"), fx("blue.webm"), fx("still.png"), fx("tone.wav")]);
  await page.waitForFunction(() => App.media.every((m) => !m.offline), null, { timeout: 20000 });
  await seekAndDraw(1);
  const [r] = await px(640, 360);
  ok(r > 120, "relinked media renders again");
});

test("overwrite edit trims what it lands on", async () => {
  const res = await page.evaluate(({ blue }) => {
    // red[0..2) blue[2..4) exist; drop blue over 1..3 → red trimmed, old blue trimmed
    Timeline.addClip(blue.id, "V1", 1, 0, 2);
    return clipsOnTrack("V1").map((c) => ({ start: c.start, end: clipEnd(c), media: findMedia(c.mediaId).name }));
  }, state);
  ok(res.length === 3, `overwrite produced 3 clips (${JSON.stringify(res)})`);
  approx(res[0].end, 1, 0.05, "first clip trimmed to the overwrite start");
  approx(res[1].start, 1, 0.05, "new clip starts at 1");
  approx(res[2].start, 3, 0.05, "old blue clip trimmed to start at 3");
});

test("audio waveform peaks are computed for imported media", async () => {
  await page.waitForFunction(({ tone }) => {
    const m = App.media.find((x) => x.id === tone.id);
    return m && m.peaks && m.peaks.length > 50;
  }, state, { timeout: 15000 });
  const maxPeak = await page.evaluate(({ tone }) =>
    Math.max(...App.media.find((x) => x.id === tone.id).peaks), state);
  ok(maxPeak > 0.1, `waveform has real amplitude (max ${maxPeak})`);
});

test("keyframed opacity animates over time", async () => {
  await page.evaluate(({ red }) => {
    App.seq.clips = []; App.seq.transitions = [];
    const c = Timeline.addClip(red.id, "V1", 0);
    kfUpsert(c, "opacity", 0, 0);
    kfUpsert(c, "opacity", 2, 100);
    Player.invalidate();
  }, state);
  await seekAndDraw(0.1);
  const dim = (await px(640, 360))[0];
  await seekAndDraw(1.0);
  const mid = (await px(640, 360))[0];
  await seekAndDraw(1.9);
  const bright = (await px(640, 360))[0];
  ok(dim < 40, `near t=0 the clip is almost transparent (r=${dim})`);
  ok(mid > 70 && mid < 200, `at t=1 opacity is ~50% (r=${mid})`);
  ok(bright > 200, `at t=1.9 opacity is ~95% (r=${bright})`);
  ok(dim < mid && mid < bright, "opacity ramps up monotonically");
});

test("chroma key removes the keyed color", async () => {
  await page.evaluate(({ red, still }) => {
    App.seq.clips = []; App.seq.transitions = [];
    Timeline.addClip(red.id, "V1", 0);
    const green = Timeline.addClip(still.id, "V2", 0, 0, 3);
    App.ui.selectedClipId = green.id;
  }, state);
  await seekAndDraw(1);
  let [, g] = await px(640, 360);
  ok(g > 120, "green still covers the red clip before keying");
  await page.evaluate(() => {
    const c = findClip(App.ui.selectedClipId);
    c.fx.keyEnabled = 1;
    c.fx.keyColor = "#00cc00";
    c.fx.keySimilarity = 25;
    Player.invalidate();
  });
  await seekAndDraw(1);
  const [r2, g2] = await px(640, 360);
  ok(r2 > 120 && g2 < 90, `keying the green reveals the red beneath (${r2},${g2})`);
});

test("wipe transition reveals the incoming clip from the left", async () => {
  await page.evaluate(({ red, blue }) => {
    App.seq.clips = []; App.seq.transitions = [];
    const a = Timeline.addClip(red.id, "V1", 0, 0, 2);
    Timeline.addClip(blue.id, "V1", clipEnd(a), 0, 2);
    App.ui.selectedClipId = a.id;
    Timeline.addTransition("wipe", "end");
  }, state);
  await seekAndDraw(2.0); // p = 0.5
  const left = await px(200, 360);
  const right = await px(1000, 360);
  ok(left[2] > 120 && left[0] < 90, `left half shows incoming blue (${left})`);
  ok(right[0] > 120 && right[2] < 90, `right half still shows outgoing red (${right})`);
  await page.evaluate(() => { App.seq.transitions = []; Player.invalidate(); });
});

test("title background box and outline render", async () => {
  await page.evaluate(() => {
    const t = Media.createTitle();
    t.title.text = "HELLO";
    t.title.bg = true;
    t.title.bgColor = "#ff00ff";
    t.title.outlineWidth = 6;
    t.title.outlineColor = "#000000";
    Timeline.addClip(t.id, "V3", 0, 0, 2);
  });
  await seekAndDraw(1);
  const magenta = await scanRegion(440, 300, 400, 120, "(r,g,b)=>r>200&&b>200&&g<90");
  const white = await scanRegion(440, 320, 400, 80, "(r,g,b)=>r>200&&g>200&&b>200");
  const black = await scanRegion(500, 330, 280, 60, "(r,g,b)=>r<45&&g<45&&b<45");
  ok(magenta, "background box renders");
  ok(white, "title text renders");
  ok(black, "outline renders around the letters");
  await page.evaluate(() => {
    App.ui.selectedClipId = clipsOnTrack("V3")[0].id;
    Timeline.deleteSelected();
  });
});

test("copy/paste clip and paste attributes between clips", async () => {
  await page.evaluate(() => {
    App.ui.selectedClipId = clipsOnTrack("V1")[0].id;
    copySelectedClip();
    Player.seek(6);
    pasteClip();
  });
  const pasted = await page.evaluate(() => {
    const c = findClip(App.ui.selectedClipId);
    return { start: c.start, mediaId: c.mediaId, n: App.seq.clips.length };
  });
  ok(pasted.n === 3, `paste created a third clip (${pasted.n})`);
  approx(pasted.start, 6, 0.1, "pasted at the playhead");
  ok(pasted.mediaId === state.red.id, "pasted clip references the same media");
  const gray = await page.evaluate(() => {
    const orig = clipsOnTrack("V1")[0];
    const target = findClip(App.ui.selectedClipId);
    App.ui.selectedClipId = orig.id;
    orig.fx.grayscale = 77;
    copyAttributes();
    App.ui.selectedClipId = target.id;
    pasteAttributes();
    return findClip(App.ui.selectedClipId).fx.grayscale;
  });
  ok(gray === 77, `paste attributes carried the effect (grayscale=${gray})`);
  await page.evaluate(() => {
    Timeline.deleteSelected();
    clipsOnTrack("V1")[0].fx.grayscale = 0;
  });
});

test("markers add, persist in the project file, and remove", async () => {
  await page.evaluate(() => { Player.seek(2); addMarker(); });
  const n = await page.evaluate(() => App.seq.markers.length);
  ok(n === 1, "marker added");
  const inJson = await page.evaluate(() => JSON.parse(Project.serialize()).seq.markers.length);
  ok(inJson === 1, "marker saved in the project file");
  await page.evaluate(() => removeNearestMarker());
  const after = await page.evaluate(() => App.seq.markers.length);
  ok(after === 0, "Shift+M removes the nearest marker");
});

test("webcam recording lands in the bin as usable media", async () => {
  // this sandboxed Chromium has no capture devices, so stand in for the OS
  // camera with a synthetic stream; everything downstream (MediaRecorder,
  // blob import, duration probe) is the real recorder pipeline
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement("canvas");
      c.width = 320; c.height = 180;
      const ctx = c.getContext("2d");
      setInterval(() => { ctx.fillStyle = "#ff8800"; ctx.fillRect(0, 0, 320, 180); }, 50);
      const actx = new AudioContext();
      const osc = actx.createOscillator();
      const dest = actx.createMediaStreamDestination();
      osc.connect(dest); osc.start();
      const stream = c.captureStream(30);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      return stream;
    };
  });
  const before = await page.evaluate(() => App.media.length);
  await page.evaluate(() => Recorder.toggle("webcam"));
  await page.waitForTimeout(1600);
  await page.evaluate(() => Recorder.stop());
  await page.waitForFunction((n) => App.media.length === n + 1, before, { timeout: 20000 });
  const rec = await page.evaluate(() => {
    const m = App.media[App.media.length - 1];
    return { name: m.name, type: m.type, duration: m.duration, offline: m.offline };
  });
  ok(rec.type === "video", `recording is video media (${rec.name})`);
  ok(!rec.offline, "recording is online");
  ok(isFinite(rec.duration) && rec.duration > 0.5, `recording has a real duration (${rec.duration})`);
  await page.evaluate(() => Media.remove(App.media[App.media.length - 1].id));
});

test("save frame exports a PNG still", async () => {
  await seekAndDraw(1);
  await page.click("#btnSaveFrame");
  await page.waitForFunction(() => !!App.lastFrame, null, { timeout: 10000 });
  const size = await page.evaluate(() => App.lastFrame.size);
  ok(size > 1000, `PNG frame has substance (${size} bytes)`);
});

test("fast render (WebCodecs + own WebM muxer) produces a playable file", async () => {
  // timeline is red[0..2) blue[2..4) at this point
  await page.evaluate(() => Exporter.openDialog());
  await page.selectOption("#exportEngine", "fast");
  await page.selectOption("#exportRes", "854x480");
  const t0 = Date.now();
  await page.evaluate(() => { App.lastExport = null; Exporter.start(); });
  await page.waitForFunction(() => !!App.lastExport, null, { timeout: 120000 });
  const renderSecs = (Date.now() - t0) / 1000;
  const info = await page.evaluate(() => ({ size: App.lastExport.size, type: App.lastExport.type }));
  ok(info.size > 20000, `muxed file has substance (${info.size} bytes)`);

  const check = await page.evaluate(async () => {
    const url = URL.createObjectURL(App.lastExport.blob);
    const v = document.createElement("video");
    v.src = url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error("decode failed")); });
    const dur = v.duration;
    const sample = async (t) => {
      v.currentTime = t;
      await new Promise((res) => (v.onseeked = res));
      const c = document.createElement("canvas");
      c.width = v.videoWidth; c.height = v.videoHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(v, 0, 0);
      const d = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const early = await sample(1.0);
    const late = await sample(3.2);
    // verify the muxed opus track actually decodes
    v.muted = true;
    await v.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    v.pause();
    const audioBytes = v.webkitAudioDecodedByteCount || 0;
    return { dur, early, late, w: v.videoWidth, audioBytes };
  });
  approx(check.dur, 4, 0.5, "muxer wrote the right duration");
  ok(check.w === 854, `rendered at requested width (${check.w})`);
  ok(check.early[0] > 100 && check.early[2] < 100, `frame at 1s is red (${check.early})`);
  ok(check.late[2] > 100 && check.late[0] < 100, `frame at 3.2s is blue (${check.late})`);
  ok(check.audioBytes > 0, `muxed audio track decodes (${check.audioBytes} bytes)`);
  console.log(`      (4s sequence rendered in ${renderSecs.toFixed(1)}s)`);
});

test("keyframe easing curves change the interpolation", async () => {
  const vals = await page.evaluate(() => {
    const c = clipsOnTrack("V1")[0];
    c.kf.x = [{ t: 0, v: 0 }, { t: 2, v: 100 }];
    c.kfEase = { x: "linear" };
    const linear = propValue(c, "x", c.start + 1); // source t=1, midpoint
    c.kfEase.x = "easeIn";
    const eased = propValue(c, "x", c.start + 1);
    c.kfEase.x = "hold";
    const held = propValue(c, "x", c.start + 1.9);
    c.kf.x = []; c.kfEase = {};
    return { linear, eased, held };
  });
  approx(vals.linear, 50, 1, "linear midpoint is 50");
  approx(vals.eased, 25, 1, "easeIn midpoint is 25");
  approx(vals.held, 0, 0.01, "hold keeps the previous keyframe value");
});

test("title animation presets animate text in", async () => {
  await page.evaluate(() => {
    const t = Media.createTitle();
    t.title.text = "ANIMATED";
    t.title.animIn = "fade";
    t.title.animDur = 1;
    Timeline.addClip(t.id, "V3", 0, 0, 3);
  });
  await seekAndDraw(0.06); // 6% into the fade — text nearly invisible
  const early = await scanRegion(340, 320, 600, 80, "(r,g,b)=>r>200&&g>200&&b>200");
  await seekAndDraw(1.8);  // fade done
  const late = await scanRegion(340, 320, 600, 80, "(r,g,b)=>r>200&&g>200&&b>200");
  ok(!early, "text is not yet visible at the start of the fade-in");
  ok(late, "text is fully visible after the fade-in");
  await page.evaluate(() => {
    App.ui.selectedClipId = clipsOnTrack("V3")[0].id;
    Timeline.deleteSelected();
  });
});

test("per-clip audio filters shape the sound (high-pass kills a low tone)", async () => {
  await page.evaluate(({ tone }) => {
    App.seq.clips = App.seq.clips.filter((c) => findTrack(c.track).kind !== "audio");
    Timeline.addClip(tone.id, "A1", 0);
    for (const c of clipsOnTrack("V1")) c.volume = 0;
  }, state);
  await page.evaluate(() => { Player.seek(0.3); Player.play(); });
  await page.waitForTimeout(900);
  const loud = await page.evaluate(() => AudioEngine.levelPeak());
  await page.evaluate(() => {
    const a1 = clipsOnTrack("A1")[0];
    a1.audio.highpass = 3000; // the fixture tone is 440 Hz
  });
  await page.waitForTimeout(900);
  const filtered = await page.evaluate(() => AudioEngine.levelPeak());
  ok(loud > 0.05, `tone audible before filtering (peak ${loud.toFixed(3)})`);
  ok(filtered < loud * 0.4, `high-pass attenuates the tone (${loud.toFixed(3)} → ${filtered.toFixed(3)})`);
  await page.evaluate(() => {
    Player.pause();
    const a1 = clipsOnTrack("A1")[0];
    a1.audio.highpass = 0;
    App.ui.selectedClipId = a1.id;
    Timeline.deleteSelected();
    for (const c of clipsOnTrack("V1")) c.volume = 100;
  });
});

test("sequence settings switch to vertical (Shorts) format", async () => {
  await page.click("#btnSettings");
  await page.selectOption("#seqPreset", "1080x1920");
  await page.selectOption("#seqFps", "30");
  await page.click("#settingsApply");
  const dims = await page.evaluate(() => {
    const c = document.querySelector("#programCanvas");
    return [c.width, c.height, App.settings.width, App.settings.height];
  });
  ok(dims[0] === 1080 && dims[1] === 1920, `canvas resized to vertical (${dims[0]}×${dims[1]})`);
  await seekAndDraw(1);
  const [r] = await page.evaluate(() => {
    const c = document.querySelector("#programCanvas");
    return c.getContext("2d").getImageData(540, 960, 1, 1).data;
  });
  ok(r > 120, "clip still composites centered in the vertical frame");
});

test("no page errors across the whole run", async () => {
  ok(pageErrors.length === 0, "page errors: " + pageErrors.join(" | "));
});

// ---------------------------------------------------------------------------

browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--no-sandbox",
    "--use-fake-ui-for-media-capture",
    "--use-fake-device-for-media-capture",
  ],
});
context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
page = await context.newPage();
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console: " + m.text()); });

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ✔ ${name}`);
    results.push([name, true]);
  } catch (e) {
    failed++;
    console.log(`  ✘ ${name}\n      ${e.message}`);
    results.push([name, false]);
  }
}
await browser.close();
console.log(`\n${results.length - failed}/${results.length} tests passed`);
process.exit(failed ? 1 : 0);
