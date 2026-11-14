/* Booze Elroy - WebAudio shim with the small love.audio Source API the game logic uses. */
(function (root) {
  "use strict";
  function createAudio(buffersB64) {
    const AC = root.AudioContext || root.webkitAudioContext;
    const ctx = AC ? new AC() : null;
    const buffers = {};
    // web edition: a master gain for the page's volume slider and mute button (the game's own volume logic stays per sound)
    const master = ctx ? ctx.createGain() : null;
    if (master) master.connect(ctx.destination);
    // web edition: the "discarded" look's dying speaker (the author, 2026-11-14), switched in between the master gain and
    // the speakers by setRuin: tinny and honky (cut lows and highs, a nasal bump), a blown cone (soft clipping), and now and
    // then a crack, a hiss, or a dropout like a loose wire. Built the first time it's switched on.
    // (Mina's film plays through its <video>, not through here, so it's never touched.)
    let ruin = null, ruinOn = false, dropTimer = 0;
    function buildRuin() {
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 420; hp.Q.value = 0.9;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400; lp.Q.value = 1.2;
      const honk = ctx.createBiquadFilter(); honk.type = "peaking"; honk.frequency.value = 1300; honk.Q.value = 1.4; honk.gain.value = 7;
      const shaper = ctx.createWaveShaper(); shaper.oversample = "2x";
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 3.2) / Math.tanh(3.2); }
      shaper.curve = curve;
      const wire = ctx.createGain(); wire.gain.value = 1;                       // the loose wire (dropouts)
      const out = ctx.createGain(); out.gain.value = 0.85;
      hp.connect(lp); lp.connect(honk); honk.connect(shaper); shaper.connect(wire); wire.connect(out); out.connect(ctx.destination);
      // noise for the cracks and hisses (a steady bed of pops was tried: "a geiger counter")
      const len = ctx.sampleRate * 2, noise = ctx.createBuffer(1, len, ctx.sampleRate), d = noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // getting stuck: the input splits into the dry path and a short delay line; to stick, the delay grabs a few
      // hundredths of a second of whatever's playing, then loops it on itself (feedback) while the dry path goes quiet:
      // the sound effect buzzing on one stuck slice, like a stuck record
      const split = ctx.createGain(), dry = ctx.createGain(), capIn = ctx.createGain(), delay = ctx.createDelay(0.2);
      const fb = ctx.createGain(), loopOut = ctx.createGain();
      capIn.gain.value = 0; fb.gain.value = 0; loopOut.gain.value = 0;
      split.connect(dry); dry.connect(hp);
      split.connect(capIn); capIn.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(loopOut); loopOut.connect(hp);
      return { input: split, wire, noise, dry, capIn, delay, fb, loopOut };
    }
    // a crack (a snap, from a tick to a bang) or a hiss (a hard burst of static), through the master gain and the speaker
    let stuckUntil = 0;
    function stick() {
      const t = ctx.currentTime, grain = 0.03 + Math.random() * 0.04, dur = 0.3 + Math.random() * 0.6, on = t + grain, off = on + dur;
      stuckUntil = off + 0.5;
      const R = ruin;
      R.delay.delayTime.setValueAtTime(grain, t);
      R.capIn.gain.setValueAtTime(1, t); R.capIn.gain.setValueAtTime(0, on);
      R.fb.gain.setValueAtTime(0.97, on); R.fb.gain.setValueAtTime(0, off);
      R.loopOut.gain.setValueAtTime(1.1, on); R.loopOut.gain.setValueAtTime(0, off);
      R.dry.gain.setValueAtTime(0, on); R.dry.gain.setValueAtTime(1, off);
      // and a mains buzz under it, so it buzzes even when nothing was playing
      const osc = ctx.createOscillator(), of = ctx.createBiquadFilter(), og = ctx.createGain();
      osc.type = "square"; osc.frequency.value = 120; of.type = "lowpass"; of.frequency.value = 900;
      og.gain.setValueAtTime(0, t); og.gain.setValueAtTime(0.05, on); og.gain.setValueAtTime(0, off);
      osc.connect(of); of.connect(og); og.connect(R.input); osc.start(t); osc.stop(off + 0.05);
    }
    // an electrical buzz (a bad ground, an arcing transformer): rough mains hum with harsh overtones, steady or sputtering
    function buzz() {
      const t = ctx.currentTime, dur = 0.3 + Math.random() * 0.9, end = t + dur;
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o1.type = "sawtooth"; o1.frequency.value = 60; o2.type = "square"; o2.frequency.value = 120 + (Math.random() - 0.5) * 2;
      f.type = "bandpass"; f.frequency.value = 350 + Math.random() * 500; f.Q.value = 0.8;
      const peak = 0.08 + Math.random() * 0.1;
      g.gain.setValueAtTime(0, t);
      if (Math.random() < 0.5) { g.gain.linearRampToValueAtTime(peak, t + 0.01); g.gain.setValueAtTime(peak, end - 0.01); } // steady
      else for (let u = t; u < end; u += 0.03 + Math.random() * 0.06) g.gain.setValueAtTime(Math.random() < 0.6 ? peak : 0, u); // sputtering
      g.gain.linearRampToValueAtTime(0, end);
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
      o1.start(t); o2.start(t); o1.stop(end + 0.05); o2.stop(end + 0.05);
    }
    function blip(kind) {
      const t = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = ruin.noise;
      const f = ctx.createBiquadFilter(), g = ctx.createGain();
      if (kind === "crack") {
        f.type = "bandpass"; f.frequency.value = 1500 + Math.random() * 3000; f.Q.value = 0.7;
        const k = Math.pow(Math.random(), 2.5), peak = 0.04 + 0.7 * k;              // mostly small ticks, now and then a bang
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.002); g.gain.exponentialRampToValueAtTime(0.001, t + 0.015 + 0.08 * k);
        src.start(t, Math.random() * 1.5, 0.12);
      } else {
        f.type = "highpass"; f.frequency.value = 2000 + Math.random() * 1500;
        const dur = 0.2 + Math.random() * 0.45, peak = 0.18 + Math.random() * 0.12;   // hard on, hard off (a fade was too soft)
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.004); g.gain.setValueAtTime(peak * 0.85, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.015);
        src.start(t, Math.random() * 0.4, dur + 0.05);
      }
      src.connect(f); f.connect(g); g.connect(master);
    }
    function dropouts() { // now and then the wire lets go for a moment, or snaps, or hisses
      clearTimeout(dropTimer);
      if (!ruinOn) return;
      const r = Math.random();
      if (r < 0.17) blip("crack"); else if (r < 0.21) blip("hiss");           // a crack every ~1.5 s, a hiss every ~6 s
      else if (r < 0.222 && ctx.currentTime > stuckUntil) stick();            // stuck every ~20 s
      else if (r < 0.253) buzz();                                             // a buzz every ~8 s
      if (Math.random() < 0.05) {
        const t = ctx.currentTime, g = ruin.wire.gain;
        // dead silence, cut and back at once (a dip and a fade back was too gentle)
        const back = t + 0.06 + Math.random() * 0.25;
        g.cancelScheduledValues(t); g.setValueAtTime(1, t); g.linearRampToValueAtTime(0, t + 0.002);
        g.setValueAtTime(0, back); g.linearRampToValueAtTime(1, back + 0.003);
      }
      dropTimer = setTimeout(dropouts, 250);
    }
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
      setMaster(v) { if (master) master.gain.value = v; },
      /** the discarded look's dying speaker, on or off */
      setRuin(on) {
        on = !!on;
        if (!ctx || on === ruinOn) return;
        ruinOn = on;
        if (on && !ruin) ruin = buildRuin();
        master.disconnect();
        master.connect(on ? ruin.input : ctx.destination);
        if (on) dropouts();
        else {
          clearTimeout(dropTimer); const t = ctx.currentTime;
          for (const [n, v] of [["wire", 1], ["dry", 1], ["capIn", 0], ["fb", 0], ["loopOut", 0]]) { ruin[n].gain.cancelScheduledValues(t); ruin[n].gain.value = v; }
        }
      } };
  }
  root.BoozeAudio = { createAudio };
})(typeof self !== "undefined" ? self : this);
