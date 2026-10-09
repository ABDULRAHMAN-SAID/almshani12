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
/* Firestore never gives up on a write when the database is missing, so every call gets a time limit */
const TO = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r({ code: "timeout" }), ms || 15000))]);
const store = {
  async list(c, f) { if (db) { let q = db.collection(P + c); if (f) q = q.where(f[0], "==", f[1]); const s = await TO(q.get()); return s.docs.map(d => ({ id: d.id, ...d.data() })); }
    return Object.entries(LS.all(c)).map(([id, v]) => ({ id, ...v })).filter(r => !f || r[f[0]] === f[1]); },
  async get(c, id) { if (db) { const d = await TO(db.collection(P + c).doc(id).get()); return d.exists ? { id: d.id, ...d.data() } : null; } const o = LS.all(c); return o[id] ? { id, ...o[id] } : null; },
  async set(c, id, v) { if (db) return TO(db.collection(P + c).doc(id).set(v)); const o = LS.all(c); o[id] = v; LS.save(c, o); },
  async add(c, v) { if (db) { const r = await TO(db.collection(P + c).add(v)); return r.id; } const id = Math.random().toString(36).slice(2, 12); await this.set(c, id, v); return id; },
  async update(c, id, v) { if (db) return TO(db.collection(P + c).doc(id).update(v)); const o = LS.all(c); o[id] = { ...o[id], ...v }; LS.save(c, o); },
  async del(c, id) { if (db) return TO(db.collection(P + c).doc(id).delete()); const o = LS.all(c); delete o[id]; LS.save(c, o); }
};
const byTime = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);

/* ================= ACCOUNTS: triple name + PIN =================
   - the triple name is the username and cannot be registered twice
   - Firebase mode: the name maps to a hidden e-mail, the PIN to the password (Firebase Auth keeps the login)
   - roles: student / parent / teacher (teacher activated once with a code checked by the security rules) */
const ROLE_AR = { student: "طالبة", parent: "ولي أمر", teacher: "المعلمة" };
const normName = s => String(s || "").replace(/[ً-ْـ]/g, "").replace(/\s+/g, " ").trim();
const nameKey = s => normName(s).replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
function checkName(n) {
  n = normName(n); const w = n.split(" ").filter(Boolean);
  if (!/^[ء-ي\s]+$/.test(n)) return "اكتب الاسم بالحروف العربية فقط.";
  if (w.length < 3) return "اكتب الاسم الثلاثي كاملًا: الاسم واسم الأب واسم الجد أو القبيلة.";
  if (w.some(x => x.length < 2)) return "تأكّد من كتابة كل جزء من الاسم كاملًا.";
  return "";
}
function checkPin(p) { p = String(p || ""); if (p.length < 4) return "الرقم السري ٤ أرقام أو أحرف على الأقل."; if (/\s/.test(p)) return "الرقم السري بلا مسافات."; return ""; }
async function sha(t) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
const fbEmail = async k => "u" + (await sha("basira|" + k)).slice(0, 32) + "@basira-school.app";
/* class rosters: the names ship encrypted; the class code from the teacher opens them (remembered on this device) */
const RST = window.BASIRA_ROSTER || { classes: [] };
const CLS = id => (RST.classes.find(c => c.id === id) || {}).name || "";
let ROSTER = null;
const b64u = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function unlockRoster(code) {
  code = String(code || "").trim().replace(/[٠-٩]/g, d => AR.indexOf(d));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64u(RST.salt), iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64u(RST.iv) }, key, b64u(RST.ct));
  ROSTER = JSON.parse(new TextDecoder().decode(pt)); ROSTER.cls.forEach(c => c.st.sort((a, b) => a.n.localeCompare(b.n, "ar")));
  try { localStorage.setItem("basira:rc", code); } catch (e) {}
  return ROSTER;
}
async function rosterReady() {
  if (ROSTER) return true; if (!RST.ct) return false;
  let c = RST.k || null; try { c = localStorage.getItem("basira:rc") || c; } catch (e) {}
  if (!c) return false;
  try { await unlockRoster(c); return true; } catch (e) { try { localStorage.removeItem("basira:rc"); } catch (x) {} return false; }
}
function rosterStudent(id) { for (const c of (ROSTER ? ROSTER.cls : [])) { const s = c.st.find(x => x.id === id); if (s) return { ...s, cls: c.id }; } return null; }
function pickerHTML(lbl) { return `<div class="field"><label>الصف</label><select name="cls"><option value="">اختر الصف…</option>${ROSTER.cls.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
  <div class="field"><label>${lbl || "اسم الطالبة"}</label><select name="sid" disabled><option value="">اختر الصف أولًا</option></select></div>`; }
function bindPicker(root) { const cs = root.querySelector("[name=cls]"), ss = root.querySelector("[name=sid]");
  cs.onchange = () => { const c = ROSTER.cls.find(x => x.id === cs.value);
    ss.innerHTML = c ? `<option value="">اختر الاسم…</option>` + c.st.map(s => `<option value="${s.id}">${esc(s.n)}</option>`).join("") : `<option value="">اختر الصف أولًا</option>`; ss.disabled = !c; }; }
async function withRoster(el, render) {
  if (await rosterReady()) return render();
  if (!RST.ct) { el.innerHTML = `<div class="msg bad">لم تُضف قوائم الصفوف بعد.</div>`; return; }
  el.innerHTML = `<div class="field"><label>رمز الصفوف</label><div class="pinrow"><input name="rc" inputmode="numeric" maxlength="10" dir="ltr" placeholder="••••" autocomplete="off"><button type="button" class="pill-btn teal" data-unlock>افتح القوائم</button></div>
    <p class="muted hint" style="margin:6px 0 0">رمز تعطيه المعلمة لحماية أسماء الطالبات، ويُطلب مرة واحدة على هذا الجهاز.</p><div data-gmsg></div></div>`;
  const inp = el.querySelector("[name=rc]"), go = async () => { const b = el.querySelector("[data-unlock]"); b.disabled = true;
    try { await unlockRoster(inp.value); render(); } catch (e) { b.disabled = false; msg(el.querySelector("[data-gmsg]"), "الرمز غير صحيح. اطلبه من المعلمة."); } };
  el.querySelector("[data-unlock]").onclick = go; inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); go(); } };
}
function clsChips(cur, counts) { if (!RST.classes.length) return ""; return `<div class="nv-filters cls-f" role="toolbar" aria-label="الصف"><button class="chip-f" data-cls="" aria-pressed="${!cur}">كل الصفوف</button>${RST.classes.map(c => `<button class="chip-f" data-cls="${c.id}" aria-pressed="${cur === c.id}">${esc(c.name)}${counts ? ` <small>${counts(c)}</small>` : ""}</button>`).join("")}</div>`; }
async function acctKey(name) { return { m: null, key: nameKey(name) }; }
const fbPass = pin => "Bz!" + pin + "#2026";
const LOCAL_T_CODE = "1234";
let ME = null, loginRole = "student";
const ERR = { roster: "تدخل الطالبة من صفحة «دخول الطالبات» باختيار صفها واسمها.", exists: "هذا الاسم مسجّل من قبل. إن كان حسابك فاختر «تسجيل الدخول»، وإن كان لشخص آخر فأضف اسم الجد الثاني أو اللقب.", bad: "الاسم أو الرقم السري غير صحيح.", many: "محاولات كثيرة. انتظر دقائق ثم حاول مرة أخرى.", net: "تعذّر الاتصال بالإنترنت. تأكد من الشبكة ثم حاول مرة أخرى.", code: "رمز تفعيل لوحة المعلمة غير صحيح.", gone: "لم يكتمل إنشاء هذا الحساب. اختر «حساب جديد» واكتب الاسم والرقم السري نفسيهما لإكماله.", role: "" };
const ERR_DB = "تعذّر الاتصال بقاعدة البيانات. على صاحب الموقع التأكد من إنشاء Firestore Database في مشروع Firebase.";
const ERR_RULES = "رفضت قاعدة البيانات الحفظ. على صاحب الموقع نشر القواعد (Rules) في Firestore.";
function fbErr(e) { const c = (e && e.code) || ""; if (c === "timeout" || c.includes("unavailable") || c.includes("failed-precondition")) return ERR_DB; if (c.includes("operation-not-allowed") || c.includes("configuration-not-found")) return "الدخول بالبريد وكلمة المرور غير مفعّل في Firebase (Authentication ← Sign-in method ← Email/Password)."; if (c.includes("email-already-in-use")) return ERR.exists; if (/wrong-password|user-not-found|invalid-credential|invalid-login|invalid-email/.test(c)) return ERR.bad; if (c.includes("too-many")) return ERR.many; if (c.includes("network")) return ERR.net; if (c.includes("permission")) return ERR_RULES; return "حدث خطأ غير متوقع، حاول مرة أخرى." + (c ? " (" + c + ")" : ""); }
async function loadProfile(uid) {
  let p; try { p = await store.get("users", uid); } catch (e) { throw new Error(fbErr(e)); } if (!p) return null;
  let admin = false; if (p.role === "teacher") { try { admin = !!(await store.get("admins", uid)); } catch (e) {} }
  return { uid, ...p, admin };
}
const acct = {
  async register(name, pin, role, code, opt) {
    name = normName(name); const key = opt && opt.key ? opt.key : nameKey(name);
    if (role === "student" && !(opt && opt.key)) throw new Error(ERR.roster);
    const prof = { name, key, role, points: 0, createdAt: now() }; if (opt && opt.cls) prof.cls = opt.cls;
    if (db) {
      const email = await fbEmail(key); let cred, fresh = true;
      try { cred = await TO(auth.createUserWithEmailAndPassword(email, fbPass(pin))); }
      catch (e) {
        if (!String(e.code || "").includes("email-already-in-use")) throw new Error(fbErr(e));
        /* the sign-in exists but its profile may never have been saved (e.g. the database was not ready): finish it */
        try { cred = await TO(auth.signInWithEmailAndPassword(email, fbPass(pin))); } catch (x) { throw new Error(ERR.exists); }
        let had = null; try { had = await store.get("users", cred.user.uid); } catch (x) { throw new Error(fbErr(x)); }
        if (had) { await auth.signOut(); throw new Error(ERR.exists); }
        fresh = false;
      }
      const uid = cred.user.uid;
      try { const b = db.batch(); if (role === "teacher") b.set(db.collection(P + "admins").doc(uid), { key: String(code || ""), createdAt: now() }); b.set(db.collection(P + "users").doc(uid), prof); await TO(b.commit()); }
      catch (e) { const c = String(e.code || ""); if (fresh) { try { await cred.user.delete(); } catch (x) {} } else { try { await auth.signOut(); } catch (x) {} }
        throw new Error(role === "teacher" && c.includes("permission") ? ERR.code + " (أو أن القواعد لم تُنشر في Firestore)" : fbErr(e)); }
      UID = uid; ME = await loadProfile(uid); return ME;
    }
    const users = LS.all("users"); if (Object.values(users).some(u => u.key === key)) throw new Error(ERR.exists);
    if (role === "teacher" && String(code) !== LOCAL_T_CODE) throw new Error(ERR.code);
    const uid = "u" + Math.random().toString(36).slice(2, 12);
    await store.set("users", uid, { ...prof, ph: await sha(pin + "|" + key) });
    if (role === "teacher") await store.set("admins", uid, { createdAt: now() });
    try { localStorage.setItem("basira:sess", uid); } catch (e) {}
    UID = uid; ME = await loadProfile(uid); return ME;
  },
  async login(name, pin, opt) {
    name = normName(name); const key = opt && opt.key ? opt.key : nameKey(name);
    if (db) {
      let cred; try { cred = await TO(auth.signInWithEmailAndPassword(await fbEmail(key), fbPass(pin))); } catch (e) { throw new Error(fbErr(e)); }
      UID = cred.user.uid; try { ME = await loadProfile(UID); } catch (e) { await auth.signOut(); UID = null; throw e; } if (!ME) { await auth.signOut(); UID = null; throw new Error(ERR.gone); } return ME;
    }
    const ph = await sha(pin + "|" + key); const hit = Object.entries(LS.all("users")).find(([, u]) => u.key === key && u.ph === ph);
    if (!hit) throw new Error(ERR.bad);
    try { localStorage.setItem("basira:sess", hit[0]); } catch (e) {}
    UID = hit[0]; ME = await loadProfile(UID); return ME;
  },
  async logout() { if (db) { try { await auth.signOut(); } catch (e) {} } else { try { localStorage.removeItem("basira:sess"); } catch (e) {} } UID = null; ME = null; IS_T = false; }
};

/* ================= TEACHER TOOLS: evaluation, teacher quizzes, announcements ================= */
const EV = [["read", "القراءة الجهرية"], ["hw", "الواجبات"], ["part", "المشاركة الصفية"], ["write", "الكتابة والإملاء"], ["sum", "تلخيص الكتب"], ["beh", "السلوك والانضباط"]];
const LV = { 4: "ممتاز", 3: "جيد جدًّا", 2: "جيد", 1: "يحتاج متابعة" };
const LVC = { 4: "approved", 3: "approved", 2: "pending", 1: "rejected" };
const forCls = (x, cls) => !x.cls || x.cls === cls;
const qresId = (qid, uid) => qid + "_" + uid;
async function allRoster() { await rosterReady(); return ROSTER ? ROSTER.cls : []; }
function evalCard(ev) {
  if (!ev || !EV.some(([k]) => ev.c && ev.c[k]) && ev.absent == null) return `<p class="muted">لم تضع المعلمة تقييمًا بعد.</p>`;
  return `<div class="ev-grid">${EV.map(([k, n]) => { const v = ev.c && ev.c[k]; return `<div><span>${n}</span>${v ? `<b class="status ${LVC[v]}">${LV[v]}</b>` : `<b class="muted">—</b>`}</div>`; }).join("")}
    <div><span>أيام الغياب</span><b>${ev.absent != null ? ar(ev.absent) : "—"}</b></div></div>${ev.updatedAt ? `<p class="muted" style="font-size:13px;margin:6px 0 0">آخر تحديث: ${fmtDate(ev.updatedAt)}</p>` : ""}`;
}

