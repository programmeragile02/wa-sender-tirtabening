require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

const app = express();

// ------------ Config ------------
const PORT = Number(process.env.PORT || 4001);
const API_KEY = process.env.API_KEY || "";
const SESSION_LABEL = process.env.WWS_SESSION_LABEL || "tirtabening";

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ------------ Logs Ring Buffer ------------
const LOG_MAX = Number(process.env.LOG_MAX || 500);
const logs = []; // { ts: number, level: 'info'|'warn'|'error'|'debug', msg: string, meta?: any }

function addLog(level, msg, meta) {
  logs.push({ ts: Date.now(), level, msg, meta });
  if (logs.length > LOG_MAX) logs.splice(0, logs.length - LOG_MAX);
  // tetap kirim ke console untuk debugging server
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
  if (level === "error") console.error(line, meta || "");
  else if (level === "warn") console.warn(line, meta || "");
  else console.log(line, meta || "");
}

// ------------ Middleware ------------
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.length === 0) return cb(null, true);
      return allowedOrigins.includes(origin)
        ? cb(null, true)
        : cb(new Error("Not allowed by CORS"));
    },
  })
);

// Simple API key auth
app.use((req, res, next) => {
  if (!API_KEY) return next(); // kalau tidak di-set, nonaktif (dev only)
  const key = req.header("x-api-key");
  if (key && key === API_KEY) return next();
  return res.status(401).json({ ok: false, message: "Unauthorized" });
});

// Rate limit dasar
// const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 }); // 60 req/menit/server
// app.use(limiter);

// Tambahkan limiter spesifik utk endpoint "write"
const writeLimiter = rateLimit({ windowMs: 60_000, max: 120 }); // bebasin s.d. 120/mnt

// ------------ WA Client ------------
let lastQRData = null; // simpan QR terakhir (data url)
let ready = false;
let state = "INIT";
let me = null;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: SESSION_LABEL }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", async (qr) => {
  state = "QR";
  ready = false;
  me = null;
  lastQRData = await QRCode.toDataURL(qr, { margin: 1 });
  // tampilkan QR di console juga
  qrcodeTerminal.generate(qr, { small: true });
  console.log("[WA] QR siap discan.");
  addLog("info", "QR siap discan");
});

client.on("ready", async () => {
  state = "READY";
  ready = true;

  // --- coba getMe(), fallback ke client.info ---
  let who = null;
  try {
    who = await client.getMe();
  } catch {}
  const inf = client.info || {};

  // Normalisasi ke objek yang konsisten
  me = who || {
    wid: inf?.wid?._serialized || null,
    user: inf?.wid?.user || null,
    pushname: inf?.pushname || null,
    platform: inf?.platform || null,
  };

  lastQRData = null;
  try {
    addLog?.("info", "WhatsApp Ready", { me });
  } catch {}
  console.log("[WA] Ready.");
});

client.on("change_state", (s) => {
  state = s || state;
  console.log("[WA] state:", state);
  addLog("info", "change_state", { state });
});

client.on("auth_failure", (m) => {
  console.error("[WA] Auth failure:", m);
  state = "AUTH_FAILURE";
  ready = false;
  me = null;
  addLog("error", "Auth failure", { message: m });
});

client.on("disconnected", async (reason) => {
  console.warn("[WA] Disconnected:", reason);
  ready = false;
  state = "DISCONNECTED";
  me = null;
  // otomatis reinit
  addLog("warn", "Disconnected", { reason });
  setTimeout(() => client.initialize(), 2000);
});

client.on("authenticated", () => {
  const inf = client.info || {};
  me = {
    wid: inf?.wid?._serialized || null,
    user: inf?.wid?.user || null,
    pushname: inf?.pushname || null,
    platform: inf?.platform || null,
  };
  try {
    addLog?.("info", "Authenticated", { me });
  } catch {}
});

client.initialize();

// ------------ Helpers ------------
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;

  // Normalisasi ke format Indonesia: 62xxxxxxxx
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("8")) return "62" + digits;
  // jika sudah +62 (dihilangkan plus), atau negara lain, gunakan apa adanya
  return digits;
}

