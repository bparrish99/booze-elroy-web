/* Booze Elroy - DARKSTAR (the author's secret, 2026-11-17: typed "darkstar" on a menu screen). A rave in honour of
   Pac-Man: an original house loop synthesized live here, and a beat clock the renderer dances to (render.js draws the
   lights, lasers, confetti and the rest). Sound and pictures only: the game itself is untouched (the author: "gameplay
   must remain pure"). */
(function (root) {
  "use strict";
  const BPM = 128, STEP = 60 / BPM / 4; // a 16th note, s
  const LEVEL = 0.65; // the music against the game's own sounds (0.5 at first; the author: "up the relative volume slightly")
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // A minor, vi-IV-I-V: Am F C G, a bar each
  const ROOTS = [45, 41, 48, 43];                                    // bass (A2 F2 C3 G2)
  const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]]; // stabs / pad
  const STABS = [3, 6, 10, 13];                                     // 16ths in a bar the stabs land on
  const ARP = [0, 1, 2, 1, 2, 0, 1, 2];
  // the lead's hook (bars 8-11 of the 16): [16th, midi, length in 16ths] per bar, an original two-bar answer phrase
  const HOOK = [
    [[0, 76, 2], [3, 76, 1], [4, 74, 2], [6, 72, 2], [8, 74, 3], [11, 72, 1], [12, 69, 4]],
    [[0, 72, 2], [3, 72, 1], [4, 69, 2], [6, 67, 2], [8, 69, 6], [14, 72, 2]],
    [[0, 76, 2], [3, 76, 1], [4, 79, 2], [6, 76, 2], [8, 74, 3], [11, 72, 1], [12, 74, 4]],
    [[0, 71, 2], [2, 74, 2], [4, 79, 4], [8, 78, 2], [10, 79, 6]],
  ];

  function create(audio) {
    const ctx = audio && audio.ctx;
    let on = false, t0 = 0, nextStep = 0, timer = 0, out = null, pump = null, noise = null;

    function nodes() {
      if (out) return;
      out = ctx.createGain(); out.gain.value = 0;
      out.connect(audio.master());
      pump = ctx.createGain(); pump.connect(out);                     // the sidechain: ducks under every kick
      const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = n.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noise = n;
    }
    const env = (g, t, a, peak, dec, sus) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sus || 0.0001), t + a + dec); };
    function kick(t) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
      g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.4);
      pump.gain.cancelScheduledValues(t); pump.gain.setValueAtTime(0.3, t); pump.gain.linearRampToValueAtTime(1, t + 0.2);
    }
    function hiss(t, dur, type, freq, q, vol, dest) {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noise; s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(dest || out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
      return { f, g };
    }
    const clap = (t, v) => { for (let i = 0; i < 3; i++) hiss(t + i * 0.011, 0.16, "bandpass", 1600, 1.2, (v || 0.5) * (i === 2 ? 1 : 0.6)); };
    function synth(t, midi, dur, type, vol, cutoff, detunes, dest) {
      const f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = "lowpass"; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.35), t + dur);
      env(g, t, 0.005, vol, dur, 0.0001);
      for (const dt of detunes || [0]) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = mtof(midi); o.detune.value = dt; o.connect(f); o.start(t); o.stop(t + dur + 0.05); }
      f.connect(g); g.connect(dest || pump);
    }
    function sample(t, name, vol, rate) { // the game's own sounds, in time (wakka fills, the coin drop at the top)
      const b = audio.buffer(name); if (!b) return;
      const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.playbackRate.value = rate || 1; g.gain.value = vol;
      s.connect(g); g.connect(out); s.start(t);
    }

    // one 16th note of the 16-bar song: bars 0-3 groove, 4-7 + stabs and arp, 8-11 + the hook, 12-14 breakdown, 15 build
    function step(n, t) {
      const bar = Math.floor(n / 16) % 16, s = n % 16, c = bar % 4, beat = s % 4 === 0;
      const breakdown = bar >= 12 && bar <= 14, build = bar === 15;
      if (!breakdown && !build && beat) kick(t);
      if (build && beat && s < 8) kick(t);
      if (!breakdown && (s === 4 || s === 12)) clap(t);
      if (build) clap(t, 0.12 + 0.4 * (s / 16));                          // the snare roll into the drop
      if (!breakdown && s % 4 === 2) hiss(t, 0.12, "highpass", 7000, 0.7, 0.18);   // open hats on the offbeat
      if (s % 2 === 1) hiss(t, 0.03, "highpass", 9000, 0.7, breakdown ? 0.03 : 0.06); // closed hats
      if (!breakdown && !build && s % 4 === 2) synth(t, ROOTS[c], STEP * 1.7, "sawtooth", 0.32, 900, [0, 7]); // offbeat bass
      if (!breakdown && !build && s === 15 && c === 3) synth(t, ROOTS[c] + 2, STEP, "sawtooth", 0.25, 900, [0]);
      if (bar >= 4 && !breakdown && !build && STABS.includes(s)) for (const m of CHORDS[c]) synth(t, m, STEP * 1.6, "sawtooth", 0.07, 3200, [-14, 0, 13]);
      if (bar >= 4 && !build) synth(t, CHORDS[c][ARP[s % 8]] + 12, STEP * 0.9, "square", breakdown ? 0.03 : 0.045, breakdown ? 1200 + 3000 * ((bar - 12) * 16 + s) / 48 : 2600, [0]);
      if (breakdown && s === 0) for (const m of CHORDS[c]) synth(t, m - 12, STEP * 16, "sawtooth", 0.05, 600 + (bar - 12) * 900, [-10, 10]); // the pad, opening up
      if (bar >= 8 && bar <= 11) for (const [at, m, len] of HOOK[bar - 8]) if (at === s) synth(t, m, STEP * len, "square", 0.09, 4200, [0, 5]);
      if (bar === 14 && s === 0) { const r = hiss(t, STEP * 32, "bandpass", 300, 2, 0.25); r.f.frequency.exponentialRampToValueAtTime(9000, t + STEP * 32); r.g.gain.setValueAtTime(0.05, t); r.g.gain.linearRampToValueAtTime(0.28, t + STEP * 31); } // the riser
      if (bar === 0 && s === 0 && n > 0) hiss(t, 1.4, "highpass", 3000, 0.5, 0.35); // the crash on the drop
      if ((c === 3 && bar < 12) && s >= 8 && s % 2 === 0) sample(t, s % 4 === 0 ? "wakka1" : "wakka2", 0.5); // wakka wakka fills
      if (bar === 0 && s === 0) sample(t, "coindrop", 0.45);             // every time round: a coin in the slot
    }
    function schedule() {
      const ahead = ctx.currentTime + 0.12;
      while (t0 + nextStep * STEP < ahead) { step(nextStep, t0 + nextStep * STEP); nextStep++; }
    }
    return {
      on: () => on,
      start() {
        if (!ctx || on) return;
        on = true; nodes(); audio.unlock();
        t0 = ctx.currentTime + 0.1; nextStep = 0;
        out.gain.cancelScheduledValues(ctx.currentTime); out.gain.setValueAtTime(0, ctx.currentTime); out.gain.linearRampToValueAtTime(LEVEL, ctx.currentTime + 0.3);
        timer = setInterval(schedule, 25); schedule();
      },
      stop() {
        if (!on) return;
        on = false; clearInterval(timer);
        if (out) { const t = ctx.currentTime; out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + 0.4); }
      },
      /** fade the music out while true (Mina's film: it plays its own sound, and it's not a party) and back in after */
      duck(d) {
        if (!on || !out || d === this.ducked) return;
        this.ducked = d; const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(d ? 0 : LEVEL, t + 0.6);
      },
      ducked: false,
      /** beats since the music started (a float: the fraction is where in the beat we are); a steady clock without audio */
      beat() { return ctx && on ? Math.max(0, (ctx.currentTime - t0) * BPM / 60) : performance.now() / 1000 * BPM / 60; },
      BPM,
    };
  }
  root.BoozeRave = { create };
})(typeof self !== "undefined" ? self : this);
