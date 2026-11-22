/* Booze Elroy - living backgrounds (web edition, 2026-11-22: the author's idea, "space" and "ocean", backgrounds that move).
   Each is a 224x288 canvas painted afresh every frame and handed to the renderer like a picture, so every look (CRT,
   plain, TV, vector's backdrop, Lantern's dark) takes it as it takes the others. Dark like the pictures (baked at 25%,
   shown at 35%), and calm: they sit behind the maze. Pictures only: their randomness is Math.random, never the game's. */
(function (root) {
  "use strict";
  const W = 224, H = 288;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const canvas = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };

  // ---------------------------------------------------------------- space
  // drifting through deep space (the author: more colour, sparkling, not snow): stars come out of the distance near the
  // middle and spread slowly outward, brightening as they near; two layers of coloured nebulae turn slowly against each
  // other, breathing; a large spiral galaxy turns slowly; stars now and then flare into a four-pointed sparkle;
  // a shooting star every so often, once in a long while a satellite blinking its way across, and a flying saucer
  function space() {
    const c = canvas(), x = c.getContext("2d");
    const sky = x.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#04030f"); sky.addColorStop(1, "#08041a");
    const CX = W / 2, CY = H * 0.45, S = 420; // (the nebula layers are bigger than the screen, so they can turn)
    const NEB_BOOST = 1.45; // (the author: the nebulae's colour "juuust a tad" stronger)
    const cloud = (blobs) => {
      const n = document.createElement("canvas"); n.width = S; n.height = S; const nx = n.getContext("2d");
      for (const [cx, cy, r, col, a0] of blobs) {
        const a = a0 * NEB_BOOST;
        const gr = nx.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(0.45, `rgba(${col},${a * 0.45})`); gr.addColorStop(1, `rgba(${col},0)`);
        nx.fillStyle = gr; nx.fillRect(0, 0, S, S);
      }
      return n;
    };
    const nebA = cloud([[130, 150, 130, "150,40,190", 0.32], [300, 260, 120, "200,50,120", 0.26], [220, 90, 70, "90,60,220", 0.24], [110, 320, 90, "170,60,150", 0.2]]);
    const nebB = cloud([[290, 130, 120, "20,140,170", 0.26], [130, 270, 130, "30,90,200", 0.26], [240, 330, 80, "40,170,150", 0.2], [330, 220, 60, "220,120,60", 0.14]]);
    // a spiral galaxy, baked once face-on, then drawn tilted (squashed along its tilt) and spun in its own plane
    // (the author: arms too thin, "like someone just drew a spiral": now broad, loosely wound arms that widen outward, a
    // glow under them, dust lanes along their inner edges, blue knots of new stars, a faint disc between, a big bright bulge)
    const spiral = (size, arms, inner, outer, coreCol) => {
      const g = document.createElement("canvas"); g.width = size; g.height = size;
      const q = g.getContext("2d"), m = size / 2, R = m - 2, WIND = 2.3 * Math.PI;
      const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
      const col = (f) => (f < 0.35 ? inner : outer);
      const armAt = (arm, f) => arm * (Math.PI * 2 / arms) + f * WIND;
      const blob = (bx, by, r, c, a) => { const gl = q.createRadialGradient(bx, by, 0, bx, by, r); gl.addColorStop(0, `rgba(${c},${a})`); gl.addColorStop(1, `rgba(${c},0)`); q.fillStyle = gl; q.fillRect(bx - r, by - r, r * 2, r * 2); };
      blob(m, m, R, outer, 0.07); // the disc's faint light between the arms
      for (let i = 0; i < size * 6; i++) { // and its scattered stars
        const r = Math.abs(gauss()) * R * 0.55, a = rnd(0, Math.PI * 2);
        q.fillStyle = `rgba(${col(r / R)},${0.25 * Math.random() * (1 - r / R)})`; q.fillRect(m + Math.cos(a) * r, m + Math.sin(a) * r, 1, 1);
      }
      for (let arm = 0; arm < arms; arm++) for (let i = 0; i < 70; i++) { // the arms' glow, wide and widening
        const f = 0.08 + 0.92 * i / 70, ang = armAt(arm, f), r = f * R;
        blob(m + Math.cos(ang) * r, m + Math.sin(ang) * r, 4 + f * 13, col(f), 0.06 * (1 - f * 0.7));
      }
      for (let arm = 0; arm < arms; arm++) for (let i = 0; i < size * 16; i++) { // the arms' stars, scattered across their width
        const f = 0.06 + 0.94 * Math.pow(Math.random(), 0.8), w = 1.2 + f * 8, ang = armAt(arm, f) + gauss() * 0.12, r = f * R + gauss() * w;
        q.fillStyle = `rgba(${col(f)},${(1 - f * 0.75) * 0.5 * Math.random()})`;
        q.fillRect(m + Math.cos(ang) * r, m + Math.sin(ang) * r, 1, 1);
      }
      q.globalCompositeOperation = "destination-out"; // dust lanes along the arms' inner edges
      for (let arm = 0; arm < arms; arm++) for (let i = 0; i < size * 3; i++) {
        const f = 0.12 + 0.75 * Math.random(), ang = armAt(arm, f) - 0.16, r = f * R - 1.5 + gauss() * 1.2;
        q.fillStyle = `rgba(0,0,0,${0.35 * Math.random()})`; q.fillRect(m + Math.cos(ang) * r, m + Math.sin(ang) * r, 1, 1);
      }
      q.globalCompositeOperation = "source-over";
      for (let arm = 0; arm < arms; arm++) for (let i = 0; i < 9; i++) { // knots of new stars, blue-white, out along the arms
        const f = rnd(0.35, 0.9), ang = armAt(arm, f) + gauss() * 0.06, r = f * R, kx = m + Math.cos(ang) * r, ky = m + Math.sin(ang) * r;
        blob(kx, ky, rnd(2, 3.5), "170,200,255", 0.28); q.fillStyle = "rgba(220,235,255,0.6)"; q.fillRect(kx, ky, 1, 1);
      }
      blob(m, m, R * 0.38, coreCol, 0.45); blob(m, m, R * 0.16, coreCol, 0.7); // the bulge
      return g;
    };
    // one galaxy, large and still, turning slowly in its own tilted plane (the author, 2026-11-22: three small ones wandering
    // looked like smudges on the screen)
    const galaxy = { img: spiral(128, 2, "255,225,200", "150,185,255", "255,235,210"), x: 0.7, y: 0.24, tilt: -0.45, squash: 0.5, spin: 0.15 };
    const TINTS = ["255,255,255", "255,255,255", "170,200,255", "140,180,255", "255,220,160", "255,170,150", "220,170,255"];
    const tint = () => TINTS[Math.floor(rnd(0, TINTS.length))];
    const MAXR = Math.hypot(W, H) / 2 + 10;
    const star = (anywhere) => ({ a: rnd(0, Math.PI * 2), r: anywhere ? rnd(2, MAXR) : rnd(2, 30), v: rnd(0.025, 0.06), tw: rnd(0.5, 2.5), p: rnd(0, 7), tint: tint(), b: rnd(0.5, 1) });
    const stars = Array.from({ length: 170 }, () => star(true));
    const still = Array.from({ length: 90 }, () => ({ x: rnd(0, W), y: rnd(0, H), b: rnd(0.08, 0.22), tw: rnd(0.3, 1.5), p: rnd(0, 7), tint: tint() })); // (the far, unmoving ones)
    const sparkles = []; let nextSparkle = rnd(0.3, 1);
    let shoot = null, nextShoot = rnd(4, 9), sat = null, nextSat = rnd(30, 60), ufo = null, nextUfo = rnd(5, 15);
    const glint = (px, py, k, col, len) => { // a four-pointed sparkle: two thin spikes, brightest in the middle
      x.globalCompositeOperation = "lighter";
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const gr = x.createLinearGradient(px - dx * len, py - dy * len, px + dx * len, py + dy * len);
        gr.addColorStop(0, `rgba(${col},0)`); gr.addColorStop(0.5, `rgba(${col},${0.8 * k})`); gr.addColorStop(1, `rgba(${col},0)`);
        x.fillStyle = gr; x.fillRect(px - dx * len - dy * 0.5, py - dy * len - dx * 0.5, dx * len * 2 + dy, dy * len * 2 + dx);
      }
      x.fillStyle = `rgba(255,255,255,${0.9 * k})`; x.fillRect(px - 0.5, py - 0.5, 1, 1);
      x.globalCompositeOperation = "source-over";
    };
    let noUfo = false; // (while Elroids plays: no saucer, it's the way in)
    return { canvas: c,
      // the saucer's middle on the screen, while one is crossing (clicking it opens Elroids: main.js)
      saucer: () => (ufo && !noUfo && ufo.x > 4 && ufo.x < W - 4 ? { x: ufo.x, y: ufo.y - 1 } : null),
      quietSaucer(q) { noUfo = !!q; if (q) ufo = null; else nextUfo = rnd(15, 30); },
      paint(t, dt) {
      x.globalCompositeOperation = "source-over"; x.globalAlpha = 1;
      x.fillStyle = sky; x.fillRect(0, 0, W, H);
      // nebulae: two layers turning slowly against each other, each breathing in its own time
      x.globalCompositeOperation = "lighter";
      for (const [neb, spin, br, ph] of [[nebA, 0.006, 0.17, 0], [nebB, -0.0045, 0.13, 2]]) {
        x.save(); x.globalAlpha = 0.75 + 0.25 * Math.sin(t * br + ph);
        x.translate(CX, CY); x.rotate(t * spin); x.drawImage(neb, -S / 2, -S / 2); x.restore();
      }
      // the galaxy, turning
      { const sz = galaxy.img.width;
        x.save(); x.translate(W * galaxy.x, H * galaxy.y); x.rotate(galaxy.tilt); x.scale(1, galaxy.squash); x.rotate(t * galaxy.spin);
        x.drawImage(galaxy.img, -sz / 2, -sz / 2); x.restore(); }
      x.globalCompositeOperation = "source-over";
      for (const s of still) { x.fillStyle = `rgba(${s.tint},${s.b * (0.6 + 0.4 * Math.sin(t * s.tw + s.p))})`; x.fillRect(Math.floor(s.x), Math.floor(s.y), 1, 1); }
      // the stars we're drifting through: outward from the middle, faster and brighter as they near
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        s.r += s.r * s.v * dt + 0.6 * dt;
        if (s.r > MAXR) { stars[i] = star(false); continue; }
        const near = s.r / MAXR, px = CX + Math.cos(s.a) * s.r, py = CY + Math.sin(s.a) * s.r;
        const a = s.b * Math.min(1, near * 1.6) * (0.25 + 0.5 * near) * (0.7 + 0.3 * Math.sin(t * s.tw + s.p));
        x.fillStyle = `rgba(${s.tint},${a})`;
        const z = near > 0.75 ? 2 : 1; x.fillRect(Math.floor(px), Math.floor(py), z, z);
      }
      // sparkles: now and then a star flares into a four-pointed glint and fades
      if ((nextSparkle -= dt) <= 0) {
        nextSparkle = rnd(0.4, 1.4);
        const s = Math.random() < 0.5 ? stars[Math.floor(rnd(0, stars.length))] : null;
        const at = s ? { ref: s } : { x: rnd(4, W - 4), y: rnd(4, H - 4) };
        sparkles.push({ ...at, life: 0, len: rnd(0.8, 1.6), size: rnd(3, 7), col: s ? s.tint : tint() });
      }
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const sp = sparkles[i]; sp.life += dt;
        if (sp.life >= sp.len) { sparkles.splice(i, 1); continue; }
        const k = Math.sin(Math.PI * sp.life / sp.len) ** 2;
        const px = sp.ref ? CX + Math.cos(sp.ref.a) * sp.ref.r : sp.x, py = sp.ref ? CY + Math.sin(sp.ref.a) * sp.ref.r : sp.y;
        glint(Math.floor(px) + 0.5, Math.floor(py) + 0.5, k * 0.6, sp.col, sp.size * (0.6 + 0.4 * k));
      }
      // a shooting star every 6-14 s: a quick streak, fading
      if ((nextShoot -= dt) <= 0 && !shoot) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        shoot = { x: rnd(20, W - 20), y: rnd(0, H * 0.5), vx: dir * rnd(140, 200), vy: rnd(60, 110), life: 0, len: rnd(0.55, 0.8) };
      }
      if (shoot) {
        shoot.life += dt;
        const k = shoot.life / shoot.len;
        if (k >= 1) { shoot = null; nextShoot = rnd(6, 14); } else {
          const hx = shoot.x + shoot.vx * shoot.life, hy = shoot.y + shoot.vy * shoot.life, fade = Math.sin(Math.PI * k);
          const tail = x.createLinearGradient(hx, hy, hx - shoot.vx * 0.12, hy - shoot.vy * 0.12);
          tail.addColorStop(0, `rgba(255,255,240,${0.6 * fade})`); tail.addColorStop(1, "rgba(255,255,240,0)");
          x.strokeStyle = tail; x.lineWidth = 1; x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx - shoot.vx * 0.12, hy - shoot.vy * 0.12); x.stroke();
        }
      }
      // a satellite, now and then: a tiny light crossing slowly, blinking
      if ((nextSat -= dt) <= 0 && !sat) {
        const ltr = Math.random() < 0.5;
        sat = { x: ltr ? -4 : W + 4, y: rnd(20, H - 20), vx: (ltr ? 1 : -1) * rnd(6, 9), vy: rnd(-2, 2) };
      }
      if (sat) {
        sat.x += sat.vx * dt; sat.y += sat.vy * dt;
        if (sat.x < -6 || sat.x > W + 6) { sat = null; nextSat = rnd(60, 120); } else {
          x.fillStyle = "rgba(220,220,230,0.35)"; x.fillRect(Math.floor(sat.x), Math.floor(sat.y), 1, 1);
          if ((t % 1.6) < 0.12) { x.fillStyle = "rgba(255,90,90,0.7)"; x.fillRect(Math.floor(sat.x), Math.floor(sat.y), 1, 1); }
        }
      }
      // a flying saucer, every half minute or so (the author, 2026-11-22: a nod to the arcade's vector saucers): white strokes,
      // across the screen, now and then jinking off on a diagonal and back
      if ((nextUfo -= dt) <= 0 && !ufo && !noUfo) { const ltr = Math.random() < 0.5; ufo = { x: ltr ? -14 : W + 14, y: rnd(30, H - 30), vx: (ltr ? 1 : -1) * rnd(28, 38), vy: 0, turn: rnd(0.8, 1.8) }; }
      if (ufo) {
        if ((ufo.turn -= dt) <= 0) { ufo.turn = rnd(0.8, 1.8); ufo.vy = [0, 22, -22][Math.floor(rnd(0, 3))]; }
        ufo.x += ufo.vx * dt; ufo.y += ufo.vy * dt;
        if (ufo.y < 12 || ufo.y > H - 12) { ufo.vy = -ufo.vy; ufo.y = Math.max(12, Math.min(H - 12, ufo.y)); }
        if (ufo.x < -16 || ufo.x > W + 16) { ufo = null; nextUfo = rnd(15, 30); } else {
          const ux = Math.round(ufo.x) + 0.5, uy = Math.round(ufo.y) + 0.5, P = (pts) => { x.moveTo(ux + pts[0], uy + pts[1]); for (let i = 2; i < pts.length; i += 2) x.lineTo(ux + pts[i], uy + pts[i + 1]); };
          x.strokeStyle = "rgba(235,240,255,0.6)"; x.lineWidth = 1; x.lineJoin = "miter"; x.beginPath();
          P([-10, 0, -4, 4, 4, 4, 10, 0, 4, -3, -4, -3, -10, 0, 10, 0]); // hull, and the band round its middle
          P([-4, -3, -2, -6, 2, -6, 4, -3]); // dome
          x.stroke();
        }
      }
    } };
  }

  // ---------------------------------------------------------------- ocean
  // deep water: light rays swaying down from a shimmering surface, bubbles rising, specks of marine snow drifting in the
  // current, kelp swaying from the floor, a small school of fish passing now and then, and once in a long while a whale,
  // far off, a shadow gliding by
  function ocean() {
    const c = canvas(), x = c.getContext("2d");
    const water = x.createLinearGradient(0, 0, 0, H);
    water.addColorStop(0, "#0b3a4e"); water.addColorStop(0.35, "#06223a"); water.addColorStop(1, "#020a16");
    // a light ray, baked once: bright at the top, fading down, soft at the sides
    const ray = document.createElement("canvas"); ray.width = 32; ray.height = H;
    { const r = ray.getContext("2d"), v = r.createLinearGradient(0, 0, 0, H);
      v.addColorStop(0, "rgba(150,230,255,0.16)"); v.addColorStop(0.6, "rgba(120,210,255,0.05)"); v.addColorStop(1, "rgba(120,210,255,0)");
      r.fillStyle = v; r.fillRect(0, 0, 32, H);
      r.globalCompositeOperation = "destination-in";
      const s = r.createLinearGradient(0, 0, 32, 0);
      s.addColorStop(0, "rgba(0,0,0,0)"); s.addColorStop(0.5, "rgba(0,0,0,1)"); s.addColorStop(1, "rgba(0,0,0,0)");
      r.fillStyle = s; r.fillRect(0, 0, 32, H); }
    const rays = Array.from({ length: 6 }, (_, i) => ({ x: 10 + i * 38 + rnd(-8, 8), w: rnd(14, 30), sw: rnd(0.15, 0.3), p: rnd(0, 7), a: rnd(0.6, 1) }));
    // the surface's shimmer: a small strip computed pixel by pixel (caustic ripples, sums of sines)
    const SH = 28, surf = document.createElement("canvas"); surf.width = W; surf.height = SH;
    const sctx = surf.getContext("2d"), simg = sctx.createImageData(W, SH);
    const snow = Array.from({ length: 70 }, () => ({ x: rnd(0, W), y: rnd(0, H), v: rnd(1.5, 4), s: Math.random() < 0.2 ? 2 : 1, a: rnd(0.08, 0.22), p: rnd(0, 7) }));
    const bubbles = [], VENTS = [{ x: 38, every: 0.9 }, { x: 171, every: 1.4 }];
    for (const v of VENTS) v.next = rnd(0, v.every);
    const kelp = Array.from({ length: 9 }, (_, i) => ({ x: 6 + i * 26 + rnd(-6, 6), h: rnd(60, 130), p: rnd(0, 7), sp: rnd(0.4, 0.7), w: rnd(2, 3.5),
      col: Math.random() < 0.5 ? "rgba(6,34,30,0.95)" : "rgba(10,44,34,0.9)" }));
    let school = null, nextSchool = rnd(8, 15), whale = null, nextWhale = rnd(35, 60);
    return { canvas: c, paint(t, dt) {
      x.globalCompositeOperation = "source-over"; x.globalAlpha = 1;
      x.fillStyle = water; x.fillRect(0, 0, W, H);
      // a whale, far off: a shadow gliding slowly across the middle depths, every couple of minutes
      if ((nextWhale -= dt) <= 0 && !whale) { const ltr = Math.random() < 0.5; whale = { x: ltr ? -110 : W + 110, y: rnd(110, 180), dir: ltr ? 1 : -1 }; }
      if (whale) {
        whale.x += whale.dir * 7 * dt;
        if (whale.x < -120 || whale.x > W + 120) { whale = null; nextWhale = rnd(90, 150); } else {
          const wy = whale.y + Math.sin(t * 0.3) * 3, tail = Math.sin(t * 1.1) * 6;
          x.save(); x.translate(whale.x, wy); x.scale(whale.dir, 1);
          x.fillStyle = "rgba(1,10,20,0.55)"; x.beginPath();
          x.moveTo(45, 0); x.quadraticCurveTo(40, -14, 5, -15); x.quadraticCurveTo(-30, -14, -55, -3); // head and back
          x.lineTo(-75, -10 + tail); x.lineTo(-70, 0 + tail * 0.3); x.lineTo(-76, 9 + tail); x.lineTo(-55, 3); // tail flukes
          x.quadraticCurveTo(-20, 12, 10, 11); x.quadraticCurveTo(35, 10, 45, 0); x.fill(); // belly
          x.beginPath(); x.moveTo(5, 8); x.quadraticCurveTo(-5, 22, -14, 24); x.quadraticCurveTo(-6, 14, -6, 9); x.fill(); // flipper
          x.restore();
        }
      }
      // light rays swaying down from the surface
      x.globalCompositeOperation = "lighter";
      for (const r of rays) {
        const sway = Math.sin(t * r.sw + r.p) * 10, a = r.a * (0.6 + 0.4 * Math.sin(t * r.sw * 1.7 + r.p * 2));
        x.save(); x.globalAlpha = a; x.translate(r.x + sway, 0); x.transform(1, 0, -0.25 + Math.sin(t * r.sw * 0.7 + r.p) * 0.06, 1, 0, 0);
        x.drawImage(ray, -r.w / 2, 0, r.w, H); x.restore();
      }
      // the surface shimmering
      const d = simg.data;
      for (let j = 0; j < SH; j++) {
        const fall = Math.pow(1 - j / SH, 2);
        for (let i = 0; i < W; i++) {
          const v = Math.sin(i * 0.11 + t * 1.3 + Math.sin(j * 0.3 + t * 0.7) * 2) + Math.sin(i * 0.07 - t * 0.9 + j * 0.2) + Math.sin((i + j * 2) * 0.05 + t * 0.5);
          const k = Math.max(0, v - 1.2) * fall * 70, o = (j * W + i) * 4;
          d[o] = 120; d[o + 1] = 220; d[o + 2] = 255; d[o + 3] = Math.min(255, k);
        }
      }
      sctx.putImageData(simg, 0, 0); x.drawImage(surf, 0, 0);
      x.globalCompositeOperation = "source-over";
      // marine snow, drifting down in the current
      for (const s of snow) {
        s.y += s.v * dt; s.x += (2 + Math.sin(t * 0.4 + s.p) * 3) * dt;
        if (s.y > H) { s.y = -2; s.x = rnd(0, W); } if (s.x > W) s.x -= W;
        x.fillStyle = `rgba(190,220,230,${s.a})`; x.fillRect(Math.floor(s.x), Math.floor(s.y), s.s, s.s);
      }
      // kelp swaying from the floor, a little more at the tips
      x.lineCap = "round";
      for (const k of kelp) {
        x.strokeStyle = k.col; let px = k.x, py = H + 2;
        for (let s = 1; s <= 12; s++) {
          const f = s / 12, nx = k.x + Math.sin(t * k.sp + k.p + f * 2) * 10 * f * f, ny = H + 2 - k.h * f;
          x.lineWidth = k.w * (1 - f * 0.6); x.beginPath(); x.moveTo(px, py); x.lineTo(nx, ny); x.stroke();
          px = nx; py = ny;
        }
      }
      // bubbles: streams from two vents in the kelp, and the odd stray one
      for (const v of VENTS) if ((v.next -= dt) <= 0) { v.next = v.every * rnd(0.4, 1.6); bubbles.push({ x: v.x + rnd(-2, 2), y: H - 4, r: rnd(0.8, 2), v: rnd(14, 22), p: rnd(0, 7) }); }
      if (Math.random() < dt * 0.4) bubbles.push({ x: rnd(0, W), y: H - 2, r: rnd(0.6, 1.4), v: rnd(10, 16), p: rnd(0, 7) });
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]; b.y -= b.v * dt; b.r += dt * 0.08;
        if (b.y < SH * 0.4) { bubbles.splice(i, 1); continue; }
        const bx = b.x + Math.sin(t * 3 + b.p) * 1.5;
        x.strokeStyle = "rgba(170,230,255,0.32)"; x.lineWidth = 0.8; x.beginPath(); x.arc(bx, b.y, b.r, 0, Math.PI * 2); x.stroke();
        x.fillStyle = "rgba(230,250,255,0.4)"; x.fillRect(Math.floor(bx - b.r * 0.4), Math.floor(b.y - b.r * 0.5), 1, 1);
      }
      // a small school of fish, now and then, swimming across together
      if ((nextSchool -= dt) <= 0 && !school) {
        const ltr = Math.random() < 0.5, y = rnd(60, H - 90);
        school = { x: ltr ? -30 : W + 30, dir: ltr ? 1 : -1, v: rnd(16, 24), fish: Array.from({ length: Math.floor(rnd(5, 10)) }, () => ({ dx: rnd(-22, 22), dy: rnd(-12, 12) + y, p: rnd(0, 7) })) };
      }
      if (school) {
        school.x += school.dir * school.v * dt;
        if (school.x < -60 || school.x > W + 60) { school = null; nextSchool = rnd(14, 28); } else {
          x.fillStyle = "rgba(120,170,190,0.33)";
          for (const f of school.fish) {
            const fx = Math.floor(school.x + f.dx), fy = Math.floor(f.dy + Math.sin(t * 2 + f.p) * 2), tl = school.dir > 0 ? -1 : 1;
            x.fillRect(fx - 2, fy, 5, 2); x.fillRect(fx - 1, fy - 1, 3, 1); // body
            x.fillRect(fx + tl * 3, fy - (Math.sin(t * 9 + f.p) > 0 ? 1 : 0), 1, 3); // tail, flicking
          }
        }
      }
    } };
  }

  const MAKERS = { space, ocean };
  root.BoozeLiving = { NAMES: Object.keys(MAKERS), create: (name) => MAKERS[name]() };
})(typeof self !== "undefined" ? self : this);