// Normalisasi nomor
function normNumber(raw) {
  return String(raw || "")
    .replace(/\D/g, "")
    .replace(/^0/, "62");
}

async function ensureReady(res) {
  if (!ready) {
    return res.status(503).json({
      ok: false,
      message: "WhatsApp belum siap. Scan QR / tunggu READY.",
    });
  }
  return null;
}

// ------------ Routes ------------
app.get("/health", (req, res) => {
  res.json({ ok: true, state, ready, me });
});

app.get("/status", (req, res) => {
  let meNow = null;
  if (ready) {
    // isi dari getMe() atau fallback client.info (seperti patch sebelumnya)
    const inf = client.info || {};
    meNow = me || {
      wid: inf?.wid?._serialized || null,
      user: inf?.wid?.user || null,
      pushname: inf?.pushname || null,
      platform: inf?.platform || null,
    };
  }
  res.json({ ok: true, state, ready, me: meNow });
});

// Ambil QR terakhir (untuk dashboard)
app.get("/qr", (req, res) => {
  if (ready || !lastQRData) return res.status(204).end(); // tidak ada QR bila sudah ready
  res.json({ ok: true, dataUrl: lastQRData });
});

// Kirim pesan tunggal
// body: { to: string, text: string }
app.post("/send", writeLimiter, async (req, res) => {
  try {
    if (await ensureReady(res)) return;
    const { to, text } = req.body || {};
    if (!to || !text) {
      return res
        .status(400)
        .json({ ok: false, message: "`to` dan `text` wajib" });
    }

    const msisdn = normalizePhone(to);
    if (!msisdn)
      return res.status(400).json({ ok: false, message: "Nomor tidak valid" });

    const jid = `${msisdn}@c.us`;
    const sent = await client.sendMessage(jid, text);

    addLog("info", "Send text OK", {
      to: msisdn,
      id: sent?.id?._serialized || null,
    });

    return res.json({
      ok: true,
      id: sent?.id?._serialized || sent?.id?.id || null,
      to: msisdn,
    });
  } catch (e) {
    addLog("error", "Send text FAIL", { error: e?.message });
    console.error("[/send] error:", e);
    res
      .status(500)
      .json({ ok: false, message: e?.message || "Gagal kirim WA" });
  }
});

// Kirim dokumen (PDF)
app.post("/send-document", writeLimiter, async (req, res) => {
  try {
    const { to, url, base64, filename, caption, mimeType } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, message: "to wajib" });
    if (!url && !base64) {
      return res
        .status(400)
        .json({ ok: false, message: "url atau base64 wajib" });
    }

    const jid = `${normNumber(to)}@c.us`;

    let b64,
      mime = mimeType || "application/pdf",
      name = filename || "invoice.pdf";
    if (url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Gagal fetch PDF: ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      b64 = buf.toString("base64");
    } else {
      b64 = base64;
    }

    const media = new MessageMedia(mime, b64, name);
    await client.sendMessage(jid, media, { caption: caption || "" });

    addLog("info", "Send document OK", { to, filename: name });
    return res.json({ ok: true });
  } catch (e) {
    addLog("error", "Send document FAIL", {
      to: req.body?.to,
      error: e?.message,
    });
    console.error("[send-document] error:", e);
    return res.status(500).json({ ok: false, message: String(e.message || e) });
  }
});

// Kirim gambar (JPG/PNG)
// body: { to: string, url?: string, base64?: string, caption?: string, mimeType?: string, filename?: string }
app.post("/send-image", writeLimiter, async (req, res) => {
  try {
    if (await ensureReady(res)) return;
    const { to, url, base64, caption, mimeType, filename } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, message: "`to` wajib" });
    if (!url && !base64)
      return res
        .status(400)
        .json({ ok: false, message: "`url` atau `base64` wajib" });

    const jid = `${normNumber(to)}@c.us`;

    // deteksi mime default
    const mime = mimeType || "image/jpeg";
    const name = filename || (mime.includes("png") ? "image.png" : "image.jpg");

    let b64;
    if (url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Gagal fetch image: ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      b64 = buf.toString("base64");
    } else {
      b64 = base64;
    }

    const media = new MessageMedia(mime, b64, name);
    const sent = await client.sendMessage(jid, media, {
      caption: caption || "",
    });

    addLog("info", "Send image OK", {
      to,
      id: sent?.id?._serialized || null,
      filename: name,
    });
    return res.json({
      ok: true,
      id: sent?.id?._serialized || null,
    });
  } catch (e) {
    addLog("error", "Send image FAIL", { to: req.body?.to, error: e?.message });
    console.error("[/send-image] error:", e);
    return res
      .status(500)
      .json({ ok: false, message: String(e?.message || e) });
  }
});

