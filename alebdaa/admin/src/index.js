// منصة إدارة حسابات «الإبداع للمظلات» — Cloudflare Worker
// المطلوب في الإعدادات (Settings → Variables and Secrets):
//   ADMIN_PASSWORD  (Secret)  كلمة مرور الدخول للمنصة
//   SECRET_KEY      (Secret)  نص عشوائي طويل يُستخدم للتشفير وتوقيع الجلسة (لا تغيّره بعد الحفظ وإلا ستُفقد البيانات)
//   DATA            (KV Namespace binding)  مكان تخزين البيانات مشفّرة

const SESSION_HOURS = 12;
const MAX_ATTEMPTS = 8;        // محاولات دخول خاطئة مسموحة
const LOCK_SECONDS = 15 * 60;  // مدة الإيقاف بعد تجاوزها
const MAX_BODY = 400 * 1024;

// الأقسام
const CATEGORIES = [
  ["social", "حسابات السوشيال"],
  ["google", "جوجل والخرائط"],
  ["web", "الموقع والتقنية"],
  ["ai", "الذكاء الاصطناعي"],
  ["design", "التصميم والمحتوى"],
  ["other", "أخرى"]
];

// الخدمات: [المفتاح، القسم، الاسم، الأيقونة، رابط الحساب، رابط الإدارة، اسم زر الإدارة، متابعين؟، الحساب الأب (للحساب الإعلاني)]
const CATALOG = [
  ["instagram", "social", "إنستقرام", "insta", "https://www.instagram.com/alebdaatents/", "https://business.facebook.com/latest/insights", "الإحصائيات", 1],
  ["tiktok", "social", "تيك توك", "tiktok", "https://www.tiktok.com/@alebdaa_tents", "https://www.tiktok.com/tiktokstudio", "TikTok Studio", 1],
  ["snapchat", "social", "سناب شات", "snap", "https://www.snapchat.com/@alebdatents", "https://profile.snapchat.com/", "الملف العام", 1],
  ["facebook", "social", "فيسبوك", "fb", "https://www.facebook.com/alebdaatents", "https://business.facebook.com/latest/home", "Business Suite", 1],
  ["youtube", "social", "يوتيوب", "yt", "https://www.youtube.com/@alebdaatents", "https://studio.youtube.com/", "YouTube Studio", 1],
  ["x", "social", "إكس", "x", "https://x.com/", "", "", 1],
  ["threads", "social", "ثريدز", "threads", "https://www.threads.net/", "", "", 1],
  ["linkedin", "social", "لينكد إن", "linkedin", "https://www.linkedin.com/", "", "", 1],
  ["pinterest", "social", "بنترست", "pin", "https://www.pinterest.com/", "", "", 1],
  ["wa-business", "social", "واتساب للأعمال", "chat", "https://web.whatsapp.com/", "https://business.facebook.com/wa/manage/home/", "إدارة واتساب", 0],
  ["meta-ads", "social", "Meta Ads", "megaphone", "https://adsmanager.facebook.com/", "https://business.facebook.com/settings", "إعدادات النشاط", 0, "facebook"],
  ["tiktok-ads", "social", "TikTok Ads", "megaphone", "https://ads.tiktok.com/", "", "", 0, "tiktok"],
  ["snap-ads", "social", "Snap Ads", "megaphone", "https://ads.snapchat.com/", "", "", 0, "snapchat"],
  ["google-ads", "google", "Google Ads", "gads", "https://ads.google.com/", "", "", 0],
  ["x-ads", "social", "X Ads", "megaphone", "https://ads.x.com/", "", "", 0, "x"],
  ["gbp", "google", "Google Business", "star", "https://maps.app.goo.gl/CAhxjJKBMuafqmHr5", "https://business.google.com/", "إدارة الملف", 0],
  ["gsc", "google", "Search Console", "search", "https://search.google.com/search-console", "", "", 0],
  ["ga4", "google", "Google Analytics", "chart", "https://analytics.google.com/", "", "", 0],
  ["gtm", "google", "Tag Manager", "tag", "https://tagmanager.google.com/", "", "", 0],
  ["merchant", "google", "Merchant Center", "cart", "https://merchants.google.com/", "", "", 0],
  ["gmail", "google", "Gmail", "mail", "https://mail.google.com/", "", "", 0],
  ["apple-maps", "google", "Apple Business Connect", "pin", "https://businessconnect.apple.com/", "", "", 0],
  ["bing-places", "google", "Bing Places", "pin", "https://www.bingplaces.com/", "", "", 0],
  ["website", "web", "الموقع الإلكتروني", "globe", "https://ebdaatents.com", "https://ebdaatents.com/wp-admin/", "لوحة الموقع", 0],
  ["domain", "web", "الدومين", "globe", "", "", "", 0],
  ["hosting", "web", "الاستضافة", "server", "", "", "", 0],
  ["cloudflare", "web", "Cloudflare", "cloud", "https://dash.cloudflare.com/", "", "", 0],
  ["netlify", "web", "Netlify", "cloud", "https://app.netlify.com/", "", "", 0],
  ["github", "web", "GitHub", "code", "https://github.com/", "", "", 0],
  ["clarity", "web", "Microsoft Clarity", "eye", "https://clarity.microsoft.com/", "", "", 0],
  ["chatgpt", "ai", "ChatGPT", "spark", "https://chatgpt.com/", "", "", 0],
  ["claude", "ai", "Claude", "spark", "https://claude.ai/", "", "", 0],
  ["gemini", "ai", "Gemini", "spark", "https://gemini.google.com/", "", "", 0],
  ["midjourney", "ai", "Midjourney", "spark", "https://www.midjourney.com/", "", "", 0],
  ["elevenlabs", "ai", "ElevenLabs", "spark", "https://elevenlabs.io/", "", "", 0],
  ["canva", "design", "Canva", "palette", "https://www.canva.com/", "", "", 0],
  ["capcut", "design", "CapCut", "video", "https://www.capcut.com/", "", "", 0],
  ["adobe", "design", "Adobe", "palette", "https://account.adobe.com/", "", "", 0],
  ["custom", "other", "خدمة أخرى", "grid", "", "", "", 0]
];
const CAT_KEYS = new Set(CATALOG.map(c => c[0]));

// بيانات البداية: حساب فاضي لكل خدمة (بدون أي كلمات مرور)
const SEED = {
  updated: "",
  pageUrl: "",
  rating: { value: "4.3", count: "24" },
  accounts: CATALOG.filter(c => c[0] !== "custom").map(c => ({
    id: c[0], service: c[0], name: "",
    user: { instagram: "alebdaatents", tiktok: "alebdaa_tents", snapchat: "alebdatents", facebook: "alebdaatents", youtube: "alebdaatents", website: "ebdaatents.com", domain: "ebdaatents.com" }[c[0]] || "",
    email: c[0] === "gmail" ? "ebdaa.tents@gmail.com" : "",
    password: "", emailPassword: "", followers: "", url: "", admin: "", note: ""
  }))
};

