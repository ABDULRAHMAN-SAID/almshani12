// حفظ بيانات الصفحة على Netlify (Netlify Blobs) — الصفحة تقرأ وتكتب عبر /.netlify/functions/data
import { getStore } from "@netlify/blobs";
import SEED from "./seed.mjs";

const MAX = 4 * 1024 * 1024;
const H = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: H });

const ub = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// يتحقق أن الرقم السري يفك بيانات المعلمة (نفس التشفير الذي تستعمله الصفحة)
export async function canOpen(pw, blob) {
  try {
    const te = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: ub(blob.s), iterations: 100000 }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: ub(blob.iv) }, key, ub(blob.ct));
    return true;
  } catch { return false; }
}
const valid = (st) => st && typeof st === "object" && st.t && st.t.s && st.t.iv && st.t.ct && st.s && typeof st.s === "object" && typeof st.at === "string";

export async function handle(req, store, seed = SEED) {
  if (req.method === "GET") {
    const cur = await store.get("state", { type: "json" });
    return json(cur || {});
  }
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const raw = await req.text();
  if (raw.length > MAX) return json({ ok: false, error: "too_large" });
  let body; try { body = JSON.parse(raw); } catch { return json({ ok: false, error: "bad_request" }); }
  const { pw, base, state } = body || {};
  if (typeof pw !== "string" || !valid(state)) return json({ ok: false, error: "bad_request" });
  const cur = await store.get("state", { type: "json" });
  const ref = cur || seed;
  if (!(await canOpen("T|" + pw, ref.t))) return json({ ok: false, error: "bad_password" });
  if (!(await canOpen("T|" + pw, state.t))) return json({ ok: false, error: "bad_request" });
  if (cur && (base || "") !== cur.at) return json({ ok: false, error: "conflict" });
  await store.setJSON("state", state);
  await store.setJSON("backup/" + state.at.slice(0, 13), state); // نسخة احتياطية لكل ساعة
  return json({ ok: true, at: state.at });
}

export default async (req) => handle(req, getStore({ name: "boost-data", consistency: "strong" }));
