"use strict";

// ---------------------------------------------------------------------------
// Minimal WebM (Matroska) muxer for WebCodecs output. Takes VP8/VP9
// EncodedVideoChunks and Opus EncodedAudioChunks and assembles a playable
// .webm file entirely in memory: EBML header → Segment(Info, Tracks,
// Clusters of SimpleBlocks). No third-party code, no network.
// ---------------------------------------------------------------------------

const Muxer = window.Muxer = {

  // ---- EBML primitives ----

  // minimal big-endian bytes of an unsigned int
  uintBytes(n) {
    if (n === 0) return new Uint8Array([0]);
    const out = [];
    while (n > 0) { out.unshift(n & 0xff); n = Math.floor(n / 256); }
    return new Uint8Array(out);
  },

  float64Bytes(v) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v);
    return b;
  },

  int16beBytes(v) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setInt16(0, v);
    return b;
  },

  // EBML variable-size integer (used for element sizes)
  vint(n) {
    let len = 1;
    while (len < 8 && n >= Math.pow(2, 7 * len) - 1) len++;
    const out = new Uint8Array(len);
    let rest = n;
    for (let i = len - 1; i >= 0; i--) { out[i] = rest & 0xff; rest = Math.floor(rest / 256); }
    out[0] |= 0x80 >> (len - 1);
    return out;
  },

  concat(parts) {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  },

  // element = ID bytes + size vint + payload
  elem(idBytes, payload) {
    if (Array.isArray(payload)) payload = this.concat(payload);
    return this.concat([new Uint8Array(idBytes), this.vint(payload.length), payload]);
  },

  uintElem(idBytes, n) { return this.elem(idBytes, this.uintBytes(n)); },
  strElem(idBytes, s) { return this.elem(idBytes, new TextEncoder().encode(s)); },
  floatElem(idBytes, v) { return this.elem(idBytes, this.float64Bytes(v)); },

  // ---- Opus decoder-config (CodecPrivate) fallback ----
  opusHead(channels, sampleRate) {
    const b = new Uint8Array(19);
    b.set(new TextEncoder().encode("OpusHead"), 0);
    b[8] = 1;                      // version
    b[9] = channels;
    const dv = new DataView(b.buffer);
    dv.setUint16(10, 312, true);   // pre-skip
    dv.setUint32(12, sampleRate, true);
    dv.setInt16(16, 0, true);      // output gain
    b[18] = 0;                     // mapping family
    return b;
  },

  // ---- the muxer ----
  // opts: {width, height, codecId ("V_VP8"|"V_VP9"), fps, durationMs,
  //        videoChunks: EncodedVideoChunk[],
  //        audio: null | {chunks: EncodedAudioChunk[], codecPrivate: Uint8Array,
  //                       channels, sampleRate}}
  buildWebM(opts) {
    const ebmlHeader = this.elem([0x1a, 0x45, 0xdf, 0xa3], [
      this.uintElem([0x42, 0x86], 1),          // EBMLVersion
      this.uintElem([0x42, 0xf7], 1),          // EBMLReadVersion
      this.uintElem([0x42, 0xf2], 4),          // EBMLMaxIDLength
      this.uintElem([0x42, 0xf3], 8),          // EBMLMaxSizeLength
      this.strElem([0x42, 0x82], "webm"),      // DocType
      this.uintElem([0x42, 0x87], 2),          // DocTypeVersion
      this.uintElem([0x42, 0x85], 2),          // DocTypeReadVersion
    ]);

    const info = this.elem([0x15, 0x49, 0xa9, 0x66], [
      this.uintElem([0x2a, 0xd7, 0xb1], 1_000_000), // TimestampScale: 1 ms
      this.floatElem([0x44, 0x89], opts.durationMs),
      this.strElem([0x4d, 0x80], "GritCut"),        // MuxingApp
      this.strElem([0x57, 0x41], "GritCut"),        // WritingApp
    ]);

    const videoTrack = this.elem([0xae], [
      this.uintElem([0xd7], 1),                 // TrackNumber
      this.uintElem([0x73, 0xc5], 1),           // TrackUID
      this.uintElem([0x83], 1),                 // TrackType: video
      this.strElem([0x86], opts.codecId),       // CodecID
      this.elem([0xe0], [                       // Video
        this.uintElem([0xb0], opts.width),      // PixelWidth
        this.uintElem([0xba], opts.height),     // PixelHeight
      ]),
    ]);

    const trackEntries = [videoTrack];
    if (opts.audio) {
      trackEntries.push(this.elem([0xae], [
        this.uintElem([0xd7], 2),
        this.uintElem([0x73, 0xc5], 2),
        this.uintElem([0x83], 2),               // TrackType: audio
        this.strElem([0x86], "A_OPUS"),
        this.uintElem([0x56, 0xaa], 6_500_000), // CodecDelay (312 samples @48k)
        this.uintElem([0x56, 0xbb], 80_000_000),// SeekPreRoll
        this.elem([0x63, 0xa2], opts.audio.codecPrivate), // CodecPrivate
        this.elem([0xe1], [                     // Audio
          this.floatElem([0xb5], opts.audio.sampleRate),
          this.uintElem([0x9f], opts.audio.channels),
        ]),
      ]));
    }
    const tracks = this.elem([0x16, 0x54, 0xae, 0x6b], trackEntries);

    // collect all blocks with track tags, sorted by timestamp
    const blocks = [];
    for (const c of opts.videoChunks) {
      const data = new Uint8Array(c.byteLength);
      c.copyTo(data);
      blocks.push({ track: 1, tsMs: Math.round(c.timestamp / 1000), key: c.type === "key", data });
    }
    if (opts.audio) {
      for (const c of opts.audio.chunks) {
        const data = new Uint8Array(c.byteLength);
        c.copyTo(data);
        blocks.push({ track: 2, tsMs: Math.round(c.timestamp / 1000), key: true, data });
      }
    }
    blocks.sort((a, b) => a.tsMs - b.tsMs || a.track - b.track);

    // clusters: start a new one at every video keyframe (and cap at 30 s)
    const clusters = [];
    let cluster = null, clusterTs = 0;
    for (const b of blocks) {
      if (!cluster || (b.track === 1 && b.key) || b.tsMs - clusterTs > 30000) {
        if (cluster) clusters.push(this.elem([0x1f, 0x43, 0xb6, 0x75], cluster));
        clusterTs = b.tsMs;
        cluster = [this.uintElem([0xe7], clusterTs)];
      }
      const rel = Math.max(-32768, Math.min(32767, b.tsMs - clusterTs));
      cluster.push(this.elem([0xa3], this.concat([   // SimpleBlock
        this.vint(b.track),
        this.int16beBytes(rel),
        new Uint8Array([b.key ? 0x80 : 0x00]),
        b.data,
      ])));
    }
    if (cluster) clusters.push(this.elem([0x1f, 0x43, 0xb6, 0x75], cluster));

    const segment = this.elem([0x18, 0x53, 0x80, 0x67], [info, tracks, ...clusters]);
    return new Blob([ebmlHeader, segment], { type: "video/webm" });
  },
};