const CATALOG_JSON = JSON.stringify({ categories: CATEGORIES, catalog: CATALOG }).replace(/</g, "\\u003c");

// ---------- crypto helpers ----------
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = buf => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret + ":session"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function aesKey(secret) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret + ":data"));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function sign(secret, msg) {
  return b64url(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(msg)));
}
// مقارنة ثابتة الزمن عبر HMAC للطرفين
async function safeEqual(secret, a, b) {
  const [x, y] = await Promise.all([sign(secret, "cmp:" + a), sign(secret, "cmp:" + b)]);
  if (x.length !== y.length) return false;
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return r === 0;
}
async function encryptJSON(secret, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(JSON.stringify(obj)));
  return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) });
}
async function decryptJSON(secret, stored) {
  const { iv, ct } = JSON.parse(stored);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(secret), unb64(ct));
  return JSON.parse(dec.decode(pt));
}

// ---------- session ----------
async function makeSession(env) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  return exp + "." + await sign(env.SECRET_KEY, "s:" + exp);
}
async function validSession(env, request) {
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)adm=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(env.SECRET_KEY, sig, await sign(env.SECRET_KEY, "s:" + exp));
}
const cookie = (val, maxAge) => "adm=" + val + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;

// ---------- responses ----------
const SEC_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow"
};
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...SEC_HEADERS, ...extra } });
}
function html(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8", ...SEC_HEADERS,
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    }
  });
}

async function readBody(request) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) throw new Error("too large");
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error("too large");
  return JSON.parse(text);
}

function cleanData(d) {
  const s = v => String(v == null ? "" : v).slice(0, 500);
  const https = v => /^https:\/\//.test(v || "") ? s(v) : "";
  if (!d || !Array.isArray(d.accounts) || d.accounts.length > 300) throw new Error("bad data");
  return {
    updated: new Date().toISOString().slice(0, 10),
    pageUrl: https(d.pageUrl),
    rating: { value: s(d.rating && d.rating.value).slice(0, 5), count: s(d.rating && d.rating.count).slice(0, 8) },
    accounts: d.accounts.map((a, i) => ({
      id: s(a.id || "a" + i).slice(0, 40),
      service: CAT_KEYS.has(a.service) ? a.service : "custom",
      name: s(a.name).slice(0, 60),
      user: s(a.user), email: s(a.email), password: s(a.password), emailPassword: s(a.emailPassword),
      followers: s(a.followers).replace(/[^\d]/g, "").slice(0, 12),
      url: https(a.url), admin: https(a.admin),
      note: s(a.note).slice(0, 300),
      phone: s(a.phone).slice(0, 30), owner: s(a.owner).slice(0, 60),
      twofa: a.twofa === "on" || a.twofa === "off" ? a.twofa : "",
      pwDate: /^\d{4}-\d{2}-\d{2}$/.test(a.pwDate || "") ? a.pwDate : ""
    }))
  };
}

// سجل الدخول (مشفّر، آخر 30 محاولة)
async function appendLog(env, request, ok) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const masked = ip.includes(":") ? ip.split(":").slice(0, 3).join(":") + ":…" : ip.replace(/\.\d+$/, ".x");
  let items = [];
  const stored = await env.DATA.get("log");
  if (stored) { try { items = await decryptJSON(env.SECRET_KEY, stored); } catch {} }
  items.unshift({ t: new Date().toISOString(), ok, ip: masked, country: request.headers.get("CF-IPCountry") || "" });
  await env.DATA.put("log", await encryptJSON(env.SECRET_KEY, items.slice(0, 30)));
}