// Bulk kirim (opsional)
// body: { items: [{to, text}, ...], delayMs?: number }
app.post("/bulk", writeLimiter, async (req, res) => {
  try {
    if (await ensureReady(res)) return;
    const { items, delayMs = 800 } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "`items` wajib array" });
    }

    const results = [];
    for (const it of items) {
      try {
        const msisdn = normalizePhone(it.to);
        if (!msisdn) throw new Error("Nomor tidak valid");
        const jid = `${msisdn}@c.us`;
        const sent = await client.sendMessage(jid, it.text);
        results.push({
          to: msisdn,
          ok: true,
          id: sent?.id?._serialized || null,
        });
        addLog("info", "Bulk send OK", { to: msisdn });
      } catch (err) {
        results.push({
          to: it.to,
          ok: false,
          message: err?.message || "error",
        });
        addLog("warn", "Bulk send FAIL", { to: it.to, error: err?.message });
      }
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }

    res.json({ ok: true, results });
  } catch (e) {
    addLog("error", "Bulk endpoint FAIL", { error: e?.message });
    console.error("[/bulk] error:", e);
    res.status(500).json({ ok: false, message: e?.message || "Bulk gagal" });
  }
});

// Logout & hapus session (perlu scan ulang)
app.post("/logout", writeLimiter, async (req, res) => {
  try {
    await client.logout();
    ready = false;
    state = "LOGOUT";
    me = null;
    addLog("info", "Logout session OK");
    setTimeout(() => {
      try {
        client.initialize();
        addLog("info", "Reinitialize after logout");
      } catch {}
    }, 1000);
    res.json({ ok: true });
  } catch (e) {
    addLog("error", "Logout FAIL", { error: e?.message });
    res.status(500).json({ ok: false, message: e?.message || "Gagal logout" });
  }
});

// reinit
// Re-init: paksa inisialisasi ulang supaya QR baru muncul
let _reinitLock = false;

app.post("/reinit", async (req, res) => {
  try {
    if (_reinitLock) {
      return res.json({ ok: true, message: "Already reinitializing" });
    }
    _reinitLock = true;

    // kalau ada, tulis log ringkas
    try {
      typeof addLog === "function" &&
        addLog("info", "Manual re-init requested");
    } catch {}

    ready = false;
    state = "INIT";

    // hentikan sesi lama bila masih nyangkut (aman diabaikan kalau sudah tidak aktif)
    try {
      await client.logout();
    } catch {}

    // inisialisasi ulang
    setTimeout(() => {
      try {
        client.initialize();
        try {
          typeof addLog === "function" &&
            addLog("info", "Client.initialize() called");
        } catch {}
      } catch (e) {
        console.error("[/reinit] initialize fail:", e?.message || e);
      } finally {
        _reinitLock = false;
      }
    }, 300);

    res.json({ ok: true });
  } catch (e) {
    _reinitLock = false;
    try {
      typeof addLog === "function" &&
        addLog("error", "Manual re-init FAIL", { error: e?.message });
    } catch {}
    res.status(500).json({ ok: false, message: String(e?.message || e) });
  }
});

// get logs
app.get("/logs", (req, res) => {
  const limit = Math.min(Number(req.query.limit || 200), LOG_MAX);
  const slice = logs.slice(-limit).reverse();
  res.json({ ok: true, items: slice });
});

app.listen(PORT, () => {
  console.log(`[WA-SENDER] listening on :${PORT}`);
});
