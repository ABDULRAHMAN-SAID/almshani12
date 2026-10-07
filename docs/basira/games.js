/* ألعاب مبادرة البصيرة — لعبة مختلفة لكل وحدة (three.js r149) */
(function () {
  "use strict";
  const AR = "٠١٢٣٤٥٦٧٨٩", ar = n => String(n).replace(/\d/g, d => AR[d]);
  const PRAISE = ["أحسنتِ! 🌟", "رائع يا بطلة ✨", "إجابة موفّقة 👏", "ممتاز! 💫", "بصيرة نافذة 🌿", "تألّقتِ! 🎉"];
  const RETRY = ["قريبة! جرّبي مرة أخرى 🌱", "فكّري قليلًا وحاولي ثانية 💭", "لا بأس، المحاولة طريق التعلّم 🤍", "خذي نفسًا وجرّبي من جديد 🌸"];
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
  const backOut = t => { t = Math.min(1, Math.max(0, t)); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const FONT = '"Tajawal","Segoe UI",Tahoma,sans-serif';

  const META = {
    board: { name: "إلى السبورة", how: "حرّكي الطالبة إلى السبورة التي عليها الإجابة الصحيحة: المسي السبورة، أو استعملي الأسهم ثم «اذهبي»." },
    dive: { name: "لؤلؤة الخليج", how: "اختاري المحارة التي تحمل الإجابة الصحيحة، فتغوص الغوّاصة إليها وتخرج اللؤلؤة." },
    route: { name: "رحلة الرحّالة", how: "عند كل مفترق طرق لافتتان. اختاري طريق الإجابة الصحيحة لتواصل القافلة رحلتها في عُمان." },
    roots: { name: "جذور المعجم", how: "المسي حروف الجذر الثلاثة بالترتيب، فتستقر في صفحات المعجم ويظهر لك باب الكلمة." },
    memory: { name: "معرض الفن", how: "اقلبي بطاقتين في كل مرة، وابحثي عن كل بطاقة وما يقابلها حتى يكتمل المعرض." },
    sort: { name: "صندوق الرسائل", how: "تنزل الرسالة ببطء. المسي الصندوق المناسب لها قبل أن تصل إلى الأرض." },
    conveyor: { name: "مصنع الكلمات", how: "تمرّ الصناديق على الحزام. المسي الصناديق الصحيحة فقط لتُشحن، واتركي الخاطئة تمرّ." },
    tower: { name: "برج البيان", how: "كل إجابة صحيحة تضيف طابقًا إلى البرج. ابني برجك حتى القمة!" },
    shop: { name: "المتجر الإلكتروني", how: "اختاري المنتج الذي يحمل الإجابة الصحيحة ليدخل سلة المشتريات." }
  };

  /* ---------------- shared stage ---------------- */
  function makeStage(host, opt) {
    const T = THREE;
    if (T.ColorManagement) T.ColorManagement.legacyMode = false;
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.className = "g3d";
    host.appendChild(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(opt.fov || 45, 1, 0.1, 200);
    const hemi = new T.HemisphereLight(opt.sky || 0xEAF6FF, opt.ground || 0x9B7B5B, 0.65);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xFFF2DE, 1.6);
    sun.position.set(6, 12, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 40 });
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    const ticks = []; let alive = true, last = performance.now();
    const ray = new T.Raycaster(), mouse = new T.Vector2();
    const picks = [];
    let onPick = null;
    function size() {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      opt.onResize && opt.onResize(w / h);
    }
    const ro = new ResizeObserver(() => size()); ro.observe(host); let sized = false;
    function loop(t) {
      if (!alive) return;
      requestAnimationFrame(loop);
      if (!sized) { sized = true; size(); }
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      for (let i = ticks.length - 1; i >= 0; i--) { if (ticks[i](dt, t / 1000) === false) ticks.splice(i, 1); }
      renderer.render(scene, camera);
    }
    requestAnimationFrame(loop);
    function pointer(e) {
      if (!onPick) return;
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(picks, true)[0];
      if (!hit) return;
      let o = hit.object; while (o && o.userData.pick === undefined) o = o.parent;
      if (o) onPick(o.userData.pick, o);
    }
    renderer.domElement.addEventListener("pointerdown", pointer);
    return {
      T, scene, camera, renderer, sun, hemi,
      tick(fn) { ticks.push(fn); },
      pickable(o, id) { o.userData.pick = id; picks.push(o); },
      clearPicks() { picks.length = 0; },
      onPick(fn) { onPick = fn; host.__pick = id => fn(id); },
      dispose() { alive = false; ro.disconnect(); renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); renderer.domElement.remove(); }
    };
  }

  /* ---------------- helpers ---------------- */
  function textCanvas(text, o) {
    o = Object.assign({ w: 512, h: 256, size: 64, color: "#16323A", bg: null, radius: 40, weight: 800, pad: 26, stroke: null }, o || {});
    const c = document.createElement("canvas"); c.width = o.w; c.height = o.h;
    const x = c.getContext("2d");
    if (o.bg) {
      x.fillStyle = o.bg; const r = o.radius;
      x.beginPath(); x.moveTo(r, 0); x.arcTo(o.w, 0, o.w, o.h, r); x.arcTo(o.w, o.h, 0, o.h, r); x.arcTo(0, o.h, 0, 0, r); x.arcTo(0, 0, o.w, 0, r); x.closePath(); x.fill();
      if (o.border) { x.lineWidth = 10; x.strokeStyle = o.border; x.stroke(); }
    }
    x.direction = "rtl"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = o.color;
    // wrap words to fit
    let size = o.size; const maxW = o.w - o.pad * 2;
    let lines;
    for (; size > 18; size -= 4) {
      x.font = `${o.weight} ${size}px ${FONT}`;
      lines = []; let line = "";
      for (const w of String(text).split(/\s+/)) {
        const t = line ? line + " " + w : w;
        if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
      }
      if (line) lines.push(line);
      if (lines.length * size * 1.25 <= o.h - o.pad * 2 && lines.every(l => x.measureText(l).width <= maxW)) break;
    }
    const lh = size * 1.25, y0 = o.h / 2 - (lines.length - 1) * lh / 2;
    lines.forEach((l, i) => {
      if (o.stroke) { x.lineWidth = 10; x.strokeStyle = o.stroke; x.lineJoin = "round"; x.strokeText(l, o.w / 2, y0 + i * lh); }
      x.fillText(l, o.w / 2, y0 + i * lh);
    });
    return c;
  }
  function tex(T, canvas) { const t = new T.CanvasTexture(canvas); t.encoding = T.sRGBEncoding; t.anisotropy = 4; return t; }
  function label(T, text, w, h, o) {
    const cv = textCanvas(text, Object.assign({ w: 512, h: Math.round(512 * h / w) }, o));
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex(T, cv), transparent: true, toneMapped: false, depthWrite: false }));
    m.userData.redraw = (txt, o2) => { const c2 = textCanvas(txt, Object.assign({ w: 512, h: Math.round(512 * h / w) }, o, o2)); m.material.map.dispose(); m.material.map = tex(T, c2); };
    return m;
  }
  function rbox(T, w, h, d, r, mat) {
    r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001);
    const s = new T.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const bev = Math.min(r * 0.6, d / 2 - 0.001);
    const g = new T.ExtrudeGeometry(s, { depth: Math.max(0.001, d - bev * 2), bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.9, bevelSegments: 4, curveSegments: 10 });
    g.translate(0, 0, -(d - bev * 2) / 2);
    const m = new T.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
  }
  const std = (T, c, o) => new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.55, metalness: 0.02 }, o || {}));

  /* the student: white hijab, white sleeves, navy pinafore (school uniform) */
  function makeGirl(T) {
    const g = new T.Group();
    const navy = std(T, 0x23306A, { roughness: 0.75 }), white = std(T, 0xF8FAFC, { roughness: 0.7 }), skin = std(T, 0xF2C6A2, { roughness: 0.6 }), shoe = std(T, 0xFFFFFF, { roughness: 0.4 });
    const dressPts = [[0.001, 0], [0.62, 0.02], [0.58, 0.25], [0.46, 0.75], [0.36, 1.12], [0.33, 1.2], [0.001, 1.22]].map(p => new T.Vector2(p[0], p[1]));
    const dress = new T.Mesh(new T.LatheGeometry(dressPts, 40), navy); dress.position.y = 0.16; dress.castShadow = true; g.add(dress);
    const torso = new T.Mesh(new T.CapsuleGeometry(0.31, 0.38, 8, 24), white); torso.position.y = 1.52; torso.scale.set(1, 1, 0.78); torso.castShadow = true; g.add(torso);
    const bib = new T.Mesh(new T.CylinderGeometry(0.335, 0.34, 0.42, 32, 1, true, -Math.PI * 0.42, Math.PI * 0.84), navy); bib.position.y = 1.43; bib.scale.set(1, 1, 0.8); bib.rotation.y = Math.PI; g.add(bib);
    const armL = new T.Group(), armR = new T.Group();
    [armL, armR].forEach((a, i) => {
      const s = i ? -1 : 1;
      const arm = new T.Mesh(new T.CapsuleGeometry(0.1, 0.5, 6, 16), white); arm.position.y = -0.3; arm.castShadow = true; a.add(arm);
      const hand = new T.Mesh(new T.SphereGeometry(0.09, 16, 12), skin); hand.position.y = -0.62; a.add(hand);
      a.position.set(0.38 * s, 1.78, 0); a.rotation.z = 0.12 * s; g.add(a);
    });
    const head = new T.Group(); head.position.y = 2.22; g.add(head);
    const face = new T.Mesh(new T.SphereGeometry(0.3, 32, 24), skin); face.scale.set(0.92, 1.05, 0.9); head.add(face);
    const hij = new T.Mesh(new T.SphereGeometry(0.36, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.62), white); hij.position.set(0, 0.03, -0.04); hij.castShadow = true; head.add(hij);
    const hijBack = new T.Mesh(new T.SphereGeometry(0.37, 32, 24), white); hijBack.position.set(0, 0, -0.08); hijBack.scale.set(1, 1.05, 0.9); head.add(hijBack);
    const capePts = [[0.001, 0.52], [0.22, 0.5], [0.34, 0.36], [0.5, 0.06], [0.52, 0], [0.001, 0]].map(p => new T.Vector2(p[0], p[1]));
    const cape = new T.Mesh(new T.LatheGeometry(capePts, 40), white); cape.position.y = 1.6; cape.castShadow = true; g.add(cape);
    const eyeM = std(T, 0x2B1A12, { roughness: 0.3 });
    [-1, 1].forEach(s => { const e = new T.Mesh(new T.SphereGeometry(0.042, 16, 12), eyeM); e.position.set(0.1 * s, 0.03, 0.255); head.add(e);
      const hl = new T.Mesh(new T.SphereGeometry(0.013, 8, 6), std(T, 0xffffff)); hl.position.set(0.1 * s + 0.012, 0.045, 0.29); head.add(hl);
      const ck = new T.Mesh(new T.SphereGeometry(0.05, 12, 8), std(T, 0xF39A9A, { transparent: true, opacity: 0.55 })); ck.position.set(0.16 * s, -0.07, 0.22); ck.scale.z = 0.4; head.add(ck); });
    const smile = new T.Mesh(new T.TorusGeometry(0.07, 0.014, 8, 20, Math.PI), std(T, 0xB04A55)); smile.position.set(0, -0.1, 0.262); smile.rotation.z = Math.PI; head.add(smile);
    [-1, 1].forEach(s => { const sh = new T.Mesh(new T.SphereGeometry(0.13, 20, 14), shoe); sh.scale.set(0.9, 0.55, 1.4); sh.position.set(0.16 * s, 0.07, 0.1); sh.castShadow = true; g.add(sh); });
    g.userData = { armL, armR, head, walk: 0 };
    g.userData.animate = (dt, moving) => {
      const u = g.userData; u.walk += dt * (moving ? 9 : 2);
      const sw = moving ? Math.sin(u.walk) * 0.55 : Math.sin(u.walk) * 0.04;
      armL.rotation.x = sw; armR.rotation.x = -sw;
      dress.position.y = 0.16 + (moving ? Math.abs(Math.sin(u.walk)) * 0.05 : 0);
      head.rotation.z = Math.sin(u.walk * 0.5) * 0.03;
    };
    g.userData.cheer = () => { g.userData.cheerT = 1; };
    return g;
  }

  function sparkSystem(stage) {
    const T = stage.T;
    const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d");
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,235,170,.85)"); gr.addColorStop(1, "rgba(255,210,120,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const map = new T.CanvasTexture(c); const list = [];
    stage.tick(dt => { for (let i = list.length - 1; i >= 0; i--) { const s = list[i]; s.userData.l -= dt * 1.1; s.userData.v.y -= dt * 4; s.position.addScaledVector(s.userData.v, dt); s.material.opacity = Math.max(0, s.userData.l); if (s.userData.l <= 0) { stage.scene.remove(s); s.material.dispose(); list.splice(i, 1); } } });
    const cols = [0xFFE7A8, 0xFFB45C, 0x7FE0D4, 0xF7A8C4];
    return (pos, n, spread) => { for (let i = 0; i < (n || 18); i++) { const s = new T.Sprite(new T.SpriteMaterial({ map, color: cols[i % 4], transparent: true, depthWrite: false, blending: T.AdditiveBlending })); s.scale.setScalar(0.35 + Math.random() * 0.25); s.position.copy(pos); const sp = spread || 3; s.userData = { v: new T.Vector3((Math.random() - 0.5) * sp, Math.random() * sp + 1.5, (Math.random() - 0.5) * sp), l: 1 }; stage.scene.add(s); list.push(s); } };
  }
  function tween(stage, dur, fn, done) { let t = 0; stage.tick(dt => { t += dt; const k = Math.min(1, t / dur); fn(k); if (k >= 1) { done && done(); return false; } }); }
  function shake(stage, obj, amt) { const base = obj.position.x; tween(stage, 0.45, k => { obj.position.x = base + Math.sin(k * 30) * (1 - k) * (amt || 0.15); }, () => obj.position.x = base); }
  function skyBg(T, top, mid, bot) {
    const c = document.createElement("canvas"); c.width = 4; c.height = 256; const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, top); g.addColorStop(0.55, mid); g.addColorStop(1, bot); x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
  }

  /* ---------------- shell (DOM HUD) ---------------- */
  function shell(host, unit, kind) {
    host.innerHTML = `<div class="gwrap"><div class="g-hud"><span class="g-pill" data-s>⭐ ٠</span><span class="g-pill g-title">${esc(META[kind].name)}</span><span class="g-pill" data-p></span></div>
      <div class="g-qbox" hidden><div class="g-q" data-q></div><div class="g-fb" data-fb aria-live="polite"></div></div>
      <div class="g-ctrl" hidden></div>
      <div class="g-over" data-over><div class="g-card"><div class="g-badge">${esc(unit.title)} · ${esc(unit.theme)}</div><h3>${esc(META[kind].name)}</h3><p>${esc(META[kind].how)}</p><button class="g-btn" data-go>ابدئي اللعب</button></div></div></div>`;
    const W = host.querySelector(".gwrap");
    return {
      W, stageHost: W,
      score(n) { W.querySelector("[data-s]").textContent = "⭐ " + ar(n); },
      prog(i, n) { W.querySelector("[data-p]").textContent = ar(i) + " / " + ar(n); },
      q(text) { const b = W.querySelector(".g-qbox"); b.hidden = !text; W.querySelector("[data-q]").textContent = text || ""; W.querySelector("[data-fb]").textContent = ""; W.querySelector("[data-fb]").className = "g-fb"; },
      fb(text, ok) { const f = W.querySelector("[data-fb]"); f.textContent = text; f.className = "g-fb " + (ok ? "ok" : "soft"); },
      ctrl(html) { const c = W.querySelector(".g-ctrl"); c.hidden = !html; c.innerHTML = html || ""; return c; },
      start(fn) { W.querySelector("[data-go]").onclick = () => { W.querySelector("[data-over]").hidden = true; fn(); }; },
      end(score, total, again) {
        const o = W.querySelector("[data-over]"); o.hidden = false;
        const r = score / total, msg = r >= 0.9 ? "أداء مذهل! 🏆" : r >= 0.6 ? "أحسنتِ، عمل جميل 🌟" : "بداية طيبة، العبي مرة أخرى 🌱";
        const stars = r >= 0.9 ? 3 : r >= 0.6 ? 2 : r > 0 ? 1 : 0;
        o.innerHTML = `<div class="g-card"><div class="g-stars">${[0, 1, 2].map(i => `<span class="${i < stars ? "on" : ""}">★</span>`).join("")}</div><h3>${msg}</h3><p>جمعتِ ${ar(score)} من ${ar(total)} من المحاولة الأولى.</p><button class="g-btn" data-again>العبي مرة أخرى</button></div>`;
        o.querySelector("[data-again]").onclick = again;
      }
    };
  }

  /* ---------------- MCQ engine shared by board/dive/route/tower/shop ---------------- */
  function mcqRun(ui, items, n, show, onDone) {
    const qs = shuffle(items).slice(0, Math.min(n, items.length));
    let i = 0, score = 0, tries = 0, lock = false;
    const api = {
      next() {
        if (i >= qs.length) { onDone(score, qs.length); return; }
        const q = qs[i]; tries = 0; lock = false;
        ui.prog(i + 1, qs.length); ui.q(q.q);
        const opts = shuffle(q.opts.map((t, k) => ({ t, ok: k === q.a })));
        show(opts, i);
      },
      answer(opt, done) {
        if (lock) return false;
        if (opt.ok) { lock = true; if (tries === 0) score++; ui.score(score); ui.fb(pick(PRAISE), true); setTimeout(() => { i++; done ? done(api.next) : api.next(); }, 1300); return true; }
        tries++; ui.fb(pick(RETRY), false); return false;
      },
      get locked() { return lock; }
    };
    return api;
  }

  /* ===== 1. board: walk the student to the right blackboard ===== */
  function gBoard(host, unit, done) {
    const ui = shell(host, unit, "board");
    const st = makeStage(ui.stageHost, { fov: 48, onResize: a => { st && (st.camera.position.z = a < 1 ? 15 : 11); } });
    const T = st.T, S = st.scene;
    S.background = new T.Color(0xEFF6F4); S.fog = new T.Fog(0xEFF6F4, 20, 40);
    st.camera.position.set(0, 6.5, 11); st.camera.lookAt(0, 2.2, -2);
    const floor = new T.Mesh(new T.PlaneGeometry(40, 30), std(T, 0xD9B48A, { roughness: 0.8 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
    for (let i = -8; i <= 8; i++) { const l = new T.Mesh(new T.PlaneGeometry(0.03, 30), std(T, 0xC79E74)); l.rotation.x = -Math.PI / 2; l.position.set(i * 1.2, 0.002, 0); S.add(l); }
    const wall = new T.Mesh(new T.PlaneGeometry(40, 14), std(T, 0xE6F1EF)); wall.position.set(0, 7, -6); wall.receiveShadow = true; S.add(wall);
    const trim = rbox(T, 40, 0.5, 0.2, 0.1, std(T, 0x0A6E79)); trim.position.set(0, 0.25, -5.9); S.add(trim);
    const boards = [];
    [-4.6, 0, 4.6].forEach((x, k) => {
      const g = new T.Group(); g.position.set(x, 3.5, -5.75);
      const frame = rbox(T, 4, 2.6, 0.25, 0.18, std(T, 0xB98A55)); g.add(frame);
      const slate = rbox(T, 3.6, 2.2, 0.1, 0.1, std(T, 0x245A4A, { roughness: 0.9 })); slate.position.z = 0.1; g.add(slate);
      const lb = label(T, "", 3.4, 2, { color: "#FFFFFF", size: 84, weight: 700 }); lb.position.z = 0.17; g.add(lb);
      const tray = rbox(T, 3.4, 0.12, 0.3, 0.05, std(T, 0xB98A55)); tray.position.set(0, -1.32, 0.2); g.add(tray);
      const chalk = new T.Mesh(new T.CapsuleGeometry(0.04, 0.2, 4, 8), std(T, 0xffffff)); chalk.rotation.z = Math.PI / 2; chalk.position.set(-1, -1.22, 0.25); g.add(chalk);
      S.add(g); g.userData.lb = lb; g.userData.slate = slate; boards.push(g); st.pickable(g, k);
    });
    // desks
    const deskM = std(T, 0xF4F0E8), legM = std(T, 0x6C7A80);
    [[-5, 2], [5, 2], [-5, 5.2], [5, 5.2]].forEach(([x, z]) => { const d = rbox(T, 2.4, 0.16, 1.3, 0.08, deskM); d.position.set(x, 1.3, z); S.add(d);
      [[-1, -0.5], [1, -0.5], [-1, 0.5], [1, 0.5]].forEach(([a, b]) => { const l = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 1.3, 8), legM); l.position.set(x + a, 0.65, z + b); S.add(l); });
      const bk = rbox(T, 0.7, 0.12, 0.5, 0.04, std(T, [0xEC7F16, 0x0A6E79, 0xE0688A][Math.floor(Math.random() * 3)])); bk.position.set(x + 0.4, 1.45, z); bk.rotation.y = 0.3; S.add(bk); });
    const plant = new T.Group(); const pot = new T.Mesh(new T.CylinderGeometry(0.45, 0.35, 0.8, 24), std(T, 0xEC7F16)); pot.position.y = 0.4; plant.add(pot);
    [0, 1, 2, 3, 4].forEach(i => { const lf = new T.Mesh(new T.SphereGeometry(0.4, 16, 12), std(T, 0x3BAA82)); lf.position.set(Math.cos(i * 1.3) * 0.3, 1.1 + i * 0.12, Math.sin(i * 1.3) * 0.3); lf.scale.set(0.7, 1.2, 0.7); plant.add(lf); });
    plant.position.set(-8.5, 0, -4.5); S.add(plant);
    const girl = makeGirl(T); girl.position.set(0, 0, 3.5); girl.rotation.y = Math.PI; S.add(girl);
    const ring = new T.Mesh(new T.RingGeometry(0.55, 0.7, 40), new T.MeshBasicMaterial({ color: 0xEC7F16, transparent: true, opacity: 0.85 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; S.add(ring);
    const spark = sparkSystem(st);
    let opts = [], sel = 1, target = null, run;
    const home = new T.Vector3(0, 0, 3.5);
    function setSel(k) { sel = (k + 3) % 3; ring.position.x = boards[sel].position.x; ring.position.z = -3.6; }
    function go(k) {
      if (!run || run.locked || target) return; setSel(k);
      target = new T.Vector3(boards[k].position.x, 0, -3.9); target.k = k;
    }
    st.onPick(k => go(k));
    st.tick((dt, t) => {
      let moving = false;
      if (target) {
        const d = target.clone().sub(girl.position); d.y = 0; const dist = d.length();
        if (dist > 0.05) { moving = true; d.normalize(); girl.position.addScaledVector(d, Math.min(dist, dt * 4.2)); girl.rotation.y = Math.atan2(d.x, d.z); }
        else if (target.k !== undefined) {
          const k = target.k; target = null; girl.rotation.y = Math.PI;
          const ok = run.answer(opts[k], next => { target = home.clone(); target.after = next; });
          if (ok) { boards[k].userData.slate.material.color.set(0x1E9D63); spark(new T.Vector3(boards[k].position.x, 4, -5)); }
          else { boards[k].userData.slate.material.color.set(0xC9741A); shake(st, boards[k], 0.12); setTimeout(() => { boards[k].userData.slate.material.color.set(0x245A4A); target = home.clone(); }, 700); }
        } else { const a = target.after; target = null; girl.rotation.y = Math.PI; a && a(); }
      }
      girl.userData.animate(dt, moving);
      ring.material.opacity = 0.6 + Math.sin(t * 5) * 0.3;
    });
    const c = ui.ctrl(`<button class="g-key" data-k="r" aria-label="يمين">▶</button><button class="g-key go" data-k="g">اذهبي</button><button class="g-key" data-k="l" aria-label="يسار">◀</button>`);
    c.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { const k = b.dataset.k; if (k === "g") go(sel); else setSel(sel + (k === "l" ? -1 : 1)); });
    const key = e => { if (!run) return; if (e.key === "ArrowLeft") setSel(sel - 1); else if (e.key === "ArrowRight") setSel(sel + 1); else if (e.key === "Enter" || e.key === " " || e.key === "ArrowUp") { e.preventDefault(); go(sel); } else if ("123".includes(e.key)) go(+e.key - 1); };
    window.addEventListener("keydown", key);
    function start() {
      ui.score(0); c.hidden = false;
      run = mcqRun(ui, unit.game.q, 10, o => { opts = o; boards.forEach((b, k) => { b.userData.lb.userData.redraw(o[k].t); b.userData.slate.material.color.set(0x245A4A); }); setSel(1); girl.position.copy(home); }, (s, n) => { done(s, n); ui.end(s, n, start); });
      run.next();
    }
    ui.start(start);
    return { destroy() { window.removeEventListener("keydown", key); st.dispose(); } };
  }

  /* ===== 2. dive: pick the oyster with the pearl ===== */
  function gDive(host, unit, done) {
    const ui = shell(host, unit, "dive");
    const st = makeStage(ui.stageHost, { fov: 50, sky: 0xBFF3FF, ground: 0x0E5A6B, onResize: a => { st && (st.camera.position.z = a < 1 ? 16 : 11.5); } });
    const T = st.T, S = st.scene;
    S.background = skyBg(T, "#7FD3E0", "#2C9AB2", "#0B4C66"); S.fog = new T.FogExp2(0x1E7F98, 0.035);
    st.camera.position.set(0, 4.5, 11.5); st.camera.lookAt(0, 1.6, 0);
    const sand = new T.Mesh(new T.PlaneGeometry(60, 40, 60, 40), std(T, 0xE9D2A2, { roughness: 1 })); sand.rotation.x = -Math.PI / 2;
    const p = sand.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 0.5) * 0.15 + Math.cos(p.getY(i) * 0.7) * 0.12); sand.geometry.computeVertexNormals(); sand.receiveShadow = true; S.add(sand);
    // seaweed
    const weeds = [];
    for (let i = 0; i < 14; i++) { const pts = []; for (let k = 0; k < 6; k++) pts.push(new T.Vector3(Math.sin(k) * 0.15, k * 0.5, 0)); const tube = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 20, 0.07, 8), std(T, i % 2 ? 0x2E9E6E : 0x46B98A)); const x = (Math.random() - 0.5) * 22, z = -2 - Math.random() * 8; tube.position.set(x, 0, z); S.add(tube); weeds.push(tube); }
    const rockM = std(T, 0x6E8C94, { roughness: 0.9 });
    for (let i = 0; i < 8; i++) { const r = new T.Mesh(new T.SphereGeometry(0.4 + Math.random() * 0.6, 24, 16), rockM); r.scale.y = 0.6; r.position.set((Math.random() - 0.5) * 20, 0.1, -3 - Math.random() * 6); r.castShadow = true; S.add(r); }
    // oysters
    const shellM = std(T, 0xB98F6E, { roughness: 0.5 }), inner = std(T, 0xF6E9F0, { roughness: 0.25, metalness: 0.1 });
    const oys = [];
    [-4.2, 0, 4.2].forEach((x, k) => {
      const g = new T.Group(); g.position.set(x, 0.3, 0.5); g.scale.setScalar(1.3);
      const bot = new T.Mesh(new T.SphereGeometry(0.9, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), shellM); bot.scale.set(1, 0.45, 0.85); bot.castShadow = true; g.add(bot);
      const inn = new T.Mesh(new T.CircleGeometry(0.85, 32), inner); inn.rotation.x = -Math.PI / 2; inn.scale.set(1, 0.85, 1); inn.position.y = 0.01; g.add(inn);
      const lid = new T.Group(); lid.position.set(0, 0.02, -0.75); g.add(lid);
      const top = new T.Mesh(new T.SphereGeometry(0.9, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), shellM); top.scale.set(1, 0.42, 0.85); top.position.z = 0.75; lid.add(top);
      const pearl = new T.Mesh(new T.SphereGeometry(0.28, 32, 24), new T.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.12, metalness: 0.25, emissive: 0x88AACC, emissiveIntensity: 0.25 })); pearl.position.y = 0.25; pearl.visible = false; g.add(pearl);
      const lb = label(T, "", 3.6, 1.3, { bg: "rgba(255,255,255,.93)", color: "#0B4C66", size: 78, radius: 60 }); lb.position.set(0, 1.55, 0); lb.scale.setScalar(1 / 1.3); g.add(lb);
      g.userData = { lid, pearl, lb }; S.add(g); oys.push(g); st.pickable(g, k);
    });
    // submarine
    const sub = new T.Group(); const hull = new T.Mesh(new T.CapsuleGeometry(0.55, 1.2, 10, 24), std(T, 0xF2B233, { roughness: 0.35 })); hull.rotation.z = Math.PI / 2; hull.castShadow = true; sub.add(hull);
    const tower = rbox(T, 0.6, 0.5, 0.5, 0.18, std(T, 0xEC7F16)); tower.position.y = 0.6; sub.add(tower);
    [-0.45, 0.1].forEach(x => { const w = new T.Mesh(new T.TorusGeometry(0.17, 0.05, 10, 24), std(T, 0x8A5A10)); w.position.set(x, 0.05, 0.5); sub.add(w); const gl = new T.Mesh(new T.CircleGeometry(0.15, 24), std(T, 0x9FE6F2, { emissive: 0x2E8FA3, emissiveIntensity: 0.5 })); gl.position.set(x, 0.05, 0.52); sub.add(gl); });
    const prop = new T.Mesh(new T.TorusGeometry(0.2, 0.06, 8, 16), std(T, 0x0A6E79)); prop.rotation.y = Math.PI / 2; prop.position.x = 1.25; sub.add(prop);
    const home = new T.Vector3(0, 4.3, -1.5); sub.position.copy(home); S.add(sub);
    const bubbles = []; const bm = new T.MeshStandardMaterial({ color: 0xE6FBFF, transparent: true, opacity: 0.5, roughness: 0.1 });
    for (let i = 0; i < 30; i++) { const b = new T.Mesh(new T.SphereGeometry(0.06 + Math.random() * 0.08, 12, 8), bm); b.position.set((Math.random() - 0.5) * 20, Math.random() * 9, -1 - Math.random() * 6); b.userData.v = 0.4 + Math.random() * 0.6; S.add(b); bubbles.push(b); }
    const spark = sparkSystem(st);
    let opts = [], run, busy = false;
    function goTo(k) {
      if (!run || run.locked || busy) return; busy = true;
      const o = oys[k], from = sub.position.clone(), to = new T.Vector3(o.position.x, 1.9, o.position.z);
      tween(st, 1.1, e => sub.position.lerpVectors(from, to, ease(e)), () => {
        tween(st, 0.5, e => o.userData.lid.rotation.x = -1.1 * ease(e));
        const ok = run.answer(opts[k], next => { o.userData.pearl.visible = false; tween(st, 0.4, e => o.userData.lid.rotation.x = -1.1 * (1 - e)); const f2 = sub.position.clone(); tween(st, 0.9, e => sub.position.lerpVectors(f2, home, ease(e)), () => { busy = false; next(); }); });
        if (ok) { o.userData.pearl.visible = true; spark(new T.Vector3(o.position.x, 1, o.position.z), 22); }
        else { setTimeout(() => { tween(st, 0.4, e => o.userData.lid.rotation.x = -1.1 * (1 - e)); const f2 = sub.position.clone(); tween(st, 0.8, e => sub.position.lerpVectors(f2, home, ease(e)), () => busy = false); }, 650); }
      });
    }
    st.onPick(goTo);
    st.tick((dt, t) => { bubbles.forEach(b => { b.position.y += dt * b.userData.v; if (b.position.y > 9) b.position.y = 0; }); weeds.forEach((w, i) => w.rotation.z = Math.sin(t * 1.2 + i) * 0.12); prop.rotation.x += dt * 8; if (!busy) sub.position.y = home.y + Math.sin(t * 1.5) * 0.12; });
    const key = e => { if (run && "123".includes(e.key)) goTo(+e.key - 1); };
    window.addEventListener("keydown", key);
    function start() { ui.score(0); run = mcqRun(ui, unit.game.q, 10, o => { opts = o; oys.forEach((y, k) => { y.userData.lb.userData.redraw(o[k].t); y.userData.pearl.visible = false; }); }, (s, n) => { done(s, n); ui.end(s, n, start); }); run.next(); }
    ui.start(start);
    return { destroy() { window.removeEventListener("keydown", key); st.dispose(); } };
  }

  /* ===== 3. route: choose the road at each fork ===== */
  function gRoute(host, unit, done) {
    const ui = shell(host, unit, "route");
    const st = makeStage(ui.stageHost, { fov: 52, onResize: a => { st && (st.camera.position.y = a < 1 ? 7.5 : 5.5); } });
    const T = st.T, S = st.scene;
    S.background = skyBg(T, "#5DB3D6", "#BFE6F0", "#FBE3C1"); S.fog = new T.Fog(0xF6E2C4, 18, 48);
    st.camera.position.set(0, 5.5, 10.5);
    const world = new T.Group(); S.add(world);
    const sand = new T.Mesh(new T.PlaneGeometry(120, 220, 60, 110), std(T, 0xE7C38F, { roughness: 1 })); sand.rotation.x = -Math.PI / 2;
    const p = sand.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); if (Math.abs(x) > 6) p.setZ(i, Math.sin(x * 0.3 + p.getY(i) * 0.1) * 0.8 * Math.min(1, (Math.abs(x) - 6) / 6)); } sand.geometry.computeVertexNormals(); sand.receiveShadow = true; sand.position.z = -90; world.add(sand);
    const road = new T.Mesh(new T.PlaneGeometry(3.2, 220), std(T, 0xC79A66, { roughness: 1 })); road.rotation.x = -Math.PI / 2; road.position.set(0, 0.01, -90); road.receiveShadow = true; world.add(road);
    // palms + forts along the way
    const trunkM = std(T, 0x9B6A3F), leafM = std(T, 0x2F9A62);
    function palm(x, z) { const g = new T.Group(); const c = new T.CatmullRomCurve3([new T.Vector3(0, 0, 0), new T.Vector3(0.2, 1.5, 0), new T.Vector3(0.5, 3, 0)]); const tr = new T.Mesh(new T.TubeGeometry(c, 12, 0.14, 8), trunkM); tr.castShadow = true; g.add(tr);
      for (let i = 0; i < 7; i++) { const l = new T.Mesh(new T.SphereGeometry(0.9, 16, 8), leafM); l.scale.set(1.3, 0.12, 0.32); l.position.set(0.5 + Math.cos(i * 0.9) * 0.7, 3 - 0.15, Math.sin(i * 0.9) * 0.7); l.rotation.y = -i * 0.9; l.rotation.z = -0.35; l.castShadow = true; g.add(l); }
      g.position.set(x, 0, z); world.add(g); }
    for (let z = 4; z > -190; z -= 7) { palm(-5 - Math.random() * 3, z); palm(5 + Math.random() * 3, z - 3.5); }
    const fortM = std(T, 0xD9B98E);
    function fort(x, z) { const g = new T.Group(); const t1 = new T.Mesh(new T.CylinderGeometry(1.1, 1.25, 3.2, 32), fortM); t1.position.y = 1.6; t1.castShadow = true; g.add(t1); const w = rbox(T, 4, 2.2, 1.6, 0.2, fortM); w.position.set(2, 1.1, 0); g.add(w); const t2 = new T.Mesh(new T.CylinderGeometry(0.9, 1, 2.6, 32), fortM); t2.position.set(4.1, 1.3, 0); g.add(t2);
      for (let i = 0; i < 10; i++) { const m = new T.Mesh(new T.CapsuleGeometry(0.12, 0.2, 4, 8), fortM); const a = i / 10 * Math.PI * 2; m.position.set(Math.cos(a) * 1.05, 3.35, Math.sin(a) * 1.05); g.add(m); }
      g.position.set(x, 0, z); g.rotation.y = x > 0 ? -0.5 : 0.5; world.add(g); }
    for (let z = -20; z > -190; z -= 34) fort(z % 68 === 0 ? 9 : -13, z);
    // caravan (cart + camel-like rounded shapes)
    const cart = new T.Group();
    const body = rbox(T, 1.4, 0.7, 2, 0.2, std(T, 0x0A6E79)); body.position.y = 0.75; cart.add(body);
    const canopy = new T.Mesh(new T.CylinderGeometry(0.8, 0.8, 2, 24, 1, false, 0, Math.PI), std(T, 0xF6EBD6, { side: T.DoubleSide })); canopy.rotation.z = Math.PI / 2; canopy.rotation.y = Math.PI / 2; canopy.position.y = 1.1; cart.add(canopy);
    const wheels = [];
    [[-0.78, 0.6], [0.78, 0.6], [-0.78, -0.6], [0.78, -0.6]].forEach(([x, z]) => { const w = new T.Mesh(new T.TorusGeometry(0.32, 0.09, 10, 24), std(T, 0x6B4A2B)); w.rotation.y = Math.PI / 2; w.position.set(x, 0.35, z); cart.add(w); wheels.push(w); });
    const flag = new T.Mesh(new T.PlaneGeometry(0.6, 0.4), std(T, 0xD4202C, { side: T.DoubleSide })); flag.position.set(0, 2.1, -0.6); cart.add(flag);
    const pole = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 1.2, 8), std(T, 0x6B4A2B)); pole.position.set(-0.3, 1.6, -0.6); cart.add(pole);
    cart.position.set(0, 0, 4.2); S.add(cart);
    // fork signs
    const signs = [-1, 1].map((s, k) => { const g = new T.Group(); const post = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 2.2, 10), std(T, 0x6B4A2B)); post.position.y = 1.1; g.add(post);
      const board = rbox(T, 3.2, 1.3, 0.16, 0.2, std(T, 0xFFF6E6)); board.position.y = 2.4; g.add(board);
      const lb = label(T, "", 3, 1.15, { color: "#3A2A16", size: 80 }); lb.position.set(0, 2.4, 0.1); g.add(lb);
      const arrow = new T.Mesh(new T.ConeGeometry(0.25, 0.5, 3), std(T, 0xEC7F16)); arrow.rotation.z = s * Math.PI / 2; arrow.position.set(-s * 1.9, 2.4, 0); g.add(arrow);
      g.userData = { lb, board }; S.add(g); st.pickable(g, k); return g; });
    const spark = sparkSystem(st);
    let opts = [], run, busy = false, dist = 0;
    function placeSigns() { signs.forEach((g, k) => { g.position.set(k ? 2.6 : -2.6, 0, -4); g.rotation.y = 0; g.visible = true; g.userData.board.material.color.set(0xFFF6E6); }); cart.position.x = 0; }
    function choose(k) {
      if (!run || run.locked || busy) return; busy = true;
      const x0 = cart.position.x, x1 = k ? 1.6 : -1.6;
      tween(st, 0.6, e => { cart.position.x = x0 + (x1 - x0) * ease(e); cart.rotation.y = (k ? -1 : 1) * 0.4 * Math.sin(e * Math.PI); }, () => {
        const ok = run.answer(opts[k], next => {
          signs.forEach(s => s.visible = false);
          const z0 = world.position.z; tween(st, 1.4, e => { world.position.z = z0 + 9 * ease(e); cart.position.x = x1 * (1 - ease(e)); wheels.forEach(w => w.rotation.x += 0.25); }, () => { dist += 9; if (world.position.z > 150) world.position.z = 0; busy = false; next(); });
        });
        if (ok) { signs[k].userData.board.material.color.set(0xBDEFD6); spark(new T.Vector3(signs[k].position.x, 3, -4)); }
        else { signs[k].userData.board.material.color.set(0xFFD8B0); shake(st, signs[k], 0.1); setTimeout(() => { tween(st, 0.5, e => cart.position.x = x1 * (1 - ease(e)), () => busy = false); }, 600); }
      });
    }
    st.onPick(choose);
    st.tick((dt, t) => { flag.rotation.y = Math.sin(t * 6) * 0.3; st.camera.lookAt(0, 1.2, -3); });
    const c = ui.ctrl(`<button class="g-key" data-k="1" aria-label="الطريق الأيمن">▶</button><button class="g-key" data-k="0" aria-label="الطريق الأيسر">◀</button>`);
    c.querySelectorAll("[data-k]").forEach(b => b.onclick = () => choose(+b.dataset.k));
    const key = e => { if (e.key === "ArrowLeft") choose(0); else if (e.key === "ArrowRight") choose(1); };
    window.addEventListener("keydown", key);
    function start() { ui.score(0); c.hidden = false; run = mcqRun(ui, unit.game.q, 10, o => { opts = o; placeSigns(); signs.forEach((g, k) => g.userData.lb.userData.redraw(o[k].t)); }, (s, n) => { done(s, n); ui.end(s, n, start); }); run.next(); }
    ui.start(start);
    return { destroy() { window.removeEventListener("keydown", key); st.dispose(); } };
  }

  /* ===== 4. roots: tap the three root letters in order ===== */
  function gRoots(host, unit, done) {
    const ui = shell(host, unit, "roots");
    const st = makeStage(ui.stageHost, { fov: 45, onResize: a => { st && (st.camera.position.z = a < 1 ? 15 : 10.5); } });
    const T = st.T, S = st.scene;
    S.background = skyBg(T, "#1D3B5C", "#2E6A85", "#E9D9BF"); S.fog = new T.Fog(0x2E5C78, 16, 34);
    st.camera.position.set(0, 3.2, 10.5); st.camera.lookAt(0, 1.6, 0);
    const desk = rbox(T, 14, 0.4, 6, 0.2, std(T, 0x7A5132, { roughness: 0.7 })); desk.position.set(0, -1.2, 0); S.add(desk);
    // open dictionary book
    const book = new T.Group(); book.position.set(0, -0.85, 1.2); book.rotation.x = -0.25; S.add(book);
    const coverM = std(T, 0x0A6E79), pageM = std(T, 0xFFF8EA, { roughness: 0.9 });
    [-1, 1].forEach(s => { const cv = rbox(T, 3, 0.12, 2.2, 0.06, coverM); cv.position.set(1.55 * s, 0, 0); cv.rotation.z = -s * 0.06; book.add(cv); const pg = rbox(T, 2.8, 0.14, 2, 0.04, pageM); pg.position.set(1.5 * s, 0.1, 0); pg.rotation.z = -s * 0.06; book.add(pg); });
    const slots = [0, 1, 2].map(i => { const sl = new T.Mesh(new T.CircleGeometry(0.42, 32), std(T, 0xE9DCC3)); sl.rotation.x = -Math.PI / 2; sl.position.set((1 - i) * 1.2, 0.19, 0.1); book.add(sl); return sl; });
    const entry = label(T, "", 5.6, 0.9, { color: "#0A6E79", size: 70 }); entry.rotation.x = -Math.PI / 2; entry.position.set(0, 0.2, 0.8); book.add(entry);
    const orbs = []; const orbM = () => std(T, 0xFFFFFF, { roughness: 0.25, metalness: 0.05 });
    for (let i = 0; i < 6; i++) { const g = new T.Group(); const s = new T.Mesh(new T.SphereGeometry(0.62, 40, 28), orbM()); s.castShadow = true; g.add(s); const lb = label(T, "", 1.05, 1.05, { color: "#0A6E79", size: 210, pad: 4 }); lb.position.z = 0.63; g.add(lb); g.userData = { s, lb, i }; S.add(g); orbs.push(g); st.pickable(g, i); }
    const spark = sparkSystem(st);
    const words = shuffle(unit.game.words).slice(0, 8);
    let wi = 0, need = [], got = 0, score = 0, mistakes = 0, busy = false, ang = 0;
    function lay(t) { orbs.forEach((o, i) => { if (o.userData.placed) return; const a = ang + i / orbs.length * Math.PI * 2; o.position.set(Math.cos(a) * 3.8, 2.6 + Math.sin(t * 1.4 + i) * 0.25 + Math.sin(a) * 0.6, Math.sin(a) * 0.8 - 0.5); o.rotation.y = 0; }); }
    function showWord() {
      if (wi >= words.length) { done(score, words.length); ui.end(score, words.length, start); return; }
      const w = words[wi]; ui.prog(wi + 1, words.length);
      ui.q(`استخرجي جذر الكلمة: ${w.w}`);
      need = w.root.replace(/\s+/g, "").split(""); got = 0; mistakes = 0;
      const letters = shuffle(w.pick.map(x => x.trim()).filter(Boolean)).slice(0, 6);
      need.forEach(l => { if (!letters.includes(l)) letters[Math.floor(Math.random() * letters.length)] = l; });
      orbs.forEach((o, i) => { o.visible = i < letters.length; o.userData.placed = false; o.userData.l = letters[i]; o.userData.lb.userData.redraw(letters[i] || ""); o.userData.s.material.color.set(0xFFFFFF); o.scale.setScalar(1); });
      slots.forEach(s => s.material.color.set(0xE9DCC3)); entry.userData.redraw("");
    }
    st.onPick(i => {
      if (busy || wi >= words.length) return; const o = orbs[i]; if (o.userData.placed) return;
      if (o.userData.l === need[got]) {
        o.userData.placed = true; const from = o.position.clone(), slot = slots[got], to = new T.Vector3(); slot.getWorldPosition(to); to.y += 0.55;
        o.userData.s.material.color.set(0xD8F3E7); got++;
        tween(st, 0.6, e => { o.position.lerpVectors(from, to, ease(e)); o.scale.setScalar(1 - 0.35 * ease(e)); });
        slot.material.color.set(0x1E9D63);
        if (got === need.length) {
          busy = true; if (mistakes === 0) score++; ui.score(score); ui.fb(pick(PRAISE) + "  الجذر: " + words[wi].root, true);
          entry.userData.redraw(words[wi].entry || ""); spark(new T.Vector3(0, 0.5, 1.2), 26);
          setTimeout(() => { busy = false; wi++; showWord(); }, 2300);
        }
      } else { mistakes++; o.userData.s.material.color.set(0xFFE1C2); shake(st, o, 0.2); ui.fb(got === 0 ? "ابدئي بالحرف الأول من الجذر 🌱" : pick(RETRY), false); setTimeout(() => o.userData.s.material.color.set(0xFFFFFF), 600); }
    });
    st.tick((dt, t) => { ang += dt * 0.25; lay(t); });
    function start() { wi = 0; score = 0; ui.score(0); showWord(); }
    ui.start(start);
    return { destroy() { st.dispose(); } };
  }

  /* ===== 5. memory: flip cards in a gallery ===== */
  function gMemory(host, unit, done) {
    const ui = shell(host, unit, "memory");
    const st = makeStage(ui.stageHost, { fov: 42, onResize: a => { st && fit(a); } });
    const T = st.T, S = st.scene;
    S.background = new T.Color(0xF3EEE6);
    const wall = new T.Mesh(new T.PlaneGeometry(60, 30), std(T, 0xEFE7DA, { roughness: 1 })); wall.position.z = -0.6; wall.receiveShadow = true; S.add(wall);
    const rail = rbox(T, 60, 0.25, 0.25, 0.1, std(T, 0xB98A55)); rail.position.set(0, 5.4, -0.4); S.add(rail);
    const spot = new T.SpotLight(0xFFF1D6, 0.8, 30, 0.7, 0.6); spot.position.set(0, 9, 8); S.add(spot);
    const pairs = shuffle(unit.game.pairs).slice(0, 8);
    const cards = shuffle(pairs.flatMap((p, k) => [{ t: p[0], k }, { t: p[1], k }]));
    const backC = document.createElement("canvas"); backC.width = 256; backC.height = 320; { const x = backC.getContext("2d"); const g = x.createLinearGradient(0, 0, 256, 320); g.addColorStop(0, "#0A6E79"); g.addColorStop(1, "#13919C"); x.fillStyle = g; x.fillRect(0, 0, 256, 320); x.strokeStyle = "rgba(255,255,255,.35)"; x.lineWidth = 6; x.strokeRect(14, 14, 228, 292); x.fillStyle = "#F2B233"; x.font = `800 110px ${FONT}`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("؟", 128, 165); }
    const backT = tex(T, backC);
    const wide = host.clientWidth / Math.max(1, host.clientHeight) > 1.25; const cols = wide ? 8 : 4, rows = Math.ceil(cards.length / cols), W = 2.3, H = 2.05, gap = 0.3;
    const grid = new T.Group(); S.add(grid);
    const objs = cards.map((c, i) => {
      const g = new T.Group();
      const frame = rbox(T, W + 0.2, H + 0.2, 0.12, 0.12, std(T, 0xC9973B, { metalness: 0.4, roughness: 0.35 })); frame.position.z = -0.08; g.add(frame);
      const card = new T.Group(); g.add(card);
      const back = new T.Mesh(new T.PlaneGeometry(W, H), new T.MeshBasicMaterial({ map: backT, toneMapped: false })); back.position.z = 0.01; card.add(back);
      const front = label(T, c.t, W, H, { bg: "#FFFDF7", color: "#16323A", size: 64, radius: 20, border: "#E8D9BE" }); front.rotation.y = Math.PI; front.position.z = -0.01; front.material.depthWrite = true; card.add(front);
      const x = (i % cols - (cols - 1) / 2) * (W + gap), y = ((rows - 1) / 2 - Math.floor(i / cols)) * (H + gap);
      g.position.set(-x, y + 0.2, 0); grid.add(g); g.userData = { card, c, open: false, done: false }; st.pickable(g, i); return g;
    });
    function fit(a) { const needW = cols * (W + gap) + 0.6, needH = rows * (H + gap) + 3.4; const vf = 42 * Math.PI / 180; const dH = needH / 2 / Math.tan(vf / 2), dW = needW / 2 / Math.tan(vf / 2) / a; st.camera.position.set(0, 1.1, Math.max(dH, dW) + 0.5); st.camera.lookAt(0, 1.1, 0); }
    fit(host.clientWidth / Math.max(1, host.clientHeight));
    const spark = sparkSystem(st);
    let open = [], found = 0, moves = 0, misses = 0, busy = false, started = false;
    function flip(o, to) { const c = o.userData.card, a0 = c.rotation.y, a1 = to ? Math.PI : 0; tween(st, 0.35, e => c.rotation.y = a0 + (a1 - a0) * ease(e)); o.userData.open = to; }
    st.onPick(i => {
      if (!started || busy) return; const o = objs[i]; if (o.userData.open || o.userData.done) return;
      flip(o, true); open.push(o);
      if (open.length === 2) {
        moves++; busy = true; const [a, b] = open;
        if (a.userData.c.k === b.userData.c.k) { setTimeout(() => { a.userData.done = b.userData.done = true; found++; ui.score(found); ui.prog(found, pairs.length); ui.fb(pick(PRAISE), true); spark(a.getWorldPosition(new T.Vector3()), 10); spark(b.getWorldPosition(new T.Vector3()), 10); open = []; busy = false;
          if (found === pairs.length) { const sc = Math.max(1, pairs.length - Math.max(0, misses - 2)); setTimeout(() => { done(sc, pairs.length); ui.end(sc, pairs.length, start); }, 900); } }, 450); }
        else { misses++; ui.fb(pick(RETRY), false); setTimeout(() => { flip(a, false); flip(b, false); open = []; busy = false; }, 1100); }
      }
    });
    function start() { started = true; found = 0; moves = 0; misses = 0; open = []; ui.score(0); ui.prog(0, pairs.length); ui.q("اقلبي بطاقتين متقابلتين: العبارة وما يقابلها"); objs.forEach(o => { o.userData.done = false; if (o.userData.open) flip(o, false); }); }
    ui.start(start);
    return { destroy() { st.dispose(); } };
  }

  /* ===== 6. sort: send each letter to the right mailbox ===== */
  function gSort(host, unit, done) {
    const ui = shell(host, unit, "sort");
    const st = makeStage(ui.stageHost, { fov: 48, onResize: a => { st && (st.camera.position.z = a < 1 ? 17 : 12); } });
    const T = st.T, S = st.scene;
    S.background = skyBg(T, "#9ED9E6", "#DFF3F2", "#F7EBD9");
    st.camera.position.set(0, 5, 12); st.camera.lookAt(0, 3, 0);
    const ground = new T.Mesh(new T.PlaneGeometry(50, 30), std(T, 0xA8D8A0)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; S.add(ground);
    const path = new T.Mesh(new T.PlaneGeometry(16, 3), std(T, 0xE9DCC3)); path.rotation.x = -Math.PI / 2; path.position.set(0, 0.01, 1.5); S.add(path);
    const groups = unit.game.groups, n = groups.length, colors = [0xD9473F, 0x0A6E79, 0xEC7F16];
    const boxes = groups.map((gname, k) => {
      const g = new T.Group(); const x = (k - (n - 1) / 2) * (n === 2 ? 5 : 4.4); g.position.set(-x, 0, 0);
      const post = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 2, 12), std(T, 0x6C7A80)); post.position.y = 1; g.add(post);
      const box = rbox(T, 2.4, 1.7, 1.6, 0.45, std(T, colors[k % 3], { roughness: 0.4 })); box.position.y = 2.7; g.add(box);
      const slot = rbox(T, 1.3, 0.16, 0.1, 0.05, std(T, 0x222222)); slot.position.set(0, 3.15, 0.82); g.add(slot);
      const fl = new T.Group(); fl.position.set(1.25, 2.5, 0); g.add(fl); const flPole = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 1, 8), std(T, 0x333333)); flPole.position.y = 0.5; fl.add(flPole); const flag = rbox(T, 0.5, 0.3, 0.04, 0.05, std(T, 0xF2B233)); flag.position.set(0.25, 0.9, 0); fl.add(flag); fl.rotation.z = -1.2;
      const lb = label(T, gname, 3.4, 1, { bg: "rgba(255,255,255,.95)", color: "#16323A", size: 64, radius: 40 }); lb.position.set(0, 4.3, 0.3); g.add(lb);
      S.add(g); st.pickable(g, k); g.userData = { fl }; return g;
    });
    const env = new T.Group(); const paper = rbox(T, 3.2, 1.9, 0.08, 0.12, std(T, 0xFFFDF5)); env.add(paper);
    const flapC = new T.Mesh(new T.ConeGeometry(1.84, 0.9, 3), std(T, 0xF3E6CD)); flapC.rotation.z = Math.PI; flapC.scale.set(1, 1, 0.02); flapC.position.set(0, 0.5, 0.05); env.add(flapC);
    const elb = label(T, "", 3, 1.25, { color: "#16323A", size: 70 }); elb.position.set(0, -0.2, 0.07); env.add(elb);
    S.add(env);
    const spark = sparkSystem(st);
    const items = shuffle(unit.game.items).slice(0, 12);
    let i = 0, score = 0, tries = 0, busy = true, fallY = 9, cur = null;
    function nextItem() {
      if (i >= items.length) { busy = true; env.visible = false; done(score, items.length); ui.end(score, items.length, start); return; }
      cur = items[i]; tries = 0; ui.prog(i + 1, items.length); ui.q("إلى أي صندوق تذهب هذه الرسالة؟");
      elb.userData.redraw(cur[0]); env.visible = true; env.position.set(0, 9, 2.5); env.rotation.set(0, 0, 0); fallY = 9; busy = false;
    }
    st.onPick(k => {
      if (busy || !cur) return;
      if (k === cur[1]) {
        busy = true; if (tries === 0) score++; ui.score(score); ui.fb(pick(PRAISE), true);
        const from = env.position.clone(), to = boxes[k].position.clone().add(new T.Vector3(0, 3.15, 0.9));
        tween(st, 0.6, e => { env.position.lerpVectors(from, to, ease(e)); env.scale.setScalar(1 - 0.75 * ease(e)); }, () => { env.visible = false; env.scale.setScalar(1); const fl = boxes[k].userData.fl; tween(st, 0.4, e => fl.rotation.z = -1.2 * (1 - e)); spark(to, 14); setTimeout(() => { tween(st, 0.4, e => fl.rotation.z = -1.2 * e); i++; nextItem(); }, 700); });
      } else { tries++; ui.fb(pick(RETRY), false); shake(st, boxes[k], 0.12); fallY = Math.min(9, fallY + 1.2); }
    });
    st.tick((dt, t) => {
      if (!busy && cur) { fallY -= dt * 0.38; env.position.y = fallY; env.rotation.z = Math.sin(t * 2) * 0.08;
        if (fallY < 1.2) { busy = true; ui.fb("وصلت الرسالة إلى الأرض! المسي الصندوق الصحيح 🌱", false); tries++; setTimeout(() => { fallY = 9; busy = false; }, 900); } }
    });
    function start() { i = 0; score = 0; ui.score(0); nextItem(); }
    ui.start(start);
    return { destroy() { st.dispose(); } };
  }

  /* ===== 7. conveyor: ship only the correct crates ===== */
  function gConveyor(host, unit, done) {
    const ui = shell(host, unit, "conveyor");
    const st = makeStage(ui.stageHost, { fov: 46, onResize: a => { st && (st.camera.position.z = a < 1 ? 16 : 11); } });
    const T = st.T, S = st.scene;
    S.background = skyBg(T, "#2D4B5E", "#4E7488", "#D9C9AE"); S.fog = new T.Fog(0x4E7488, 18, 40);
    st.camera.position.set(0, 5.2, 11); st.camera.lookAt(0, 1.6, 0);
    const floor = new T.Mesh(new T.PlaneGeometry(50, 30), std(T, 0x8A9AA0, { roughness: 0.9 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
    const belt = rbox(T, 18, 0.35, 2.4, 0.15, std(T, 0x2B2F33, { roughness: 0.8 })); belt.position.set(0, 1.3, 0); S.add(belt);
    const rollers = []; for (let x = -8.5; x <= 8.5; x += 1) { const r = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 2.5, 16), std(T, 0x9AA5AB, { metalness: 0.5, roughness: 0.3 })); r.rotation.x = Math.PI / 2; r.position.set(x, 1.05, 0); S.add(r); rollers.push(r); }
    [-8, 0, 8].forEach(x => { const l = rbox(T, 0.4, 1.1, 2.2, 0.08, std(T, 0xF2B233)); l.position.set(x, 0.55, 0); S.add(l); });
    const truck = new T.Group(); const bed = rbox(T, 3.6, 1.4, 2.6, 0.2, std(T, 0x1E9D63)); bed.position.y = 1.2; truck.add(bed);
    const cab = rbox(T, 1.6, 1.8, 2.4, 0.35, std(T, 0x0A6E79)); cab.position.set(-2.6, 1.45, 0); truck.add(cab);
    [[-2.4, 1], [-2.4, -1], [1, 1], [1, -1]].forEach(([x, z]) => { const w = new T.Mesh(new T.CylinderGeometry(0.45, 0.45, 0.35, 24), std(T, 0x222222)); w.rotation.x = Math.PI / 2; w.position.set(x, 0.45, z); truck.add(w); });
    truck.position.set(-1, 0, -4.5); truck.rotation.y = Math.PI; S.add(truck);
    const crateM = () => std(T, 0xD8A86A, { roughness: 0.75 });
    const crates = [0, 1, 2, 3].map(k => { const g = new T.Group(); const b = rbox(T, 3, 1.5, 1.6, 0.18, crateM()); g.add(b); const lb = label(T, "", 2.8, 1.3, { bg: "rgba(255,250,240,.96)", color: "#3A2A16", size: 64, radius: 26 }); lb.position.z = 0.82; g.add(lb); g.userData = { b, lb }; S.add(g); st.pickable(g, k); return g; });
    const spark = sparkSystem(st);
    const rounds = shuffle(unit.game.rounds).slice(0, 6);
    let r = 0, score = 0, total = 0, active = false, items = [], speed = 1.15, mistakesR = 0, okLeft = 0;
    function nextRound() {
      if (r >= rounds.length) { active = false; done(score, total); ui.end(score, total, start); return; }
      const R = rounds[r]; ui.prog(r + 1, rounds.length); ui.q(R.prompt);
      items = shuffle(R.items).slice(0, 4); okLeft = items.filter(x => x.ok).length; total += okLeft; mistakesR = 0;
      crates.forEach((c, k) => { c.visible = true; c.userData.state = "belt"; c.userData.it = items[k]; c.userData.lb.userData.redraw(items[k].t); c.userData.b.material.color.set(0xD8A86A); c.position.set(6.5 + k * 3.9, 2.25, 0); c.scale.setScalar(1); c.rotation.set(0, 0, 0); });
      active = true;
    }
    st.onPick(k => {
      if (!active) return; const c = crates[k]; if (c.userData.state !== "belt") return;
      if (c.userData.it.ok) {
        c.userData.state = "ship"; score++; okLeft--; ui.score(score); ui.fb(pick(PRAISE), true); c.userData.b.material.color.set(0x7FD1A6);
        const from = c.position.clone(), to = truck.position.clone().add(new T.Vector3(0, 2.4, 0));
        tween(st, 0.8, e => { c.position.lerpVectors(from, to, ease(e)); c.position.y += Math.sin(e * Math.PI) * 2; c.scale.setScalar(1 - 0.5 * e); }, () => { c.visible = false; spark(to, 12); });
      } else { mistakesR++; c.userData.b.material.color.set(0xFFC9A0); ui.fb("هذا الصندوق ليس صحيحًا، دعيه يمرّ 🌿", false); shake(st, c, 0.15); }
    });
    st.tick(dt => {
      rollers.forEach(rl => rl.rotation.y += dt * 3);
      if (!active) return;
      let alive = 0;
      crates.forEach(c => { if (c.userData.state === "belt") { c.position.x -= dt * speed; if (c.position.x < -10.5) { c.userData.state = "gone"; c.visible = false; if (c.userData.it.ok) ui.fb("فاتكِ صندوق صحيح، انتبهي للقادم 👀", false); } else alive++; } else if (c.visible) alive++; });
      if (!alive) { active = false; r++; setTimeout(nextRound, 700); }
    });
    function start() { r = 0; score = 0; total = 0; ui.score(0); nextRound(); }
    ui.start(start);
    return { destroy() { st.dispose(); } };
  }

  /* ===== 8. tower: every correct answer adds a floor ===== */
  function gTower(host, unit, done) {
    const ui = shell(host, unit, "tower");
    let camY = 3;
    const st = makeStage(ui.stageHost, { fov: 46, onResize: a => { st && (st.camera.position.z = a < 1 ? 17 : 12.5); } });
    const T = st.T, S = st.scene;
    S.background = skyBg(T, "#3E8DC2", "#A9DCEB", "#FCE7C6"); S.fog = new T.Fog(0xCDEAF0, 25, 60);
    st.camera.position.set(0, camY + 2, 12.5);
    const island = new T.Mesh(new T.CylinderGeometry(6, 6.6, 1, 64), std(T, 0x8FCB8B)); island.position.y = -0.5; island.receiveShadow = true; S.add(island);
    const base = rbox(T, 3.2, 0.6, 3.2, 0.25, std(T, 0xB7C4C4)); base.position.y = 0.3; S.add(base);
    const cols = [0x0A6E79, 0xEC7F16, 0xE0688A, 0xF2B233, 0x13919C, 0x7A5CC9];
    // options as floating blocks to the side
    const opts3 = [0, 1, 2].map(k => { const g = new T.Group(); const b = rbox(T, 3.2, 1.2, 1.4, 0.4, std(T, 0xFFFFFF, { roughness: 0.35 })); g.add(b); const lb = label(T, "", 3, 1.05, { color: "#16323A", size: 66 }); lb.position.z = 0.72; g.add(lb); g.userData = { b, lb }; S.add(g); st.pickable(g, k); return g; });
    const stack = []; const spark = sparkSystem(st);
    let opts = [], run, busy = false;
    function placeOpts() { const y = 0.6 + stack.length * 0.9 + 3.2; opts3.forEach((g, k) => { g.position.set((1 - k) * 3.7, y, 1.5); g.visible = true; g.userData.b.material.color.set(0xFFFFFF); }); }
    function choose(k) {
      if (!run || run.locked || busy) return;
      const ok = run.answer(opts[k], next => { busy = false; next(); });
      if (ok) {
        busy = true; opts3.forEach(g => g.visible = false);
        const h = 0.9, y = 0.6 + stack.length * h + h / 2, blk = rbox(T, 2.8 - (stack.length % 3) * 0.12, h - 0.06, 2.8 - (stack.length % 3) * 0.12, 0.3, std(T, cols[stack.length % cols.length], { roughness: 0.4 }));
        const win = new T.Mesh(new T.PlaneGeometry(0.7, 0.45), std(T, 0xFFF4C8, { emissive: 0xFFD27A, emissiveIntensity: 0.4 })); win.position.z = 1.45 - (stack.length % 3) * 0.06; blk.add(win);
        blk.position.set(0, y + 6, 0); blk.rotation.y = 0.6; S.add(blk); stack.push(blk);
        tween(st, 0.7, e => { blk.position.y = y + 6 * (1 - backOut(e)) ; blk.rotation.y = 0.6 * (1 - e); }, () => { spark(new T.Vector3(0, y, 0), 16); });
      } else { opts3[k].userData.b.material.color.set(0xFFE1C2); shake(st, opts3[k], 0.15); stack.forEach((b, i) => { const r0 = b.rotation.z; tween(st, 0.5, e => b.rotation.z = r0 + Math.sin(e * 20) * 0.03 * (1 - e) * (i + 1) / stack.length); }); }
    }
    st.onPick(choose);
    st.tick((dt, t) => { const target = 2.5 + stack.length * 0.9; camY += (target - camY) * Math.min(1, dt * 2); st.camera.position.y = camY + 2.5; st.camera.lookAt(0, camY, 0); opts3.forEach((g, k) => g.position.y += Math.sin(t * 2 + k) * 0.003); });
    const key = e => { if ("123".includes(e.key)) choose(+e.key - 1); };
    window.addEventListener("keydown", key);
    function start() { stack.forEach(b => S.remove(b)); stack.length = 0; camY = 3; ui.score(0); run = mcqRun(ui, unit.game.q, 10, o => { opts = o; placeOpts(); opts3.forEach((g, k) => g.userData.lb.userData.redraw(o[k].t)); }, (s, n) => { const top = new T.Mesh(new T.ConeGeometry(1.2, 1.4, 32), std(T, 0xF2B233, { metalness: 0.3 })); top.position.y = 0.6 + stack.length * 0.9 + 0.7; S.add(top); stack.push(top); spark(top.position.clone(), 30); done(s, n); ui.end(s, n, start); }); run.next(); }
    ui.start(start);
    return { destroy() { window.removeEventListener("keydown", key); st.dispose(); } };
  }

  /* ===== 9. shop: put the right product in the cart ===== */
  function gShop(host, unit, done) {
    const ui = shell(host, unit, "shop");
    const st = makeStage(ui.stageHost, { fov: 46, onResize: a => { st && (st.camera.position.z = a < 1 ? 15.5 : 11); } });
    const T = st.T, S = st.scene;
    S.background = new T.Color(0xF6F1FA);
    st.camera.position.set(0, 4.2, 11); st.camera.lookAt(0, 2.2, 0);
    const floor = new T.Mesh(new T.PlaneGeometry(40, 30), std(T, 0xE9E3F0)); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
    const wall = new T.Mesh(new T.PlaneGeometry(40, 16), std(T, 0xFBF8FF)); wall.position.set(0, 8, -3); S.add(wall);
    const shelfM = std(T, 0xFFFFFF, { roughness: 0.3 });
    [1.6, 3.8].forEach(y => { const sh = rbox(T, 13, 0.18, 1.6, 0.08, shelfM); sh.position.set(0, y, -2); S.add(sh); });
    const screen = rbox(T, 6, 1, 0.12, 0.2, std(T, 0x7A5CC9)); screen.position.set(0, 6.2, -2.8); S.add(screen);
    const scr = label(T, "متجر البصيرة", 5.6, 0.9, { color: "#FFFFFF", size: 70 }); scr.position.set(0, 6.2, -2.72); S.add(scr);
    const pcol = [0xEC7F16, 0x0A6E79, 0xE0688A];
    const prods = [0, 1, 2].map(k => { const g = new T.Group(); const b = rbox(T, 3.2, 2, 1.3, 0.35, std(T, pcol[k], { roughness: 0.4 })); g.add(b); const tag = label(T, "", 3, 1.6, { bg: "rgba(255,255,255,.96)", color: "#16323A", size: 64, radius: 30 }); tag.position.z = 0.67; g.add(tag); const bow = new T.Mesh(new T.TorusGeometry(0.22, 0.07, 10, 20), std(T, 0xF2B233)); bow.position.set(0, 1.08, 0); g.add(bow); g.userData = { b, tag, home: new T.Vector3((1 - k) * 4.2, 2.75, -1.6) }; g.position.copy(g.userData.home); S.add(g); st.pickable(g, k); return g; });
    const cart = new T.Group(); const basket = new T.Mesh(new T.CylinderGeometry(1.5, 1.2, 1.3, 4, 1, true), std(T, 0x7A5CC9, { side: T.DoubleSide, metalness: 0.3, roughness: 0.4 })); basket.rotation.y = Math.PI / 4; basket.scale.set(1.3, 1, 0.9); basket.position.y = 1.5; cart.add(basket);
    const handle = new T.Mesh(new T.TorusGeometry(0.9, 0.06, 8, 24, Math.PI), std(T, 0x333333)); handle.position.set(0, 2.2, -1); cart.add(handle);
    [[-1.2, 0.8], [1.2, 0.8], [-1.2, -0.8], [1.2, -0.8]].forEach(([x, z]) => { const w = new T.Mesh(new T.SphereGeometry(0.25, 16, 12), std(T, 0x333333)); w.position.set(x, 0.25, z); cart.add(w); });
    cart.position.set(0, 0, 4.6); cart.scale.setScalar(0.7); S.add(cart);
    const count = label(T, "٠", 1, 1, { bg: "#EC7F16", color: "#fff", size: 150, radius: 250, pad: 4 }); count.position.set(1.5, 2.4, 4.6); S.add(count);
    const spark = sparkSystem(st);
    let opts = [], run, busy = false, inCart = 0;
    function choose(k) {
      if (!run || run.locked || busy) return; busy = true; const p = prods[k], from = p.position.clone(), to = cart.position.clone().add(new T.Vector3(0, 1.8, 0));
      tween(st, 0.7, e => { p.position.lerpVectors(from, to, ease(e)); p.position.y += Math.sin(e * Math.PI) * 1.6; p.scale.setScalar(1 - 0.45 * e); }, () => {
        const ok = run.answer(opts[k], next => { busy = false; next(); });
        if (ok) { p.visible = false; inCart++; count.userData.redraw(ar(inCart)); spark(to, 22); }
        else { p.userData.b.material.color.set(0xD7CCE4); const f2 = p.position.clone(); tween(st, 0.6, e => { p.position.lerpVectors(f2, p.userData.home, ease(e)); p.scale.setScalar(0.55 + 0.45 * e); }, () => { busy = false; }); }
      });
    }
    st.onPick(choose);
    st.tick((dt, t) => { prods.forEach((p, k) => p.rotation.y = Math.sin(t * 1.2 + k) * 0.12); });
    const key = e => { if ("123".includes(e.key)) choose(+e.key - 1); };
    window.addEventListener("keydown", key);
    function start() { inCart = 0; count.userData.redraw("٠"); ui.score(0); run = mcqRun(ui, unit.game.q, 10, o => { opts = o; prods.forEach((p, k) => { p.visible = true; p.position.copy(p.userData.home); p.scale.setScalar(1); p.userData.b.material.color.set(pcol[k]); p.userData.tag.userData.redraw(o[k].t); }); }, (s, n) => { done(s, n); ui.end(s, n, start); }); run.next(); }
    ui.start(start);
    return { destroy() { window.removeEventListener("keydown", key); st.dispose(); } };
  }

  const MAP = { board: gBoard, dive: gDive, route: gRoute, roots: gRoots, memory: gMemory, sort: gSort, conveyor: gConveyor, tower: gTower, shop: gShop };
  window.BasiraGames = {
    meta: META,
    mount(host, unit, onDone) {
      if (!window.THREE) { host.innerHTML = '<div class="empty"><b>تعذّر تحميل اللعبة</b>تحقّقي من الاتصال ثم أعيدي فتح الصفحة.</div>'; return { destroy() {} }; }
      const fn = MAP[unit.game.type]; if (!fn) return { destroy() {} };
      const go = () => fn(host, unit, onDone || (() => {}));
      return go();
    }
  };
})();