// يفتح صفحة الروابط المنشورة ويتأكد من البيكسلات ورقم الواتساب
async function checkPage(pageUrl) {
  let res, text;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000);
    res = await fetch(pageUrl, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "alebdaa-admin-check" } });
    clearTimeout(t);
    text = await res.text();
  } catch { return { ok: false, error: "تعذّر فتح صفحة الروابط", pageUrl }; }
  if (!res.ok) return { ok: false, error: "صفحة الروابط ردّت بالكود " + res.status, pageUrl };
  // تجاهل التعليقات عشان التعليق «ضع هنا أكواد...» ما يتحسبش بيكسل
  const code = text.replace(/<!--[\s\S]*?-->/g, "");
  const find = (re) => { const m = code.match(re); return m ? (m[1] || "✓") : ""; };
  const checks = [
    ["Meta Pixel", find(/fbq\(\s*['"]init['"]\s*,\s*['"]?(\d{6,})/)],
    ["Google Tag", find(/googletagmanager\.com\/(?:gtag\/js\?id=|gtm\.js\?id=)([A-Z0-9-]+)/i) || find(/gtag\(\s*['"]config['"]\s*,\s*['"]([A-Z0-9-]+)/i)],
    ["Snap Pixel", find(/snaptr\(\s*['"]init['"]\s*,\s*['"]([a-f0-9-]{8,})/i)],
    ["TikTok Pixel", find(/ttq\.load\(\s*['"]([A-Z0-9]+)/i)]
  ].map(([name, id]) => ({ name, on: !!id, id: id === "✓" ? "" : id }));
  const wa = find(/WA_NUMBER\s*=\s*["'](\d+)/);
  return { ok: true, pageUrl, checkedAt: new Date().toISOString(), whatsapp: wa ? "+" + wa : "", checks };
}

export default {
  async fetch(request, env) {
    if (!env.ADMIN_PASSWORD || !env.SECRET_KEY || !env.DATA) {
      return new Response("المنصة غير مُعدّة: أضف ADMIN_PASSWORD و SECRET_KEY كـ Secrets واربط KV باسم DATA.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" && request.method === "GET") return html(PAGE.replace("__CATALOG__", CATALOG_JSON));

    if (path === "/api/login" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "local";
      const rlKey = "rl:" + ip;
      const tries = Number(await env.DATA.get(rlKey)) || 0;
      if (tries >= MAX_ATTEMPTS) return json({ error: "محاولات كثيرة. حاول بعد 15 دقيقة." }, 429);
      let body;
      try { body = await readBody(request); } catch { return json({ error: "طلب غير صالح" }, 400); }
      const ok = await safeEqual(env.SECRET_KEY, String(body.password || ""), env.ADMIN_PASSWORD);
      if (!ok) {
        await env.DATA.put(rlKey, String(tries + 1), { expirationTtl: LOCK_SECONDS });
        await appendLog(env, request, false);
        return json({ error: "كلمة المرور غير صحيحة" }, 401);
      }
      await env.DATA.delete(rlKey);
      await appendLog(env, request, true);
      return json({ ok: true }, 200, { "Set-Cookie": cookie(await makeSession(env), SESSION_HOURS * 3600) });
    }

    if (path === "/api/logout" && request.method === "POST") {
      return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    }

    if (path === "/api/data") {
      if (!(await validSession(env, request))) return json({ error: "غير مسجّل" }, 401);
      if (request.method === "GET") {
        const stored = await env.DATA.get("data");
        if (!stored) return json(SEED);
        try { return json(await decryptJSON(env.SECRET_KEY, stored)); }
        catch { return json({ error: "تعذّر فك تشفير البيانات. هل تغيّر SECRET_KEY؟" }, 500); }
      }
      if (request.method === "PUT") {
        if (!(request.headers.get("Content-Type") || "").includes("application/json")) return json({ error: "طلب غير صالح" }, 415);
        let data;
        try { data = cleanData(await readBody(request)); } catch { return json({ error: "بيانات غير صالحة" }, 400); }
        await env.DATA.put("data", await encryptJSON(env.SECRET_KEY, data));
        return json({ ok: true, updated: data.updated });
      }
      return json({ error: "غير مسموح" }, 405);
    }

    if (path === "/api/status" && request.method === "GET") {
      if (!(await validSession(env, request))) return json({ error: "غير مسجّل" }, 401);
      let pageUrl = "";
      const stored = await env.DATA.get("data");
      if (stored) { try { pageUrl = (await decryptJSON(env.SECRET_KEY, stored)).pageUrl || ""; } catch {} }
      if (!/^https:\/\//.test(pageUrl)) return json({ ok: false, error: "أضف رابط صفحة الروابط أولًا من «تعديل البيانات»" });
      return json(await checkPage(pageUrl));
    }

    if (path === "/api/log" && request.method === "GET") {
      if (!(await validSession(env, request))) return json({ error: "غير مسجّل" }, 401);
      const stored = await env.DATA.get("log");
      let items = [];
      if (stored) { try { items = await decryptJSON(env.SECRET_KEY, stored); } catch {} }
      return json({ items });
    }

    return json({ error: "غير موجود" }, 404);
  }
};

// ---------- الواجهة ----------
const PAGE = String.raw`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>إدارة حسابات الإبداع</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: dark; --page: #262624; --bg: #30302e; --row: #30302e; --head: #3a3936; --soft: #3a3936; --ink: #faf9f5; --ink-soft: #b7b5a9; --line: #45443f; --chip-line: #4f4d48; --accent: #d97757; --dot: #d97757; --sub: #33302d; --gold-soft: rgba(217,119,87,.16); --ok: #3ecf74; --bad: #ff8a65; --btn: #d97757; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { overflow-x: hidden; max-width: 100%; }
  body { margin: 0; font-family: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, system-ui, sans-serif; background: var(--page); color: var(--ink); line-height: 1.5; -webkit-text-size-adjust: 100%; }
  button, input, select, textarea { font: inherit; color: inherit; }
  input, select, textarea { font-size: 16px; }
  button { background: none; border: 0; cursor: pointer; padding: 0; }
  a { color: inherit; text-decoration: none; }
  .wrap { width: 100%; max-width: 760px; margin: 0 auto; padding: 28px 14px 120px; }
  h1 { margin: 0; font-size: 1.6rem; }
  .sub { margin: 6px 0 16px; color: var(--ink-soft); font-size: .92rem; }
  .bar { display: flex; flex-wrap: wrap; gap: 10px; }
  .chip { padding: 9px 18px; border-radius: 999px; border: 1px solid var(--chip-line); background: transparent; font-weight: 600; font-size: .92rem; }
  .chip.small { padding: 6px 12px; font-size: .8rem; color: var(--ink-soft); }
  /* login */
  .login { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
  .login form { width: 100%; max-width: 340px; background: var(--bg); border: 1px solid var(--line); border-radius: 22px; padding: 22px 18px; display: grid; gap: 12px; text-align: center; }
  .login h1 { font-size: 1.25rem; }
  .login input { width: 100%; padding: 12px; border-radius: 14px; border: 1px solid var(--chip-line); background: var(--soft); text-align: center; direction: ltr; }
  .login input:focus, .ed:focus { outline: 2px solid var(--accent); }
  .btn { background: var(--btn); color: #fff; font-weight: 700; padding: 12px; border-radius: 14px; }
  .btn:disabled { opacity: .5; }
  .err { margin: 0; color: var(--bad); font-size: .85rem; min-height: 1.2em; }
  /* section */
  .sec { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 28px 2px 12px; width: 100%; text-align: right; }
  .sec h2 { margin: 0; font-size: 1.15rem; display: flex; align-items: center; gap: 10px; }
  .sec h2::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--dot); }
  .sec small { color: var(--ink-soft); font-size: .86rem; font-weight: 600; white-space: nowrap; }
  .sec .arr { display: inline-block; margin-inline-start: 4px; font-size: .7rem; transition: transform .15s; }
  .sec[aria-expanded="false"] .arr { transform: rotate(90deg); }
  /* table */
  .tbl { background: var(--bg); border: 1px solid var(--line); border-radius: 20px; overflow: hidden; }
  .th { display: grid; grid-template-columns: 62px minmax(0, 1.45fr) minmax(0, 1.05fr); gap: 10px; padding: 12px; font-size: .78rem; color: var(--ink-soft); font-weight: 600; background: var(--head); }
  .grp-h { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--line); background: var(--head); }
  .grp-h .val { flex: 1; font-weight: 700; font-size: .95rem; text-align: right; direction: ltr; background: var(--row); }
  .grp-h small { color: var(--ink-soft); font-size: .8rem; white-space: nowrap; }
  .blk { border-top: 1px solid var(--line); background: var(--row); }
  .blk.has-sub { background: var(--sub); }
  .tr { display: grid; column-gap: 8px; grid-template-columns: 62px minmax(0, 1.45fr) minmax(0, 1.05fr); gap: 10px; align-items: center; padding: 12px; }
  .tr + .tr { border-top: 1px dashed var(--chip-line); }
  .pc { display: grid; justify-items: center; gap: 6px; text-align: center; min-width: 0; }
  .logo { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--gold-soft); color: var(--accent); }
  .logo svg { width: 20px; height: 20px; }
  .pc .nm { font-size: .8rem; font-weight: 600; line-height: 1.3; color: var(--accent); overflow-wrap: anywhere; }
  .pc .nm.nolink { color: var(--ink); }
  .pc .lbl { font-size: .8rem; font-weight: 600; color: var(--accent); line-height: 1.35; }
  .cv { display: grid; grid-auto-rows: 30px; gap: 6px; justify-items: start; align-items: center; min-width: 0; }
  .val { display: inline-block; max-width: 100%; direction: ltr; text-align: left; background: transparent; border: 1px solid var(--chip-line); border-radius: 8px; padding: 4px 9px; font-size: .78rem; color: var(--ink); overflow-wrap: anywhere; cursor: copy; }
  .val.mail { color: var(--ink-soft); }
  .val.empty { border: 0; color: var(--ink-soft); cursor: default; padding: 4px 6px; }
  .val.copied { border-color: var(--ok); }
  .note { grid-column: 1 / -1; font-size: .76rem; color: var(--ink-soft); }
  /* edit */
  .er { border-top: 1px solid var(--line); padding: 12px; display: grid; gap: 8px; background: var(--row); }
  .er.child { border-top: 1px dashed var(--chip-line); background: var(--sub); }
  .er .top { display: flex; align-items: center; gap: 10px; }
  .er .top b { flex: 1; font-size: .92rem; }
  .eg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .eg label { display: grid; gap: 3px; font-size: .72rem; color: var(--ink-soft); min-width: 0; }
  .eg label.full { grid-column: 1 / -1; }
  .ed { width: 100%; min-width: 0; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--chip-line); background: var(--soft); direction: ltr; }
  select.ed { direction: rtl; }
  .del { color: var(--bad); font-size: .8rem; }
  .addbar { display: flex; gap: 8px; margin-top: 14px; }
  .addbar select { flex: 1; }
  .addbar .btn { padding: 9px 18px; white-space: nowrap; }
  /* numbers + status */
  .sum { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 16px; }
  .search { margin-top: 12px; direction: rtl; border-radius: 999px; padding: 10px 16px; }
  .pc small { font-size: .68rem; color: var(--ink-soft); }
  .pc .adm { font-size: .68rem; color: var(--ink-soft); text-decoration: underline; }
  .quick { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .quick a { display: flex; align-items: center; gap: 8px; background: var(--bg); border: 1px solid var(--line); border-radius: 14px; padding: 8px 10px; font-size: .84rem; font-weight: 600; }
  .quick .logo { width: 30px; height: 30px; }
  .quick .logo svg { width: 17px; height: 17px; }
  .alerts { margin-top: 10px; background: rgba(255,138,101,.08); border: 1px solid rgba(255,138,101,.45); border-radius: 16px; padding: 10px 12px; display: grid; gap: 4px; font-size: .84rem; }
  .alerts b { color: var(--bad); }
  .alerts span { color: var(--ink); }
  .meta { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; font-size: .72rem; color: var(--ink-soft); }
  .meta span { border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; }
  .meta .bad { color: var(--bad); border-color: rgba(255,138,101,.5); }
  .meta .good { color: var(--ok); border-color: rgba(62,207,116,.45); }
  .pwrow { display: flex; gap: 6px; }
  .pwrow .ed { flex: 1; }
  .gen { font-size: .72rem; font-weight: 700; color: var(--accent); border: 1px solid var(--chip-line); border-radius: 9px; padding: 0 8px; white-space: nowrap; }
  .cv .val { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .val.fill { cursor: text; border: 1px dashed var(--chip-line); color: var(--ink-soft); font-size: .72rem; direction: rtl; text-align: right; }
  .val.fill:hover { border-color: var(--accent); color: var(--accent); }
  .ed.inline { padding: 5px 8px; font-size: 16px; border-color: var(--accent); }
  .eye { padding: 10px 14px; border-radius: 14px; border: 1px solid var(--chip-line); font-size: .82rem; font-weight: 700; white-space: nowrap; }
  .more-row { display: block; width: 100%; padding: 12px; border-top: 1px solid var(--line); color: var(--accent); font-weight: 700; font-size: .88rem; text-align: center; background: var(--head); }
  .empty-q { text-align: center; color: var(--ink-soft); padding: 20px 0; }
  .sum > div { background: var(--bg); border: 1px solid var(--line); border-radius: 16px; padding: 12px 6px; text-align: center; min-width: 0; }
  .sum b { display: block; font-size: 1.3rem; color: var(--accent); line-height: 1.2; }
  .sum span { font-size: .74rem; color: var(--ink-soft); }
  .rating { display: flex; gap: 6px; justify-content: center; margin-top: 6px; }
  .rating input { width: 56px; text-align: center; }
  .stat-box { margin-top: 10px; background: var(--bg); border: 1px solid var(--line); border-radius: 18px; padding: 10px; display: grid; gap: 6px; font-size: .86rem; }
  .stat-box .ln { display: flex; justify-content: space-between; align-items: center; gap: 8px; background: var(--row); border-radius: 10px; padding: 8px 10px; }
  .stat-box .on { color: var(--ok); font-weight: 700; direction: ltr; overflow-wrap: anywhere; } .stat-box .off { color: var(--bad); font-weight: 700; }
  .stat-box .muted { color: var(--ink-soft); font-size: .78rem; text-align: center; }
  /* save bar */
  .save { position: fixed; left: 0; right: 0; bottom: 0; background: rgba(38,38,36,.97); border-top: 1px solid var(--line); padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); }
  .save .in { max-width: 760px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .save .st { font-size: .82rem; color: var(--ink-soft); flex: 1; min-width: 0; }
  .save .st.dirty { color: var(--accent); }
  .save .btn { padding: 12px 30px; }
  .toast { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); max-width: calc(100% - 28px); background: var(--ok); color: #111; font-weight: 700; padding: 8px 16px; border-radius: 999px; font-size: .85rem; z-index: 10; }
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="i-insta" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".9" fill="currentColor"/></g></symbol>
  <symbol id="i-fb" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M14.5 21v-7.5h2.7l.4-3.2h-3.1V8.4c0-.9.3-1.6 1.6-1.6h1.7V4a20 20 0 0 0-2.5-.2c-2.5 0-4.1 1.5-4.1 4.2v2.3H8.5v3.2h2.7V21"/></symbol>
  <symbol id="i-tiktok" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.4 2.6 2.2 4.3 5 4.5"/></symbol>
  <symbol id="i-snap" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M12 3c3 0 5 2.2 5 5v2.4l1.7-.6c.6-.2 1 .5.5.9l-1.9 1.4c.6 1.8 2 3 3.7 3.4-.4.9-1.8 1.2-2.8 1.3l-.4 1.3-2-.3c-1.3.6-2.3 1.6-3.8 1.6s-2.5-1-3.8-1.6l-2 .3-.4-1.3c-1-.1-2.4-.4-2.8-1.3 1.7-.4 3.1-1.6 3.7-3.4l-1.9-1.4c-.5-.4-.1-1.1.5-.9l1.7.6V8c0-2.8 2-5 5-5Z"/></symbol>
  <symbol id="i-yt" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10 9.2 15 12l-5 2.8Z" fill="currentColor"/></g></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M5 4l14 16M19 4 5 20"/></symbol>
  <symbol id="i-threads" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"/></g></symbol>
  <symbol id="i-linkedin" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2.5 2.5 0 0 1 5 0v4M12 10v7"/></g></symbol>
  <symbol id="i-pin" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></g></symbol>
  <symbol id="i-chat" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z"/></symbol>
  <symbol id="i-megaphone" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M3 10v4h4l7 4V6L7 10Z"/><path d="M17.5 9a4 4 0 0 1 0 6M7 14l1.5 5h2.5L10 15"/></g></symbol>
  <symbol id="i-star" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/></g></symbol>
  <symbol id="i-chart" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/></g></symbol>
  <symbol id="i-tag" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 12V4h8l10 10-8 8Z"/><circle cx="7.5" cy="8.5" r="1.3"/></g></symbol>
  <symbol id="i-cart" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11h11L21 7H6.2"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/></g></symbol>
  <symbol id="i-mail" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 7 8.5-7"/></g></symbol>
  <symbol id="i-globe" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></g></symbol>
  <symbol id="i-server" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01" stroke-linecap="round" stroke-width="2.2"/></g></symbol>
  <symbol id="i-cloud" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 9 4.5 4.5 0 0 0 7 18Z"/></symbol>
  <symbol id="i-code" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/></symbol>
  <symbol id="i-eye" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></g></symbol>
  <symbol id="i-spark" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7ZM18.5 15.5c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3Z"/></symbol>
  <symbol id="i-palette" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3a9 9 0 0 0 0 18c1.2 0 1.6-.9 1.2-1.8-.5-1.1.2-2.2 1.4-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10Z"/><circle cx="7.5" cy="11" r="1.1"/><circle cx="10" cy="7" r="1.1"/><circle cx="15" cy="7.5" r="1.1"/></g></symbol>
  <symbol id="i-video" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3Z"/></g></symbol>
  <symbol id="i-gads" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.5 4 4 16M14.5 4 20 16"/><circle cx="5.5" cy="18" r="2" fill="currentColor"/></g></symbol>
  <symbol id="i-grid" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></g></symbol>
</defs></svg>

<section class="login" id="loginView" hidden>
  <form id="loginForm" autocomplete="off">
    <h1>إدارة حسابات الإبداع</h1>
    <p class="sub" style="margin:0">أدخل كلمة مرور المنصة</p>
    <input id="pw" type="password" autocomplete="current-password" required>
    <button class="btn" id="loginBtn" type="submit">دخول</button>
    <p class="err" id="loginErr"></p>
  </form>
</section>

<main class="wrap" id="appView" hidden>
  <h1>حسابات الإبداع للمظلات</h1>
  <p class="sub" id="subLine">اضغط على أي بيانات عشان تنسخ، واضغط على اسم المنصة عشان تفتح الحساب.</p>
  <div class="bar">
    <button class="chip" id="editBtn">تعديل البيانات</button>
    <button class="chip" id="maskBtn">إظهار كلمات المرور</button>
  </div>
  <div class="sum" id="sum"></div>
  <input class="ed search" id="q" type="search" placeholder="ابحث عن منصة أو حساب أو إيميل" autocomplete="off">
  <div id="list"></div>
  <div class="addbar" id="addBar" hidden><select class="ed" id="addSel"></select><button class="btn" id="addBtn">+ إضافة</button></div>
  <div class="sec" style="cursor:default"><h2>مديرو الإعلانات</h2></div>
  <div class="quick" id="adsQuick"></div>
  <div class="sec" style="cursor:default"><h2>حالة صفحة الروابط</h2><button class="chip small" id="checkBtn">فحص الآن</button></div>
  <div class="stat-box" id="statusBox"></div>
  <div class="sec" style="cursor:default"><h2>سجل الدخول</h2><button class="chip small" id="logBtn">تحديث</button></div>
  <div class="stat-box" id="logBox"></div>
  <div class="sec" style="cursor:default"><h2>نسخة احتياطية</h2></div>
  <div class="stat-box">
    <div class="muted">الملف يحتوي على كلمات المرور بدون تشفير. احفظه في مكان آمن واحذفه بعد الاستخدام.</div>
    <div class="bar" style="justify-content:center"><button class="chip small" id="expBtn">تنزيل نسخة احتياطية</button><button class="chip small" id="impBtn">استيراد نسخة</button></div>
    <input type="file" id="impFile" accept="application/json,.json" hidden>
  </div>
  <div style="text-align:center;margin-top:22px"><button class="chip small" id="logoutBtn">تسجيل الخروج</button></div>
</main>

<div class="save" id="saveBar" hidden>
  <div class="in"><span class="st" id="saveSt">كل التعديلات محفوظة</span><button class="eye" id="maskBtn2">إظهار كلمات المرور</button><button class="btn" id="saveBtn" disabled>حفظ</button></div>
</div>
<div class="toast" id="toast" hidden></div>

<script>
(function () {
  var META = __CATALOG__;
  var CATS = META.categories, CAT = {};
  META.catalog.forEach(function (c) { CAT[c[0]] = { key: c[0], cat: c[1], name: c[2], icon: c[3], url: c[4], admin: c[5], adminLabel: c[6], fol: !!c[7], parent: c[8] || "" }; });
  var query = "", showMore = {};
  function isEmpty(a) { return !(a.user || a.email || a.password || a.emailPassword || Number(a.followers) || a.note || a.phone || a.owner); }
  var data = null, editing = false, masked = true, dirty = false, collapsed = {}, lastStatus = null;
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svc(a) { return CAT[a.service] || CAT.custom; }
  function nameOf(a) { return a.service === "custom" ? (a.name || "خدمة أخرى") : (svc(a).name + (a.name ? " · " + a.name : "")); }
  function icon(a) {
    var s = el("span", "logo");
    s.innerHTML = '<svg><use href="#i-' + svc(a).icon + '"/></svg>'; return s;
  }
  function fmt(n) { n = Number(n); if (!n) return ""; if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M"; if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K"; return String(n); }
  function toast(t) { var x = $("toast"); x.textContent = t; x.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { x.hidden = true; }, 1600); }
  function setDirty(v) { dirty = v; $("saveSt").textContent = v ? "توجد تعديلات غير محفوظة" : "كل التعديلات محفوظة"; $("saveSt").className = "st" + (v ? " dirty" : ""); $("saveBtn").disabled = !v; }
  function api(method, path, body) {
    return fetch(path, { method: method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function ext(a, text, href, cls) { var x = el("a", cls, text); x.href = href; x.target = "_blank"; x.rel = "noopener noreferrer"; return x; }

  // ---- login / load ----
  function showLogin() { $("appView").hidden = true; $("saveBar").hidden = true; $("loginView").hidden = false; $("pw").value = ""; $("pw").focus(); }
  function load() {
    api("GET", "/api/data").then(function (j) {
      if (j._status === 401) return showLogin();
      if (j._status !== 200) { $("loginView").hidden = false; $("loginErr").textContent = j.error || "خطأ في التحميل"; return; }
      delete j._status; data = j; $("loginView").hidden = true; $("appView").hidden = false; $("saveBar").hidden = false; setDirty(false); render();
      if (data.pageUrl) runCheck();
      loadLog();
    }).catch(function () { $("loginView").hidden = false; $("loginErr").textContent = "تعذّر الاتصال بالسيرفر"; });
  }
  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault(); $("loginBtn").disabled = true; $("loginErr").textContent = "";
    api("POST", "/api/login", { password: $("pw").value }).then(function (j) {
      $("loginBtn").disabled = false;
      if (j.ok) load(); else { $("loginErr").textContent = j.error || "تعذّر الدخول"; $("pw").value = ""; $("pw").focus(); }
    }).catch(function () { $("loginBtn").disabled = false; $("loginErr").textContent = "تعذّر الاتصال بالسيرفر"; });
  });
  $("logoutBtn").addEventListener("click", function () {
    if (dirty && !window.confirm("توجد تعديلات غير محفوظة. هل تريد الخروج بدون حفظ؟")) return;
    api("POST", "/api/logout").then(function () { data = null; showLogin(); });
  });
  $("editBtn").addEventListener("click", function () { editing = !editing; this.textContent = editing ? "إنهاء التعديل" : "تعديل البيانات"; $("addBar").hidden = !editing; render(); });
  function toggleMask() { masked = !masked; var t = masked ? "إظهار كلمات المرور" : "إخفاء كلمات المرور"; $("maskBtn").textContent = t; $("maskBtn2").textContent = t; render(); }
  $("maskBtn").addEventListener("click", toggleMask);
  $("maskBtn2").addEventListener("click", toggleMask);
  $("saveBtn").addEventListener("click", function () {
    $("saveBtn").disabled = true; $("saveSt").textContent = "جارٍ الحفظ...";
    api("PUT", "/api/data", data).then(function (j) {
      if (j._status === 401) { toast("انتهت الجلسة، سجّل الدخول من جديد"); return showLogin(); }
      if (j.ok) { data.updated = j.updated; setDirty(false); toast("تم الحفظ"); renderSum(); } else { $("saveSt").textContent = j.error || "تعذّر الحفظ"; $("saveBtn").disabled = false; }
    }).catch(function () { $("saveSt").textContent = "تعذّر الاتصال بالسيرفر"; $("saveBtn").disabled = false; });
  });
  window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  // add account
  (function () {
    var sel = $("addSel");
    CATS.forEach(function (c) {
      var og = el("optgroup"); og.label = c[1];
      META.catalog.filter(function (x) { return x[1] === c[0]; }).forEach(function (x) { var o = el("option", null, x[2]); o.value = x[0]; og.append(o); });
      sel.append(og);
    });
  })();
  $("addBtn").addEventListener("click", function () {
    var k = $("addSel").value, a = { id: "a" + Date.now(), service: k, name: "", user: "", email: "", password: "", followers: "", url: "", admin: "", note: "" };
    data.accounts.push(a); collapsed[CAT[k].cat] = false; setDirty(true); render();
    var row = document.querySelector('[data-id="' + a.id + '"]'); if (row) { row.scrollIntoView({ block: "center" }); var f = row.querySelector("input"); if (f) f.focus(); }
  });

  // ---- render ----
  function chip(value, isPw, acc, key) {
    var v = el("div", "val");
    if (!value) {
      v.classList.add("empty");
      if (!acc) { v.textContent = "—"; return v; }
      v.classList.add("fill"); v.textContent = "+ " + ({ user: "اسم الحساب", email: "الجيميل", password: "كلمة المرور", emailPassword: "مرور الجيميل" }[key] || "إضافة");
      v.title = "اضغط للكتابة";
      v.addEventListener("click", function () {
        var i = el("input", "ed inline"); i.type = (key === "password" || key === "emailPassword") && masked ? "password" : key === "email" ? "email" : "text";
        v.replaceWith(i); i.focus();
        var done = false;
        function commit() {
          if (done) return; done = true;
          var val = i.value.trim();
          if (val) { acc[key] = val; if (key === "password") acc.pwDate = today(); setDirty(true); toast("اضغط «حفظ» لتثبيت التعديل"); }
          render();
        }
        i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { done = true; render(); } });
        i.addEventListener("blur", commit);
      });
      return v;
    }
    v.textContent = isPw && masked ? "••••••" : value; v.title = "اضغط للنسخ";
    v.addEventListener("click", function () {
      (navigator.clipboard ? navigator.clipboard.writeText(value) : Promise.reject()).then(function () { v.classList.add("copied"); toast("تم النسخ"); setTimeout(function () { v.classList.remove("copied"); }, 1200); })
        .catch(function () { toast("انسخ يدويًا"); });
    });
    return v;
  }
  function renderAlerts() {
    var box = $("alerts"); box.textContent = "";
    var withPw = data.accounts.filter(function (a) { return a.password; }), byPw = {};
    withPw.forEach(function (a) { (byPw[a.password] = byPw[a.password] || []).push(a); });
    var reused = Object.keys(byPw).filter(function (k) { return byPw[k].length > 1; });
    var no2fa = withPw.filter(function (a) { return a.twofa === "off"; });
    var old = withPw.filter(function (a) { return a.pwDate && daysSince(a.pwDate) > 180; });
    var lines = [];
    reused.forEach(function (k) { lines.push("نفس كلمة المرور مستخدمة في: " + byPw[k].map(nameOf).join("، ")); });
    if (no2fa.length) lines.push("بدون تحقق بخطوتين: " + no2fa.map(nameOf).join("، "));
    if (old.length) lines.push("كلمة مرور أقدم من 6 شهور: " + old.map(nameOf).join("، "));
    box.hidden = !lines.length;
    if (lines.length) { box.append(el("b", null, "تنبيهات الأمان")); lines.forEach(function (l) { box.append(el("span", null, "• " + l)); }); }
  }
  function renderSum() {
    var s = $("sum"); s.textContent = "";
    var total = 0, any = false;
    data.accounts.forEach(function (a) { if (svc(a).fol && Number(a.followers)) { total += Number(a.followers); any = true; } });
    var filled = data.accounts.filter(function (a) { return a.user || a.email || a.password; }).length;
    [[any ? fmt(total) : "—", "إجمالي المتابعين"], [(data.rating && data.rating.value) || "—", "تقييم جوجل" + (data.rating && data.rating.count ? " · " + data.rating.count : "")], [filled + "/" + data.accounts.length, "حسابات مكتملة"]].forEach(function (it, i) {
      var d = el("div"); d.append(el("b", null, it[0]), el("span", null, it[1]));
      if (i === 1 && editing) {
        var r = el("div", "rating"); r.append(inp(data.rating, "value", "4.3"), inp(data.rating, "count", "24")); d.append(r);
      }
      s.append(d);
    });
    $("subLine").textContent = "اضغط على أي بيانات عشان تنسخ، واضغط على اسم المنصة عشان تفتح الحساب." + (data.updated ? " · آخر حفظ: " + data.updated : "");
  }
  function inp(obj, key, ph, type) {
    var i = el("input", "ed"); i.type = type || "text"; i.value = obj[key] || ""; if (ph) i.placeholder = ph;
    i.addEventListener("input", function () { obj[key] = i.value; setDirty(true); });
    return i;
  }
  function lab(text, node, full) { var l = el("label", full ? "full" : null); l.append(el("span", null, text), node); return l; }

  function viewRow(a, child) {
    var tr = el("div", "tr"); tr.dataset.id = a.id;
    var pc = el("div", "pc"), s = svc(a), url = a.url || s.url;
    if (child) {
      var lb = url ? ext(a, "الحساب الإعلاني", url, "lbl") : el("span", "lbl", "الحساب الإعلاني"); pc.append(lb);
    } else if (url) { var l1 = ext(a, "", url); l1.append(icon(a)); pc.append(l1, ext(a, nameOf(a), url, "nm")); }
    else pc.append(icon(a), el("span", "nm nolink", nameOf(a)));
    if (!child && s.fol && Number(a.followers)) pc.append(el("small", null, fmt(a.followers) + " متابع"));
    var admin = a.admin || s.admin;
    if (admin) pc.append(ext(a, s.adminLabel || "الإدارة", admin, "adm"));
    var cv = el("div", "cv"); cv.append(chip(a.user, false, a, "user")); var m = chip(a.email, false, a, "email"); m.classList.add("mail"); cv.append(m);
    var pw = el("div", "cv"); pw.append(chip(a.password, true, a, "password"), chip(a.emailPassword, true, a, "emailPassword"));
    tr.append(pc, cv, pw);
    var meta = [];
    if (a.phone) meta.push(["الجوال: \u2066" + a.phone + "\u2069"]);
    if (a.owner) meta.push(["المسؤول: " + a.owner]);
    if (a.twofa === "on") meta.push(["التحقق بخطوتين ✓", "good"]);
    else if (a.twofa === "off" && a.password) meta.push(["بدون تحقق بخطوتين", "bad"]);
    if (a.pwDate) meta.push(["الباسورد من \u2066" + a.pwDate + "\u2069", daysSince(a.pwDate) > 180 ? "bad" : ""]);
    if (meta.length) { var m = el("div", "meta"); meta.forEach(function (x) { m.append(el("span", x[1] || null, x[0])); }); tr.append(m); }
    if (a.note) tr.append(el("div", "note", a.note));
    return tr;
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function daysSince(d) { return Math.floor((Date.now() - new Date(d + "T00:00:00Z").getTime()) / 864e5); }
  function genPassword() {
    var cs = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?", out = "", r = new Uint32Array(16);
    crypto.getRandomValues(r); for (var i = 0; i < 16; i++) out += cs[r[i] % cs.length]; return out;
  }
  function editRow(a, child) {
    var r = el("div", "er" + (child ? " child" : "")); r.dataset.id = a.id; var s = svc(a);
    var top = el("div", "top"); top.append(icon(a), el("b", null, nameOf(a)));
    var del = el("button", "del", "حذف"); del.type = "button";
    del.addEventListener("click", function () { if (window.confirm("حذف «" + nameOf(a) + "»؟")) { data.accounts.splice(data.accounts.indexOf(a), 1); setDirty(true); render(); } });
    top.append(del); r.append(top);
    var g = el("div", "eg");
    if (a.service === "custom") g.append(lab("اسم الخدمة", inp(a, "name", "مثال: Hostinger"), true));
    g.append(lab("اسم الحساب", inp(a, "user")), lab("الجيميل", inp(a, "email", "", "email")));
    var pwi = inp(a, "password", "", masked ? "password" : "text");
    pwi.addEventListener("input", function () { a.pwDate = today(); });
    var gen = el("button", "gen", "توليد"); gen.type = "button";
    gen.addEventListener("click", function () { if (a.password && !window.confirm("استبدال كلمة المرور الحالية بكلمة جديدة؟ (غيّرها في المنصة نفسها أولًا)")) return; a.password = genPassword(); a.pwDate = today(); pwi.value = a.password; pwi.type = "text"; setDirty(true); });
    var pr = el("div", "pwrow"); pr.append(pwi, gen);
    g.append(lab("كلمة مرور الحساب", pr));
    g.append(lab("كلمة مرور الجيميل", inp(a, "emailPassword", "", masked ? "password" : "text")));
    if (s.fol) { var f = inp(a, "followers", "مثال: 15400"); f.inputMode = "numeric"; g.append(lab("المتابعون", f)); } else g.append(lab("وصف قصير", inp(a, "name", "اختياري")));
    g.append(lab("رابط الحساب" + (s.url ? " (اختياري)" : ""), inp(a, "url", s.url || "https://")), lab("رابط الإدارة" + (s.admin ? " (اختياري)" : ""), inp(a, "admin", s.admin || "https://")));
    g.append(lab("الجوال المرتبط", inp(a, "phone", "+974...", "tel")), lab("المسؤول عن الحساب", inp(a, "owner", "الاسم")));
    var tf = el("select", "ed"); [["", "غير محدد"], ["on", "مفعّل"], ["off", "غير مفعّل"]].forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; if ((a.twofa || "") === o[0]) op.selected = true; tf.append(op); });
    tf.addEventListener("change", function () { a.twofa = tf.value; setDirty(true); });
    g.append(lab("التحقق بخطوتين", tf));
    g.append(lab("ملاحظة", inp(a, "note", "مثال: رقم التحقق على جوال المدير"), true));
    r.append(g); return r;
  }

  // يبني «بلوكات»: المنصة ومعاها الحساب الإعلاني بتاعها تحتها
  function blocks(accs) {
    var order = META.catalog.map(function (x) { return x[0]; });
    var mains = accs.filter(function (a) { return !svc(a).parent; }), kids = accs.filter(function (a) { return svc(a).parent; });
    mains.sort(function (a, b) { return order.indexOf(a.service) - order.indexOf(b.service); });
    var out = mains.map(function (m) { return { main: m, kids: [] }; });
    kids.forEach(function (k) {
      var host = out.filter(function (o) { return o.main.service === svc(k).parent; })[0];
      if (host) host.kids.push(k); else out.push({ main: k, kids: [] });
    });
    return out;
  }
  function match(a) {
    if (!query) return true;
    var hay = (nameOf(a) + " " + svc(a).name + " " + a.service + " " + (a.user || "") + " " + (a.email || "") + " " + (a.note || "")).toLowerCase();
    return hay.indexOf(query) > -1;
  }
  function render() {
    renderSum(); renderStatus(lastStatus); renderQuick();
    var list = $("list"); list.textContent = ""; var shown = 0;
    CATS.forEach(function (c) {
      var accs = data.accounts.filter(function (a) { return svc(a).cat === c[0] && match(a); });
      if (!accs.length) return;
      shown += accs.length;
      var open = query ? true : collapsed[c[0]] !== true;
      var head = el("button", "sec"); head.type = "button"; head.setAttribute("aria-expanded", open);
      var sm = el("small"); sm.append(document.createTextNode(accs.length + " حسابات"), el("span", "arr", "▾"));
      head.append(el("h2", null, c[1]), sm);
      head.addEventListener("click", function () { collapsed[c[0]] = open; render(); });
      list.append(head);
      if (!open) return;
      var t = el("div", "tbl"), bl = blocks(accs);
      if (editing) {
        bl.forEach(function (o) { t.append(editRow(o.main)); o.kids.forEach(function (k) { t.append(editRow(k, true)); }); });
        list.append(t); return;
      }
      // «عرض المزيد»: نعرض اللي فيه بيانات، والباقي يظهر بالزرار تحت آخر منصة
      var extra = [];
      var filled = function (o) { return !isEmpty(o.main) || o.kids.some(function (k) { return !isEmpty(k); }); };
      bl = bl.filter(filled).concat(bl.filter(function (o) { return !filled(o); })); // اللي فيه بيانات الأول
      if (!query && !showMore[c[0]] && bl.length > 4) { extra = bl.slice(4); bl = bl.slice(0, 4); }
      var th = el("div", "th"); th.append(el("span", null, "المنصة"), el("span", null, "اسم الحساب / الجيميل"), el("span", null, "كلمات المرور")); t.append(th);
      var groups = {}, keys = [];
      bl.forEach(function (o) { var k = (o.main.email || "").trim().toLowerCase(); if (!groups[k]) { groups[k] = []; keys.push(k); } groups[k].push(o); });
      keys.sort(function (x, y) { if (!x) return 1; if (!y) return -1; return groups[y].length - groups[x].length; });
      keys.forEach(function (k) {
        if (k && groups[k].length > 1) {
          var n = groups[k].reduce(function (t2, o) { return t2 + 1 + o.kids.length; }, 0);
          var gh = el("div", "grp-h"); gh.append(chip(groups[k][0].main.email), el("small", null, n + " حسابات")); t.append(gh);
        }
        groups[k].forEach(function (o) {
          var bk = el("div", "blk" + (o.kids.length ? " has-sub" : ""));
          bk.append(viewRow(o.main)); o.kids.forEach(function (kid) { bk.append(viewRow(kid, true)); });
          t.append(bk);
        });
      });
      if (extra.length || showMore[c[0]]) {
        var mb = el("button", "more-row", showMore[c[0]] ? "عرض أقل" : "عرض المزيد (" + extra.length + ")");
        mb.type = "button"; mb.addEventListener("click", function () { showMore[c[0]] = !showMore[c[0]]; render(); });
        t.append(mb);
      }
      list.append(t);
    });
    if (!shown) list.append(el("div", "empty-q", query ? "لا توجد نتائج لـ «" + query + "»" : "لا توجد حسابات"));
  }
  function renderQuick() {
    var q = $("adsQuick"); q.textContent = "";
    META.catalog.filter(function (c) { return c[8] || c[0] === "google-ads"; }).forEach(function (c) {
      var acc = data.accounts.filter(function (a) { return a.service === c[0]; })[0] || { service: c[0] };
      var x = ext(acc, "", (acc.url || c[4]), null); x.append(icon(acc), el("span", null, c[2])); q.append(x);
    });
  }
  $("q").addEventListener("input", function () { query = this.value.trim().toLowerCase(); render(); });

  // ---- page status ----
  function renderStatus(r) {
    var b = $("statusBox"); b.textContent = "";
    if (editing) {
      var g = el("div", "eg"); g.append(lab("رابط صفحة الروابط بعد نشرها", inp(data, "pageUrl", "https://"), true)); b.append(g); return;
    }
    if (!r) { b.append(el("div", "muted", data.pageUrl ? "اضغط «فحص الآن» لفحص البيكسلات ورقم الواتساب." : "أضف رابط صفحة الروابط من «تعديل البيانات».")); return; }
    if (!r.ok) { b.append(el("div", "muted", r.error || "تعذّر الفحص")); return; }
    function ln(k, v, on) { var d = el("div", "ln"); d.append(el("span", null, k), el("span", on ? "on" : "off", v)); b.append(d); }
    ln("رقم الواتساب", r.whatsapp || "غير موجود", !!r.whatsapp);
    r.checks.forEach(function (c) { ln(c.name, c.on ? ("مركّب" + (c.id ? " · " + c.id : "")) : "غير مركّب", c.on); });
    b.append(el("div", "muted", "آخر فحص: " + new Date(r.checkedAt).toLocaleString("ar-QA")));
  }
  function runCheck() {
    if (dirty) { toast("احفظ التعديلات أولًا"); return; }
    $("checkBtn").disabled = true; $("checkBtn").textContent = "جارٍ الفحص...";
    api("GET", "/api/status").then(function (j) {
      $("checkBtn").disabled = false; $("checkBtn").textContent = "فحص الآن";
      if (j._status === 401) return showLogin();
      lastStatus = j; renderStatus(j);
    }).catch(function () { $("checkBtn").disabled = false; $("checkBtn").textContent = "فحص الآن"; lastStatus = { ok: false, error: "تعذّر الاتصال بالسيرفر" }; renderStatus(lastStatus); });
  }
  $("checkBtn").addEventListener("click", runCheck);

  // سجل الدخول
  function loadLog() {
    api("GET", "/api/log").then(function (j) {
      var b = $("logBox"); b.textContent = "";
      if (j._status === 401) return showLogin();
      var items = (j.items || []).slice(0, 15);
      if (!items.length) { b.append(el("div", "muted", "لا يوجد سجل بعد")); return; }
      items.forEach(function (it) {
        var d = el("div", "ln");
        d.append(el("span", null, new Date(it.t).toLocaleString("ar-QA") + (it.country ? " · " + it.country : "") + (it.ip ? " · " + it.ip : "")), el("span", it.ok ? "on" : "off", it.ok ? "دخول ناجح" : "محاولة خاطئة"));
        b.append(d);
      });
    });
  }
  $("logBtn").addEventListener("click", loadLog);

  // قفل تلقائي بعد 15 دقيقة بدون استخدام
  var IDLE_MS = 15 * 60 * 1000, lastAct = Date.now();
  ["click", "keydown", "touchstart", "scroll"].forEach(function (ev) { window.addEventListener(ev, function () { lastAct = Date.now(); }, { passive: true }); });
  setInterval(function () {
    if (data && !$("appView").hidden && Date.now() - lastAct > IDLE_MS) {
      if (dirty) return; // ما نقفلش وفيه تعديلات مش محفوظة
      api("POST", "/api/logout").then(function () { data = null; showLogin(); toast("تم قفل المنصة تلقائيًا"); });
    }
  }, 30000);

  // نسخة احتياطية
  $("expBtn").addEventListener("click", function () {
    if (!window.confirm("الملف هيكون فيه كلمات المرور بدون تشفير. متأكد؟")) return;
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var a = el("a"); a.href = URL.createObjectURL(blob); a.download = "alebdaa-accounts-" + today() + ".json"; document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });
  $("impBtn").addEventListener("click", function () { $("impFile").click(); });
  $("impFile").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var j = JSON.parse(rd.result);
        if (!j || !Array.isArray(j.accounts)) throw 0;
        if (!window.confirm("استبدال كل البيانات الحالية بمحتوى الملف (" + j.accounts.length + " حساب)؟")) return;
        data = j; if (!data.rating) data.rating = { value: "", count: "" }; setDirty(true); render(); toast("تم الاستيراد. اضغط حفظ");
      } catch (e) { toast("الملف غير صالح"); }
    };
    rd.readAsText(f); this.value = "";
  });

  load();
})();
</script>
</body>
</html>
`;
