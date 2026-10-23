// الإبداع للمظلات: صفحة الروابط (ملفات ثابتة) + خزنة الحسابات.
// الخزنة بتتشفّر في المتصفح بكلمة المرور الرئيسية، والسيرفر بيحفظ نص مشفّر بس.
// من نفس كلمة المرور المتصفح بيطلّع مفتاحين: واحد للتشفير وما بيطلعش من الجهاز، وتاني "توكن" للسيرفر.
// السيرفر بيحفظ SHA-256 للتوكن، فمحدش يقدر يقرا أو يغيّر الخزنة من غير كلمة المرور.

const VAULT_KEY = "vault";
const MAX_FAILS = 8;
const FAIL_WINDOW = 15 * 60;
const MAX_BODY = 512 * 1024;

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      ...SECURITY_HEADERS,
    },
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(request) {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function validToken(t) {
  return typeof t === "string" && /^[0-9a-f]{64}$/.test(t);
}

function validDoc(d) {
  return d && typeof d === "object" && d.v === 2 &&
    typeof d.salt === "string" && d.salt.length <= 64 &&
    typeof d.iv === "string" && d.iv.length <= 64 &&
    typeof d.ct === "string" && d.ct.length <= MAX_BODY &&
    Number.isInteger(d.iter) && d.iter >= 100000 && d.iter <= 5000000;
}

async function readBody(request) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function failKey(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return "fail:" + (await sha256Hex(ip)).slice(0, 32);
}

async function tooManyFails(env, request) {
  const n = Number((await env.DATA.get(await failKey(request))) || 0);
  return n >= MAX_FAILS;
}

async function noteFail(env, request) {
  const k = await failKey(request);
  const n = Number((await env.DATA.get(k)) || 0) + 1;
  await env.DATA.put(k, String(n), { expirationTtl: FAIL_WINDOW });
}

async function loadVault(env) {
  return env.DATA.get(VAULT_KEY, "json");
}

async function authorized(env, request, stored) {
  const token = bearer(request);
  return validToken(token) && safeEqual(await sha256Hex(token), stored.authHash);
}

async function handleApi(request, env, url) {
  const path = url.pathname;

  // معلومات عامة: هل فيه خزنة، والملح وعدد التكرارات اللي المتصفح محتاجهم عشان يطلّع المفاتيح
  if (path === "/api/vault/meta" && request.method === "GET") {
    const stored = await loadVault(env);
    if (!stored) return json({ exists: false });
    return json({ exists: true, salt: stored.doc.salt, iter: stored.doc.iter });
  }

  // فتح الخزنة: بيرجّع النص المشفّر لو التوكن صح
  if (path === "/api/vault/open" && request.method === "POST") {
    if (await tooManyFails(env, request)) return json({ error: "locked" }, 429);
    const stored = await loadVault(env);
    if (!stored) return json({ error: "missing" }, 404);
    if (!(await authorized(env, request, stored))) {
      await noteFail(env, request);
      return json({ error: "denied" }, 401);
    }
    return json({ doc: stored.doc });
  }

  // حفظ: أول مرة بتتعمل الخزنة، وبعد كده لازم التوكن الحالي. newToken بيتبعت لما كلمة المرور تتغير.
  if (path === "/api/vault" && request.method === "PUT") {
    if (await tooManyFails(env, request)) return json({ error: "locked" }, 429);
    const body = await readBody(request);
    if (!body || !validDoc(body.doc)) return json({ error: "bad_request" }, 400);
    const stored = await loadVault(env);
    let authHash;
    if (!stored) {
      if (!validToken(body.newToken)) return json({ error: "bad_request" }, 400);
      authHash = await sha256Hex(body.newToken);
    } else {
      if (!(await authorized(env, request, stored))) {
        await noteFail(env, request);
        return json({ error: "denied" }, 401);
      }
      if (body.newToken !== undefined && !validToken(body.newToken)) return json({ error: "bad_request" }, 400);
      authHash = body.newToken ? await sha256Hex(body.newToken) : stored.authHash;
    }
    const doc = { ...body.doc, updated: new Date().toISOString() };
    await env.DATA.put(VAULT_KEY, JSON.stringify({ authHash, doc }));
    return json({ ok: true, updated: doc.updated });
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);

    const res = await env.ASSETS.fetch(request);
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      const out = new Response(res.body, res);
      out.headers.set("X-Robots-Tag", "noindex, nofollow");
      out.headers.set("Cache-Control", "no-store");
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
      return out;
    }
    return res;
  },
};
