(function () {
"use strict";
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const AR = "٠١٢٣٤٥٦٧٨٩", ar = n => String(n).replace(/\d/g, d => AR[d]);
const ORD = ["", "الأولى", "الثانية", "الثالثة"];
const PRAISE = ["أحسنتِ! 🌟", "رائع يا بطلة ✨", "إجابة موفّقة 👏", "ممتاز! 💫", "تألّقتِ! 🎉", "بصيرة نافذة 🌿"];
const RETRY = ["قريبة! جرّبي مرة أخرى 🌱", "فكّري قليلًا وحاولي ثانية 💭", "لا بأس، المحاولة طريق التعلّم 🤍", "خذي نفسًا وجرّبي من جديد 🌸"];
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function toast(t) { const e = $("#toast"); e.textContent = t; e.classList.add("on"); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove("on"), 2600); }
function msg(el, t, ok) { el.innerHTML = t ? `<div class="msg ${ok ? "ok" : "bad"}">${esc(t)}</div>` : ""; }
const now = () => Date.now();
const fmtDate = t => { try { return new Date(t).toLocaleDateString("ar-OM", { day: "numeric", month: "long" }); } catch (e) { return ""; } };
const UNITS = window.BASIRA_UNITS || [];
const BOOK_URL = "books/lughati-g10-t1.pdf";

/* ================= DATA LAYER ================= */
const P = "basira_";
const DEFAULT_SITE = {
  desc: "«البصيرة» مبادرة قرائية وتعليمية لطالبات الصف العاشر في مدرسة نفيسة بنت الحسن، تشرف عليها الأستاذة عائشة الكحالي. تجمع المبادرة دروس كتاب «لغتي الجميلة» للفصل الدراسي الأول مشروحةً خطوة بخطوة، مع أنشطة تفاعلية واختبار تدريبي ولعبة مختلفة لكل وحدة. وتقرأ الطالبة كتبًا من المكتبة وتلخّصها في ورقة «تلخيص كتاب»، وتُنشر أجمل الأعمال في مشاركات الطالبات، وتتابع الأسرة رحلة ابنتها مع المعلمة.",
  goals: "تنمية عادة القراءة الواعية لدى طالبات الصف العاشر.\nتمكين الطالبة من دروس «لغتي الجميلة» بشرح متدرّج وأنشطة وتدريبات على نمط الاختبارات.\nتنمية مهارة التلخيص والتعبير الكتابي بلغة سليمة.\nغرس القيم والأخلاق الحميدة من خلال ما تقرؤه الطالبة.\nتعزيز الشراكة بين المدرسة والأسرة في متابعة الطالبة.\nتحفيز الطالبات بالنقاط والتكريم ونشر أعمالهن المتميزة.\nتوظيف التقنية والألعاب التفاعلية في تعلّم اللغة العربية."
};
const cfg = window.BASIRA || {}; const hasFB = !!(cfg.firebase && cfg.firebase.apiKey && window.firebase);
let db = null, auth = null, UID = null, IS_T = false;
const LS = { k: c => "basira:" + c, all(c) { try { return JSON.parse(localStorage.getItem(this.k(c)) || "{}"); } catch (e) { return {}; } }, save(c, o) { try { localStorage.setItem(this.k(c), JSON.stringify(o)); } catch (e) {} } };
const store = {
  async list(c, f) { if (db) { let q = db.collection(P + c); if (f) q = q.where(f[0], "==", f[1]); const s = await q.get(); return s.docs.map(d => ({ id: d.id, ...d.data() })); }
    return Object.entries(LS.all(c)).map(([id, v]) => ({ id, ...v })).filter(r => !f || r[f[0]] === f[1]); },
  async get(c, id) { if (db) { const d = await db.collection(P + c).doc(id).get(); return d.exists ? { id: d.id, ...d.data() } : null; } const o = LS.all(c); return o[id] ? { id, ...o[id] } : null; },
  async set(c, id, v) { if (db) return db.collection(P + c).doc(id).set(v); const o = LS.all(c); o[id] = v; LS.save(c, o); },
  async add(c, v) { if (db) { const r = await db.collection(P + c).add(v); return r.id; } const id = Math.random().toString(36).slice(2, 12); await this.set(c, id, v); return id; },
  async update(c, id, v) { if (db) return db.collection(P + c).doc(id).update(v); const o = LS.all(c); o[id] = { ...o[id], ...v }; LS.save(c, o); },
  async del(c, id) { if (db) return db.collection(P + c).doc(id).delete(); const o = LS.all(c); delete o[id]; LS.save(c, o); }
};
const byTime = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);

async function boot() {
  if (hasFB) {
    try {
      firebase.initializeApp(cfg.firebase); auth = firebase.auth(); db = firebase.firestore();
      await new Promise(res => { const un = auth.onAuthStateChanged(async u => { if (!u) { try { await auth.signInAnonymously(); } catch (e) { console.warn(e); res(); } return; } UID = u.uid; IS_T = !u.isAnonymous && !!u.email && u.email.toLowerCase() === String(cfg.teacherEmail || "").toLowerCase(); un(); res(); }); });
    } catch (e) { console.warn("firebase off", e); db = null; }
  }
  if (!db) {
    $("#demo").hidden = false;
    try { UID = localStorage.getItem("basira:uid"); } catch (e) {}
    if (!UID) { UID = "u" + Math.random().toString(36).slice(2, 12); try { localStorage.setItem("basira:uid", UID); } catch (e) {} }
    try { IS_T = sessionStorage.getItem("basira:t") === "1"; } catch (e) {}
  }
  renderAxes(); renderGamesGrid(); route(); refreshMe();
}

