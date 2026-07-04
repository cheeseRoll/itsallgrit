// Generates real test media for the e2e suite:
//   red.webm  — 4 s solid red video + 440 Hz tone
//   blue.webm — 4 s solid blue video + 880 Hz tone
//   still.png — green still image
//   tone.wav  — 3 s 440 Hz tone (pure Node WAV writer)
// Videos are recorded inside Chromium (canvas + WebAudio -> MediaRecorder),
// then remuxed with Playwright's ffmpeg so duration metadata is exact.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
fs.mkdirSync(dir, { recursive: true });

const FFMPEG = "/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux";

function writeWav(file, seconds, freq) {
  const rate = 44100, n = rate * seconds;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

async function recordClip(page, { color, freq, seconds }) {
  const b64 = await page.evaluate(async ({ color, freq, seconds }) => {
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext("2d");
    const actx = new AudioContext();
    const osc = actx.createOscillator();
    osc.frequency.value = freq;
    const gain = actx.createGain();
    gain.gain.value = 0.4;
    const dest = actx.createMediaStreamDestination();
    osc.connect(gain).connect(dest);
    osc.start();

    const stream = canvas.captureStream(30);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((res) => (rec.onstop = res));

    let running = true;
    (function draw() {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (running) requestAnimationFrame(draw);
    })();

    rec.start(100);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    rec.stop();
    await done;
    running = false;
    osc.stop(); actx.close();

    const blob = new Blob(chunks, { type: "video/webm" });
    const buf = await blob.arrayBuffer();
    let s = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }, { color, freq, seconds });
  return Buffer.from(b64, "base64");
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const page = await browser.newPage();
await page.goto("about:blank");

for (const [name, color, freq] of [["red", "#ff0000", 440], ["blue", "#0000ff", 880]]) {
  const raw = await recordClip(page, { color, freq, seconds: 4 });
  const rawFile = path.join(dir, `${name}.raw.webm`);
  const outFile = path.join(dir, `${name}.webm`);
  fs.writeFileSync(rawFile, raw);
  execFileSync(FFMPEG, ["-y", "-i", rawFile, "-c", "copy", outFile], { stdio: "pipe" });
  fs.unlinkSync(rawFile);
  console.log(`${name}.webm: ${fs.statSync(outFile).size} bytes`);
}

// green still image
const pngB64 = await page.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 320; c.height = 180;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#00cc00";
  ctx.fillRect(0, 0, 320, 180);
  return c.toDataURL("image/png").split(",")[1];
});
fs.writeFileSync(path.join(dir, "still.png"), Buffer.from(pngB64, "base64"));
console.log("still.png written");

writeWav(path.join(dir, "tone.wav"), 3, 440);
console.log("tone.wav written");

await browser.close();
console.log("fixtures done ->", dir);
