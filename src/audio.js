/* Booze Elroy - WebAudio shim with the small love.audio Source API the game logic uses. */
(function (root) {
  "use strict";
  function createAudio(buffersB64) {
    const AC = root.AudioContext || root.webkitAudioContext;
    const ctx = AC ? new AC() : null;
    const buffers = {};
    // web edition: a master gain for the page's mute button (the game's own volume logic stays per sound)
    const master = ctx ? ctx.createGain() : null;
    if (master) master.connect(ctx.destination);
    const ready = ctx ? Promise.all(Object.keys(buffersB64).map(async (name) => {
      try {
        const bin = Uint8Array.from(atob(buffersB64[name]), (c) => c.charCodeAt(0));
        buffers[name] = await ctx.decodeAudioData(bin.buffer);
      } catch (e) { console.warn("audio decode failed", name, e); }
    })) : Promise.resolve();

    class Snd {
      constructor(name, loop) { this.name = name; this.loop = !!loop; this.vol = 1; this.node = null; this.gain = null; this.playing = false; this.offset = 0; this.startedAt = 0; }
      _start(offset) {
        const buf = buffers[this.name];
        if (!ctx || !buf) return;
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = this.loop;
        const gain = ctx.createGain(); gain.gain.value = this.vol;
        src.connect(gain); gain.connect(master);
        const me = src;
        src.onended = () => { if (this.node === me) { this.playing = false; this.node = null; this.offset = 0; } };
        this.node = src; this.gain = gain; this.playing = true;
        this.startedAt = ctx.currentTime - offset;
        src.start(0, offset % buf.duration);
      }
      play() { if (this.playing) return; if (ctx && ctx.state === "suspended") ctx.resume(); this._start(this.offset); }
      stop() { this._kill(); this.offset = 0; }
      pause() { if (!this.playing) return; this.offset = ctx.currentTime - this.startedAt; this._kill(); }
      _kill() { if (this.node) { const n = this.node; this.node = null; n.onended = null; try { n.stop(); } catch { /* ignore */ } } this.playing = false; }
      isPlaying() { return this.playing; }
      setVolume(v) { this.vol = v; if (this.gain) this.gain.gain.value = v; }
      setLooping(l) { this.loop = !!l; if (this.node) this.node.loop = this.loop; }
    }
    return { ctx, ready, makeSound: (name, loop) => new Snd(name, loop), unlock() { if (ctx && ctx.state === "suspended") ctx.resume(); },
      setMuted(m) { if (master) master.gain.value = m ? 0 : 1; } };
  }
  root.BoozeAudio = { createAudio };
})(typeof self !== "undefined" ? self : this);