/* ================= ROUTER ================= */
const VIEWS = ["home", "units", "unit", "games", "about", "register", "library", "summary", "posts", "parents", "teacher"];
let current = null, gameInst = null;
function route() {
  let h = (location.hash || "#home").slice(1); let unitId = null, sub = "lessons";
  const m = h.match(/^(u[1-9])(?:-(lessons|acts|test|game))?$/); if (m) { unitId = m[1]; sub = m[2] || "lessons"; h = "unit"; }
  if (!VIEWS.includes(h)) h = "home";
  if (gameInst) { gameInst.destroy(); gameInst = null; }
  VIEWS.forEach(v => { $("#v-" + v).hidden = v !== h; });
  $$(".nav a").forEach(a => { const t = a.getAttribute("href").slice(1); if (t === h || (h === "unit" && t === "units")) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  $("#nav").classList.remove("open"); $("#menuT").setAttribute("aria-expanded", "false");
  if (current !== location.hash) window.scrollTo({ top: 0 }); current = location.hash;
  ({ home: loadHome, about: loadAbout, register: refreshMe, library: loadBooks, summary: loadSummary, posts: loadPosts, parents: loadParents, teacher: loadTeacher, unit: () => openUnit(unitId, sub) }[h] || (() => {}))();
}
window.addEventListener("hashchange", route);
$("#menuT").onclick = () => { const n = $("#nav"); n.classList.toggle("open"); $("#menuT").setAttribute("aria-expanded", n.classList.contains("open")); };

/* ================= UNITS ================= */
const AXES = [{ n: 1, name: "الوطن" }, { n: 2, name: "قضايا معاصرة" }, { n: 3, name: "العمل والصناعات" }];
let RESULTS = [];
async function myResults() { try { RESULTS = await store.list("results", ["uid", UID]); } catch (e) { RESULTS = []; } return RESULTS; }
function bestFor(uid) { const r = RESULTS.filter(x => x.unit === uid); return r.length ? Math.max(...r.map(x => Math.round(x.score / x.total * 100))) : null; }
function renderAxes() {
  const html = AXES.map(a => `<section class="axis a${a.n}"><div class="axis-h"><small>المحور ${["", "الأول", "الثاني", "الثالث"][a.n]}</small><b>${esc(a.name)}</b></div><div class="units">${UNITS.filter(u => u.axisN === a.n).map(u => {
    const best = bestFor(u.id);
    return `<a class="unit-card" href="#${u.id}"><div class="ucover"><img src="assets/units/${u.id}.jpg" alt="" loading="lazy"><span class="ulabel">الوحدة ${ORD[u.unitN]}</span></div><div class="num"><span>المحور ${["", "الأول", "الثاني", "الثالث"][u.axisN]} · ص ${ar(u.pages)}</span></div><h3>${esc(u.theme)}</h3><ul>${u.lessons.map(l => `<li>${esc(l.type)}: ${esc(l.title)}</li>`).join("")}</ul><div class="ft"><span class="chip-s">🎮 ${esc(BasiraGames.meta[u.game.type].name)}</span>${best != null ? `<span class="chip-s done-badge">✓ ${ar(best)}٪</span>` : `<span class="chip-s">📝 ${ar(u.test.length)} سؤالًا</span>`}</div></a>`;
  }).join("")}</div></section>`).join("");
  $("#axes").innerHTML = html; $("#axes2").innerHTML = html;
  const nL = UNITS.reduce((s, u) => s + u.lessons.length, 0); const st = $(".stats div:nth-child(2) b"); if (st) st.textContent = ar(nL);
}
function renderGamesGrid() {
  const ic = { board: "🧑‍🏫", dive: "🦪", route: "🐪", roots: "🔤", memory: "🖼️", sort: "✉️", conveyor: "🏭", tower: "🏰", shop: "🛒" };
  const bg = ["#0A6E79", "#4B4FA8", "#C0611A"];
  $("#gamesGrid").innerHTML = UNITS.map(u => `<a class="game-card" href="#${u.id}-game"><span class="gi gi-img" style="background:${bg[u.axisN - 1]}"><img src="assets/units/${u.id}.jpg" alt="" loading="lazy"><i>${ic[u.game.type]}</i></span><div><b>${esc(BasiraGames.meta[u.game.type].name)}</b><small>المحور ${["", "الأول", "الثاني", "الثالث"][u.axisN]} · الوحدة ${ORD[u.unitN]} · ${esc(u.theme)}</small></div></a>`).join("");
}
let U = null, curLesson = 0;
function openUnit(id, sub) {
  U = UNITS.find(u => u.id === id); if (!U) { location.hash = "units"; return; }
  const hero = $("#uHero"); hero.className = "unit-hero a" + U.axisN;
  hero.innerHTML = `<img class="u-art" src="assets/units/${U.id}.jpg" alt=""><div style="position:relative;z-index:1"><small>المحور ${["", "الأول", "الثاني", "الثالث"][U.axisN]}: ${esc(U.axis)} · الوحدة ${ORD[U.unitN]} · الصفحات ${ar(U.pages)}</small><h2>${esc(U.theme)}</h2></div><a class="pill-btn light back" href="#units">كل الوحدات</a>`;
  $$("#uTabs button").forEach(b => { b.setAttribute("aria-selected", b.dataset.t === sub); b.onclick = () => { location.hash = U.id + "-" + b.dataset.t; }; });
  ({ lessons: renderLessons, acts: renderActs, test: renderTest, game: renderGame }[sub])();
}

/* ---------- lessons ---------- */
const ORDL = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"];
function verseHTML(q) {
  const parts = q.split(/\s*(?:\.\.\.|…)\s*/).filter(Boolean);
  if (parts.length === 2 && !/^﴿/.test(q)) return `<div class="verse"><span>${esc(parts[0])}</span><span>${esc(parts[1])}</span></div>`;
  return `<blockquote class="${/^﴿/.test(q) ? "ayah" : "bq"}">${esc(q)}</blockquote>`;
}
function renderLessons() {
  const L = U.lessons; if (curLesson >= L.length) curLesson = 0;
  const l = L[curLesson];
  const pdfPage = (l.page || 1) + 3;
  const cards = l.cards || [];
  $("#uBody").innerHTML = `<div class="lesson-layout"><nav class="lesson-list" aria-label="دروس الوحدة">${L.map((x, i) => `<button class="lesson-link" data-i="${i}" aria-current="${i === curLesson}"><small>الدرس ${ORDL[i] || ar(i + 1)} · ${esc(x.type)}</small><b>${esc(x.title)}</b></button>`).join("")}</nav>
  <article class="lesson card">
    <div class="lesson-top"><span class="ltype">${esc(l.type)}</span><span class="muted" style="font-size:14px;font-weight:700">صفحة ${ar(l.page)} في الكتاب</span><a class="pill-btn soft" style="margin-inline-start:auto;padding:6px 14px" href="${BOOK_URL}#page=${pdfPage}" target="_blank" rel="noopener">افتحي صفحة الكتاب</a></div>
    <h3>${esc(l.title)}</h3>
    ${l.hook ? `<div class="hook"><span aria-hidden="true">✨</span><p>${esc(l.hook)}</p></div>` : ""}
    <p class="about">${esc(l.about || "")}</p>
    ${l.author && l.author.name ? `<div class="author"><span class="av" aria-hidden="true">${esc(l.author.name.trim().charAt(0))}</span><div><b>${esc(l.author.name)}</b>${l.author.bio ? `<p>${esc(l.author.bio)}</p>` : ""}</div></div>` : ""}
    ${l.idea ? `<div class="idea"><small>الفكرة العامة</small><p>${esc(l.idea)}</p></div>` : ""}
    ${cards.length ? `<div><div class="sub-h">الدرس في ${ar(cards.length)} بطاقات <span class="muted" style="font-size:14px;font-weight:700">اضغطي على البطاقة بعد قراءتها</span></div>
      <div class="lprog" aria-hidden="true"><i style="width:0%"></i></div>
      <div class="lcards">${cards.map((c, i) => `<section class="lcard" data-c="${i}" tabindex="0" role="button" aria-pressed="false"><header><span class="ic">${esc(c.icon || "📘")}</span><span class="n">${ar(i + 1)}</span><h4>${esc(c.title)}</h4><span class="tick" aria-hidden="true">✓</span></header>${c.quote ? verseHTML(c.quote) : ""}<p>${esc(c.text)}</p></section>`).join("")}</div></div>` : ""}
    ${l.table && l.table.rows && l.table.rows.length ? `<div><div class="sub-h">${esc(l.table.title || "جدول يلخّص الدرس")}</div><div class="ltable-wrap"><table class="ltable"><thead><tr>${(l.table.head || []).map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${l.table.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>` : ""}
    ${l.vocab && l.vocab.length ? `<div><div class="sub-h">معاني الكلمات <span class="muted" style="font-size:14px;font-weight:700">اضغطي على الكلمة لتري معناها</span></div><div class="vflip">${l.vocab.map(v => `<button class="vf" aria-pressed="false"><b>${esc(v.w)}</b><span>${esc(v.m)}</span></button>`).join("")}</div></div>` : ""}
    ${l.tip ? `<div class="tipbox">${esc(l.tip)}</div>` : ""}
    ${l.keyPoints && l.keyPoints.length ? `<div class="keys"><h4>⭐ احفظي هذه النقاط</h4><ul>${l.keyPoints.map(k => `<li>${esc(k)}</li>`).join("")}</ul></div>` : ""}
    ${l.check && l.check.length ? `<div><div class="sub-h">🎯 اختبري فهمك بسرعة</div><div class="qcheck">${l.check.map((q, qi) => `<div class="qc" data-q="${qi}"><h5>${esc(q.q)}</h5><div class="opts">${q.opts.map((o, k) => `<button class="opt" data-k="${k}">${esc(o)}</button>`).join("")}</div><div class="act-f"><button class="pill-btn ghost" data-show>أظهري الإجابة</button></div><div data-v></div></div>`).join("")}</div></div>` : ""}
    <div class="row">${curLesson > 0 ? `<button class="pill-btn ghost" data-nav="-1">→ الدرس السابق</button>` : ""}${curLesson < L.length - 1 ? `<button class="pill-btn orange" data-nav="1">الدرس التالي ←</button>` : `<a class="pill-btn orange" href="#${U.id}-acts">انتقلي إلى الأنشطة ←</a>`}</div>
  </article></div>`;
  $$(".lesson-link").forEach(b => b.onclick = () => { curLesson = +b.dataset.i; renderLessons(); scrollToBody(); });
  $$("[data-nav]").forEach(b => b.onclick = () => { curLesson += +b.dataset.nav; renderLessons(); scrollToBody(); });
  const prog = () => { const n = $$(".lcard.read").length; const bar = $(".lprog i"); if (bar) bar.style.width = (cards.length ? n / cards.length * 100 : 0) + "%"; if (n === cards.length && cards.length) toast("أحسنتِ! أنهيتِ بطاقات الدرس 🌟"); };
  $$(".lcard").forEach(c => { const t = () => { const on = !c.classList.contains("read"); c.classList.toggle("read", on); c.setAttribute("aria-pressed", on); prog(); }; c.onclick = t; c.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); t(); } }; });
  $$(".vf").forEach(b => b.onclick = () => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"));
  $$(".qc").forEach(box => {
    const q = l.check[+box.dataset.q]; const v = box.querySelector("[data-v]");
    const reveal = (msg) => { box._done = true; box.querySelectorAll(".opt").forEach(x => { if (+x.dataset.k === q.a) x.classList.add("right"); }); v.innerHTML = `<div class="verdict ok"><b>${msg}</b>${q.explain ? `<div class="explain">${esc(q.explain)}</div>` : ""}</div>`; };
    box.querySelectorAll(".opt").forEach(b => b.onclick = () => { if (box._done) return; const k = +b.dataset.k;
      if (k === q.a) { reveal(pick(PRAISE)); } else { b.classList.add("soft"); v.innerHTML = `<div class="verdict soft"><b>${pick(RETRY)}</b></div>`; } });
    box.querySelector("[data-show]").onclick = () => reveal("هذه هي الإجابة الصحيحة 👇");
  });
}
function scrollToBody() { const y = $("#uBody").getBoundingClientRect().top + window.scrollY - 100; window.scrollTo({ top: y, behavior: "smooth" }); }

/* ---------- activities ---------- */
const KIND = { mcq: "اختيار من متعدد", tf: "صواب أم خطأ", match: "توصيل", order: "ترتيب", classify: "تصنيف", fill: "أكملي الفراغ" };
function verdict(box, ok, explain, extra) {
  box.innerHTML = `<div class="verdict ${ok ? "ok" : "soft"}"><b>${ok ? pick(PRAISE) : pick(RETRY)}</b>${extra ? `<div>${extra}</div>` : ""}${explain ? `<div class="explain">${esc(explain)}</div>` : ""}</div>`;
}
function renderActs() {
  $("#uBody").innerHTML = `<div class="acts">${U.activities.map((a, i) => `<div class="act" data-a="${i}"></div>`).join("")}</div><div class="row" style="margin-top:18px;justify-content:center"><a class="pill-btn orange big" href="#${U.id}-test">ابدئي الاختبار التدريبي ←</a></div>`;
  U.activities.forEach((a, i) => mountAct($(`.act[data-a="${i}"]`), a, i));
}
function lessonName(n) { const l = U.lessons[(n || 1) - 1]; return l ? l.type + ": " + l.title : ""; }
function mountAct(el, a, i) {
  const head = `<div class="act-h"><span class="k">${KIND[a.kind] || ""}</span><span class="muted" style="font-size:13px">${esc(lessonName(a.lesson))}</span></div>`;
  if (a.kind === "mcq" || a.kind === "fill" || a.kind === "tf") {
    const opts = a.kind === "tf" ? [{ t: "صواب ✔", v: true }, { t: "خطأ ✘", v: false }] : a.opts.map((t, k) => ({ t, v: k }));
    const correct = a.kind === "tf" ? a.a : a.a;
    el.innerHTML = `${head}<h4>${esc(a.q).replace(/_{3,}/g, '<span style="border-bottom:2px dashed var(--orange);padding:0 22px"></span>')}</h4><div class="${a.kind === "tf" ? "tf" : "opts"}">${opts.map((o, k) => `<button class="opt" data-k="${k}" aria-pressed="false">${esc(o.t)}</button>`).join("")}</div><div class="act-f"><button class="pill-btn teal" data-check disabled>تحقّقي</button><button class="pill-btn soft" data-show>أظهري الإجابة</button></div><div data-v></div>`;
    let sel = null;
    el.querySelectorAll(".opt").forEach(b => b.onclick = () => { if (el._done) return; el.querySelectorAll(".opt").forEach(x => { x.setAttribute("aria-pressed", "false"); x.classList.remove("soft"); }); b.setAttribute("aria-pressed", "true"); sel = +b.dataset.k; el.querySelector("[data-check]").disabled = false; el.querySelector("[data-v]").innerHTML = ""; });
    const right = () => opts.findIndex(o => o.v === correct);
    el.querySelector("[data-check]").onclick = () => { if (sel == null) return; const ok = opts[sel].v === correct; const b = el.querySelector(`.opt[data-k="${sel}"]`);
      if (ok) { b.classList.add("right"); el._done = true; verdict(el.querySelector("[data-v]"), true, a.explain); } else { b.classList.add("soft"); verdict(el.querySelector("[data-v]"), false, ""); } };
    el.querySelector("[data-show]").onclick = () => { el._done = true; el.querySelectorAll(".opt").forEach(x => x.setAttribute("aria-pressed", "false")); el.querySelector(`.opt[data-k="${right()}"]`).classList.add("right"); el.querySelector("[data-v]").innerHTML = `<div class="verdict ok"><b>الإجابة الصحيحة: ${esc(opts[right()].t)}</b>${a.explain ? `<div class="explain">${esc(a.explain)}</div>` : ""}</div>`; };
  }
  else if (a.kind === "match") {
    const left = a.pairs.map((p, k) => ({ t: p[0], k })), rightCol = shuffle(a.pairs.map((p, k) => ({ t: p[1], k })));
    const colors = ["#0A6E79", "#EC7F16", "#D85F84", "#4B4FA8", "#1A8F5A", "#8E5A2B"];
    el.innerHTML = `${head}<h4>${esc(a.title)}</h4><p class="muted" style="margin:4px 0 0;font-size:14px">المسي عبارة من العمود الأول، ثم ما يناسبها من العمود الثاني.</p><div class="match"><div class="col">${left.map(x => `<button class="opt" data-l="${x.k}">${esc(x.t)}</button>`).join("")}</div><div class="col">${rightCol.map(x => `<button class="opt" data-r="${x.k}">${esc(x.t)}</button>`).join("")}</div></div><div class="act-f"><button class="pill-btn soft" data-show>أظهري الإجابة</button><button class="pill-btn ghost" data-reset>ابدئي من جديد</button></div><div data-v></div>`;
    let selL = null, made = 0, wrong = 0;
    el.querySelectorAll("[data-l]").forEach(b => b.onclick = () => { if (b.classList.contains("used")) return; el.querySelectorAll("[data-l]").forEach(x => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", "true"); selL = +b.dataset.l; });
    el.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { if (selL == null || b.classList.contains("used")) return; const lb = el.querySelector(`[data-l="${selL}"]`);
      if (+b.dataset.r === selL) { const c = colors[made % colors.length]; [lb, b].forEach(x => { x.classList.add("used", "right"); x.setAttribute("aria-pressed", "false"); x.insertAdjacentHTML("afterbegin", `<span class="pair-tag" style="background:${c}">${ar(made + 1)}</span>`); }); made++; selL = null; el.querySelector("[data-v]").innerHTML = "";
        if (made === left.length) verdict(el.querySelector("[data-v]"), true, "", wrong ? "" : "وصّلتِ كل الأزواج من المحاولة الأولى!"); }
      else { wrong++; b.classList.add("soft"); setTimeout(() => b.classList.remove("soft"), 700); verdict(el.querySelector("[data-v]"), false, ""); } });
    el.querySelector("[data-show]").onclick = () => { el.querySelector("[data-v]").innerHTML = `<div class="verdict ok"><b>الأزواج الصحيحة</b>${a.pairs.map(p => `<div>• ${esc(p[0])} ← ${esc(p[1])}</div>`).join("")}</div>`; };
    el.querySelector("[data-reset]").onclick = () => mountAct(el, a, i);
  }
  else if (a.kind === "order") {
    let cur = shuffle(a.items.map((t, k) => ({ t, k }))); if (cur.every((x, j) => x.k === j)) cur.reverse();
    const draw = (checked) => { el.querySelector("[data-list]").innerHTML = cur.map((x, j) => `<div class="order-item${checked && x.k === j ? " right" : ""}"><span class="n">${ar(j + 1)}</span><span>${esc(x.t)}</span><button data-up="${j}" aria-label="إلى الأعلى">▲</button><button data-down="${j}" aria-label="إلى الأسفل">▼</button></div>`).join("");
      el.querySelectorAll("[data-up]").forEach(b => b.onclick = () => { const j = +b.dataset.up; if (j > 0) { [cur[j - 1], cur[j]] = [cur[j], cur[j - 1]]; draw(); } });
      el.querySelectorAll("[data-down]").forEach(b => b.onclick = () => { const j = +b.dataset.down; if (j < cur.length - 1) { [cur[j + 1], cur[j]] = [cur[j], cur[j + 1]]; draw(); } }); };
    el.innerHTML = `${head}<h4>${esc(a.title)}</h4><p class="muted" style="margin:4px 0 0;font-size:14px">حرّكي العبارات بالسهمين حتى يصبح الترتيب صحيحًا.</p><div class="order-list" data-list></div><div class="act-f"><button class="pill-btn teal" data-check>تحقّقي</button><button class="pill-btn soft" data-show>أظهري الإجابة</button></div><div data-v></div>`;
    draw();
    el.querySelector("[data-check]").onclick = () => { const okN = cur.filter((x, j) => x.k === j).length; draw(true); verdict(el.querySelector("[data-v]"), okN === cur.length, "", okN === cur.length ? "" : `في مكانه الصحيح ${ar(okN)} من ${ar(cur.length)}. العبارات الخضراء صحيحة، رتّبي الباقي.`); };
    el.querySelector("[data-show]").onclick = () => { cur = a.items.map((t, k) => ({ t, k })); draw(true); el.querySelector("[data-v]").innerHTML = `<div class="verdict ok"><b>هذا هو الترتيب الصحيح</b></div>`; };
  }
  else if (a.kind === "classify") {
    const items = shuffle(a.items.map((x, k) => ({ t: x[0], g: x[1], k })));
    el.innerHTML = `${head}<h4>${esc(a.title)}</h4><p class="muted" style="margin:4px 0 0;font-size:14px">المسي العبارة، ثم المسي المجموعة التي تنتمي إليها.</p><div class="classify"><div class="pool" data-pool>${items.map(x => `<button class="chipbtn" data-c="${x.k}" aria-pressed="false">${esc(x.t)}</button>`).join("")}</div><div class="bins">${a.groups.map((g, gi) => `<div class="bin" data-g="${gi}" role="button" tabindex="0"><b>${esc(g)}</b><div data-in></div></div>`).join("")}</div></div><div class="act-f"><button class="pill-btn soft" data-show>أظهري الإجابة</button></div><div data-v></div>`;
    let sel = null, placed = 0, wrong = 0;
    el.querySelectorAll("[data-c]").forEach(b => b.onclick = () => { el.querySelectorAll("[data-c]").forEach(x => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", "true"); sel = +b.dataset.c; });
    const drop = bin => { if (sel == null) return; const it = items.find(x => x.k === sel), b = el.querySelector(`[data-c="${sel}"]`);
      if (it.g === +bin.dataset.g) { b.remove(); bin.querySelector("[data-in]").insertAdjacentHTML("beforeend", `<span class="opt right">${esc(it.t)}</span>`); sel = null; placed++; el.querySelector("[data-v]").innerHTML = ""; if (placed === items.length) verdict(el.querySelector("[data-v]"), true, "", wrong ? "" : "صنّفتِ كل العبارات من المحاولة الأولى!"); }
      else { wrong++; bin.style.borderColor = "#F0C89A"; setTimeout(() => bin.style.borderColor = "", 700); verdict(el.querySelector("[data-v]"), false, ""); } };
    el.querySelectorAll(".bin").forEach(bin => { bin.onclick = () => drop(bin); bin.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); drop(bin); } }; });
    el.querySelector("[data-show]").onclick = () => { el.querySelector("[data-v]").innerHTML = `<div class="verdict ok"><b>التصنيف الصحيح</b>${a.groups.map((g, gi) => `<div><b style="display:inline">${esc(g)}:</b> ${a.items.filter(x => x[1] === gi).map(x => esc(x[0])).join("، ")}</div>`).join("")}</div>`; };
  }
}

/* ---------- practice test ---------- */
function renderTest() {
  const Q = U.test; let i = 0, score = 0, firstTry = true, answered = false, sel = null; const wrongList = [];
  const box = $("#uBody");
  function draw() {
    if (i >= Q.length) return finish();
    const q = Q[i]; firstTry = true; answered = false; sel = null;
    box.innerHTML = `<div class="test-shell"><div class="test-top"><b>السؤال ${ar(i + 1)} من ${ar(Q.length)}</b><div class="bar-p"><i style="width:${i / Q.length * 100}%"></i></div><span class="stars">${ar(score)} ✓</span></div>
    <div class="act"><div class="act-h"><span class="k">الاختبار التدريبي</span><span class="muted" style="font-size:13px">${esc(lessonName(q.lesson))}</span></div><h4>${esc(q.q)}</h4><div class="opts">${q.opts.map((o, k) => `<button class="opt" data-k="${k}" aria-pressed="false">${esc(o)}</button>`).join("")}</div>
    <div class="act-f"><button class="pill-btn teal" data-check disabled>تحقّقي</button><button class="pill-btn soft" data-show>أظهري الإجابة</button><button class="pill-btn orange" data-next hidden>السؤال التالي ←</button></div><div data-v></div></div></div>`;
    box.querySelectorAll(".opt").forEach(b => b.onclick = () => { if (answered) return; box.querySelectorAll(".opt").forEach(x => { x.setAttribute("aria-pressed", "false"); x.classList.remove("soft"); }); b.setAttribute("aria-pressed", "true"); sel = +b.dataset.k; box.querySelector("[data-check]").disabled = false; box.querySelector("[data-v]").innerHTML = ""; });
    box.querySelector("[data-check]").onclick = () => { if (sel == null || answered) return; const b = box.querySelector(`.opt[data-k="${sel}"]`);
      if (sel === q.a) { answered = true; b.classList.add("right"); if (firstTry) score++; verdict(box.querySelector("[data-v]"), true, q.explain); done(); }
      else { firstTry = false; b.classList.add("soft"); verdict(box.querySelector("[data-v]"), false, ""); } };
    box.querySelector("[data-show]").onclick = () => { if (answered) return; answered = true; firstTry = false; wrongList.push(i); box.querySelectorAll(".opt").forEach(x => x.setAttribute("aria-pressed", "false")); box.querySelector(`.opt[data-k="${q.a}"]`).classList.add("right"); box.querySelector("[data-v]").innerHTML = `<div class="verdict ok"><b>الإجابة الصحيحة: ${esc(q.opts[q.a])}</b><div class="explain">${esc(q.explain)}</div></div>`; done(); };
    function done() { if (!firstTry && !wrongList.includes(i)) wrongList.push(i); box.querySelector("[data-check]").hidden = true; box.querySelector("[data-show]").hidden = true; const n = box.querySelector("[data-next]"); n.hidden = false; n.textContent = i === Q.length - 1 ? "اعرضي النتيجة ←" : "السؤال التالي ←"; n.onclick = () => { i++; draw(); }; n.focus(); }
  }
  async function finish() {
    const pct = Math.round(score / Q.length * 100);
    const col = pct >= 85 ? "var(--ok)" : pct >= 60 ? "var(--orange)" : "var(--rose)";
    box.innerHTML = `<div class="test-shell"><div class="card result"><div class="ring" style="background:conic-gradient(${col} ${pct}%,var(--line) 0)"><span>${ar(pct)}٪</span></div><h3 style="font-size:26px;font-weight:900">${pct >= 85 ? "ممتاز! أتقنتِ الوحدة 🏆" : pct >= 60 ? "أحسنتِ، وبقي القليل 🌟" : "بداية طيبة، راجعي الدروس وأعيدي المحاولة 🌱"}</h3><p class="muted" style="margin:0">أجبتِ ${ar(score)} من ${ar(Q.length)} من المحاولة الأولى.</p>
    ${wrongList.length ? `<div style="text-align:start;width:100%"><div class="sub-h" style="margin-top:8px">راجعي هذه الأسئلة</div><ul>${wrongList.map(k => `<li>${esc(Q[k].q)} <b style="color:var(--ok)">← ${esc(Q[k].opts[Q[k].a])}</b></li>`).join("")}</ul></div>` : ""}
    <div class="row" style="justify-content:center"><button class="pill-btn orange" data-again>أعيدي الاختبار</button><a class="pill-btn ghost" href="#${U.id}-game">العبي لعبة الوحدة</a></div><div data-save class="muted" style="font-size:14px"></div></div></div>`;
    box.querySelector("[data-again]").onclick = renderTest;
    const sv = box.querySelector("[data-save]");
    if (!ME) { sv.innerHTML = `سجّلي اسمك لتُحفظ نتيجتك وتراها المعلمة. <a href="#register">سجّلي الآن</a>`; return; }
    try { await store.add("results", { uid: UID, name: ME.name, cls: ME.cls, unit: U.id, kind: "test", score, total: Q.length, createdAt: now() }); sv.textContent = "حُفظت نتيجتك ✓"; myResults(); }
    catch (e) { sv.textContent = "لم تُحفظ النتيجة الآن، تأكدي من الاتصال."; }
  }
  draw();
}

/* ---------- game ---------- */
function renderGame() {
  $("#uBody").innerHTML = `<div class="game-box" id="gameBox"></div><p class="note" style="margin-top:12px">${esc(BasiraGames.meta[U.game.type].how)} تعمل اللعبة على الجوال والحاسوب.</p>`;
  const unit = U;
  const start = () => { gameInst = BasiraGames.mount($("#gameBox"), unit, async (score, total) => {
    if (!ME) return; try { await store.add("results", { uid: UID, name: ME.name, cls: ME.cls, unit: unit.id, kind: "game", score, total, createdAt: now() }); } catch (e) {} }); };
  if (document.fonts && document.fonts.load) Promise.race([document.fonts.load('800 40px "Tajawal"'), new Promise(r => setTimeout(r, 1500))]).then(start); else start();
}

/* ================= ME ================= */
let ME = null;
async function refreshMe() {
  try { ME = await store.get("students", UID); } catch (e) { ME = null; }
  $("#meTxt").textContent = ME ? ME.name.split(" ")[0] : "تسجيل الطالبات";
  await myResults(); renderAxes();
  if (ME) {
    $("#fPts").textContent = ar(ME.points || 0) + " نقطة";
    $("#regBox").innerHTML = `<div class="msg ok">أنتِ مسجّلة باسم «${esc(ME.name)}». تُحفظ الآن نتائج اختباراتك وألعابك.</div><div class="row" style="margin-top:14px"><a class="pill-btn orange" href="#units">ادرسي الوحدات</a><a class="pill-btn ghost" href="#summary">اكتبي تلخيصًا</a></div>`;
    const tests = RESULTS.filter(r => r.kind === "test").sort(byTime);
    $("#meInfo").innerHTML = `<div style="display:flex;gap:14px;align-items:center"><span style="width:64px;height:64px;border-radius:20px;background:var(--rose-l);color:#A33A5B;display:grid;place-items:center;font-size:28px;font-weight:900">${esc(ME.name.trim()[0] || "")}</span><div><b style="font-size:20px;color:var(--ink)">${esc(ME.name)}</b><br>الصف ${esc(ME.cls)}</div></div><div style="margin-top:12px;font-weight:800;color:var(--ink)">نقاط البصيرة: <span class="stars">${ar(ME.points || 0)} ★</span></div>
    <div style="margin-top:10px">${tests.length ? `<table class="res-table"><thead><tr><th>الوحدة</th><th>الدرجة</th><th>التاريخ</th></tr></thead><tbody>${tests.slice(0, 12).map(r => { const u = UNITS.find(x => x.id === r.unit); return `<tr><td>${u ? esc(u.theme) : ""}</td><td><b>${ar(r.score)}/${ar(r.total)}</b></td><td>${fmtDate(r.createdAt)}</td></tr>`; }).join("")}</tbody></table>` : `<span class="muted">لم تحلّي اختبارًا تدريبيًّا بعد.</span>`}</div>`;
  }
}
$("#regForm").addEventListener("submit", async e => {
  e.preventDefault(); const name = $("#rName").value.trim().replace(/\s+/g, " "), cls = $("#rCls").value;
  if (name.split(" ").length < 2) { msg($("#regMsg"), "اكتبي اسمك واسم والدك على الأقل."); return; }
  try { await store.set("students", UID, { name, cls, createdAt: now() }); toast("حُفظ اسمك"); refreshMe(); }
  catch (err) { msg($("#regMsg"), "لم يُحفظ الاسم. تأكدي من اتصال الإنترنت ثم حاولي مرة أخرى."); }
});

/* ================= HOME / ABOUT ================= */
async function siteData() { try { const s = await store.get("site", "main"); return { ...DEFAULT_SITE, ...(s || {}) }; } catch (e) { return DEFAULT_SITE; } }
function loadHome() { renderAxes(); }
async function loadAbout() { const s = await siteData(); $("#aboutDesc").textContent = s.desc; $("#aboutGoals").innerHTML = s.goals.split("\n").filter(x => x.trim()).map((g, i) => `<div class="goal"><span class="n">${ar(i + 1)}</span><span>${esc(g)}</span></div>`).join(""); }

/* ================= BOOKS ================= */
const COVERS = ["linear-gradient(160deg,#0A6E79,#13919C)", "linear-gradient(160deg,#EC7F16,#F3A24B)", "linear-gradient(160deg,#C84A72,#E0688A)", "linear-gradient(160deg,#4B4FA8,#6D72C7)"];
const FIXED_BOOKS = [{ title: "لغتي الجميلة · الصف العاشر · الفصل الدراسي الأول", author: "وزارة التعليم – سلطنة عُمان", desc: "كتاب الطالبة كاملًا: المحاور الثلاثة والوحدات التسع. افتحيه للقراءة أو للرجوع إلى صفحة أي درس.", url: BOOK_URL, color: 0, fixed: true }];
async function loadBooks() {
  const el = $("#books"); let b = []; try { b = (await store.list("books")).sort(byTime); } catch (e) {}
  b = FIXED_BOOKS.concat(b);
  el.innerHTML = b.map((x, i) => `<div class="card book"><div class="cover" style="background:${COVERS[(x.color ?? i) % 4]}">${esc(x.title.split("·")[0].slice(0, 34))}</div><div class="info"><h3>${esc(x.title)}</h3>${x.author ? `<span class="muted" style="font-size:14px">${esc(x.author)}</span>` : ""}<p>${esc(x.desc || "")}</p><div class="row" style="margin-top:auto">${x.url ? `<a class="pill-btn teal" href="${esc(x.url)}" target="_blank" rel="noopener">اقرئي الكتاب</a>` : ""}${x.fixed ? `<a class="pill-btn ghost" href="#units">الدروس مشروحة</a>` : `<a class="pill-btn ghost" href="#summary" data-book="${esc(x.title)}">لخّصيه</a>`}</div></div></div>`).join("");
  $$("#books [data-book]").forEach(a => a.addEventListener("click", () => setTimeout(() => { $("#sBook").value = a.dataset.book; }, 60)));
}

/* ================= SUMMARY ================= */
async function loadSummary() {
  await refreshMe();
  $("#sumName").textContent = ME ? ME.name : "سجّلي اسمك أولًا"; $("#sumName").className = ME ? "" : "muted"; $("#sumCls").textContent = ME ? ME.cls : "…/…";
  const el = $("#mySums"); let s = []; try { s = (await store.list("summaries", ["uid", UID])).sort(byTime); } catch (e) {}
  el.innerHTML = s.length ? s.map(x => `<div class="li"><div class="grow"><b>${esc(x.book)}</b><br><span class="muted" style="font-size:14px">${esc(x.author)} · ${fmtDate(x.createdAt)}</span></div><span class="status ${x.status === "published" ? "approved" : "pending"}">${x.status === "published" ? "نُشر في المشاركات" : "وصل للمعلمة"}</span></div>`).join("") : `<p class="muted" style="margin:6px 0 0">لم ترسلي تلخيصًا بعد.</p>`;
}
$("#sumForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!ME) { msg($("#sumMsg"), "سجّلي اسمك أولًا من صفحة التسجيل."); return; }
  const v = { uid: UID, name: ME.name, cls: ME.cls, book: $("#sBook").value.trim(), author: $("#sAuthor").value.trim(), text: $("#sText").value.trim(), status: "new", createdAt: now() };
  if (v.text.length < 40) { msg($("#sumMsg"), "التلخيص قصير. اكتبي فقرة أو أكثر."); return; }
  try { await store.add("summaries", v); $("#sumForm").reset(); msg($("#sumMsg"), "أُرسل تلخيصك إلى المعلمة. أحسنتِ!", true); loadSummary(); } catch (err) { msg($("#sumMsg"), "لم يُرسل التلخيص. تأكدي من الاتصال ثم أعيدي المحاولة."); }
});

/* ================= POSTS ================= */
async function loadPosts() {
  const el = $("#posts"); let p = []; try { p = (await store.list("posts")).sort(byTime); } catch (e) {}
  if (!p.length) { el.style.columns = "auto"; el.innerHTML = `<div class="empty"><b>لا توجد مشاركات منشورة بعد</b>حين تختار المعلمة أعمالًا متميزة، تظهر هنا بأسماء صاحباتها.</div>`; return; }
  el.style.columns = "";
  el.innerHTML = p.map(x => `<article class="post">${x.img ? `<img src="${x.img}" alt="">` : ""}<div class="pb"><span class="kind">${esc(x.kind || "مشاركة")}</span><h3>${esc(x.title)}</h3><div class="by"><span class="av">${esc((x.name || " ").trim()[0])}</span>${esc(x.name)}</div>${x.text ? `<p>${esc(x.text)}</p>` : ""}</div></article>`).join("");
}

/* ================= PARENTS ================= */
async function loadParents() {
  let req = null; try { req = await store.get("parents", UID); } catch (e) {}
  if (req) {
    $("#parentReq").innerHTML = `<h3 style="font-size:20px;font-weight:900">طلبك</h3><p style="margin:8px 0">${esc(req.pname)} (${esc(req.rel)}) · متابعة الطالبة <b>${esc(req.sname)}</b></p><span class="status ${req.status}">${{ pending: "بانتظار موافقة المعلمة", approved: "تمت الموافقة", rejected: "لم تتم الموافقة" }[req.status]}</span>${req.status === "rejected" ? `<p class="muted" style="margin-top:10px">تواصل مع المعلمة عبر المدرسة إن كان هناك خطأ.</p>` : ""}`;
    if (req.status === "approved") showParentView(req); else $("#parentView").hidden = true; return;
  }
  let st = []; try { st = (await store.list("students")).sort((a, b) => a.name.localeCompare(b.name, "ar")); } catch (e) {}
  $("#pStu").innerHTML = st.length ? `<option value="">اختر من القائمة</option>` + st.map(s => `<option value="${s.id}">${esc(s.name)} — ${esc(s.cls)}</option>`).join("") : `<option value="">لم تسجّل أي طالبة بعد</option>`;
  $("#pStu")._st = st;
}
$("#parForm").addEventListener("submit", async e => {
  e.preventDefault(); const sid = $("#pStu").value; const s = ($("#pStu")._st || []).find(x => x.id === sid); if (!s) { msg($("#parMsg"), "اختر ابنتك من القائمة."); return; }
  try { await store.set("parents", UID, { pname: $("#pName").value.trim(), rel: $("#pRel").value, sid, sname: s.name, status: "pending", createdAt: now() }); toast("أُرسل الطلب إلى المعلمة"); loadParents(); } catch (err) { msg($("#parMsg"), "لم يُرسل الطلب. أعد المحاولة بعد قليل."); }
});
async function showParentView(req) {
  const v = $("#parentView"); v.hidden = false;
  let st = null, notes = [], res = []; try { st = await store.get("students", req.sid); } catch (e) {} try { notes = (await store.list("notes", ["sid", req.sid])).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); } catch (e) {} try { res = (await store.list("results", ["uid", req.sid])).filter(r => r.kind === "test").sort(byTime); } catch (e) {}
  v.innerHTML = `<div class="row" style="justify-content:space-between"><h3 style="font-size:22px;font-weight:900">متابعة ${esc(req.sname)}</h3>${st ? `<span class="stars" style="font-size:18px">نقاط البصيرة: ${ar(st.points || 0)} ★</span>` : ""}</div>
  <div class="sub-h" style="margin-top:14px">نتائج الاختبارات التدريبية</div>${res.length ? `<div class="tbl"><table class="res-table"><thead><tr><th>الوحدة</th><th>الدرجة</th><th>التاريخ</th></tr></thead><tbody>${res.map(r => { const u = UNITS.find(x => x.id === r.unit); return `<tr><td>${u ? esc(u.theme) : ""}</td><td><b>${ar(r.score)}/${ar(r.total)}</b></td><td>${fmtDate(r.createdAt)}</td></tr>`; }).join("")}</tbody></table></div>` : `<p class="muted">لم تحلّ اختبارًا بعد.</p>`}
  <div class="sub-h" style="margin-top:14px">ملاحظات المعلمة</div><div class="notes">${notes.length ? notes.map(n => `<div class="bubble ${n.from === "parent" ? "p" : "t"}"><small>${n.from === "parent" ? "أنت" : "أ. عائشة الكحالي"} · ${fmtDate(n.createdAt)}</small>${esc(n.text)}</div>`).join("") : `<p class="muted">لا توجد ملاحظات بعد.</p>`}</div>
  <form class="form" id="pNoteF" style="margin-top:14px"><div class="field"><label for="pNote">ملاحظة للمعلمة</label><textarea id="pNote" maxlength="600" style="min-height:80px" required></textarea></div><button class="pill-btn teal" type="submit">أرسل الملاحظة</button></form>`;
  $("#pNoteF").onsubmit = async e => { e.preventDefault(); try { await store.add("notes", { sid: req.sid, from: "parent", uid: UID, text: $("#pNote").value.trim(), createdAt: now() }); toast("وصلت ملاحظتك"); showParentView(req); } catch (err) { toast("لم تُرسل الملاحظة"); } };
}

/* ================= TEACHER ================= */
async function loadTeacher() {
  $("#tLogin").hidden = IS_T; $("#tPanel").hidden = !IS_T;
  if (!db) { $("#tEmail").closest(".field").hidden = true; $("#tPass").placeholder = "كلمة السر التجريبية: 1234"; }
  if (IS_T) { $("#tWho").textContent = db ? ("مسجّلة الدخول: " + (auth.currentUser.email || "")) : "وضع تجريبي"; openTab(curTab); }
}
$("#tForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!db) { if ($("#tPass").value === "1234") { IS_T = true; try { sessionStorage.setItem("basira:t", "1"); } catch (e) {} loadTeacher(); } else msg($("#tMsg"), "كلمة السر غير صحيحة."); return; }
  try { const c = await auth.signInWithEmailAndPassword($("#tEmail").value.trim(), $("#tPass").value); UID = c.user.uid; IS_T = c.user.email.toLowerCase() === String(cfg.teacherEmail).toLowerCase(); if (!IS_T) { msg($("#tMsg"), "هذا الحساب ليس حساب المعلمة."); return; } loadTeacher(); }
  catch (err) { msg($("#tMsg"), "البريد أو كلمة السر غير صحيحة."); }
});
$("#tOut").onclick = async () => { IS_T = false; try { sessionStorage.removeItem("basira:t"); } catch (e) {} if (db) { await auth.signOut(); await auth.signInAnonymously(); UID = auth.currentUser.uid; } loadTeacher(); };
let curTab = "stu";
$$("#tTabs button").forEach(b => b.onclick = () => openTab(b.dataset.t));
function openTab(t) { curTab = t; $$("#tTabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.t === t)); $$("[data-p]").forEach(p => p.hidden = p.dataset.p !== t);
  ({ stu: tStudents, res: tResults, req: tRequests, sum: tSummaries, post: tPosts, book: tBooks, site: tSite }[t])(); badges(); }
async function badges() { try { const r = (await store.list("parents")).filter(x => x.status === "pending").length; $("#reqN").hidden = !r; $("#reqN").textContent = ar(r); } catch (e) {} try { const s = (await store.list("summaries")).filter(x => x.status === "new").length; $("#sumN").hidden = !s; $("#sumN").textContent = ar(s); } catch (e) {} }
async function tStudents() {
  const el = $("#tStu"); let st = [], notes = []; try { st = (await store.list("students")).sort((a, b) => a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name, "ar")); notes = await store.list("notes"); } catch (e) {}
  $("#stuNames").innerHTML = st.map(s => `<option value="${esc(s.name)}">`).join("");
  if (!st.length) { el.innerHTML = `<div class="empty"><b>لم تسجّل أي طالبة بعد</b>شاركي رابط الموقع مع الطالبات ليسجّلن أسماءهن.</div>`; return; }
  el.innerHTML = `<p class="muted" style="margin:0 0 6px">عدد المسجّلات: ${ar(st.length)}</p>` + st.map(s => { const n = notes.filter(x => x.sid === s.id); return `<div class="li" data-s="${s.id}"><div class="grow"><b>${esc(s.name)}</b><br><span class="muted" style="font-size:14px">الصف ${esc(s.cls)} · سُجّلت ${fmtDate(s.createdAt)}</span></div><span class="stars">${ar(s.points || 0)} ★</span><button class="mini o" data-a="plus">+ نقطة</button><button class="mini" data-a="minus">− نقطة</button><button class="mini" data-a="note">ملاحظة${n.length ? " (" + ar(n.length) + ")" : ""}</button><button class="mini no" data-a="del">حذف</button><div data-box style="flex-basis:100%" hidden></div></div>`; }).join("");
  el.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => { const row = b.closest("[data-s]"), id = row.dataset.s, s = st.find(x => x.id === id);
    if (b.dataset.a === "plus" || b.dataset.a === "minus") { await store.update("students", id, { points: Math.max(0, (s.points || 0) + (b.dataset.a === "plus" ? 1 : -1)) }); tStudents(); }
    if (b.dataset.a === "del") { if (b.dataset.c) { await store.del("students", id); tStudents(); } else { b.dataset.c = 1; b.textContent = "تأكيد الحذف"; } }
    if (b.dataset.a === "note") { const box = row.querySelector("[data-box]"); box.hidden = !box.hidden; if (box.hidden) return; const nn = notes.filter(x => x.sid === id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      box.innerHTML = `<div class="notes">${nn.map(n => `<div class="bubble ${n.from === "parent" ? "p" : "t"}"><small>${n.from === "parent" ? "ولي الأمر" : "أنتِ"} · ${fmtDate(n.createdAt)}</small>${esc(n.text)}</div>`).join("") || '<span class="muted">لا ملاحظات بعد.</span>'}</div><div class="row" style="margin-top:8px"><input style="flex:1;border:1.5px solid var(--line);border-radius:12px;padding:8px 12px;min-width:0" placeholder="ملاحظة تظهر لولي الأمر بعد الموافقة"><button class="mini ok">إرسال</button></div>`;
      const inp = box.querySelector("input"); box.querySelector(".mini.ok").onclick = async () => { if (!inp.value.trim()) return; await store.add("notes", { sid: id, from: "teacher", text: inp.value.trim(), createdAt: now() }); toast("حُفظت الملاحظة"); tStudents(); }; }
  });
}
async function tResults() {
  const el = $("#tRes"); let r = [], st = []; try { r = await store.list("results"); st = await store.list("students"); } catch (e) {}
  r = r.filter(x => x.kind === "test");
  if (!st.length) { el.innerHTML = `<div class="empty"><b>لا توجد نتائج بعد</b>تظهر هنا درجات الطالبات في الاختبارات التدريبية لكل وحدة.</div>`; return; }
  const best = (sid, u) => { const x = r.filter(y => y.uid === sid && y.unit === u); return x.length ? Math.max(...x.map(y => y.score)) : null; };
  el.innerHTML = `<table class="res-table"><thead><tr><th>الطالبة</th>${UNITS.map(u => `<th title="${esc(u.theme)}">و${ar(u.axisN)}/${ar(u.unitN)}</th>`).join("")}</tr></thead><tbody>${st.sort((a, b) => a.name.localeCompare(b.name, "ar")).map(s => `<tr><td><b>${esc(s.name)}</b><br><span class="muted" style="font-size:12.5px">${esc(s.cls)}</span></td>${UNITS.map(u => { const b = best(s.id, u.id); return `<td>${b == null ? '<span class="muted">—</span>' : `<b style="color:${b >= 10 ? "var(--ok)" : b >= 7 ? "var(--orange-d)" : "var(--rose)"}">${ar(b)}</b>`}</td>`; }).join("")}</tr>`).join("")}</tbody></table><p class="muted" style="font-size:13px">أعلى درجة من ١٢ في الاختبار التدريبي لكل وحدة (المحور/الوحدة).</p>`;
}
async function tRequests() {
  const el = $("#tReq"); let r = []; try { r = (await store.list("parents")).sort(byTime); } catch (e) {}
  if (!r.length) { el.innerHTML = `<div class="empty"><b>لا توجد طلبات</b>حين يطلب وليّ أمر متابعة ابنته يظهر طلبه هنا لتوافقي عليه.</div>`; return; }
  const L = { pending: "بانتظار الموافقة", approved: "موافَق", rejected: "مرفوض" };
  el.innerHTML = r.map(x => `<div class="li" data-r="${x.id}"><div class="grow"><b>${esc(x.pname)}</b> (${esc(x.rel)})<br><span class="muted" style="font-size:14px">يطلب متابعة: ${esc(x.sname)} · ${fmtDate(x.createdAt)}</span></div><span class="status ${x.status}">${L[x.status]}</span>${x.status !== "approved" ? '<button class="mini ok" data-a="approved">موافقة</button>' : ""}${x.status !== "rejected" ? '<button class="mini no" data-a="rejected">رفض</button>' : ""}</div>`).join("");
  el.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => { await store.update("parents", b.closest("[data-r]").dataset.r, { status: b.dataset.a }); toast(b.dataset.a === "approved" ? "تمت الموافقة" : "رُفض الطلب"); tRequests(); badges(); });
}
async function tSummaries() {
  const el = $("#tSum"); let s = []; try { s = (await store.list("summaries")).sort(byTime); } catch (e) {}
  if (!s.length) { el.innerHTML = `<div class="empty"><b>لا توجد تلخيصات بعد</b>تصلك هنا تلخيصات الطالبات من ورقة «تلخيص كتاب».</div>`; return; }
  el.innerHTML = s.map(x => `<div class="li" data-x="${x.id}" style="align-items:flex-start"><div class="grow"><b>${esc(x.book)}</b> — ${esc(x.author)}<br><span class="muted" style="font-size:14px">${esc(x.name)} · ${esc(x.cls)} · ${fmtDate(x.createdAt)}</span><p style="margin:8px 0 0;white-space:pre-line;color:var(--ink-2)">${esc(x.text)}</p></div>${x.status === "published" ? '<span class="status approved">منشور</span>' : '<button class="mini ok" data-a="pub">انشريه في المشاركات</button>'}<button class="mini no" data-a="del">حذف</button></div>`).join("");
  el.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => { const id = b.closest("[data-x]").dataset.x, x = s.find(y => y.id === id);
    if (b.dataset.a === "pub") { await store.add("posts", { name: x.name, kind: "تلخيص كتاب", title: x.book + " — " + x.author, text: x.text, createdAt: now() }); await store.update("summaries", id, { status: "published" }); toast("نُشر في المشاركات"); }
    else { if (!b.dataset.c) { b.dataset.c = 1; b.textContent = "تأكيد"; return; } await store.del("summaries", id); }
    tSummaries(); badges(); });
}
function shrink(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => { const im = new Image(); im.onload = () => { const k = Math.min(1, 900 / Math.max(im.width, im.height)); const c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", .72)); }; im.onerror = rej; im.src = fr.result; }; fr.onerror = rej; fr.readAsDataURL(file); }); }
async function tPosts() {
  let st = []; try { st = await store.list("students"); } catch (e) {} $("#stuNames").innerHTML = st.map(s => `<option value="${esc(s.name)}">`).join("");
  const el = $("#tPosts"); let p = []; try { p = (await store.list("posts")).sort(byTime); } catch (e) {}
  el.innerHTML = p.length ? p.map(x => `<div class="li" data-x="${x.id}"><div class="grow"><b>${esc(x.title)}</b><br><span class="muted" style="font-size:14px">${esc(x.name)} · ${esc(x.kind || "")}</span></div><button class="mini no" data-a="del">حذف</button></div>`).join("") : `<p class="muted">لا مشاركات منشورة.</p>`;
  el.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => { if (!b.dataset.c) { b.dataset.c = 1; b.textContent = "تأكيد"; return; } await store.del("posts", b.closest("[data-x]").dataset.x); tPosts(); });
}
$("#postForm").addEventListener("submit", async e => { e.preventDefault(); const f = $("#poImg").files[0]; let img = "";
  try { if (f) img = await shrink(f); await store.add("posts", { name: $("#poName").value.trim(), kind: $("#poKind").value, title: $("#poTitle").value.trim(), text: $("#poText").value.trim(), img, createdAt: now() }); $("#postForm").reset(); msg($("#poMsg"), "نُشرت المشاركة.", true); tPosts(); }
  catch (err) { msg($("#poMsg"), "لم تُنشر. إن كانت الصورة كبيرة جدًّا فجرّبي صورة أصغر."); } });
async function tBooks() { const el = $("#tBooks"); let b = []; try { b = (await store.list("books")).sort(byTime); } catch (e) {}
  el.innerHTML = `<p class="muted" style="font-size:14px">كتاب «لغتي الجميلة» موجود دائمًا في المكتبة. أضيفي هنا كتبًا أخرى للقراءة.</p>` + b.map(x => `<div class="li" data-x="${x.id}"><div class="grow"><b>${esc(x.title)}</b><br><span class="muted" style="font-size:14px;direction:ltr;unicode-bidi:isolate">${esc(x.url || "")}</span></div><button class="mini no" data-a="del">حذف</button></div>`).join("");
  el.querySelectorAll("[data-a]").forEach(btn => btn.onclick = async () => { if (!btn.dataset.c) { btn.dataset.c = 1; btn.textContent = "تأكيد"; return; } await store.del("books", btn.closest("[data-x]").dataset.x); tBooks(); }); }
$("#bookForm").addEventListener("submit", async e => { e.preventDefault(); try { await store.add("books", { title: $("#bTitle").value.trim(), author: $("#bAuthor").value.trim(), desc: $("#bDesc").value.trim(), url: $("#bUrl").value.trim(), color: 1 + Math.floor(Math.random() * 3), createdAt: now() }); $("#bookForm").reset(); msg($("#bMsg"), "أُضيف الكتاب إلى المكتبة.", true); tBooks(); } catch (err) { msg($("#bMsg"), "لم يُحفظ الكتاب."); } });
async function tSite() { const s = await siteData(); $("#sDesc").value = s.desc; $("#sGoals").value = s.goals; }
$("#siteForm").addEventListener("submit", async e => { e.preventDefault(); try { await store.set("site", "main", { desc: $("#sDesc").value.trim(), goals: $("#sGoals").value.trim() }); msg($("#siteMsg"), "حُفظ التوصيف والأهداف.", true); } catch (err) { msg($("#siteMsg"), "لم يُحفظ."); } });

boot();
})();