/* ---------- teacher: evaluation & follow-up ---------- */
let evCls = "";
async function tEvals() {
  const el = $("#tEval"); const R = await allRoster(); if (!evCls && R[0]) evCls = R[0].id;
  let evs = {}; try { (await store.list("evals")).forEach(e => evs[e.id] = e); } catch (e) {}
  const C = R.find(c => c.id === evCls);
  el.innerHTML = `<p class="muted" style="margin:0 0 8px">قيّمي كل طالبة في البنود المهمة؛ يُحفظ كل تغيير فورًا، ويراه وليّ أمرها في صفحة المتابعة.</p>
    <div class="nv-filters">${R.map(c => `<button class="chip-f" data-c="${c.id}" aria-pressed="${c.id === evCls}">${esc(c.name)}</button>`).join("")}</div>
    ${C ? `<div class="tbl"><table class="res-table ev-table"><thead><tr><th>الطالبة</th>${EV.map(([, n]) => `<th>${n}</th>`).join("")}<th>الغياب</th></tr></thead><tbody>${C.st.map(s => { const k = "r:" + s.id, e = evs[k] || {}; return `<tr data-k="${k}"><td><b>${esc(s.n)}</b></td>${EV.map(([c]) => `<td><select data-ev="${c}" aria-label="${c}"><option value="">—</option>${[4, 3, 2, 1].map(v => `<option value="${v}" ${e.c && +e.c[c] === v ? "selected" : ""}>${LV[v]}</option>`).join("")}</select></td>`).join("")}<td><input data-ab type="number" min="0" max="200" value="${e.absent != null ? e.absent : ""}" style="width:64px"></td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">لا توجد قوائم صفوف.</div>`}`;
  $$("#tEval [data-c]").forEach(b => b.onclick = () => { evCls = b.dataset.c; tEvals(); });
  $$("#tEval tr[data-k]").forEach(tr => { const k = tr.dataset.k, s = C.st.find(x => "r:" + x.id === k);
    const save = async () => { const c = {}; tr.querySelectorAll("[data-ev]").forEach(x => { if (x.value) c[x.dataset.ev] = +x.value; });
      const ab = tr.querySelector("[data-ab]").value; const doc = { name: s.n, cls: evCls, c, updatedAt: now() }; if (ab !== "") doc.absent = Math.max(0, +ab);
      try { await store.set("evals", k, doc); tr.classList.add("saved"); setTimeout(() => tr.classList.remove("saved"), 900); } catch (e) { toast("لم يُحفظ التقييم"); } };
    tr.querySelectorAll("select,input").forEach(x => x.onchange = save); });
}

/* ---------- teacher: quizzes ---------- */
let qEdit = null;
async function tQuizzes() {
  const el = $("#tQuiz"); const R = await allRoster();
  let qz = [], rs = []; try { qz = (await store.list("quizzes")).sort(byTime); } catch (e) {} try { rs = await store.list("qres"); } catch (e) {}
  if (qEdit) return quizEditor(el, R);
  el.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center"><p class="muted" style="margin:0">اختبارات قصيرة تضعينها للصفوف، تحلّها الطالبة مرة واحدة فتُصحَّح فورًا، وتظهر درجتها لك ولوليّ أمرها.</p><button class="pill-btn orange" data-new>+ اختبار جديد</button></div>
    <div class="list" style="margin-top:12px">${qz.length ? qz.map(q => { const r = rs.filter(x => x.qid === q.id); const avg = r.length ? Math.round(r.reduce((a, x) => a + x.score / x.total, 0) / r.length * 100) : null;
      return `<div class="li" data-q="${q.id}" style="flex-wrap:wrap"><div class="grow"><b>${esc(q.title)}</b><br><span class="muted" style="font-size:13.5px">${q.cls ? esc(CLS(q.cls)) : "كل الصفوف"} · ${ar(q.qs.length)} أسئلة · ${fmtDate(q.createdAt)}</span></div>
        <span class="status ${q.open ? "approved" : "rejected"}">${q.open ? "مفتوح" : "مغلق"}</span><span class="chip-s">حلّته ${ar(r.length)}${avg != null ? " · متوسط " + ar(avg) + "٪" : ""}</span>
        <button class="mini" data-a="res">النتائج</button><button class="mini" data-a="edit">تعديل</button><button class="mini" data-a="tog">${q.open ? "إغلاق" : "فتح"}</button><button class="mini no" data-a="del">حذف</button><div data-box style="flex-basis:100%" hidden></div></div>`; }).join("") : `<div class="empty"><b>لا توجد اختبارات بعد</b>اضغطي «اختبار جديد» لكتابة أول اختبار.</div>`}</div>`;
  el.querySelector("[data-new]").onclick = () => { qEdit = { title: "", cls: "", open: true, qs: [{ q: "", opts: ["", "", "", ""], a: 0 }] }; tQuizzes(); };
  el.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => { const row = b.closest("[data-q]"), q = qz.find(x => x.id === row.dataset.q), a = b.dataset.a;
    if (a === "edit") { qEdit = JSON.parse(JSON.stringify(q)); tQuizzes(); }
    if (a === "tog") { await store.update("quizzes", q.id, { open: !q.open }); tQuizzes(); }
    if (a === "del") { if (!b.dataset.c) { b.dataset.c = 1; b.textContent = "تأكيد الحذف"; return; } await store.del("quizzes", q.id); tQuizzes(); }
    if (a === "res") { const box = row.querySelector("[data-box]"); box.hidden = !box.hidden; if (box.hidden) return; const r = rs.filter(x => x.qid === q.id).sort((x, y) => y.score / y.total - x.score / x.total);
      box.innerHTML = r.length ? `<div class="tbl"><table class="res-table"><thead><tr><th>الطالبة</th><th>الصف</th><th>الدرجة</th><th>التاريخ</th></tr></thead><tbody>${r.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(CLS(x.cls))}</td><td><b>${ar(x.score)} من ${ar(x.total)}</b></td><td>${fmtDate(x.createdAt)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">لم تحلّه أي طالبة بعد.</p>`; }
  });
}
function quizEditor(el, R) {
  const Q = qEdit;
  el.innerHTML = `<form class="form" id="qForm" novalidate><h3 class="auth-t">${Q.id ? "تعديل الاختبار" : "اختبار جديد"}</h3>
    <div class="grid2"><div class="field"><label>عنوان الاختبار</label><input name="title" maxlength="80" value="${esc(Q.title)}" placeholder="مثال: اختبار قصير في الوحدة الثانية"></div>
    <div class="field"><label>للصف</label><select name="cls"><option value="">كل الصفوف</option>${R.map(c => `<option value="${c.id}" ${Q.cls === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div></div>
    <div id="qList">${Q.qs.map((x, i) => `<div class="card qed" data-i="${i}"><div class="row" style="justify-content:space-between"><b>السؤال ${ar(i + 1)}</b>${Q.qs.length > 1 ? `<button type="button" class="mini no" data-rm>حذف السؤال</button>` : ""}</div>
      <div class="field"><input data-q value="${esc(x.q)}" maxlength="300" placeholder="نص السؤال"></div>
      <div class="qopts">${x.opts.map((o, j) => `<label class="qopt"><input type="radio" name="a${i}" value="${j}" ${x.a === j ? "checked" : ""} aria-label="الإجابة الصحيحة"><input data-o="${j}" value="${esc(o)}" maxlength="120" placeholder="الخيار ${ar(j + 1)}${j > 1 ? " (اختياري)" : ""}"></label>`).join("")}</div>
      <p class="muted" style="margin:4px 0 0;font-size:13px">اختاري الدائرة بجانب الإجابة الصحيحة.</p></div>`).join("")}</div>
    <div class="row"><button type="button" class="pill-btn ghost" data-add>+ سؤال</button><span style="flex:1"></span><button type="button" class="pill-btn ghost" data-cancel>إلغاء</button><button class="pill-btn orange" type="submit">احفظي الاختبار</button></div><div data-msg></div></form>`;
  const f = $("#qForm"), M = f.querySelector("[data-msg]");
  const read = () => { Q.title = f.title.value.trim(); Q.cls = f.cls.value;
    Q.qs = [...f.querySelectorAll(".qed")].map((d, i) => ({ q: d.querySelector("[data-q]").value.trim(), opts: [...d.querySelectorAll("[data-o]")].map(x => x.value.trim()), a: +((d.querySelector(`input[name=a${i}]:checked`) || {}).value || 0) })); };
  f.querySelector("[data-add]").onclick = () => { read(); Q.qs.push({ q: "", opts: ["", "", "", ""], a: 0 }); quizEditor(el, R); };
  f.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { read(); Q.qs.splice(+b.closest(".qed").dataset.i, 1); quizEditor(el, R); });
  f.querySelector("[data-cancel]").onclick = () => { qEdit = null; tQuizzes(); };
  f.onsubmit = async e => { e.preventDefault(); read();
    if (!Q.title) { msg(M, "اكتبي عنوان الاختبار."); return; }
    for (let i = 0; i < Q.qs.length; i++) { const x = Q.qs[i]; if (!x.q || !x.opts[0] || !x.opts[1]) { msg(M, `السؤال ${ar(i + 1)}: اكتبي نصه وخيارين على الأقل.`); return; } if (!x.opts[x.a]) { msg(M, `السؤال ${ar(i + 1)}: الإجابة الصحيحة المختارة فارغة.`); return; } }
    const qs = Q.qs.map(x => { const keep = x.opts.map((o, j) => [o, j]).filter(([o]) => o); return { q: x.q, opts: keep.map(([o]) => o), a: keep.findIndex(([, j]) => j === x.a) }; });
    const doc = { title: Q.title, cls: Q.cls, qs, open: Q.open !== false, createdAt: Q.createdAt || now() };
    try { if (Q.id) await store.set("quizzes", Q.id, doc); else await store.add("quizzes", doc); toast("حُفظ الاختبار"); qEdit = null; tQuizzes(); } catch (err) { msg(M, "لم يُحفظ الاختبار."); } };
}

/* ---------- teacher: announcements & photos ---------- */
let annEdit = null;
async function tAnn() {
  const el = $("#tAnn"); const R = await allRoster(); let an = []; try { an = (await store.list("ann")).sort(byTime); } catch (e) {}
  const E = annEdit || {};
  el.innerHTML = `<form class="form" id="annForm"><h3 class="auth-t">${E.id ? "تعديل الإعلان" : "إعلان أو صورة جديدة"}</h3>
    <div class="grid2"><div class="field"><label>العنوان</label><input name="t" required maxlength="80" value="${esc(E.title || "")}"></div>
    <div class="field"><label>يظهر لـ</label><select name="cls"><option value="">كل الصفوف</option>${R.map(c => `<option value="${c.id}" ${E.cls === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div></div>
    <div class="field"><label>النص</label><textarea name="x" maxlength="1500" style="min-height:90px">${esc(E.text || "")}</textarea></div>
    <div class="field"><label>صورة (اختياري)</label><input name="img" type="file" accept="image/*">${E.img ? `<img src="${E.img}" alt="" style="max-height:120px;border-radius:12px;margin-top:6px"><label class="muted" style="font-size:14px"><input type="checkbox" name="rmimg"> احذفي الصورة</label>` : ""}</div>
    <div class="row">${E.id ? `<button type="button" class="pill-btn ghost" data-cancel>إلغاء</button>` : ""}<button class="pill-btn orange" type="submit">${E.id ? "احفظي التعديل" : "انشري للطالبات وأولياء الأمور"}</button></div><div data-msg></div></form>
    <h3 style="font-size:18px;font-weight:900;margin-top:20px">المنشور</h3><div class="list">${an.length ? an.map(a => `<div class="li" data-id="${a.id}">${a.img ? `<img src="${a.img}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:12px">` : ""}<div class="grow"><b>${esc(a.title)}</b><br><span class="muted" style="font-size:13.5px">${a.cls ? esc(CLS(a.cls)) : "كل الصفوف"} · ${fmtDate(a.createdAt)}</span></div><button class="mini" data-a="edit">تعديل</button><button class="mini no" data-a="del">حذف</button></div>`).join("") : `<p class="muted">لم تنشري شيئًا بعد.</p>`}</div>`;
  const f = $("#annForm"), M = f.querySelector("[data-msg]");
  if (f.querySelector("[data-cancel]")) f.querySelector("[data-cancel]").onclick = () => { annEdit = null; tAnn(); };
  f.onsubmit = async e => { e.preventDefault(); const file = f.img.files[0]; let img = E.img || "";
    try { if (file) img = await shrink(file); if (f.rmimg && f.rmimg.checked) img = "";
      const doc = { title: f.t.value.trim(), text: f.x.value.trim(), cls: f.cls.value, img, createdAt: E.createdAt || now() };
      if (!doc.title) { msg(M, "اكتبي عنوانًا."); return; }
      if (E.id) await store.set("ann", E.id, doc); else await store.add("ann", doc); toast(E.id ? "حُفظ التعديل" : "نُشر الإعلان"); annEdit = null; tAnn(); } catch (err) { msg(M, "لم يُحفظ. إن كانت الصورة كبيرة جدًّا فاختاري صورة أصغر."); } };
  el.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => { const id = b.closest("[data-id]").dataset.id;
    if (b.dataset.a === "edit") { annEdit = an.find(x => x.id === id); tAnn(); window.scrollTo({ top: $("#tPanel").offsetTop, behavior: "smooth" }); }
    if (b.dataset.a === "del") { if (!b.dataset.c) { b.dataset.c = 1; b.textContent = "تأكيد الحذف"; return; } await store.del("ann", id); tAnn(); } });
}

/* ---------- student: «من المعلمة» ---------- */
function annHTML(a) { return `<article class="ann">${a.img ? `<img src="${a.img}" alt="">` : ""}<div><span class="muted" style="font-size:13px">${a.cls ? esc(CLS(a.cls)) : "لكل الصفوف"} · ${fmtDate(a.createdAt)}</span><h3>${esc(a.title)}</h3>${a.text ? `<p>${esc(a.text)}</p>` : ""}</div></article>`; }
async function loadTasks() {
  await refreshMe(); const el = $("#tasks");
  if (!ME || ME.role !== "student") { el.innerHTML = `<div class="empty"><b>هذه الصفحة للطالبات</b>ادخلي بحسابك لتري اختبارات المعلمة وإعلاناتها لصفك.${ME && ME.role === "parent" ? `<div style="margin-top:10px"><a class="pill-btn teal" href="#parents">متابعة ابنتي</a></div>` : `<div style="margin-top:10px"><a class="pill-btn orange" href="#register">دخول الطالبات</a></div>`}</div>`; return; }
  let qz = [], mine = [], an = [], ev = null;
  try { qz = (await store.list("quizzes")).filter(q => q.open !== false && forCls(q, ME.cls)).sort(byTime); } catch (e) {}
  try { mine = await store.list("qres", ["uid", UID]); } catch (e) {}
  try { an = (await store.list("ann")).filter(a => forCls(a, ME.cls)).sort(byTime); } catch (e) {}
  try { ev = await store.get("evals", ME.key); } catch (e) {}
  el.innerHTML = `<div class="grid2"><div class="card"><h3 class="auth-t">اختبارات المعلمة</h3><div class="list">${qz.length ? qz.map(q => { const r = mine.find(x => x.qid === q.id);
      return `<div class="li"><div class="grow"><b>${esc(q.title)}</b><br><span class="muted" style="font-size:13.5px">${ar(q.qs.length)} أسئلة · ${fmtDate(q.createdAt)}</span></div>${r ? `<span class="status approved">${ar(r.score)} من ${ar(r.total)}</span><button class="mini" data-view="${q.id}">التصحيح</button>` : `<button class="mini o" data-take="${q.id}">ابدئي ✎</button>`}</div>`; }).join("") : `<p class="muted">لا توجد اختبارات مفتوحة لصفك الآن.</p>`}</div></div>
    <div class="card"><h3 class="auth-t">تقييم المعلمة لي</h3>${evalCard(ev)}</div></div>
    <div id="quizBox"></div>
    <h3 class="auth-t" style="margin-top:22px">إعلانات المعلمة</h3><div class="anns">${an.length ? an.map(annHTML).join("") : `<div class="empty">لا توجد إعلانات بعد.</div>`}</div>`;
  $$("#tasks [data-take]").forEach(b => b.onclick = () => takeQuiz(qz.find(q => q.id === b.dataset.take), null));
  $$("#tasks [data-view]").forEach(b => b.onclick = () => takeQuiz(qz.find(q => q.id === b.dataset.view), mine.find(x => x.qid === b.dataset.view)));
}
function takeQuiz(q, done) {
  const box = $("#quizBox"); const pick = done ? done.answers : q.qs.map(() => null);
  const draw = () => {
    box.innerHTML = `<div class="card" style="margin-top:16px"><h3 class="auth-t">${esc(q.title)}</h3>${q.qs.map((x, i) => `<div class="qq-t"><p><b>${ar(i + 1)}.</b> ${esc(x.q)}</p><div class="opts">${x.opts.map((o, j) => { let c = ""; if (done) { if (j === x.a) c = "right"; else if (pick[i] === j) c = "soft"; } else if (pick[i] === j) c = "picked";
        return `<button class="opt ${c}" data-i="${i}" data-j="${j}" ${done ? "disabled" : ""}>${esc(o)}</button>`; }).join("")}</div>${done ? `<div class="muted" style="font-size:14px;margin-top:4px">${pick[i] === x.a ? "✓ إجابتك صحيحة" : "الإجابة الصحيحة: " + esc(x.opts[x.a])}</div>` : ""}</div>`).join("")}
      ${done ? `<div class="verdict ok"><b>درجتك: ${ar(done.score)} من ${ar(done.total)}</b><div>الإجابات الصحيحة باللون الأخضر.</div></div>` : `<div class="row" style="margin-top:12px"><button class="pill-btn orange big" data-send>سلّمي الإجابات</button><span class="muted" data-left></span></div><div data-msg></div>`}</div>`;
    box.querySelectorAll("[data-j]").forEach(b => b.onclick = () => { pick[+b.dataset.i] = +b.dataset.j; draw(); });
    const s = box.querySelector("[data-send]"); if (s) { const left = pick.filter(x => x == null).length; box.querySelector("[data-left]").textContent = left ? `بقي ${ar(left)} من الأسئلة` : "أجبتِ عن كل الأسئلة";
      s.onclick = async () => { if (pick.some(x => x == null)) { msg(box.querySelector("[data-msg]"), "أجيبي عن كل الأسئلة أولًا."); return; } s.disabled = true;
        const score = q.qs.filter((x, i) => pick[i] === x.a).length, r = { qid: q.id, title: q.title, uid: UID, name: ME.name, cls: ME.cls || "", score, total: q.qs.length, answers: pick, createdAt: now() };
        try { await store.set("qres", qresId(q.id, UID), r); done = r; draw(); award("quiz", q.id, q.title); loadTasks().then(() => takeQuiz(q, r)); } catch (e) { s.disabled = false; msg(box.querySelector("[data-msg]"), "لم تُسلَّم الإجابات. ربما سلّمتِ هذا الاختبار من قبل، أو تأكدي من الاتصال."); } }; }
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  draw();
}


/* ---------- teacher: students' login list (names + PINs, opened with the teacher code) ---------- */
let ACC = null, accCls = "";
async function openAcc(code) {
  const T = RST.tp; code = digits(code);
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64u(T.salt), iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  ACC = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64u(T.iv) }, key, b64u(T.ct))));
  try { localStorage.setItem("basira:tc", code); } catch (e) {}
}
async function tAccounts() {
  const el = $("#tAcc"); const R = await allRoster();
  if (!RST.tp) { el.innerHTML = `<div class="empty">لم تُضف أرقام الطالبات بعد.</div>`; return; }
  if (!ACC) { let c = null; try { c = localStorage.getItem("basira:tc"); } catch (e) {} for (const k of [c, "506887"]) { if (!k || ACC) continue; try { await openAcc(k); } catch (e) { ACC = null; } } }
  if (!ACC) {
    el.innerHTML = `<form class="form" style="max-width:420px"><p class="muted" style="margin:0">قائمة دخول الطالبات محمية. اكتبي رمز تفعيل لوحة المعلمة لعرضها (يُطلب مرة واحدة على هذا الجهاز).</p><div class="field"><label>رمز لوحة المعلمة</label><input name="c" inputmode="numeric" maxlength="12" dir="ltr" autocomplete="off"></div><button class="pill-btn teal" type="submit">اعرضي القائمة</button><div data-msg></div></form>`;
    const f = el.querySelector("form"); f.onsubmit = async e => { e.preventDefault(); try { await openAcc(f.c.value); tAccounts(); } catch (x) { msg(f.querySelector("[data-msg]"), "الرمز غير صحيح."); } }; return;
  }
  if (!accCls && R[0]) accCls = R[0].id;
  let users = []; try { users = await store.list("users", ["role", "student"]); } catch (e) {}
  const inSet = new Set(users.map(u => u.key)), C = R.find(c => c.id === accCls);
  el.innerHTML = `<p class="muted" style="margin:0 0 8px">لا تُنشئ الطالبة حسابًا: تختار صفها واسمها وتكتب رقمها السري من هذه القائمة. اطبعي بطاقات الصف وأعطي كل طالبة بطاقتها.</p>
    <div class="nv-filters">${R.map(c => `<button class="chip-f" data-c="${c.id}" aria-pressed="${c.id === accCls}">${esc(c.name)} <small>${ar(c.st.filter(s => inSet.has("r:" + s.id)).length)}/${ar(c.st.length)}</small></button>`).join("")}</div>
    <div class="row" style="margin:8px 0"><button class="pill-btn orange" data-print>🖨 اطبعي بطاقات ${C ? esc(C.name) : ""}</button><button class="pill-btn ghost" data-list>🖨 اطبعي قائمة الصف</button></div>
    ${C ? `<div class="tbl"><table class="res-table"><thead><tr><th>#</th><th>الطالبة</th><th>الرقم السري</th><th>الحالة</th></tr></thead><tbody>${C.st.map((s, i) => `<tr><td>${ar(i + 1)}</td><td><b>${esc(s.n)}</b></td><td dir="ltr" style="font-family:monospace;font-size:17px;letter-spacing:2px">${ACC[s.id] || "—"}</td><td>${inSet.has("r:" + s.id) ? `<span class="status approved">دخلت</span>` : `<span class="muted">لم تدخل بعد</span>`}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
  $$("#tAcc [data-c]").forEach(b => b.onclick = () => { accCls = b.dataset.c; tAccounts(); });
  const site = location.href.split("#")[0];
  const doPrint = html => { let pa = $("#printArea"); if (!pa) { pa = document.createElement("div"); pa.id = "printArea"; document.body.appendChild(pa); } pa.innerHTML = html; document.body.classList.add("printing"); setTimeout(() => { window.print(); setTimeout(() => document.body.classList.remove("printing"), 400); }, 80); };
  el.querySelector("[data-print]").onclick = () => doPrint(`<div class="pcards">${C.st.map(s => `<div class="pcard"><b class="pc-h">مبادرة البصيرة · ${esc(C.name)}</b><div class="pc-n">${esc(s.n)}</div><div class="pc-l">رقمك السري</div><div class="pc-p">${ACC[s.id]}</div><small>ادخلي من «دخول الطالبات»: اختاري صفك ثم اسمك ثم اكتبي الرقم.</small></div>`).join("")}</div>`);
  el.querySelector("[data-list]").onclick = () => doPrint(`<h2 style="margin:0 0 8px">حسابات طالبات ${esc(C.name)} · مبادرة البصيرة</h2><table class="plist"><thead><tr><th>#</th><th>الطالبة</th><th>الرقم السري</th></tr></thead><tbody>${C.st.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.n)}</td><td dir="ltr">${ACC[s.id]}</td></tr>`).join("")}</tbody></table>`);
}

/* tells the site owner at once if Firestore is missing or its rules are not published */
async function dbCheck() {
  try { await TO(db.collection(P + "site").doc("main").get({ source: "server" }), 10000); }
  catch (e) { const c = String((e && e.code) || ""), d = $("#demo");
    d.textContent = c.includes("permission") ? "تنبيه لصاحب الموقع: قاعدة البيانات موجودة لكن القواعد لم تُنشر. افتح Firestore Database ← Rules والصق ملف القواعد ثم Publish."
      : "تنبيه لصاحب الموقع: قاعدة البيانات غير موجودة بعد. افتح Firebase ← Firestore Database ← Create database.";
    d.style.background = "#FDECEC"; d.style.color = "#8E2A20"; d.hidden = false; }
}
/* ================= SURVEY (inside the site) ================= */
const SCALE = ["ضعيف", "مقبول", "جيد", "جيد جدًّا", "ممتاز"];
const SURVEY = {
  student: [
    { id: "lessons", q: "ما مدى استفادتك من شروح الدروس في الموقع؟", t: "scale" },
    { id: "games", q: "ما رأيك في ألعاب الوحدات؟", t: "scale" },
    { id: "tests", q: "هل ساعدتك الاختبارات التدريبية على الاستعداد لاختبارات المدرسة؟", t: "scale" },
    { id: "novels", q: "هل شجّعتك الروايات والنقاط على القراءة أكثر؟", t: "pick", o: ["نعم، كثيرًا", "قليلًا", "لا"] },
    { id: "fav", q: "ما أكثر قسم أعجبك؟", t: "pick", o: ["الدروس", "الأنشطة", "الاختبارات", "الألعاب", "الروايات", "المتصدرات", "تلخيص كتاب"] },
    { id: "freq", q: "كم مرة تدخلين الموقع في الأسبوع؟", t: "pick", o: ["أقل من مرة", "مرة واحدة", "٢–٣ مرات", "كل يوم تقريبًا"] },
    { id: "easy", q: "هل استخدام الموقع سهل على الجوال؟", t: "scale" },
    { id: "text", q: "ماذا تقترحين أن نضيف أو نحسّن؟", t: "text" }
  ],
  parent: [
    { id: "follow", q: "ما مدى سهولة متابعة ابنتك من الموقع؟", t: "scale" },
    { id: "clear", q: "ما مدى وضوح تقييم المعلمة وملاحظاتها؟", t: "scale" },
    { id: "improve", q: "هل لاحظت اهتمامًا أكبر بالقراءة عند ابنتك؟", t: "pick", o: ["نعم، واضحًا", "قليلًا", "لا", "ما زال مبكرًا"] },
    { id: "freq", q: "كم مرة تتابع ابنتك في الموقع؟", t: "pick", o: ["أقل من مرة في الأسبوع", "مرة في الأسبوع", "أكثر من مرة في الأسبوع"] },
    { id: "text", q: "ملاحظاتك أو اقتراحاتك للمعلمة", t: "text" }
  ]
};
async function loadSurvey() {
  await refreshMe(); const el = $("#survey");
  if (!ME || (ME.role !== "student" && ME.role !== "parent")) {
    el.innerHTML = `<div class="empty"><b>${ME && ME.role === "teacher" ? "نتائج الاستبيان في لوحتك" : "الاستبيان للطالبات وأولياء الأمور"}</b>${ME && ME.role === "teacher" ? `<div style="margin-top:10px"><a class="pill-btn teal" href="#teacher">لوحة المعلمة ← الاستبيان</a></div>` : `ادخل بحسابك أولًا، فلكل حساب إجابة واحدة.<div style="margin-top:12px"><a class="pill-btn orange" href="#register">الدخول</a></div>`}</div>`; return; }
  let old = null; try { old = await store.get("survey", UID); } catch (e) {}
  if (old) { el.innerHTML = `<div class="card" style="text-align:center;padding:30px"><div style="font-size:44px">💚</div><h3 class="auth-t">شكرًا لك، وصلت إجابتك</h3><p class="muted">أُرسلت الإجابة في ${fmtDate(old.createdAt)}، ولكل حساب إجابة واحدة. رأيك يساعد المعلمة على تطوير المبادرة.</p></div>`; return; }
  const Q = SURVEY[ME.role], ans = {};
  el.innerHTML = `<form class="card form" id="svForm" novalidate><p class="muted" style="margin:0">دقيقتان فقط. لا تظهر إجابتك لأحد غير المعلمة، ولا يظهر اسمك في النتائج.</p>
    ${Q.map((x, i) => `<div class="sv-q" data-q="${x.id}"><b>${ar(i + 1)}. ${esc(x.q)}</b>${x.t === "text" ? `<textarea name="${x.id}" maxlength="600" style="min-height:90px" placeholder="اكتب هنا (اختياري)"></textarea>`
      : `<div class="sv-opts">${(x.t === "scale" ? SCALE : x.o).map((o, j) => `<button type="button" class="sv-o" data-v="${x.t === "scale" ? j + 1 : j}">${x.t === "scale" ? `<span class="sv-n">${ar(j + 1)}</span>` : ""}${esc(o)}</button>`).join("")}</div>`}</div>`).join("")}
    <button class="pill-btn orange big" type="submit">أرسل الاستبيان</button><div data-msg></div></form>`;
  const f = $("#svForm");
  f.querySelectorAll(".sv-o").forEach(b => b.onclick = () => { const q = b.closest("[data-q]"); q.querySelectorAll(".sv-o").forEach(x => x.setAttribute("aria-pressed", x === b)); ans[q.dataset.q] = +b.dataset.v; q.classList.remove("miss"); });
  f.onsubmit = async e => { e.preventDefault(); const miss = Q.filter(x => x.t !== "text" && ans[x.id] == null);
    f.querySelectorAll(".sv-q").forEach(q => q.classList.toggle("miss", miss.some(x => x.id === q.dataset.q)));
    if (miss.length) { msg(f.querySelector("[data-msg]"), `بقي ${ar(miss.length)} من الأسئلة دون إجابة.`); f.querySelector(".sv-q.miss").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const t = f.querySelector("textarea"); const doc = { role: ME.role, cls: ME.cls || "", a: ans, text: t ? t.value.trim() : "", createdAt: now() };
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    try { await store.set("survey", UID, doc); toast("شكرًا لك! وصلت إجابتك"); loadSurvey(); } catch (err) { btn.disabled = false; msg(f.querySelector("[data-msg]"), err && err.code ? fbErr(err) : "لم يُرسل الاستبيان، حاول مرة أخرى."); } };
}
let svRole = "student";
async function tSurvey() {
  const el = $("#tSrv"); let all = []; try { all = (await store.list("survey")).sort(byTime); } catch (e) {}
  const nS = all.filter(x => x.role === "student").length, nP = all.filter(x => x.role === "parent").length;
  const R = all.filter(x => x.role === svRole), Q = SURVEY[svRole];
  el.innerHTML = `<p class="muted" style="margin:0 0 8px">استبيان البصيرة داخل الموقع: تجيب كل طالبة ووليّ أمر مرة واحدة من صفحة «الاستبيان». الإجابات بلا أسماء.</p>
    <div class="nv-filters"><button class="chip-f" data-r="student" aria-pressed="${svRole === "student"}">الطالبات <small>${ar(nS)}</small></button><button class="chip-f" data-r="parent" aria-pressed="${svRole === "parent"}">أولياء الأمور <small>${ar(nP)}</small></button></div>
    ${!R.length ? `<div class="empty"><b>لا توجد إجابات بعد</b>شاركي رابط الموقع، والاستبيان في الصفحة الرئيسية.</div>` : Q.map((x, i) => {
      if (x.t === "text") { const tx = R.filter(r => r.text); return `<div class="sv-res"><b>${ar(i + 1)}. ${esc(x.q)}</b>${tx.length ? `<div class="notes">${tx.map(r => `<div class="bubble t"><small>${r.cls ? esc(CLS(r.cls)) + " · " : ""}${fmtDate(r.createdAt)}</small>${esc(r.text)}</div>`).join("")}</div>` : `<p class="muted">لا توجد اقتراحات مكتوبة.</p>`}</div>`; }
      const opts = x.t === "scale" ? SCALE : x.o, vals = R.map(r => r.a && r.a[x.id]).filter(v => v != null);
      const cnt = opts.map((o, j) => vals.filter(v => v === (x.t === "scale" ? j + 1 : j)).length), mx = Math.max(1, ...cnt);
      const avg = x.t === "scale" && vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      return `<div class="sv-res"><div class="row" style="justify-content:space-between"><b>${ar(i + 1)}. ${esc(x.q)}</b>${avg != null ? `<span class="status approved">المتوسط ${ar(avg.toFixed(1))} من ٥</span>` : ""}</div>${opts.map((o, j) => `<div class="sv-bar"><span>${esc(o)}</span><i><em style="width:${cnt[j] / mx * 100}%"></em></i><b>${ar(cnt[j])}</b></div>`).join("")}</div>`; }).join("")}`;
  $$("#tSrv [data-r]").forEach(b => b.onclick = () => { svRole = b.dataset.r; tSurvey(); });
}

async function boot() {
  if (hasFB) {
    try {
      firebase.initializeApp(cfg.firebase); auth = firebase.auth(); db = firebase.firestore();
      try { await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}
      await new Promise(res => { const un = auth.onAuthStateChanged(async u => { un(); if (u && !u.isAnonymous) { UID = u.uid; try { ME = await loadProfile(u.uid); } catch (e) { ME = null; } } res(); }); });
    } catch (e) { console.warn("firebase off", e); db = null; }
  }
  if (!db) {
    $("#demo").hidden = false;
    let s = null; try { s = localStorage.getItem("basira:sess"); } catch (e) {}
    if (s) { UID = s; ME = await loadProfile(s); if (!ME) UID = null; }
  }
  IS_T = !!(ME && ME.admin);
  if (db) dbCheck();
  renderAxes(); renderGamesGrid(); route(); refreshMe();
}

/* ================= ROUTER ================= */
const VIEWS = ["home", "units", "unit", "games", "read", "leaders", "tasks", "survey", "about", "register", "library", "summary", "posts", "parents", "teacher"];
let current = null, gameInst = null;
function route() {
  let h = (location.hash || "#home").slice(1); let unitId = null, sub = "lessons";
  const m = h.match(/^(u[1-9])(?:-(lessons|acts|test|game))?$/); if (m) { unitId = m[1]; sub = m[2] || "lessons"; h = "unit"; }
  let nid = null, nch = null; const nm = h.match(/^read-(n\d+)(?:-(\d+))?$/); if (nm) { nid = nm[1]; nch = nm[2] != null ? +nm[2] : null; h = "read"; }
  if (!VIEWS.includes(h)) h = "home";
  if (gameInst) { gameInst.destroy(); gameInst = null; }
  VIEWS.forEach(v => { $("#v-" + v).hidden = v !== h; });
  $$(".nav a").forEach(a => { const t = a.getAttribute("href").slice(1); if (t === h || (h === "unit" && t === "units")) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  $("#nav").classList.remove("open"); $("#menuT").setAttribute("aria-expanded", "false");
  if (current !== location.hash) window.scrollTo({ top: 0 }); current = location.hash;
  ({ home: loadHome, about: loadAbout, register: loadAccount, library: loadBooks, summary: loadSummary, posts: loadPosts, parents: loadParents, teacher: loadTeacher, read: () => loadRead(nid, nch), leaders: loadLeaders, tasks: loadTasks, survey: loadSurvey, unit: () => openUnit(unitId, sub) }[h] || (() => {}))();
}
window.addEventListener("hashchange", route);
$("#menuT").onclick = () => { const n = $("#nav"); n.classList.toggle("open"); $("#menuT").setAttribute("aria-expanded", n.classList.contains("open")); };

/* ================= UNITS ================= */
const AXES = [{ n: 1, name: "الوطن" }, { n: 2, name: "قضايا معاصرة" }, { n: 3, name: "العمل والصناعات" }];
let RESULTS = [];
async function myResults() { if (!UID || !ME || ME.role !== "student") { RESULTS = []; return RESULTS; } try { RESULTS = await store.list("results", ["uid", UID]); } catch (e) { RESULTS = []; } return RESULTS; }
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
  const act = ok && U && box.closest ? box.closest(".act[data-a]") : null;
  if (act && !act._pt) { act._pt = 1; award("act", U.id + "-" + act.dataset.a, U.theme, true); }
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
    if (!ME || ME.role !== "student") { sv.innerHTML = `سجّلي الدخول بحسابك لتُحفظ نتيجتك وتراها المعلمة. <a href="#register">الدخول / التسجيل</a>`; return; }
    try { await store.add("results", { uid: UID, name: ME.name, unit: U.id, kind: "test", score, total: Q.length, createdAt: now() }); sv.textContent = "حُفظت نتيجتك ✓"; myResults(); }
    catch (e) { sv.textContent = "لم تُحفظ النتيجة الآن، تأكدي من الاتصال."; return; }
    try { const r1 = await award("test", U.id, U.theme); const r2 = pct >= 85 ? await award("testx", U.id, U.theme) : {};
      const got = (r1.ok ? r1.pts : 0) + (r2.ok ? r2.pts : 0); if (got) sv.textContent = `حُفظت نتيجتك ✓ وحصلتِ على ${ar(got)} نقطة 🎉`;
      else if (pct < 85 && !hasPt("testx", U.id)) sv.textContent = `حُفظت نتيجتك ✓ · أعيدي الاختبار وحقّقي ٨٥٪ لتحصلي على ${ar(PTS.testx)} نقاط إضافية`; }
    catch (e) {}
  }
  draw();
}

/* ---------- game ---------- */
function renderGame() {
  $("#uBody").innerHTML = `<div class="game-box" id="gameBox"></div><p class="note" style="margin-top:12px">${esc(BasiraGames.meta[U.game.type].how)} تعمل اللعبة على الجوال والحاسوب.</p>`;
  const unit = U;
  const start = () => { gameInst = BasiraGames.mount($("#gameBox"), unit, async (score, total) => {
    if (!ME || ME.role !== "student") return; try { await store.add("results", { uid: UID, name: ME.name, unit: unit.id, kind: "game", score, total, createdAt: now() }); myResults(); } catch (e) {} award("game", unit.id, unit.theme); }); };
  if (document.fonts && document.fonts.load) Promise.race([document.fonts.load('800 40px "Tajawal"'), new Promise(r => setTimeout(r, 1500))]).then(start); else start();
}

/* ================= AUTH FORMS ================= */
/* authForm(el, {roles, fixed, teacher, title, onDone}) — login / new account with triple name + PIN */
/* students never sign up: each name in the class list has a 6-digit PIN given by the teacher.
   the first correct login quietly creates the account; after that it is a normal sign-in. */
async function pinHash(sid, pin) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode("basira-pin|" + sid), iterations: RST.pi || 120000, hash: "SHA-256" }, base, 96);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
const digits = v => String(v || "").replace(/[٠-٩]/g, d => AR.indexOf(d)).replace(/\s+/g, "");
async function studentLogin(s, pin) {
  const opt = { key: "r:" + s.id, cls: s.cls };
  try { return await acct.login(s.n, pin, opt); } catch (e) { if (e.message !== ERR.bad && e.message !== ERR.gone) throw e; }
  if (!s.h || (await pinHash(s.id, pin)) !== s.h) throw new Error("الرقم السري غير صحيح. تأكدي منه في الورقة التي أعطتك إياها المعلمة.");
  try { return await acct.register(s.n, pin, "student", "", opt); }
  catch (e) { if (e.message === ERR.exists) throw new Error("تعذّر الدخول بهذا الرقم. راجعي المعلمة."); throw e; }
}
function studentAuth(el, onDone) {
  el.innerHTML = `<h3 class="auth-t">دخول الطالبات</h3><div data-body></div>`;
  const body = el.querySelector("[data-body]");
  withRoster(body, () => {
    body.innerHTML = `<form class="form" novalidate>${pickerHTML("اسمك")}
      <div class="field"><label>الرقم السري</label><div class="pinrow"><input name="p" type="password" inputmode="numeric" maxlength="6" dir="ltr" autocomplete="current-password" placeholder="••••••"><button type="button" class="eye" aria-label="إظهار الرقم السري">👁</button></div></div>
      <button class="pill-btn orange big" type="submit" data-go>دخول</button><div data-msg></div>
      <p class="muted hint">الرقم السري من ستة أرقام تعطيك إياه المعلمة. لا تحتاجين إلى إنشاء حساب، ويبقى الدخول محفوظًا على هذا الجهاز حتى تضغطي «خروج».</p></form>`;
    const f = body.querySelector("form"), M = body.querySelector("[data-msg]"); bindPicker(f);
    f.querySelector(".eye").onclick = () => { f.p.type = f.p.type === "password" ? "text" : "password"; };
    f.onsubmit = async e => { e.preventDefault();
      const s = rosterStudent(f.sid.value); if (!s) { msg(M, "اختاري صفك ثم اسمك من القائمة."); return; }
      const pin = digits(f.p.value); if (!/^\d{6}$/.test(pin)) { msg(M, "الرقم السري ستة أرقام."); f.p.focus(); return; }
      const btn = f.querySelector("[data-go]"), t0 = btn.textContent; btn.disabled = true; btn.textContent = "لحظة…";
      try { const me = await studentLogin(s, pin); toast("أهلًا " + me.name.split(" ")[0] + " · " + CLS(me.cls)); await refreshMe(); onDone && onDone(me); }
      catch (err) { msg(M, err.message || ERR.bad); }
      finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = t0; } } };
  });
}
function authForm(el, o) {
  let mode = o.mode || "login", role = o.fixed || (o.roles && o.roles[0]) || "student";
  const roleBtns = o.fixed ? "" : `<div class="field" data-rolef hidden><label>نوع الحساب</label><div class="seg">${(o.roles || ["student", "parent"]).map(r => `<button type="button" data-r="${r}" aria-pressed="${r === role}">${ROLE_AR[r]}</button>`).join("")}</div></div>`;
  el.innerHTML = `${o.title ? `<h3 class="auth-t">${esc(o.title)}</h3>` : ""}<div class="seg seg-main" role="tablist"><button type="button" data-m="login" aria-pressed="${mode === "login"}">تسجيل الدخول</button><button type="button" data-m="new" aria-pressed="${mode === "new"}">حساب جديد</button></div>
  <form class="form" autocomplete="on" novalidate>${roleBtns}
    <div class="field"><label>الاسم الثلاثي</label><input name="n" required maxlength="60" autocomplete="username" placeholder="${o.fixed === "parent" ? "مثال: سالم محمد الهنائي" : o.fixed === "teacher" ? "اسمك الثلاثي" : "مثال: مريم سالم محمد"}"></div>
    <div class="field"><label>الرقم السري</label><div class="pinrow"><input name="p" type="password" inputmode="numeric" required minlength="4" maxlength="12" dir="ltr" autocomplete="current-password"><button type="button" class="eye" aria-label="إظهار الرقم السري">👁</button></div></div>
    <div class="field" data-newf hidden><label>أعد كتابة الرقم السري</label><input name="p2" type="password" inputmode="numeric" maxlength="12" dir="ltr" autocomplete="new-password"></div>
    ${o.daughter && ROSTER ? `<div data-newf hidden class="kid-pick"><div class="sub-h" style="margin:4px 0 6px">ابنتك</div>${pickerHTML("اسم ابنتك")}</div>` : ""}
    ${o.teacher ? `<div class="field" data-newf hidden><label>رمز تفعيل لوحة المعلمة</label><input name="c" inputmode="numeric" maxlength="12" dir="ltr"></div>` : ""}
    <button class="pill-btn orange big" type="submit" data-go>دخول</button><div data-msg></div>
    <p class="muted hint" data-hint></p>
  </form>`;
  const f = el.querySelector("form"), M = el.querySelector("[data-msg]");
  function paint() {
    el.querySelectorAll("[data-m]").forEach(b => b.setAttribute("aria-pressed", b.dataset.m === mode));
    el.querySelectorAll("[data-newf],[data-rolef]").forEach(x => x.hidden = mode !== "new");
    el.querySelectorAll("[data-r]").forEach(b => b.setAttribute("aria-pressed", b.dataset.r === role));
    f.p.setAttribute("autocomplete", mode === "new" ? "new-password" : "current-password");
    el.querySelector("[data-go]").textContent = mode === "new" ? (role === "parent" ? "أنشئ حساب ولي الأمر" : role === "teacher" ? "أنشئي حساب المعلمة" : "أنشئي حسابي") : "دخول";
    el.querySelector("[data-hint]").textContent = mode === "new" && role === "student" && RST.classes.length ? "اكتبي اسمك كما في قائمة صفك: اسمك واسم أبيك واسم جدك، فيُعرف صفك تلقائيًّا. احفظي الرقم السري جيدًا." : mode === "new" && role === "parent" ? "اكتب اسمك الثلاثي ورقمًا سريًّا تختاره، ثم اختر صف ابنتك واسمها. تظهر لك متابعتها بعد موافقة المعلمة." : mode === "new" ? "الاسم الثلاثي هو اسم الدخول، ولا يتكرر. احفظ الرقم السري جيدًا، فلا يمكن استرجاعه إلا عن طريق المعلمة." : "يبقى الدخول محفوظًا على هذا الجهاز حتى تضغط «خروج».";
    msg(M, "");
  }
  el.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { mode = b.dataset.m; paint(); });
  el.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { role = b.dataset.r; paint(); });
  el.querySelector(".eye").onclick = () => { f.p.type = f.p.type === "password" ? "text" : "password"; };
  if (f.sid) bindPicker(f);
  f.onsubmit = async e => {
    e.preventDefault(); const name = f.n.value, pin = f.p.value.trim();
    const en = checkName(name); if (en) { msg(M, en); f.n.focus(); return; }
    const ep = checkPin(pin); if (ep) { msg(M, ep); f.p.focus(); return; }
    if (mode === "new" && pin !== f.p2.value.trim()) { msg(M, "الرقمان السريان غير متطابقين."); f.p2.focus(); return; }
    const kid = mode === "new" && f.sid ? rosterStudent(f.sid.value) : null;
    if (mode === "new" && f.sid && !kid) { msg(M, "اختر صف ابنتك ثم اسمها."); f.cls.focus(); return; }
    const btn = el.querySelector("[data-go]"); btn.disabled = true; const t0 = btn.textContent; btn.textContent = "لحظة…";
    try {
      const me = mode === "new" ? await acct.register(name, pin, role, f.c ? f.c.value.trim() : "") : await acct.login(name, pin);
      if (kid) { const skey = "r:" + kid.id; try { await store.set("links", UID + "_" + skey, { parentUid: UID, parentName: me.name, skey, studentName: kid.n, cls: kid.cls, status: "pending", createdAt: now() }); } catch (x) {} }
      IS_T = !!me.admin; toast(mode === "new" ? "أهلًا " + me.name.split(" ")[0] + "! أُنشئ حسابك ✓" + (me.cls ? " · " + CLS(me.cls) : "") : "أهلًا بعودتك " + me.name.split(" ")[0]);
      await refreshMe(); o.onDone && o.onDone(me);
    } catch (err) { msg(M, err.message || ERR.bad); }
    finally { btn.disabled = false; btn.textContent = t0; if (!el.isConnected) return; }
  };
  paint();
}
async function doLogout() { loginRole = "student"; await acct.logout(); toast("خرجت من حسابك"); await refreshMe(); route(); }

/* ================= ME (account page) ================= */
async function refreshMe() {
  if (ME && UID) { try { const p = await loadProfile(UID); if (p) ME = p; } catch (e) {} }
  $("#meTxt").textContent = ME ? (ME.role === "teacher" ? "لوحة المعلمة" : ME.name.split(" ")[0]) : "دخول";
  const hb = $("#meTxt").closest("a"); if (hb) hb.setAttribute("href", ME && ME.role === "teacher" ? "#teacher" : ME && ME.role === "parent" ? "#parents" : "#register");
  await Promise.all([myResults(), loadMyPoints()]); renderAxes();
  $("#fPts").textContent = isStu() ? ar(myTotal()) + " نقطة" : "سجّلي لتجمعي النقاط";
}
async function loadAccount() {
  await refreshMe();
  const A = $("#regAuth"), I = $("#meInfo");
  if (!ME) {
    const who = loginRole;
    A.innerHTML = `<div class="seg seg-main who-seg" role="tablist" aria-label="من أنت؟">${[["student", "طالبة"], ["parent", "وليّ أمر"], ["teacher", "المعلمة"]].map(([r, t]) => `<button type="button" data-who="${r}" aria-pressed="${r === who}">${t}</button>`).join("")}</div><div id="whoBox"></div>`;
    A.querySelectorAll("[data-who]").forEach(b => b.onclick = () => { loginRole = b.dataset.who; loadAccount(); });
    const box = $("#whoBox");
    if (who === "student") studentAuth(box, () => { location.hash = "register"; loadAccount(); });
    else if (who === "parent") { await rosterReady(); authForm(box, { fixed: "parent", daughter: true, title: "دخول وليّ الأمر", onDone: () => { location.hash = "parents"; } }); }
    else teacherAuth(box, () => { location.hash = "teacher"; });
    I.innerHTML = who === "student" ? `<h3 style="font-size:20px;font-weight:900">كيف أدخل؟</h3><ul class="why"><li>اختاري صفك ثم اسمك من القائمة، فأسماء طالبات الصف مُدخلة مسبقًا.</li><li>اكتبي رقمك السري (ستة أرقام) الذي أعطتك إياه المعلمة، ولا حاجة إلى إنشاء حساب.</li><li>تُحفظ نتائجك ونقاطك وتلخيصاتك، وتتابعك المعلمة ووليّ أمرك.</li></ul>`
      : who === "parent" ? `<h3 style="font-size:20px;font-weight:900">كيف يتابع وليّ الأمر؟</h3><ul class="why"><li>أول مرة: اضغط «حساب جديد»، واكتب اسمك الثلاثي ورقمًا سريًّا تختاره، ثم اختر صف ابنتك واسمها.</li><li>تراجع المعلمة الطلب وتوافق عليه، فلا يرى أي وليّ أمر إلا ابنته.</li><li>بعدها تدخل من «تسجيل الدخول» فتجد تقييم ابنتك ودرجاتها ونقاطها وملاحظات المعلمة.</li></ul>`
      : `<h3 style="font-size:20px;font-weight:900">لوحة المعلمة</h3><ul class="why"><li>اكتبي رقمك السري فقط، فالاسم ثابت.</li><li>من اللوحة: طلبات أولياء الأمور، والتقييم، والاختبارات، والإعلانات، وحسابات الطالبات.</li></ul>`;
    return;
  }
  if (ME.role === "parent") { A.innerHTML = `<div class="msg ok">أنت مسجّل الدخول باسم «${esc(ME.name)}» (ولي أمر).</div><div class="row" style="margin-top:14px"><a class="pill-btn teal" href="#parents">صفحة المتابعة</a><button class="pill-btn ghost" data-out>خروج</button></div>`; }
  else if (ME.role === "teacher") { A.innerHTML = `<div class="msg ok">مرحبًا أ. ${esc(ME.name)}.</div><div class="row" style="margin-top:14px"><a class="pill-btn teal" href="#teacher">لوحة المعلمة</a><button class="pill-btn ghost" data-out>خروج</button></div>`; }
  else A.innerHTML = `<div class="msg ok">أنتِ مسجّلة الدخول باسم «${esc(ME.name)}». تُحفظ نتائجك وألعابك ونقاطك تلقائيًّا.</div><div class="row" style="margin-top:14px"><a class="pill-btn orange" href="#units">ادرسي الوحدات</a><a class="pill-btn ghost" href="#summary">اكتبي تلخيصًا</a><button class="pill-btn ghost" data-out>خروج</button></div>`;
  A.querySelector("[data-out]").onclick = doLogout;
  const tests = RESULTS.filter(r => r.kind === "test").sort(byTime), games = RESULTS.filter(r => r.kind === "game").length;
  I.innerHTML = `<div style="display:flex;gap:14px;align-items:center"><span class="avatar">${esc(ini(ME.name))}</span><div><b style="font-size:20px;color:var(--ink)">${esc(ME.name)}</b><br><span class="muted">${ROLE_AR[ME.role] || ""}${ME.cls ? " · الصف " + esc(CLS(ME.cls)) : ""}</span></div></div>
  ${ME.role === "student" ? `<div class="mestats"><div><b data-mypts>${ar(myTotal())}</b><span>نقطة</span></div><div><b>${ar([...MYPTS.values()].filter(p => p.kind === "novel").length)}</b><span>رواية</span></div><div><b>${ar(tests.length)}</b><span>اختبار</span></div><div><b>${ar(games)}</b><span>لعبة</span></div></div>
  <div class="row" style="margin-top:10px"><a class="pill-btn soft" href="#leaders">🏆 لوحة المتصدرات</a><a class="pill-btn soft" href="#read">📖 اقرئي رواية</a><a class="pill-btn soft" href="#tasks">💬 من المعلمة</a><a class="pill-btn soft" href="#survey">📝 الاستبيان</a></div>
  ${MYPTS.size ? `<div class="sub-h" style="margin-top:14px">آخر نقاطك</div><div class="pts-log">${[...MYPTS.values()].sort(byTime).slice(0, 8).map(p => `<div><span>${PTS_IC[p.kind] || "⭐"}</span><span class="grow">${esc(PTS_AR[p.kind] || "")}${p.label ? `: ${esc(p.label)}` : ""}</span><b>${plus(p.pts)}</b></div>`).join("")}</div>` : ""}
  <div style="margin-top:10px">${tests.length ? `<table class="res-table"><thead><tr><th>الوحدة</th><th>الدرجة</th><th>التاريخ</th></tr></thead><tbody>${tests.slice(0, 12).map(r => { const u = UNITS.find(x => x.id === r.unit); return `<tr><td>${u ? esc(u.theme) : ""}</td><td><b>${ar(r.score)}/${ar(r.total)}</b></td><td>${fmtDate(r.createdAt)}</td></tr>`; }).join("")}</tbody></table>` : `<span class="muted">لم تحلّي اختبارًا تدريبيًّا بعد.</span>`}</div>` : ""}`;
}

/* ================= POINTS =================
   every reward is a document basira_points/{uid}_{kind}_{ref}: the id makes it count once only,
   and basira_scores/{uid} keeps the running total that the leaderboard reads (checked by the rules) */
const PTS = { novel: 30, novelq: 10, book: 20, game: 10, test: 10, testx: 10, act: 2, quiz: 15 };
const PTS_AR = { novel: "قراءة رواية", novelq: "اختبار الرواية بلا أخطاء", book: "قراءة كتاب من المكتبة", game: "إنهاء لعبة وحدة", test: "حلّ اختبار تدريبي", testx: "إتقان الاختبار (٨٥٪ فأكثر)", act: "حلّ نشاط", quiz: "حلّ اختبار المعلمة" };
const PTS_IC = { novel: "📖", novelq: "🧠", book: "📚", game: "🎮", test: "📝", testx: "🏅", act: "✏️", quiz: "🎯", teacher: "⭐" };
let MYPTS = new Map(), SCORE = 0, ptsQ = Promise.resolve();
const isStu = () => !!(ME && UID && ME.role === "student");
const ptId = (kind, ref) => UID + "_" + kind + "_" + String(ref).slice(0, 40);
const hasPt = (kind, ref) => !!UID && MYPTS.has(ptId(kind, ref));
const myTotal = () => SCORE + ((ME && ME.points) || 0);
async function loadMyPoints() {
  MYPTS = new Map(); SCORE = 0; if (!isStu()) return;
  try { (await store.list("points", ["uid", UID])).forEach(p => MYPTS.set(p.id, p)); } catch (e) {}
  try { const s = await store.get("scores", UID); SCORE = s ? (s.total || 0) : 0; } catch (e) { SCORE = [...MYPTS.values()].reduce((a, p) => a + (p.pts || 0), 0); }
}
function updPts() {
  const t = ar(myTotal());
  if (isStu()) $("#fPts").textContent = t + " نقطة";
  $$("[data-mypts]").forEach(e => e.textContent = t);
}
function award(kind, ref, label, quiet) {
  if (!isStu() || !PTS[kind]) return Promise.resolve({ need: true });
  const id = ptId(kind, ref);
  if (MYPTS.has(id)) return Promise.resolve({ dup: true });
  const run = async () => {
    if (MYPTS.has(id)) return { dup: true };
    const pts = PTS[kind], doc = { uid: UID, name: ME.name, kind, ref: String(ref).slice(0, 40), label: String(label || "").slice(0, 80), pts, createdAt: now() };
    for (let tries = 0; tries < 2; tries++) {
      try {
        let total;
        if (db) {
          const s = await db.collection(P + "scores").doc(UID).get(); total = (s.exists ? (s.data().total || 0) : 0) + pts;
          const b = db.batch();
          b.set(db.collection(P + "points").doc(id), doc);
          b.set(db.collection(P + "scores").doc(UID), { name: ME.name, total, last: id, updatedAt: now() });
          await b.commit();
        } else {
          if (await store.get("points", id)) { MYPTS.set(id, { id, ...doc }); return { dup: true }; }
          const s = await store.get("scores", UID); total = ((s && s.total) || 0) + pts;
          await store.set("points", id, doc); await store.set("scores", UID, { name: ME.name, total, last: id, updatedAt: now() });
        }
        SCORE = total; MYPTS.set(id, { id, ...doc }); updPts();
        toast(quiet ? `+${ar(pts)} نقطة ✨` : `+${ar(pts)} نقطة 🎉 ${PTS_AR[kind]}`);
        return { ok: true, pts };
      } catch (e) { if (tries) return { err: true }; await loadMyPoints(); if (MYPTS.has(id)) return { dup: true }; }
    }
    return { err: true };
  };
  ptsQ = ptsQ.then(run, run); return ptsQ;
}
const plus = n => `<span dir="ltr">+${ar(n)}</span>`;
const ini = s => { const c = String(s || "").trim()[0] || ""; return c === "ه" ? "هـ" : c; };
function ptsNudge() { return `<a href="#register">سجّلي الدخول بحسابك</a> لتُحسب لكِ النقاط وتظهري في لوحة المتصدرات.`; }

/* ================= NOVELS («اقرئي») ================= */
const NOVELS = window.BASIRA_NOVELS || [];
const NV_GENRE = {
  "غموض": ["#1F2A5C", "#4B4FA8", "🗝️"], "مغامرة": ["#7A3B12", "#C0611A", "⛰️"], "تاريخية": ["#6B4A1E", "#B58A3C", "🏺"],
  "خيال علمي": ["#0F3D4C", "#1C8C9E", "🤖"], "صداقة": ["#8E2F55", "#D85F84", "✉️"], "بيئة": ["#11523D", "#2E9A6B", "🐢"],
  "مدرسية": ["#064E57", "#0A6E79", "🎓"], "أسرة": ["#5B3A8C", "#8C6BC2", "🏡"], "خيال": ["#2B1F5C", "#6D4BC2", "✨"],
  "مجتمع": ["#3E5A1E", "#7A9A32", "💧"], "فن ومثابرة": ["#7C2D2D", "#C25A3C", "🖋️"]
};
const NV_ICON = { n1: "📜", n2: "⭐", n3: "🦪", n4: "🤖", n5: "✉️", n6: "🐢", n7: "⚖️", n8: "🌫️", n9: "📚", n10: "💧", n11: "⏳", n12: "🐪", n13: "🖋️", n14: "🎤", n15: "📈" };
const nvWords = n => n.chapters.reduce((s, c) => s + c.text.split(/\s+/).length, 0);
const nvMins = n => Math.max(5, Math.round(nvWords(n) / 170));
const nvCol = n => NV_GENRE[n.genre] || ["#064E57", "#0A6E79", "📖"];
const NVK = id => "basira:nv:" + id;
const nvPos = id => { try { return JSON.parse(localStorage.getItem(NVK(id)) || "null"); } catch (e) { return null; } };
const nvSave = (id, v) => { try { localStorage.setItem(NVK(id), JSON.stringify(v)); } catch (e) {} };
let nvFilter = "الكل", nvFont = (() => { try { return +localStorage.getItem("basira:nvfont") || 19; } catch (e) { return 19; } })();
function nvCover(n, big) {
  const [c1, c2] = nvCol(n);
  return `<div class="nv-cover${big ? " big" : ""}" style="--c1:${c1};--c2:${c2}"><span class="nv-ic">${NV_ICON[n.id] || nvCol(n)[2]}</span><span class="nv-g">${esc(n.genre)}</span><b>${esc(n.title)}</b><small>روايات البصيرة</small></div>`;
}
async function loadRead(nid, ch) {
  await refreshMe();
  const done = NOVELS.filter(n => hasPt("novel", n.id)).length; $("#nvDone").textContent = ar(done);
  if (nid) { const n = NOVELS.find(x => x.id === nid); if (n) { $("#nvList").hidden = true; $("#reader").hidden = false; openNovel(n, ch); return; } }
  $("#nvList").hidden = false; $("#reader").hidden = true;
  const genres = ["الكل", ...new Set(NOVELS.map(n => n.genre))];
  $("#nvFilters").innerHTML = genres.map(g => `<button class="chip-f" aria-pressed="${g === nvFilter}" data-g="${esc(g)}">${g === "الكل" ? "الكل" : (nvCol({ genre: g })[2] + " " + esc(g))}</button>`).join("");
  $$("#nvFilters [data-g]").forEach(b => b.onclick = () => { nvFilter = b.dataset.g; loadRead(); });
  const list = NOVELS.filter(n => nvFilter === "الكل" || n.genre === nvFilter);
  $("#nvGrid").innerHTML = list.map(n => {
    const read = hasPt("novel", n.id), pos = nvPos(n.id), started = !read && pos && pos.ch > 0;
    return `<a class="nv-card" href="#read-${n.id}">${nvCover(n)}<div class="nv-b"><h3>${esc(n.title)}</h3><p>${esc(n.blurb)}</p><div class="nv-meta"><span>⏱ ${ar(nvMins(n))} دقائق</span><span>${ar(n.chapters.length)} فصول</span>${read ? `<span class="ok">✓ قرأتِها</span>` : started ? `<span class="go">تابعي: الفصل ${ar(pos.ch + 1)}</span>` : `<span class="pts">${plus(PTS.novel)} نقطة</span>`}</div></div></a>`;
  }).join("");
}
function openNovel(n, ch) {
  const R = $("#reader"), last = n.chapters.length; // index "last" = the closing page (words, quiz, «لقد قرأتُ»)
  let i = ch != null ? ch : ((nvPos(n.id) || {}).ch || 0); i = Math.max(0, Math.min(last, i));
  nvSave(n.id, { ch: i, t: now() });
  const [c1, c2] = nvCol(n);
  const steps = n.chapters.map((c, k) => `<button class="nv-step${k === i ? " on" : ""}${k < i ? " past" : ""}" data-ch="${k}" title="${esc(c.title)}">${ar(k + 1)}</button>`).join("") + `<button class="nv-step end${i === last ? " on" : ""}" data-ch="${last}" title="ختام الرواية">✓</button>`;
  let body;
  if (i < last) {
    const c = n.chapters[i];
    body = `<article class="nv-text" style="font-size:${nvFont}px"><div class="nv-chn">الفصل ${ORDL[i] || ar(i + 1)}</div><h3>${esc(c.title)}</h3>${c.text.split(/\n\s*\n/).map(p => `<p>${esc(p.trim())}</p>`).join("")}</article>
    <div class="nv-nav">${i > 0 ? `<button class="pill-btn ghost" data-go="${i - 1}">→ الفصل السابق</button>` : `<span></span>`}<button class="pill-btn orange big" data-go="${i + 1}">${i + 1 < last ? "الفصل التالي ←" : "ختام الرواية ←"}</button></div>`;
  } else {
    const read = hasPt("novel", n.id), qd = hasPt("novelq", n.id);
    body = `<div class="nv-end">
      <div class="card nv-vals"><div class="sub-h">قيم في الرواية</div><div class="row">${n.values.map(v => `<span class="chip-v">${esc(v)}</span>`).join("")}</div></div>
      <div class="card"><div class="sub-h">📘 معاني كلمات</div><div class="nv-vocab">${n.vocab.map(v => `<div><b>${esc(v.w)}</b><span>${esc(v.m)}</span></div>`).join("")}</div></div>
      <div class="card"><div class="sub-h">🧠 اختبري فهمك ${qd ? `<span class="chip-s done-badge">✓ أنجزتِه</span>` : `<span class="chip-s">${plus(PTS.novelq)} نقاط إن أجبتِ كلها من المحاولة الأولى</span>`}</div><div id="nvQuiz"></div></div>
      <div class="card"><div class="sub-h">💬 للنقاش</div><ol class="nv-disc">${n.discuss.map(d => `<li>${esc(d)}</li>`).join("")}</ol><a class="pill-btn ghost" href="#summary" data-sum>اكتبي رأيك في ورقة التلخيص</a></div>
      <div class="nv-done${read ? " is" : ""}" id="nvDoneBox">${read
        ? `<div class="big-ok">✓</div><h3>قرأتِ هذه الرواية</h3><p>أُضيفت ${ar(PTS.novel)} نقطة إلى رصيدك. اختاري روايتك التالية!</p><div class="row" style="justify-content:center"><a class="pill-btn orange" href="#read">روايات أخرى</a><a class="pill-btn ghost" href="#leaders">لوحة المتصدرات</a></div>`
        : `<h3>أنهيتِ «${esc(n.title)}»؟</h3><p>اضغطي الزر لتُسجَّل قراءتك وتحصلي على <b>${ar(PTS.novel)} نقطة</b>.</p><button class="pill-btn orange big" id="nvRead">📖 لقد قرأتُ الرواية</button><div class="muted" id="nvReadMsg" style="font-size:14px;margin-top:8px">${isStu() ? "" : ptsNudge()}</div>`}</div>
    </div>`;
  }
  R.innerHTML = `<div class="nv-head" style="--c1:${c1};--c2:${c2}">${nvCover(n, true)}<div class="nv-hd"><a class="nv-back" href="#read">→ كل الروايات</a><span class="nv-g2">${esc(n.genre)} · ⏱ ${ar(nvMins(n))} دقائق</span><h2>${esc(n.title)}</h2><p>${esc(n.blurb)}</p></div></div>
  <div class="nv-bar"><div class="nv-steps">${steps}</div><div class="nv-font" aria-label="حجم الخط"><button data-fs="-1" aria-label="تصغير الخط">أ−</button><button data-fs="1" aria-label="تكبير الخط">أ+</button></div></div>
  <div class="nv-prog"><i style="width:${Math.round(i / last * 100)}%"></i></div>
  <div class="nv-wrap">${body}</div>`;
  const go = k => { location.hash = "read-" + n.id + "-" + k; };
  R.querySelectorAll("[data-ch]").forEach(b => b.onclick = () => go(+b.dataset.ch));
  R.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(+b.dataset.go));
  R.querySelectorAll("[data-fs]").forEach(b => b.onclick = () => { nvFont = Math.max(15, Math.min(26, nvFont + 2 * b.dataset.fs)); try { localStorage.setItem("basira:nvfont", nvFont); } catch (e) {} const t = R.querySelector(".nv-text"); if (t) t.style.fontSize = nvFont + "px"; });
  const sum = R.querySelector("[data-sum]"); if (sum) sum.addEventListener("click", () => setTimeout(() => { $("#sBook").value = n.title; $("#sAuthor").value = "روايات البصيرة"; }, 60));
  if (i === last) { nvQuiz(n); const b = $("#nvRead"); if (b) b.onclick = async () => {
    if (!isStu()) { $("#nvReadMsg").innerHTML = ptsNudge(); return; }
    b.disabled = true; const r = await award("novel", n.id, n.title);
    if (r.ok || r.dup) { openNovel(n, last); confetti(); } else { b.disabled = false; $("#nvReadMsg").textContent = "لم تُسجَّل القراءة الآن، تأكدي من الاتصال ثم أعيدي المحاولة."; }
  }; }
}
function nvQuiz(n) {
  const box = $("#nvQuiz"); let k = 0, first = 0, tried = false;
  const draw = () => {
    if (k >= n.quiz.length) {
      const all = first === n.quiz.length;
      box.innerHTML = `<div class="verdict ${all ? "ok" : "soft"}"><b>${all ? "أجبتِ الأسئلة كلها من المحاولة الأولى! 🌟" : `أجبتِ ${ar(first)} من ${ar(n.quiz.length)} من المحاولة الأولى`}</b><div><button class="mini" data-re>أعيدي الأسئلة</button></div></div>`;
      box.querySelector("[data-re]").onclick = () => { k = 0; first = 0; draw(); };
      if (all) award("novelq", n.id, n.title);
      return;
    }
    const q = n.quiz[k]; tried = false;
    box.innerHTML = `<div class="muted" style="font-size:13px">سؤال ${ar(k + 1)} من ${ar(n.quiz.length)}</div><h4 style="margin:4px 0 10px">${esc(q.q)}</h4><div class="opts">${q.opts.map((o, j) => `<button class="opt" data-j="${j}">${esc(o)}</button>`).join("")}</div><div data-v></div>`;
    box.querySelectorAll("[data-j]").forEach(b => b.onclick = () => {
      if (box._lock) return; const j = +b.dataset.j;
      if (j === q.a) { if (!tried) first++; b.classList.add("right"); verdict(box.querySelector("[data-v]"), true, q.explain); box._lock = true;
        box.querySelector("[data-v]").insertAdjacentHTML("beforeend", `<div style="margin-top:8px"><button class="pill-btn teal" data-next>${k + 1 < n.quiz.length ? "السؤال التالي ←" : "النتيجة"}</button></div>`);
        box.querySelector("[data-next]").onclick = () => { box._lock = false; k++; draw(); };
      } else { tried = true; b.classList.add("soft"); b.disabled = true; verdict(box.querySelector("[data-v]"), false, ""); }
    });
  };
  draw();
}
function confetti() {
  const c = document.createElement("div"); c.className = "confetti"; const cols = ["#EC7F16", "#0A6E79", "#D85F84", "#4B4FA8", "#FFD36B"];
  c.innerHTML = Array.from({ length: 70 }, (_, k) => `<i style="left:${Math.random() * 100}%;background:${cols[k % 5]};animation-delay:${Math.random() * .6}s;animation-duration:${1.6 + Math.random() * 1.4}s;transform:rotate(${Math.random() * 360}deg)"></i>`).join("");
  document.body.appendChild(c); setTimeout(() => c.remove(), 3600);
}

/* ================= LEADERBOARD ================= */
const short2 = s => String(s || "").split(" ").slice(0, 2).join(" ");
let lbCls = "";
async function loadLeaders() {
  await refreshMe();
  $("#ptsGuide").innerHTML = `<h3 style="font-size:20px;font-weight:900">كيف أجمع النقاط؟</h3><ul class="pts-guide">${Object.keys(PTS).map(k => `<li><span>${PTS_IC[k]}</span><b>${esc(PTS_AR[k])}</b><em>${plus(PTS[k])}</em></li>`).join("")}<li><span>${PTS_IC.teacher}</span><b>نقاط تمنحها المعلمة للمتميزات</b><em>★</em></li></ul><p class="muted" style="font-size:14px;margin:10px 0 0">تُحسب كل رواية وكل كتاب وكل لعبة واختبار ونشاط مرة واحدة فقط.</p>${isStu() ? `<div class="my-total"><span>رصيدك</span><b data-mypts>${ar(myTotal())}</b><span>نقطة</span></div>` : ""}`;
  const el = $("#leaders");
  if (db && !UID) { el.innerHTML = `<div class="empty"><b>لوحة المتصدرات للطالبات المسجّلات</b>سجّلي الدخول بحسابك لتري الترتيب. <div style="margin-top:12px"><a class="pill-btn orange" href="#register">دخول الطالبات</a></div></div>`; return; }
  el.innerHTML = `<div class="card muted">جارٍ تحميل الترتيب…</div>`;
  let sc = [], us = [];
  try { us = await store.list("users", ["role", "student"]); } catch (e) {}
  try { sc = await store.list("scores"); } catch (e) {}
  if (lbCls) us = us.filter(u => u.cls === lbCls);
  const m = new Map(us.map(u => [u.id, { id: u.id, name: u.name, cls: u.cls || "", total: u.points || 0 }]));
  sc.forEach(s => { const r = m.get(s.id); if (r) r.total += s.total || 0; });
  const rows = [...m.values()].filter(r => r.total > 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ar"));
  let rank = 0, prev = null; rows.forEach((r, k) => { if (r.total !== prev) { rank = k + 1; prev = r.total; } r.rank = rank; });
  const CH = clsChips(lbCls), bindCh = () => $$("#leaders [data-cls]").forEach(b => b.onclick = () => { lbCls = b.dataset.cls; loadLeaders(); });
  if (!rows.length) { el.innerHTML = CH + `<div class="empty"><b>لم تجمع أي طالبة ${lbCls ? "من هذا الصف " : ""}نقاطًا بعد</b>كوني الأولى! اقرئي رواية أو العبي لعبة وحدة.<div class="row" style="justify-content:center;margin-top:12px"><a class="pill-btn orange" href="#read">اقرئي رواية</a><a class="pill-btn ghost" href="#games">العبي</a></div></div>`; bindCh(); return; }
  const top = rows.slice(0, 3), medal = ["🥇", "🥈", "🥉"], order = [1, 0, 2];
  const pod = `<div class="podium">${order.filter(k => top[k]).map(k => { const r = top[k]; return `<div class="pod p${k + 1}${r.id === UID ? " me" : ""}"><span class="pav">${esc(ini(r.name))}</span><b>${esc(short2(r.name))}</b>${r.cls && !lbCls ? `<small class="muted">${esc(CLS(r.cls))}</small>` : ""}<span class="ppts">${ar(r.total)} نقطة</span><div class="pbar"><span>${medal[r.rank - 1] || ar(r.rank)}</span></div></div>`; }).join("")}</div>`;
  const rest = rows.slice(3, 30), meRow = rows.find(r => r.id === UID), meOut = meRow && rows.indexOf(meRow) >= 30;
  el.innerHTML = CH + pod + (rest.length || meOut ? `<div class="card lb-list">${rest.map(r => lbRow(r)).join("")}${meOut ? `<div class="lb-gap">⋯</div>` + lbRow(meRow) : ""}</div>` : "") +
    (isStu() && !meRow ? `<p class="note" style="margin-top:14px">لم تظهري في اللوحة بعد: أول رواية تقرئينها تضعك فيها! <a href="#read">اقرئي الآن</a></p>` : "");
  bindCh();
}
const lbRow = r => `<div class="lb-row${r.id === UID ? " me" : ""}"><span class="lb-r">${ar(r.rank)}</span><span class="lb-av">${esc(ini(r.name))}</span><b class="grow">${esc(short2(r.name))}${r.id === UID ? ` <small>(أنتِ)</small>` : ""}${r.cls && !lbCls ? ` <small class="muted">${esc(CLS(r.cls))}</small>` : ""}</b><span class="lb-p">${ar(r.total)}</span></div>`;

/* ================= HOME / ABOUT ================= */
async function siteData() { try { const s = await store.get("site", "main"); return { ...DEFAULT_SITE, ...(s || {}) }; } catch (e) { return DEFAULT_SITE; } }
function loadHome() { renderAxes(); }
async function loadAbout() { const s = await siteData(); $("#aboutDesc").textContent = s.desc; $("#aboutGoals").innerHTML = s.goals.split("\n").filter(x => x.trim()).map((g, i) => `<div class="goal"><span class="n">${ar(i + 1)}</span><span>${esc(g)}</span></div>`).join(""); }

/* ================= BOOKS ================= */
const COVERS = ["linear-gradient(160deg,#0A6E79,#13919C)", "linear-gradient(160deg,#EC7F16,#F3A24B)", "linear-gradient(160deg,#C84A72,#E0688A)", "linear-gradient(160deg,#4B4FA8,#6D72C7)"];
const FIXED_BOOKS = [{ title: "لغتي الجميلة · الصف العاشر · الفصل الدراسي الأول", author: "وزارة التعليم – سلطنة عُمان", desc: "كتاب الطالبة كاملًا: المحاور الثلاثة والوحدات التسع. افتحيه للقراءة أو للرجوع إلى صفحة أي درس.", url: BOOK_URL, color: 0, fixed: true }];
async function loadBooks() {
  await refreshMe();
  const el = $("#books"); let b = []; try { b = (await store.list("books")).sort(byTime); } catch (e) {}
  b = FIXED_BOOKS.concat(b);
  el.innerHTML = b.map((x, i) => `<div class="card book"><div class="cover" style="background:${COVERS[(x.color ?? i) % 4]}">${esc(x.title.split("·")[0].slice(0, 34))}</div><div class="info"><h3>${esc(x.title)}</h3>${x.author ? `<span class="muted" style="font-size:14px">${esc(x.author)}</span>` : ""}<p>${esc(x.desc || "")}</p><div class="row" style="margin-top:auto">${x.url ? `<a class="pill-btn teal" href="${esc(x.url)}" target="_blank" rel="noopener">اقرئي الكتاب</a>` : ""}${x.fixed ? `<a class="pill-btn ghost" href="#units">الدروس مشروحة</a>` : `<a class="pill-btn ghost" href="#summary" data-book="${esc(x.title)}">لخّصيه</a>`}${x.id ? (hasPt("book", x.id) ? `<span class="chip-s done-badge">✓ قرأتِه</span>` : `<button class="pill-btn soft" data-read="${esc(x.id)}" data-t="${esc(x.title)}">📚 قرأتُ الكتاب ${plus(PTS.book)}</button>`) : ""}</div></div></div>`).join("");
  $$("#books [data-read]").forEach(btn => btn.onclick = async () => {
    if (!isStu()) { toast("سجّلي الدخول بحسابك لتُحسب لكِ النقاط"); location.hash = "register"; return; }
    btn.disabled = true; const r = await award("book", btn.dataset.read, btn.dataset.t);
    if (r.ok || r.dup) { btn.outerHTML = `<span class="chip-s done-badge">✓ قرأتِه</span>`; confetti(); } else { btn.disabled = false; toast("لم تُسجَّل القراءة، تأكدي من الاتصال"); } });
  $$("#books [data-book]").forEach(a => a.addEventListener("click", () => setTimeout(() => { $("#sBook").value = a.dataset.book; }, 60)));
}

/* ================= SUMMARY ================= */
async function loadSummary() {
  await refreshMe(); const okS = ME && ME.role === "student";
  $("#sumName").textContent = okS ? ME.name : "سجّلي الدخول أولًا"; $("#sumName").className = okS ? "" : "muted"; $("#sumCls").textContent = okS && ME.cls ? CLS(ME.cls) : "العاشر";
  const el = $("#mySums"); let s = []; if (okS) { try { s = (await store.list("summaries", ["uid", UID])).sort(byTime); } catch (e) {} }
  el.innerHTML = s.length ? s.map(x => `<div class="li"><div class="grow"><b>${esc(x.book)}</b><br><span class="muted" style="font-size:14px">${esc(x.author)} · ${fmtDate(x.createdAt)}</span></div><span class="status ${x.status === "published" ? "approved" : "pending"}">${x.status === "published" ? "نُشر في المشاركات" : "وصل للمعلمة"}</span></div>`).join("") : `<p class="muted" style="margin:6px 0 0">لم ترسلي تلخيصًا بعد.</p>`;
}
$("#sumForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!ME || ME.role !== "student") { msg($("#sumMsg"), "سجّلي الدخول بحسابك أولًا من صفحة «دخول / تسجيل»."); return; }
  const v = { uid: UID, name: ME.name, book: $("#sBook").value.trim(), author: $("#sAuthor").value.trim(), text: $("#sText").value.trim(), status: "new", createdAt: now() };
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
const ST_AR = { pending: "بانتظار موافقة المعلمة", approved: "تمت الموافقة", rejected: "لم تتم الموافقة" };
async function loadParents() {
  await refreshMe();
  const A = $("#parAuth"), area = $("#parentArea");
  if (!ME || ME.role !== "parent") {
    area.innerHTML = ""; $("#parHow").hidden = false; A.style.gridColumn = "";
    if (ME) { A.innerHTML = `<div class="msg bad">هذه الصفحة لأولياء الأمور. أنت مسجّل الدخول بحساب ${ROLE_AR[ME.role]}.</div><button class="pill-btn ghost" style="margin-top:12px" data-out>خروج ثم دخول بحساب ولي الأمر</button>`; A.querySelector("[data-out]").onclick = doLogout; return; }
    await rosterReady(); authForm(A, { fixed: "parent", daughter: true, title: "دخول ولي الأمر", onDone: () => loadParents() }); return;
  }
  $("#parHow").hidden = true; A.style.gridColumn = "1 / -1";
  A.innerHTML = `<div class="row" style="justify-content:space-between"><div><b style="font-size:19px">${esc(ME.name)}</b><br><span class="muted">ولي أمر</span></div><div class="row"><a class="mini" href="#survey">📝 الاستبيان</a><button class="mini" data-out>خروج</button></div></div>`;
  A.querySelector("[data-out]").onclick = doLogout;
  let links = []; try { links = (await store.list("links", ["parentUid", UID])).sort(byTime); } catch (e) {}
  area.innerHTML = `<div class="grid2" style="margin-top:18px">
    <div class="card"><h3 class="auth-t">${links.length ? "إضافة ابنة أخرى" : "اختر ابنتك"}</h3><p class="muted" style="margin:0 0 10px">${links.length ? "إن كانت لك ابنة أخرى في الصفوف فاختر صفها واسمها." : "اختر الصف ثم اسم ابنتك وأرسل الطلب."} بعد موافقة المعلمة تظهر لك متابعتها أسفل الصفحة.</p><div id="pickBox"></div></div>
    <div class="card"><h3 class="auth-t">طلباتي</h3><div class="list" id="myLinks">${links.length ? links.map(l => `<div class="li"><div class="grow"><b>${esc(l.studentName)}</b><br><span class="muted" style="font-size:13.5px">${l.cls ? esc(CLS(l.cls)) + " · " : ""}${fmtDate(l.createdAt)}</span></div><span class="status ${l.status}">${ST_AR[l.status]}</span></div>`).join("") : `<p class="muted">لم ترسل طلبًا بعد.</p>`}</div></div>
  </div><div id="follow"></div>`;
  const pb = $("#pickBox");
  withRoster(pb, () => {
    pb.innerHTML = `<form class="form" novalidate>${pickerHTML("اسم ابنتك")}<button class="pill-btn orange" type="submit">هذه ابنتي، أرسل الطلب</button><div data-msg></div></form>`;
    const f = pb.querySelector("form"), M = f.querySelector("[data-msg]"); bindPicker(f);
    f.onsubmit = async e => { e.preventDefault(); const st = rosterStudent(f.sid.value); if (!st) { msg(M, "اختر الصف ثم اسم ابنتك."); return; }
      const skey = "r:" + st.id; if (links.some(l => l.skey === skey)) { msg(M, "أرسلت طلبًا لهذا الاسم من قبل، وتجده في «طلباتي»."); return; }
      const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
      try { await store.set("links", UID + "_" + skey, { parentUid: UID, parentName: ME.name, skey, studentName: st.n, cls: st.cls, status: "pending", createdAt: now() }); toast("أُرسل الطلب إلى المعلمة"); loadParents(); }
      catch (err) { btn.disabled = false; msg(M, "لم يُرسل الطلب، حاول مرة أخرى."); } };
  });
  const ok = links.filter(l => l.status === "approved");
  for (const l of ok) await showFollow(l);
}
const PK_AR = { novel: "قرأت رواية", novelq: "أجابت أسئلة الرواية كلها", book: "قرأت كتابًا", game: "أنهت لعبة الوحدة", test: "حلّت الاختبار التدريبي", testx: "أتقنت الاختبار (٨٥٪ فأكثر)", act: "حلّت نشاطًا", quiz: "حلّت اختبار المعلمة" };
async function showFollow(l) {
  const box = document.createElement("div"); box.className = "card"; box.style.marginTop = "18px"; $("#follow").appendChild(box);
  const head = `<div class="row" style="justify-content:space-between;align-items:center"><div><h3 style="font-size:22px;font-weight:900;margin:0">متابعة ${esc(l.studentName)}</h3><span class="muted">${l.cls ? "الصف " + esc(CLS(l.cls)) : ""}</span></div>`;
  let st = null; try { st = (await store.list("users", ["key", l.skey || ""]))[0] || null; } catch (e) {}
  let ev = null, an = []; try { ev = await store.get("evals", l.skey); } catch (e) {}
  try { an = (await store.list("ann")).filter(a => forCls(a, l.cls)).sort(byTime).slice(0, 3); } catch (e) {}
  const evBlock = `<div class="sub-h" style="margin-top:16px">تقييم المعلمة</div>${evalCard(ev)}`;
  const anBlock = an.length ? `<div class="sub-h" style="margin-top:16px">إعلانات المعلمة لصفها</div><div class="anns sm">${an.map(annHTML).join("")}</div>` : "";
  if (!st) { box.innerHTML = head + `</div><p class="muted" style="margin:12px 0 0">لم تدخل ابنتك الموقع بعد. تدخل من «دخول الطالبات» بالرقم السري الذي أعطتها إياه المعلمة، ثم تظهر هنا نتائجها ونقاطها.</p>${evBlock}${anBlock}`; return; }
  const sid = st.id; let notes = [], res = [], pts = [], sc = 0, qr = [];
  try { qr = (await store.list("qres", ["uid", sid])).sort(byTime); } catch (e) {}
  try { const x = await store.get("scores", sid); sc = (x && x.total) || 0; } catch (e) {}
  try { pts = (await store.list("points", ["uid", sid])).sort(byTime); } catch (e) {}
  try { res = (await store.list("results", ["uid", sid])).sort(byTime); } catch (e) {}
  try { notes = (await store.list("notes", ["sid", sid])).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); } catch (e) {}
  const tests = res.filter(r => r.kind === "test"), games = res.filter(r => r.kind === "game"), total = sc + (st.points || 0);
  const avg = tests.length ? Math.round(tests.reduce((s, r) => s + r.score / r.total, 0) / tests.length * 100) : null;
  const uName = id => { const u = UNITS.find(x => x.id === id); return u ? u.theme : ""; };
  box.innerHTML = head + `<span class="stars" style="font-size:20px">${ar(total)} نقطة ★</span></div>
  <div class="mestats"><div><b>${ar(total)}</b><span>نقطة</span></div><div><b>${ar(pts.filter(p => p.kind === "act").length)}</b><span>نشاطًا محلولًا</span></div><div><b>${ar(tests.length)}</b><span>اختبارًا</span></div><div><b>${avg != null ? ar(avg) + "٪" : "—"}</b><span>متوسط الدرجات</span></div></div>
  <div class="sub-h" style="margin-top:16px">ملاحظات المعلمة</div><div class="notes">${notes.length ? notes.map(n => `<div class="bubble ${n.from === "parent" ? "p" : "t"}"><small>${n.from === "parent" ? "أنت" : "المعلمة"} · ${fmtDate(n.createdAt)}</small>${esc(n.text)}</div>`).join("") : `<p class="muted">لا توجد ملاحظات بعد.</p>`}</div>
  ${evBlock}
  ${qr.length ? `<div class="sub-h" style="margin-top:16px">اختبارات المعلمة</div><div class="tbl"><table class="res-table"><thead><tr><th>الاختبار</th><th>الدرجة</th><th>النسبة</th><th>التاريخ</th></tr></thead><tbody>${qr.map(r => { const pc = Math.round(r.score / r.total * 100); return `<tr><td>${esc(r.title || "")}</td><td><b>${ar(r.score)} من ${ar(r.total)}</b></td><td><span class="status ${pc >= 85 ? "approved" : pc >= 60 ? "pending" : "rejected"}">${ar(pc)}٪</span></td><td>${fmtDate(r.createdAt)}</td></tr>`; }).join("")}</tbody></table></div>` : ""}
  <div class="sub-h" style="margin-top:16px">الاختبارات التدريبية: الدرجات والتصحيح</div>${tests.length ? `<div class="tbl"><table class="res-table"><thead><tr><th>الوحدة</th><th>الدرجة</th><th>النسبة</th><th>التاريخ</th></tr></thead><tbody>${tests.map(r => { const pc = Math.round(r.score / r.total * 100); return `<tr><td>${esc(uName(r.unit))}</td><td><b>${ar(r.score)} من ${ar(r.total)}</b></td><td><span class="status ${pc >= 85 ? "approved" : pc >= 60 ? "pending" : "rejected"}">${ar(pc)}٪</span></td><td>${fmtDate(r.createdAt)}</td></tr>`; }).join("")}</tbody></table></div>` : `<p class="muted">لم تحلّ اختبارًا تدريبيًّا بعد.</p>`}
  ${games.length ? `<div class="sub-h" style="margin-top:16px">الألعاب</div><div class="tbl"><table class="res-table"><thead><tr><th>لعبة الوحدة</th><th>النتيجة</th><th>التاريخ</th></tr></thead><tbody>${games.slice(0, 12).map(r => `<tr><td>${esc(uName(r.unit))}</td><td><b>${ar(r.score)} من ${ar(r.total)}</b></td><td>${fmtDate(r.createdAt)}</td></tr>`).join("")}</tbody></table></div>` : ""}
  <div class="sub-h" style="margin-top:16px">ما أنجزته وحصلت به على نقاط</div>${pts.length ? `<div class="pts-log">${pts.slice(0, 30).map(p => `<div><span>${PTS_IC[p.kind] || "⭐"}</span><span class="grow">${esc(PK_AR[p.kind] || "")}${p.label ? `: ${esc(p.label)}` : ""} <small class="muted">${fmtDate(p.createdAt)}</small></span><b>${plus(p.pts)}</b></div>`).join("")}</div>` : `<p class="muted">لم تجمع نقاطًا بعد.</p>`}
  ${anBlock}
  <form class="form" style="margin-top:16px"><div class="field"><label>ملاحظة للمعلمة</label><textarea maxlength="600" style="min-height:80px" required></textarea></div><button class="pill-btn teal" type="submit">أرسل الملاحظة</button></form>`;
  box.querySelector("form").onsubmit = async e => { e.preventDefault(); const t = box.querySelector("textarea").value.trim(); if (!t) return;
    try { await store.add("notes", { sid, from: "parent", uid: UID, pname: ME.name, text: t, createdAt: now() }); toast("وصلت ملاحظتك"); box.remove(); showFollow(l); } catch (err) { toast("لم تُرسل الملاحظة"); } };
}

/* ================= TEACHER ================= */
/* the teacher's account is fixed: her name is set, she only types her PIN. the first correct login creates the account. */
const T_ACC = { key: "t:aisha", name: "عائشة الكحالي", h: "wH7u3rKg8DEBryJC" };
function teacherAuth(L, onDone) {
  L.innerHTML = `<h3 class="auth-t">دخول المعلمة</h3><form class="form" novalidate>
    <div class="field"><label>الاسم</label><input value="أ. ${T_ACC.name}" readonly tabindex="-1" style="background:var(--paper);font-weight:800"></div>
    <div class="field"><label>الرقم السري</label><div class="pinrow"><input name="p" type="password" inputmode="numeric" maxlength="12" dir="ltr" autocomplete="current-password" autofocus><button type="button" class="eye" aria-label="إظهار الرقم السري">👁</button></div></div>
    <button class="pill-btn orange big" type="submit" data-go>دخول</button><div data-msg></div>
    <p class="muted hint">يبقى الدخول محفوظًا على هذا الجهاز حتى تضغطي «تسجيل الخروج».</p></form>`;
  const f = L.querySelector("form"), M = f.querySelector("[data-msg]");
  f.querySelector(".eye").onclick = () => { f.p.type = f.p.type === "password" ? "text" : "password"; };
  f.onsubmit = async e => { e.preventDefault(); const pin = digits(f.p.value); if (!pin) { msg(M, "اكتبي الرقم السري."); return; }
    const btn = f.querySelector("[data-go]"); btn.disabled = true; btn.textContent = "لحظة…";
    try {
      if ((await pinHash(T_ACC.key, pin)) !== T_ACC.h) throw new Error("الرقم السري غير صحيح.");
      const opt = { key: T_ACC.key }; let me;
      try { me = await acct.login(T_ACC.name, pin, opt); }
      catch (x) { if (x.message !== ERR.bad && x.message !== ERR.gone) throw x; me = await acct.register(T_ACC.name, pin, "teacher", db ? "506887" : LOCAL_T_CODE, opt); }
      IS_T = !!me.admin; toast("أهلًا أ. عائشة"); await refreshMe(); if (onDone) onDone(); else loadTeacher();
    } catch (err) { msg(M, err.message || ERR.bad); }
    finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = "دخول"; } } };
}
async function loadTeacher() {
  await refreshMe(); IS_T = !!(ME && ME.admin);
  $("#tLogin").hidden = IS_T; $("#tPanel").hidden = !IS_T;
  if (!IS_T) {
    const L = $("#tLogin");
    if (ME) { L.innerHTML = `<div class="msg bad">هذه اللوحة للمعلمة فقط. أنت مسجّل الدخول بحساب ${ROLE_AR[ME.role]}.</div><button class="pill-btn ghost" style="margin-top:12px" data-out>خروج</button>`; L.querySelector("[data-out]").onclick = doLogout; return; }
    teacherAuth(L); return;
  }
  $("#tWho").textContent = "أ. " + ME.name; openTab(curTab);
}
$("#tOut").onclick = doLogout;
let curTab = "req";
$$("#tTabs button").forEach(b => b.onclick = () => openTab(b.dataset.t));
function openTab(t) { curTab = t; $$("#tTabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.t === t)); $$("[data-p]").forEach(p => p.hidden = p.dataset.p !== t);
  ({ stu: tStudents, acc: tAccounts, srv: tSurvey, ev: tEvals, quiz: tQuizzes, ann: tAnn, res: tResults, req: tRequests, sum: tSummaries, post: tPosts, book: tBooks, site: tSite }[t])(); badges(); }
async function badges() { try { const r = (await store.list("links", ["status", "pending"])).length; $("#reqN").hidden = !r; $("#reqN").textContent = ar(r); } catch (e) {} try { const s = (await store.list("summaries")).filter(x => x.status === "new").length; $("#sumN").hidden = !s; $("#sumN").textContent = ar(s); } catch (e) {} }
let tCls = "";
async function tStudents() {
  const el = $("#tStu"); let st = [], notes = []; try { st = (await store.list("users", ["role", "student"])).sort((a, b) => a.name.localeCompare(b.name, "ar")); notes = await store.list("notes"); } catch (e) {}
  let sc = {}; try { (await store.list("scores")).forEach(x => sc[x.id] = x.total || 0); } catch (e) {}
  $("#stuNames").innerHTML = st.map(s => `<option value="${esc(s.name)}">`).join("");
  const cnt = c => ar(st.filter(x => x.cls === c.id).length) + "/" + ar(c.n);
  const head = clsChips(tCls, cnt) + (RST.classes.length ? `<p class="muted" style="margin:0 0 6px">${tCls ? `${esc(CLS(tCls))}: دخلت ${ar(st.filter(x => x.cls === tCls).length)} من ${ar((RST.classes.find(c => c.id === tCls) || {}).n || 0)} طالبة` : `دخلت ${ar(st.length)} من ${ar(RST.classes.reduce((a, c) => a + c.n, 0))} طالبة في ${ar(RST.classes.length)} صفوف`}. أسماء الطالبات مُدخلة بصفوفهن، وتدخل الطالبة باختيار صفها واسمها.</p>` : "");
  const bind = () => $$("#tStu [data-cls]").forEach(b => b.onclick = () => { tCls = b.dataset.cls; tStudents(); });
  if (tCls) st = st.filter(x => x.cls === tCls);
  if (!st.length) { el.innerHTML = head + `<div class="empty"><b>لم تسجّل أي طالبة ${tCls ? "من هذا الصف " : ""}بعد</b>شاركي رابط الموقع مع الطالبات ليسجّلن أسماءهن.</div>`; bind(); return; }
  el.innerHTML = head + st.map(s => { const n = notes.filter(x => x.sid === s.id); return `<div class="li" data-s="${s.id}"><div class="grow"><b>${esc(s.name)}</b><br><span class="muted" style="font-size:14px">${s.cls ? esc(CLS(s.cls)) + " · " : ""}سُجّلت ${fmtDate(s.createdAt)}</span></div><span class="stars" title="نقاط النشاط ${ar(sc[s.id] || 0)} + نقاط المعلمة ${ar(s.points || 0)}">${ar((sc[s.id] || 0) + (s.points || 0))} ★</span><button class="mini o" data-a="plus">+٥ نقاط</button><button class="mini" data-a="minus">−٥</button><button class="mini" data-a="note">ملاحظة${n.length ? " (" + ar(n.length) + ")" : ""}</button><button class="mini no" data-a="del">حذف</button><div data-box style="flex-basis:100%" hidden></div></div>`; }).join("");
  bind();
  el.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => { const row = b.closest("[data-s]"), id = row.dataset.s, s = st.find(x => x.id === id);
    if (b.dataset.a === "plus" || b.dataset.a === "minus") { await store.update("users", id, { points: Math.max(0, (s.points || 0) + (b.dataset.a === "plus" ? 5 : -5)) }); tStudents(); }
    if (b.dataset.a === "del") { if (b.dataset.c) { await store.del("users", id); tStudents(); } else { b.dataset.c = 1; b.textContent = "تأكيد الحذف"; } }
    if (b.dataset.a === "note") { const box = row.querySelector("[data-box]"); box.hidden = !box.hidden; if (box.hidden) return; const nn = notes.filter(x => x.sid === id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      box.innerHTML = `<div class="notes">${nn.map(n => `<div class="bubble ${n.from === "parent" ? "p" : "t"}"><small>${n.from === "parent" ? "ولي الأمر" : "أنتِ"} · ${fmtDate(n.createdAt)}</small>${esc(n.text)}</div>`).join("") || '<span class="muted">لا ملاحظات بعد.</span>'}</div><div class="row" style="margin-top:8px"><input style="flex:1;border:1.5px solid var(--line);border-radius:12px;padding:8px 12px;min-width:0" placeholder="ملاحظة تظهر لولي الأمر بعد الموافقة"><button class="mini ok">إرسال</button></div>`;
      const inp = box.querySelector("input"); box.querySelector(".mini.ok").onclick = async () => { if (!inp.value.trim()) return; await store.add("notes", { sid: id, from: "teacher", text: inp.value.trim(), createdAt: now() }); toast("حُفظت الملاحظة"); tStudents(); }; }
  });
}
async function tResults() {
  const el = $("#tRes"); let r = [], st = []; try { r = await store.list("results"); st = await store.list("users", ["role", "student"]); } catch (e) {}
  r = r.filter(x => x.kind === "test");
  if (!st.length) { el.innerHTML = `<div class="empty"><b>لا توجد نتائج بعد</b>تظهر هنا درجات الطالبات في الاختبارات التدريبية لكل وحدة.</div>`; return; }
  const best = (sid, u) => { const x = r.filter(y => y.uid === sid && y.unit === u); return x.length ? Math.max(...x.map(y => y.score)) : null; };
  el.innerHTML = `<table class="res-table"><thead><tr><th>الطالبة</th>${UNITS.map(u => `<th title="${esc(u.theme)}">و${ar(u.axisN)}/${ar(u.unitN)}</th>`).join("")}</tr></thead><tbody>${st.sort((a, b) => a.name.localeCompare(b.name, "ar")).map(s => `<tr><td><b>${esc(s.name)}</b></td>${UNITS.map(u => { const b = best(s.id, u.id); return `<td>${b == null ? '<span class="muted">—</span>' : `<b style="color:${b >= 10 ? "var(--ok)" : b >= 7 ? "var(--orange-d)" : "var(--rose)"}">${ar(b)}</b>`}</td>`; }).join("")}</tr>`).join("")}</tbody></table><p class="muted" style="font-size:13px">أعلى درجة من ١٢ في الاختبار التدريبي لكل وحدة (المحور/الوحدة).</p>`;
}
async function tRequests() {
  const el = $("#tReq"); let r = []; try { r = (await store.list("links")).sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0) || byTime(a, b)); } catch (e) {}
  if (!r.length) { el.innerHTML = `<div class="empty"><b>لا توجد طلبات</b>حين يسجّل وليّ أمر ويختار ابنته يظهر طلبه هنا لتوافقي عليه أو ترفضيه.</div>`; return; }
  const L = { pending: "بانتظار الموافقة", approved: "موافَق", rejected: "مرفوض" };
  el.innerHTML = r.map(x => `<div class="li" data-r="${x.id}"><div class="grow"><b>${esc(x.parentName)}</b> <span class="muted">(ولي أمر)</span><br><span style="font-size:14.5px">يطلب متابعة الطالبة: <b>${esc(x.studentName)}</b>${(x.cls || x.studentCls) ? ` · ${esc(CLS(x.cls || x.studentCls))}` : ""}</span><br><span class="muted" style="font-size:13px">${fmtDate(x.createdAt)}</span></div><span class="status ${x.status}">${L[x.status]}</span>${x.status !== "approved" ? '<button class="mini ok" data-a="approved">موافقة</button>' : ""}${x.status !== "rejected" ? '<button class="mini no" data-a="rejected">رفض</button>' : ""}</div>`).join("");
  el.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => { b.disabled = true; try { await store.update("links", b.closest("[data-r]").dataset.r, { status: b.dataset.a, decidedAt: now() }); toast(b.dataset.a === "approved" ? "تمت الموافقة، يستطيع وليّ الأمر المتابعة الآن" : "رُفض الطلب"); } catch (e) { toast("لم يُحفظ القرار"); } tRequests(); badges(); });
}
async function tSummaries() {
  const el = $("#tSum"); let s = []; try { s = (await store.list("summaries")).sort(byTime); } catch (e) {}
  if (!s.length) { el.innerHTML = `<div class="empty"><b>لا توجد تلخيصات بعد</b>تصلك هنا تلخيصات الطالبات من ورقة «تلخيص كتاب».</div>`; return; }
  el.innerHTML = s.map(x => `<div class="li" data-x="${x.id}" style="align-items:flex-start"><div class="grow"><b>${esc(x.book)}</b> — ${esc(x.author)}<br><span class="muted" style="font-size:14px">${esc(x.name)} · ${fmtDate(x.createdAt)}</span><p style="margin:8px 0 0;white-space:pre-line;color:var(--ink-2)">${esc(x.text)}</p></div>${x.status === "published" ? '<span class="status approved">منشور</span>' : '<button class="mini ok" data-a="pub">انشريه في المشاركات</button>'}<button class="mini no" data-a="del">حذف</button></div>`).join("");
  el.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => { const id = b.closest("[data-x]").dataset.x, x = s.find(y => y.id === id);
    if (b.dataset.a === "pub") { await store.add("posts", { name: x.name, kind: "تلخيص كتاب", title: x.book + " — " + x.author, text: x.text, createdAt: now() }); await store.update("summaries", id, { status: "published" }); toast("نُشر في المشاركات"); }
    else { if (!b.dataset.c) { b.dataset.c = 1; b.textContent = "تأكيد"; return; } await store.del("summaries", id); }
    tSummaries(); badges(); });
}
function shrink(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => { const im = new Image(); im.onload = () => { const k = Math.min(1, 900 / Math.max(im.width, im.height)); const c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", .72)); }; im.onerror = rej; im.src = fr.result; }; fr.onerror = rej; fr.readAsDataURL(file); }); }
async function tPosts() {
  let st = []; try { st = await store.list("users", ["role", "student"]); } catch (e) {} $("#stuNames").innerHTML = st.map(s => `<option value="${esc(s.name)}">`).join("");
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
