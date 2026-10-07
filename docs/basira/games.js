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

  /* ---------------- shared stage (PBR + env light + bloom + grade) ---------------- */
  const MOBILE = (window.matchMedia && matchMedia("(pointer:coarse)").matches) || Math.min(screen.width, screen.height) < 700;
  const GRADE = {
    uniforms: { tDiffuse: { value: null }, vig: { value: 0.42 }, sat: { value: 1.08 }, warm: { value: 0.02 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform sampler2D tDiffuse; uniform float vig; uniform float sat; uniform float warm; varying vec2 vUv;" +
      "void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(0.2126,0.7152,0.0722)); c = mix(vec3(l), c, sat);" +
      "c += vec3(warm, warm*0.4, -warm*0.6) * l; vec2 d = vUv - 0.5; c *= 1.0 - vig * dot(d,d) * 1.5;" +
      "c = clamp(c, 0.0, 1.0); c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c)); gl_FragColor = vec4(c, 1.0); }"
  };
  function makeStage(host, opt) {
    const T = THREE, X = window.THREEX;
    if (T.ColorManagement) T.ColorManagement.legacyMode = false;
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    const PR = Math.min(window.devicePixelRatio || 1, MOBILE ? 1.6 : 2);
    renderer.setPixelRatio(PR);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = opt.exposure || 0.8;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.physicallyCorrectLights = false;
    renderer.domElement.className = "g3d";
    host.appendChild(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(opt.fov || 45, 1, 0.1, 220);
    // image-based light: soft studio reflections on every PBR surface
    let pmrem = null;
    if (X && X.RoomEnvironment) {
      pmrem = new T.PMREMGenerator(renderer);
      const envScene = new X.RoomEnvironment();
      scene.environment = pmrem.fromScene(envScene, 0.04).texture;
      envScene.traverse && envScene.traverse(o => { o.geometry && o.geometry.dispose(); });
    }
    const hemi = new T.HemisphereLight(opt.sky || 0xEAF6FF, opt.ground || 0x9B7B5B, X ? 0.18 : 0.65);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xFFF0D8, X ? 1.25 : 1.6);
    sun.position.set(6, 12, 8); sun.castShadow = true;
    const SM = MOBILE ? 1024 : 2048;
    sun.shadow.mapSize.set(SM, SM);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 44 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
    scene.add(sun);
    const rim = new T.DirectionalLight(0xCFE8FF, 0.3); rim.position.set(-8, 6, -6); scene.add(rim);
    // post-processing: MSAA HDR target -> bloom -> colour grade + sRGB
    let composer = null, bloom = null;
    if (X && X.EffectComposer) {
      try {
        const gl2 = renderer.capabilities.isWebGL2;
        const rt = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType, samples: gl2 ? 4 : 0 });
        composer = new X.EffectComposer(renderer, rt);
        composer.addPass(new X.RenderPass(scene, camera));
        bloom = new X.UnrealBloomPass(new T.Vector2(256, 256), opt.bloom != null ? opt.bloom : 0.18, 0.45, 0.97);
        composer.addPass(bloom);
        const grade = new X.ShaderPass(GRADE); if (opt.vig != null) grade.uniforms.vig.value = opt.vig;
        composer.addPass(grade);
        if (!gl2 && X.SMAAPass) composer.addPass(new X.SMAAPass(4, 4));
      } catch (e) { composer = null; }
    }
    const ticks = []; let alive = true, last = performance.now();
    const ray = new T.Raycaster(), mouse = new T.Vector2();
    const picks = [];
    let onPick = null;
    function size() {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      if (composer) composer.setSize(w, h);
      opt.onResize && opt.onResize(w / h);
    }
    const ro = new ResizeObserver(() => size()); ro.observe(host); let sized = false;
    function loop(t) {
      if (!alive) return;
      requestAnimationFrame(loop);
      if (!sized) { sized = true; size(); }
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      for (let i = ticks.length - 1; i >= 0; i--) { if (ticks[i](dt, t / 1000) === false) ticks.splice(i, 1); }
      if (composer) composer.render(dt); else renderer.render(scene, camera);
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
      T, scene, camera, renderer, sun, hemi, rim,
      tick(fn) { ticks.push(fn); },
      pickable(o, id) { o.userData.pick = id; picks.push(o); },
      clearPicks() { picks.length = 0; },
      onPick(fn) { onPick = fn; host.__pick = id => fn(id); },
      dispose() { alive = false; ro.disconnect(); if (scene.environment) scene.environment.dispose(); pmrem && pmrem.dispose(); composer && composer.renderTarget1 && (composer.renderTarget1.dispose(), composer.renderTarget2.dispose()); renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); renderer.domElement.remove(); }
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

  /* ---------------- procedural surface textures ---------------- */
  const TEXC = {};
  function canvasTex(T, key, w, h, draw, rep) {
    if (!TEXC[key]) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); TEXC[key] = c; }
    const t = new T.CanvasTexture(TEXC[key]); t.encoding = T.sRGBEncoding; t.anisotropy = 8; t.wrapS = t.wrapT = T.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); return t;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  function speckle(x, w, h, n, cols, rmin, rmax, alpha) { for (let i = 0; i < n; i++) { x.globalAlpha = alpha * Math.random(); x.fillStyle = cols[i % cols.length]; x.beginPath(); x.arc(Math.random() * w, Math.random() * h, rnd(rmin, rmax), 0, 7); x.fill(); } x.globalAlpha = 1; }
  function woodTex(T, rep) {
    return canvasTex(T, "wood", 1024, 1024, (x, w, h) => {
      const tones = ["#C9925C", "#BF8650", "#D29E68", "#B97E4A", "#CC965F", "#C48A55"];
      const ph = h / 8;
      for (let r = 0; r < 8; r++) {
        let xo = -rnd(40, 340);
        while (xo < w) { const len = rnd(380, 620); x.fillStyle = tones[Math.floor(Math.random() * tones.length)]; x.fillRect(xo, r * ph, len, ph);
          x.strokeStyle = "rgba(90,50,20,.18)"; x.lineWidth = 1.4;
          for (let g = 0; g < 9; g++) { x.beginPath(); const y0 = r * ph + rnd(4, ph - 4); x.moveTo(xo, y0); for (let k = 0; k <= 12; k++) x.lineTo(xo + len * k / 12, y0 + Math.sin(k * 0.9 + g) * rnd(1, 4)); x.stroke(); }
          if (Math.random() < 0.35) { x.fillStyle = "rgba(110,60,25,.35)"; x.beginPath(); x.ellipse(xo + rnd(40, len - 40), r * ph + ph / 2, rnd(6, 12), rnd(3, 6), 0, 0, 7); x.fill(); }
          x.fillStyle = "rgba(60,30,10,.55)"; x.fillRect(xo, r * ph, 3, ph); xo += len; }
        x.fillStyle = "rgba(60,30,10,.5)"; x.fillRect(0, r * ph, w, 3);
      }
      const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "rgba(255,255,255,.06)"); g.addColorStop(1, "rgba(0,0,0,.06)"); x.fillStyle = g; x.fillRect(0, 0, w, h);
    }, rep || [4, 4]);
  }
  function noiseTex(T, key, base, cols, rep, opts) {
    opts = opts || {};
    return canvasTex(T, key, 512, 512, (x, w, h) => {
      x.fillStyle = base; x.fillRect(0, 0, w, h);
      speckle(x, w, h, opts.n || 5000, cols, 0.6, opts.r || 2.2, opts.a || 0.5);
      if (opts.blades) { x.lineWidth = 1.2; for (let i = 0; i < 2600; i++) { x.strokeStyle = cols[i % cols.length]; x.globalAlpha = 0.5; const px = Math.random() * w, py = Math.random() * h; x.beginPath(); x.moveTo(px, py); x.lineTo(px + rnd(-2, 2), py - rnd(4, 9)); x.stroke(); } x.globalAlpha = 1; }
      if (opts.ripples) { x.strokeStyle = "rgba(255,255,255,.22)"; x.lineWidth = 3; for (let i = 0; i < 26; i++) { x.beginPath(); const y0 = i * 20 + rnd(-4, 4); x.moveTo(0, y0); for (let k = 0; k <= 32; k++) x.lineTo(k * 16, y0 + Math.sin(k * 0.7 + i) * 5); x.stroke(); } }
      if (opts.tiles) { x.strokeStyle = "rgba(120,100,140,.25)"; x.lineWidth = 3; for (let k = 0; k <= 4; k++) { x.beginPath(); x.moveTo(k * 128, 0); x.lineTo(k * 128, h); x.stroke(); x.beginPath(); x.moveTo(0, k * 128); x.lineTo(w, k * 128); x.stroke(); } }
    }, rep || [6, 6]);
  }

  /* ---------------- the student: detailed 3D character in the real school uniform ----------------
     white hijab framing the face, long-sleeve white shirt, long pleated navy pinafore, white sneakers */
  function paintFace(blink) {
    const W = 2048, H = 1024, c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
    const cx = 512, cy = 512;
    x.fillStyle = "#F2C4A0"; x.fillRect(0, 0, W, H);
    let g = x.createRadialGradient(cx, cy - 20, 60, cx, cy, 520); g.addColorStop(0, "rgba(255,226,206,.55)"); g.addColorStop(0.55, "rgba(255,226,206,0)"); g.addColorStop(1, "rgba(170,95,60,.30)"); x.fillStyle = g; x.fillRect(0, 0, W, H);
    // cheeks
    [-1, 1].forEach(s => { const gg = x.createRadialGradient(cx + s * 178, cy + 92, 4, cx + s * 178, cy + 92, 78); gg.addColorStop(0, "rgba(240,120,120,.55)"); gg.addColorStop(1, "rgba(240,120,120,0)"); x.fillStyle = gg; x.beginPath(); x.arc(cx + s * 178, cy + 92, 80, 0, 7); x.fill(); });
    // brows
    x.lineCap = "round";
    [-1, 1].forEach(s => { x.strokeStyle = "#4A2B1C"; x.lineWidth = 15; x.beginPath(); x.moveTo(cx + s * 52, cy - 108); x.quadraticCurveTo(cx + s * 108, cy - 140, cx + s * 168, cy - 112); x.stroke(); x.lineWidth = 9; x.beginPath(); x.moveTo(cx + s * 140, cy - 126); x.lineTo(cx + s * 172, cy - 110); x.stroke(); });
    // eyes
    [-1, 1].forEach(s => {
      const ex = cx + s * 106, ey = cy - 4;
      if (blink) { x.strokeStyle = "#2A1710"; x.lineWidth = 12; x.beginPath(); x.moveTo(ex - 58, ey + 4); x.quadraticCurveTo(ex, ey + 40, ex + 58, ey + 4); x.stroke();
        for (let k = 0; k < 3; k++) { x.lineWidth = 6; x.beginPath(); const lx = ex + s * (26 + k * 14); x.moveTo(lx, ey + 26 - k * 6); x.lineTo(lx + s * 12, ey + 40 - k * 4); x.stroke(); } return; }
      x.save(); x.beginPath(); x.ellipse(ex, ey, 62, 76, 0, 0, 7); x.closePath();
      x.fillStyle = "#FFFFFF"; x.fill(); x.clip();
      const sh = x.createLinearGradient(0, ey - 68, 0, ey + 10); sh.addColorStop(0, "rgba(120,90,90,.35)"); sh.addColorStop(1, "rgba(120,90,90,0)"); x.fillStyle = sh; x.fillRect(ex - 60, ey - 70, 120, 80);
      const ix = ex - s * 3, iy = ey + 12;
      const ig = x.createRadialGradient(ix, iy, 6, ix, iy, 50); ig.addColorStop(0, "#C98545"); ig.addColorStop(0.55, "#7A3F1C"); ig.addColorStop(0.9, "#3A1C0C"); ig.addColorStop(1, "#24110A"); x.fillStyle = ig; x.beginPath(); x.arc(ix, iy, 50, 0, 7); x.fill();
      x.strokeStyle = "rgba(255,210,150,.35)"; x.lineWidth = 2; for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; x.beginPath(); x.moveTo(ix + Math.cos(a) * 20, iy + Math.sin(a) * 20); x.lineTo(ix + Math.cos(a) * 38, iy + Math.sin(a) * 38); x.stroke(); }
      x.fillStyle = "#120806"; x.beginPath(); x.arc(ix, iy, 22, 0, 7); x.fill();
      x.fillStyle = "#FFFFFF"; x.beginPath(); x.arc(ix - 14, iy - 16, 12, 0, 7); x.fill(); x.beginPath(); x.arc(ix + 13, iy + 14, 5.5, 0, 7); x.fill();
      x.restore();
      x.strokeStyle = "#24130C"; x.lineWidth = 13; x.beginPath(); x.ellipse(ex, ey, 63, 77, 0, Math.PI * 1.06, Math.PI * 1.94); x.stroke();
      x.lineWidth = 7; for (let k = 0; k < 3; k++) { const a = Math.PI * (s > 0 ? 1.72 + k * 0.08 : 1.28 - k * 0.08); const px = ex + Math.cos(a) * 63, py = ey + Math.sin(a) * 77; x.beginPath(); x.moveTo(px, py); x.lineTo(px + s * 18, py - 14 + k * 3); x.stroke(); }
      x.strokeStyle = "rgba(60,30,20,.45)"; x.lineWidth = 3; x.beginPath(); x.ellipse(ex, ey, 62, 76, 0, Math.PI * 0.18, Math.PI * 0.82); x.stroke();
    });
    // nose
    x.strokeStyle = "rgba(170,95,65,.55)"; x.lineWidth = 6; x.beginPath(); x.moveTo(cx - 18, cy + 80); x.quadraticCurveTo(cx, cy + 92, cx + 18, cy + 80); x.stroke();
    x.fillStyle = "rgba(255,240,230,.7)"; x.beginPath(); x.ellipse(cx - 4, cy + 50, 7, 12, 0, 0, 7); x.fill();
    // smile
    x.fillStyle = "#8E2F3A"; x.beginPath(); x.moveTo(cx - 88, cy + 126); x.quadraticCurveTo(cx, cy + 146, cx + 88, cy + 126); x.quadraticCurveTo(cx, cy + 238, cx - 88, cy + 126); x.fill();
    x.save(); x.clip(); x.fillStyle = "#FFFFFF"; x.beginPath(); x.moveTo(cx - 84, cy + 124); x.quadraticCurveTo(cx, cy + 144, cx + 84, cy + 124); x.lineTo(cx + 84, cy + 152); x.quadraticCurveTo(cx, cy + 172, cx - 84, cy + 152); x.fill();
    x.fillStyle = "#E86F7C"; x.beginPath(); x.ellipse(cx, cy + 178, 36, 14, 0, 0, 7); x.fill(); x.restore();
    x.strokeStyle = "#B4505A"; x.lineWidth = 5; x.beginPath(); x.moveTo(cx - 90, cy + 124); x.quadraticCurveTo(cx, cy + 238, cx + 90, cy + 124); x.stroke();
    x.strokeStyle = "rgba(150,70,60,.5)"; x.lineWidth = 4; [-1, 1].forEach(s => { x.beginPath(); x.arc(cx + s * 96, cy + 122, 10, s > 0 ? Math.PI * 1.1 : -0.1, s > 0 ? Math.PI * 1.6 : 0.4 - Math.PI * 0 + 0.0); x.stroke(); });
    return c;
  }
  function hijabMask(scale) {
    const c = document.createElement("canvas"); c.width = 512; c.height = 256; const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, 512, 256); x.fillStyle = "#000";
    x.beginPath(); x.ellipse(128, 150, 70 * scale, 66 * scale, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(128, 132, 64 * scale, 52 * scale, 0, 0, 7); x.fill();
    return c;
  }
  let FACE = null;
  function makeGirl(T) {
    if (!FACE) FACE = { open: paintFace(false), closed: paintFace(true), mask: hijabMask(1), mask2: hijabMask(1.08) };
    const g = new T.Group();
    const fabricW = new T.MeshPhysicalMaterial({ color: 0xF6F7FA, roughness: 0.82, sheen: 0.7, sheenRoughness: 0.55, sheenColor: new T.Color(0xFFFFFF) });
    const fabricN = new T.MeshPhysicalMaterial({ color: 0x18214D, roughness: 0.78, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new T.Color(0x6A78B8) });
    const skin = new T.MeshPhysicalMaterial({ color: 0xF2C4A0, roughness: 0.55, sheen: 0.25, sheenColor: new T.Color(0xFFB7A0), clearcoat: 0.05 });
    const faceOpen = new T.CanvasTexture(FACE.open), faceClosed = new T.CanvasTexture(FACE.closed);
    [faceOpen, faceClosed].forEach(t => { t.encoding = T.sRGBEncoding; t.anisotropy = 8; });
    const faceM = new T.MeshPhysicalMaterial({ map: faceOpen, roughness: 0.5, sheen: 0.25, sheenColor: new T.Color(0xFFB7A0), clearcoat: 0.08, clearcoatRoughness: 0.6 });
    const sh = o => { o.castShadow = true; o.receiveShadow = true; return o; };
    // pleated pinafore skirt
    const dressPts = [[0.001, 0], [0.5, 0.0], [0.52, 0.05], [0.47, 0.45], [0.4, 0.85], [0.34, 1.12], [0.32, 1.22], [0.001, 1.24]].map(p => new T.Vector2(p[0], p[1]));
    const dg = new T.LatheGeometry(dressPts, 96); const dp = dg.attributes.position;
    for (let i = 0; i < dp.count; i++) { const px = dp.getX(i), py = dp.getY(i), pz = dp.getZ(i), r = Math.hypot(px, pz); if (r < 0.01) continue; const a = Math.atan2(pz, px), k = Math.max(0, 1 - py / 1.15); const f = 1 + 0.045 * k * Math.sin(a * 24) + 0.012 * Math.sin(a * 7 + 1); dp.setX(i, px * f); dp.setZ(i, pz * f); }
    dg.computeVertexNormals();
    const dress = sh(new T.Mesh(dg, fabricN)); dress.position.y = 0.12; g.add(dress);
    const hemBand = new T.Mesh(new T.TorusGeometry(0.505, 0.012, 6, 96), fabricN); hemBand.rotation.x = Math.PI / 2; hemBand.position.y = 0.15; g.add(hemBand);
    // shirt torso + pinafore bib & straps
    const torso = sh(new T.Mesh(new T.CapsuleGeometry(0.29, 0.36, 10, 32), fabricW)); torso.position.y = 1.5; torso.scale.set(1, 1, 0.76); g.add(torso);
    const bibShape = new T.Shape(); bibShape.moveTo(-0.24, 0); bibShape.lineTo(0.24, 0); bibShape.lineTo(0.2, 0.36); bibShape.quadraticCurveTo(0, 0.4, -0.2, 0.36); bibShape.closePath();
    const bib = sh(new T.Mesh(new T.ExtrudeGeometry(bibShape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 }), fabricN)); bib.position.set(0, 1.3, 0.2); bib.rotation.x = -0.06; g.add(bib);
    const btnM = new T.MeshStandardMaterial({ color: 0xD9B45A, metalness: 0.8, roughness: 0.25 });
    [-1, 1].forEach(s => { const b = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.012, 16), btnM); b.rotation.x = Math.PI / 2; b.position.set(0.15 * s, 1.63, 0.245); g.add(b);
      const strap = sh(new T.Mesh(new T.BoxGeometry(0.07, 0.5, 0.025), fabricN)); strap.position.set(0.17 * s, 1.66, 0.04); strap.rotation.x = -0.25; g.add(strap); });
    const belt = new T.Mesh(new T.TorusGeometry(0.325, 0.022, 8, 64), fabricN); belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.78, 1); belt.position.y = 1.32; g.add(belt);
    // arms: long white sleeves, cuffs, hands with thumb
    const armL = new T.Group(), armR = new T.Group();
    [armL, armR].forEach((a, i) => {
      const s = i ? -1 : 1;
      const slPts = [[0.001, 0.02], [0.095, 0.0], [0.105, -0.08], [0.095, -0.3], [0.085, -0.55], [0.088, -0.6], [0.001, -0.61]].map(p => new T.Vector2(p[0], p[1]));
      const sleeve = sh(new T.Mesh(new T.LatheGeometry(slPts, 32), fabricW)); a.add(sleeve);
      const cuff = new T.Mesh(new T.TorusGeometry(0.084, 0.014, 8, 32), fabricW); cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.585; a.add(cuff);
      const hand = new T.Group(); hand.position.y = -0.66; a.add(hand);
      const palm = sh(new T.Mesh(new T.SphereGeometry(0.068, 24, 16), skin)); palm.scale.set(0.85, 1.15, 0.6); hand.add(palm);
      const fingers = new T.Mesh(new T.CapsuleGeometry(0.05, 0.05, 6, 12), skin); fingers.scale.set(1, 1, 0.55); fingers.position.y = -0.07; hand.add(fingers);
      const thumb = new T.Mesh(new T.CapsuleGeometry(0.02, 0.05, 4, 10), skin); thumb.position.set(-0.05 * s, -0.015, 0.03); thumb.rotation.z = 0.6 * s; hand.add(thumb);
      const sphere = new T.Mesh(new T.SphereGeometry(0.088, 20, 14), fabricW); sphere.position.y = -0.04; a.add(sphere);
      a.position.set(0.335 * s, 1.72, 0); a.rotation.z = 0.1 * s; g.add(a);
    });
    // head: painted face + 3D nose, hijab shell with face opening, drape over shoulders
    const head = new T.Group(); head.position.y = 2.17; head.scale.setScalar(0.94); g.add(head);
    const face = new T.Mesh(new T.SphereGeometry(0.3, 64, 48), faceM); face.scale.set(0.92, 1.04, 0.9); face.castShadow = true; head.add(face);
    const nose = new T.Mesh(new T.SphereGeometry(0.024, 16, 12), faceM.clone()); nose.material.map = null; nose.material.color.set(0xF0BC96); nose.scale.set(0.85, 1.15, 0.55); nose.position.set(0, -0.052, 0.262); head.add(nose);
    const maskT = new T.CanvasTexture(FACE.mask), mask2T = new T.CanvasTexture(FACE.mask2);
    const hijIn = new T.Mesh(new T.SphereGeometry(0.322, 64, 40, 0, Math.PI * 2, 0, Math.PI * 0.86), Object.assign(fabricW.clone(), { alphaMap: maskT, alphaTest: 0.5, side: T.DoubleSide }));
    hijIn.position.z = -0.012; hijIn.castShadow = true; head.add(hijIn);
    const hijOut = new T.Mesh(new T.SphereGeometry(0.345, 64, 40, 0, Math.PI * 2, 0, Math.PI * 0.86), Object.assign(fabricW.clone(), { alphaMap: mask2T, alphaTest: 0.5, side: T.DoubleSide }));
    hijOut.position.set(0, 0.012, -0.03); hijOut.scale.set(1, 1.04, 1); hijOut.castShadow = true; head.add(hijOut);
    const drPts = [[0.1, 0.34], [0.18, 0.29], [0.27, 0.2], [0.35, 0.1], [0.38, 0.03], [0.36, -0.03], [0.3, -0.07]].map(p => new T.Vector2(p[0], p[1]));
    const drg = new T.LatheGeometry(drPts, 96); const drp = drg.attributes.position;
    for (let i = 0; i < drp.count; i++) { const px = drp.getX(i), py = drp.getY(i), pz = drp.getZ(i), a = Math.atan2(pz, px), k = Math.max(0, (0.3 - py) / 0.6); const f = 1 + 0.03 * k * Math.sin(a * 9) + 0.012 * k * Math.sin(a * 23); drp.setX(i, px * f); drp.setZ(i, pz * f * (pz > 0 ? 0.95 : 0.82)); if (pz < 0 && py < 0.1) { const b = Math.min(1, -pz / 0.3) * (0.1 - py) / 0.17; drp.setY(i, py - 0.28 * b); } }
    drg.computeVertexNormals();
    const drape = sh(new T.Mesh(drg, Object.assign(fabricW.clone(), { side: T.DoubleSide }))); drape.position.y = 1.62; g.add(drape);
    // white sneakers peeking from the hem
    const RB = window.THREEX && THREEX.RoundedBoxGeometry;
    const shoeM = new T.MeshPhysicalMaterial({ color: 0xFCFCFD, roughness: 0.35, clearcoat: 0.3 }), soleM = new T.MeshStandardMaterial({ color: 0xC9CED6, roughness: 0.6 }), laceM = new T.MeshStandardMaterial({ color: 0xB9C2CF, roughness: 0.5 });
    [-1, 1].forEach(s => { const shoe = new T.Group();
      const up = sh(new T.Mesh(RB ? new RB(0.2, 0.13, 0.36, 4, 0.06) : new T.BoxGeometry(0.2, 0.13, 0.36), shoeM)); up.position.y = 0.085; shoe.add(up);
      const sole = sh(new T.Mesh(RB ? new RB(0.215, 0.045, 0.375, 3, 0.02) : new T.BoxGeometry(0.215, 0.045, 0.375), soleM)); sole.position.y = 0.022; shoe.add(sole);
      for (let k = 0; k < 3; k++) { const l = new T.Mesh(new T.BoxGeometry(0.11, 0.012, 0.018), laceM); l.position.set(0, 0.152, 0.02 + k * 0.045); shoe.add(l); }
      shoe.position.set(0.14 * s, 0, 0.3); shoe.rotation.y = 0.08 * s; g.add(shoe); });
    // soft contact shadow
    const cs = document.createElement("canvas"); cs.width = cs.height = 128; { const x = cs.getContext("2d"); const gr = x.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, "rgba(20,30,40,.45)"); gr.addColorStop(1, "rgba(20,30,40,0)"); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); }
    const blob = new T.Mesh(new T.PlaneGeometry(1.6, 1.6), new T.MeshBasicMaterial({ map: new T.CanvasTexture(cs), transparent: true, depthWrite: false })); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.012; g.add(blob);
    const U = g.userData = { armL, armR, head, walk: 0, blinkT: 2 + Math.random() * 2, cheerT: 0, baseY: 0 };
    U.animate = (dt, moving) => {
      U.walk += dt * (moving ? 9 : 1.6);
      const sw = moving ? Math.sin(U.walk) * 0.5 : Math.sin(U.walk) * 0.035;
      armL.rotation.x = sw; armR.rotation.x = -sw;
      let lift = moving ? Math.abs(Math.sin(U.walk)) * 0.05 : Math.sin(U.walk * 0.8) * 0.006;
      dress.rotation.y = moving ? Math.sin(U.walk) * 0.06 : 0;
      head.rotation.z = Math.sin(U.walk * 0.5) * 0.035; head.rotation.y = moving ? 0 : Math.sin(U.walk * 0.35) * 0.12;
      if (U.cheerT > 0) { U.cheerT = Math.max(0, U.cheerT - dt); const k = Math.sin((1 - U.cheerT) * Math.PI); armL.rotation.z = 0.1 + 2.5 * k; armR.rotation.z = -0.1 - 2.5 * k; lift += Math.abs(Math.sin((1 - U.cheerT) * Math.PI * 2)) * 0.32; }
      else { armL.rotation.z = 0.1; armR.rotation.z = -0.1; }
      [dress, torso, bib, belt, hemBand, drape, head, armL, armR].forEach(o => { if (o.userData.y0 === undefined) o.userData.y0 = o.position.y; o.position.y = o.userData.y0 + lift; });
      g.children.forEach(o => { if (o.isGroup && o !== head && o !== armL && o !== armR) { if (o.userData.y0 === undefined) o.userData.y0 = o.position.y; o.position.y = o.userData.y0 + lift; } });
      blob.material.opacity = 1 - lift * 1.5;
      U.blinkT -= dt; if (U.blinkT < 0) { faceM.map = faceClosed; if (U.blinkT < -0.12) { faceM.map = faceOpen; U.blinkT = 2.4 + Math.random() * 2.6; } }
    };
    U.cheer = () => { U.cheerT = 1.1; };
    return g;
  }
  /* helper: place the student in any scene, idle-animated, cheering on success */
  function addGirl(st, x, z, ry, s) {
    const T = st.T, girl = makeGirl(T); girl.position.set(x, 0, z); girl.rotation.y = ry || 0; girl.scale.setScalar(s || 1); st.scene.add(girl);
    st.tick(dt => { if (!girl.userData.noIdle) girl.userData.animate(dt, false); });
    return girl;
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
    const st = makeStage(ui.stageHost, { fov: 48, exposure: 0.74, onResize: a => { st && (st.camera.position.z = a < 1 ? 15 : 11); } });
    const T = st.T, S = st.scene;
    S.background = new T.Color(0xEFF6F4); S.fog = new T.Fog(0xEFF6F4, 20, 40);
    st.camera.position.set(0, 6.5, 11); st.camera.lookAt(0, 2.2, -2);
    const floor = new T.Mesh(new T.PlaneGeometry(40, 30), std(T, 0xFFFFFF, { roughness: 0.55, map: woodTex(T, [5, 4]) })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
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
    const girl = makeGirl(T); girl.position.set(0, 0, 2.4); girl.rotation.y = 0; S.add(girl);
    const ring = new T.Mesh(new T.RingGeometry(0.55, 0.7, 40), new T.MeshBasicMaterial({ color: 0xEC7F16, transparent: true, opacity: 0.85 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; S.add(ring);
    const spark = sparkSystem(st);
    let opts = [], sel = 1, target = null, run;
    const home = new T.Vector3(0, 0, 2.4);
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
          if (ok) { girl.userData.cheer(); boards[k].userData.slate.material.color.set(0x1E9D63); spark(new T.Vector3(boards[k].position.x, 4, -5)); }
          else { boards[k].userData.slate.material.color.set(0xC9741A); shake(st, boards[k], 0.12); setTimeout(() => { boards[k].userData.slate.material.color.set(0x245A4A); target = home.clone(); }, 700); }
        } else { const a = target.after; target = null; girl.rotation.y = 0; a && a(); }
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
    const st = makeStage(ui.stageHost, { fov: 50, exposure: 0.7, sky: 0xBFF3FF, ground: 0x0E5A6B, onResize: a => { st && (st.camera.position.z = a < 1 ? 16 : 11.5); } });
    const T = st.T, S = st.scene;
    S.background = skyBg(T, "#7FD3E0", "#2C9AB2", "#0B4C66"); S.fog = new T.FogExp2(0x1E7F98, 0.035);
    st.camera.position.set(0, 4.5, 11.5); st.camera.lookAt(0, 1.6, 0);
    const sand = new T.Mesh(new T.PlaneGeometry(60, 40, 60, 40), std(T, 0xFFFFFF, { roughness: 1, map: noiseTex(T, 'sandw', '#E7CF9E', ['#F6E3B8', '#C9AE7A', '#FFF3D4'], [8, 6], { ripples: true }) })); sand.rotation.x = -Math.PI / 2;
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
    const st = makeStage(ui.stageHost, { fov: 52, exposure: 0.72, onResize: a => { st && (st.camera.position.y = a < 1 ? 7.5 : 5.5); } });
    const T = st.T, S = st.scene;
    S.background = skyBg(T, "#5DB3D6", "#BFE6F0", "#FBE3C1"); S.fog = new T.Fog(0xF6E2C4, 18, 48);
    st.camera.position.set(0, 5.5, 10.5);
    const world = new T.Group(); S.add(world);
    const sand = new T.Mesh(new T.PlaneGeometry(120, 220, 60, 110), std(T, 0xFFFFFF, { roughness: 1, map: noiseTex(T, 'sandd', '#E6C38E', ['#F3D7A6', '#C9A06A', '#D8B27C'], [20, 36]) })); sand.rotation.x = -Math.PI / 2;
    const p = sand.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); if (Math.abs(x) > 6) p.setZ(i, Math.sin(x * 0.3 + p.getY(i) * 0.1) * 0.8 * Math.min(1, (Math.abs(x) - 6) / 6)); } sand.geometry.computeVertexNormals(); sand.receiveShadow = true; sand.position.z = -90; world.add(sand);
    const road = new T.Mesh(new T.PlaneGeometry(3.2, 220), std(T, 0xFFFFFF, { roughness: 1, map: noiseTex(T, 'road', '#C49562', ['#A97C4C', '#D9AE7C', '#8E6A44'], [1, 60], { n: 9000, r: 3 }) })); road.rotation.x = -Math.PI / 2; road.position.set(0, 0.01, -90); road.receiveShadow = true; world.add(road);
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
    const ground = new T.Mesh(new T.PlaneGeometry(50, 30), std(T, 0xFFFFFF, { roughness: 0.95, map: noiseTex(T, 'grass', '#86C27A', ['#5FA35A', '#A6D88F', '#78B86A'], [10, 6], { blades: true }) })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; S.add(ground);
    const girl = addGirl(st, -6.1, 4.0, 0.5, 1.3);
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
        busy = true; if (tries === 0) score++; ui.score(score); ui.fb(pick(PRAISE), true); girl.userData.cheer();
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
    const floor = new T.Mesh(new T.PlaneGeometry(50, 30), std(T, 0xFFFFFF, { roughness: 0.85, map: noiseTex(T, 'concrete', '#9AA7AD', ['#7E8C93', '#B4BFC4', '#8C989E'], [8, 5], { n: 12000, r: 1.6 }) })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
    const girl = addGirl(st, 5.9, 3.5, -0.5, 1.2);
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
        c.userData.state = "ship"; score++; okLeft--; ui.score(score); ui.fb(pick(PRAISE), true); girl.userData.cheer(); c.userData.b.material.color.set(0x7FD1A6);
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
    island.material.map = noiseTex(T, 'grass', '#86C27A', ['#5FA35A', '#A6D88F', '#78B86A'], [6, 2], { blades: true }); island.material.color.set(0xFFFFFF);
    const girl = addGirl(st, 3.6, 3.0, -0.35, 1.2);
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
        girl.userData.cheer(); busy = true; opts3.forEach(g => g.visible = false);
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
    const st = makeStage(ui.stageHost, { fov: 46, exposure: 0.7, onResize: a => { st && (st.camera.position.z = a < 1 ? 15.5 : 11); } });
    const T = st.T, S = st.scene;
    S.background = new T.Color(0xF6F1FA);
    st.camera.position.set(0, 4.2, 11); st.camera.lookAt(0, 2.2, 0);
    const floor = new T.Mesh(new T.PlaneGeometry(40, 30), std(T, 0xFFFFFF, { roughness: 0.3, map: noiseTex(T, 'tiles', '#EEE8F4', ['#DCD3E8', '#FFFFFF'], [10, 8], { n: 3000, r: 1.2, a: 0.35, tiles: true }) })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
    const girl = addGirl(st, -2.7, 4.4, 0.35, 1.0);
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
        if (ok) { girl.userData.cheer(); p.visible = false; inCart++; count.userData.redraw(ar(inCart)); spark(to, 22); }
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
    _dev: { makeStage, makeGirl, addGirl },
    mount(host, unit, onDone) {
      if (!window.THREE) { host.innerHTML = '<div class="empty"><b>تعذّر تحميل اللعبة</b>تحقّقي من الاتصال ثم أعيدي فتح الصفحة.</div>'; return { destroy() {} }; }
      const fn = MAP[unit.game.type]; if (!fn) return { destroy() {} };
      const go = () => fn(host, unit, onDone || (() => {}));
      return go();
    }
  };
})();
