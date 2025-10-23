// require("dotenv").config();

// const express = require("express");
// const cors = require("cors");
// const rateLimit = require("express-rate-limit");
// const qrcodeTerminal = require("qrcode-terminal");
// const QRCode = require("qrcode");
// const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

// const app = express();

// // ------------ Config ------------
// const PORT = Number(process.env.PORT || 4001);
// const API_KEY = process.env.API_KEY || "";
// const SESSION_LABEL = process.env.WWS_SESSION_LABEL || "tirtabening";

// const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
//   .split(",")
//   .map((s) => s.trim())
//   .filter(Boolean);

// // ------------ Logs Ring Buffer ------------
// const LOG_MAX = Number(process.env.LOG_MAX || 500);
// const logs = []; // { ts: number, level: 'info'|'warn'|'error'|'debug', msg: string, meta?: any }

// function addLog(level, msg, meta) {
//   logs.push({ ts: Date.now(), level, msg, meta });
//   if (logs.length > LOG_MAX) logs.splice(0, logs.length - LOG_MAX);
//   // tetap kirim ke console untuk debugging server
//   const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
//   if (level === "error") console.error(line, meta || "");
//   else if (level === "warn") console.warn(line, meta || "");
//   else console.log(line, meta || "");
// }

// // ------------ Middleware ------------
// app.use(express.json({ limit: "1mb" }));
// app.use(
//   cors({
//     origin: (origin, cb) => {
//       if (!origin || allowedOrigins.length === 0) return cb(null, true);
//       return allowedOrigins.includes(origin)
//         ? cb(null, true)
//         : cb(new Error("Not allowed by CORS"));
//     },
//   })
// );

// // Simple API key auth
// app.use((req, res, next) => {
//   if (!API_KEY) return next(); // kalau tidak di-set, nonaktif (dev only)
//   const key = req.header("x-api-key");
//   if (key && key === API_KEY) return next();
//   return res.status(401).json({ ok: false, message: "Unauthorized" });
// });

// // Rate limit dasar
// // const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 }); // 60 req/menit/server
// // app.use(limiter);

// // Tambahkan limiter spesifik utk endpoint "write"
// const writeLimiter = rateLimit({ windowMs: 60_000, max: 120 }); // bebasin s.d. 120/mnt

// // ------------ WA Client ------------
// let lastQRData = null; // simpan QR terakhir (data url)
// let ready = false;
// let state = "INIT";
// let me = null;

// const client = new Client({
//   authStrategy: new LocalAuth({ clientId: SESSION_LABEL }),
//   puppeteer: {
//     headless: true,
//     args: ["--no-sandbox", "--disable-setuid-sandbox"],
//   },
// });

// client.on("qr", async (qr) => {
//   state = "QR";
//   ready = false;
//   me = null;
//   lastQRData = await QRCode.toDataURL(qr, { margin: 1 });
//   // tampilkan QR di console juga
//   qrcodeTerminal.generate(qr, { small: true });
//   console.log("[WA] QR siap discan.");
//   addLog("info", "QR siap discan");
// });

// client.on("ready", async () => {
//   state = "READY";
//   ready = true;

//   // --- coba getMe(), fallback ke client.info ---
//   let who = null;
//   try {
//     who = await client.getMe();
//   } catch {}
//   const inf = client.info || {};

//   // Normalisasi ke objek yang konsisten
//   me = who || {
//     wid: inf?.wid?._serialized || null,
//     user: inf?.wid?.user || null,
//     pushname: inf?.pushname || null,
//     platform: inf?.platform || null,
//   };

//   lastQRData = null;
//   try {
//     addLog?.("info", "WhatsApp Ready", { me });
//   } catch {}
//   console.log("[WA] Ready.");
// });

// client.on("change_state", (s) => {
//   state = s || state;
//   console.log("[WA] state:", state);
//   addLog("info", "change_state", { state });
// });

// client.on("auth_failure", (m) => {
//   console.error("[WA] Auth failure:", m);
//   state = "AUTH_FAILURE";
//   ready = false;
//   me = null;
//   addLog("error", "Auth failure", { message: m });
// });

// client.on("disconnected", async (reason) => {
//   console.warn("[WA] Disconnected:", reason);
//   ready = false;
//   state = "DISCONNECTED";
//   me = null;
//   // otomatis reinit
//   addLog("warn", "Disconnected", { reason });
//   setTimeout(() => client.initialize(), 2000);
// });

// client.on("authenticated", () => {
//   const inf = client.info || {};
//   me = {
//     wid: inf?.wid?._serialized || null,
//     user: inf?.wid?.user || null,
//     pushname: inf?.pushname || null,
//     platform: inf?.platform || null,
//   };
//   try {
//     addLog?.("info", "Authenticated", { me });
//   } catch {}
// });

// client.initialize();

// // ------------ Helpers ------------
// function normalizePhone(raw) {
//   if (!raw) return null;
//   const digits = String(raw).replace(/\D/g, "");
//   if (!digits) return null;

//   // Normalisasi ke format Indonesia: 62xxxxxxxx
//   if (digits.startsWith("62")) return digits;
//   if (digits.startsWith("0")) return "62" + digits.slice(1);
//   if (digits.startsWith("8")) return "62" + digits;
//   // jika sudah +62 (dihilangkan plus), atau negara lain, gunakan apa adanya
//   return digits;
// }

// // Normalisasi nomor
// function normNumber(raw) {
//   return String(raw || "")
//     .replace(/\D/g, "")
//     .replace(/^0/, "62");
// }

// async function ensureReady(res) {
//   if (!ready) {
//     return res.status(503).json({
//       ok: false,
//       message: "WhatsApp belum siap. Scan QR / tunggu READY.",
//     });
//   }
//   return null;
// }

// // ------------ Routes ------------
// app.get("/health", (req, res) => {
//   res.json({ ok: true, state, ready, me });
// });

// app.get("/status", (req, res) => {
//   let meNow = null;
//   if (ready) {
//     // isi dari getMe() atau fallback client.info (seperti patch sebelumnya)
//     const inf = client.info || {};
//     meNow = me || {
//       wid: inf?.wid?._serialized || null,
//       user: inf?.wid?.user || null,
//       pushname: inf?.pushname || null,
//       platform: inf?.platform || null,
//     };
//   }
//   res.json({ ok: true, state, ready, me: meNow });
// });

// // Ambil QR terakhir (untuk dashboard)
// app.get("/qr", (req, res) => {
//   if (ready || !lastQRData) return res.status(204).end(); // tidak ada QR bila sudah ready
//   res.json({ ok: true, dataUrl: lastQRData });
// });

// // Kirim pesan tunggal
// // body: { to: string, text: string }
// app.post("/send", writeLimiter, async (req, res) => {
//   try {
//     if (await ensureReady(res)) return;
//     const { to, text } = req.body || {};
//     if (!to || !text) {
//       return res
//         .status(400)
//         .json({ ok: false, message: "`to` dan `text` wajib" });
//     }

//     const msisdn = normalizePhone(to);
//     if (!msisdn)
//       return res.status(400).json({ ok: false, message: "Nomor tidak valid" });

//     const jid = `${msisdn}@c.us`;
//     const sent = await client.sendMessage(jid, text);

//     addLog("info", "Send text OK", {
//       to: msisdn,
//       id: sent?.id?._serialized || null,
//     });

//     return res.json({
//       ok: true,
//       id: sent?.id?._serialized || sent?.id?.id || null,
//       to: msisdn,
//     });
//   } catch (e) {
//     addLog("error", "Send text FAIL", { error: e?.message });
//     console.error("[/send] error:", e);
//     res
//       .status(500)
//       .json({ ok: false, message: e?.message || "Gagal kirim WA" });
//   }
// });

// // Kirim dokumen (PDF)
// app.post("/send-document", writeLimiter, async (req, res) => {
//   try {
//     const { to, url, base64, filename, caption, mimeType } = req.body || {};
//     if (!to) return res.status(400).json({ ok: false, message: "to wajib" });
//     if (!url && !base64) {
//       return res
//         .status(400)
//         .json({ ok: false, message: "url atau base64 wajib" });
//     }

//     const jid = `${normNumber(to)}@c.us`;

//     let b64,
//       mime = mimeType || "application/pdf",
//       name = filename || "invoice.pdf";
//     if (url) {
//       const r = await fetch(url);
//       if (!r.ok) throw new Error(`Gagal fetch PDF: ${r.status}`);
//       const buf = Buffer.from(await r.arrayBuffer());
//       b64 = buf.toString("base64");
//     } else {
//       b64 = base64;
//     }

//     const media = new MessageMedia(mime, b64, name);
//     await client.sendMessage(jid, media, { caption: caption || "" });

//     addLog("info", "Send document OK", { to, filename: name });
//     return res.json({ ok: true });
//   } catch (e) {
//     addLog("error", "Send document FAIL", {
//       to: req.body?.to,
//       error: e?.message,
//     });
//     console.error("[send-document] error:", e);
//     return res.status(500).json({ ok: false, message: String(e.message || e) });
//   }
// });

// // Kirim gambar (JPG/PNG)
// // body: { to: string, url?: string, base64?: string, caption?: string, mimeType?: string, filename?: string }
// app.post("/send-image", writeLimiter, async (req, res) => {
//   try {
//     if (await ensureReady(res)) return;
//     const { to, url, base64, caption, mimeType, filename } = req.body || {};
//     if (!to) return res.status(400).json({ ok: false, message: "`to` wajib" });
//     if (!url && !base64)
//       return res
//         .status(400)
//         .json({ ok: false, message: "`url` atau `base64` wajib" });

//     const jid = `${normNumber(to)}@c.us`;

//     // deteksi mime default
//     const mime = mimeType || "image/jpeg";
//     const name = filename || (mime.includes("png") ? "image.png" : "image.jpg");

//     let b64;
//     if (url) {
//       const r = await fetch(url);
//       if (!r.ok) throw new Error(`Gagal fetch image: ${r.status}`);
//       const buf = Buffer.from(await r.arrayBuffer());
//       b64 = buf.toString("base64");
//     } else {
//       b64 = base64;
//     }

//     const media = new MessageMedia(mime, b64, name);
//     const sent = await client.sendMessage(jid, media, {
//       caption: caption || "",
//     });

//     addLog("info", "Send image OK", {
//       to,
//       id: sent?.id?._serialized || null,
//       filename: name,
//     });
//     return res.json({
//       ok: true,
//       id: sent?.id?._serialized || null,
//     });
//   } catch (e) {
//     addLog("error", "Send image FAIL", { to: req.body?.to, error: e?.message });
//     console.error("[/send-image] error:", e);
//     return res
//       .status(500)
//       .json({ ok: false, message: String(e?.message || e) });
//   }
// });

// // Bulk kirim (opsional)
// // body: { items: [{to, text}, ...], delayMs?: number }
// app.post("/bulk", writeLimiter, async (req, res) => {
//   try {
//     if (await ensureReady(res)) return;
//     const { items, delayMs = 800 } = req.body || {};
//     if (!Array.isArray(items) || items.length === 0) {
//       return res
//         .status(400)
//         .json({ ok: false, message: "`items` wajib array" });
//     }

//     const results = [];
//     for (const it of items) {
//       try {
//         const msisdn = normalizePhone(it.to);
//         if (!msisdn) throw new Error("Nomor tidak valid");
//         const jid = `${msisdn}@c.us`;
//         const sent = await client.sendMessage(jid, it.text);
//         results.push({
//           to: msisdn,
//           ok: true,
//           id: sent?.id?._serialized || null,
//         });
//         addLog("info", "Bulk send OK", { to: msisdn });
//       } catch (err) {
//         results.push({
//           to: it.to,
//           ok: false,
//           message: err?.message || "error",
//         });
//         addLog("warn", "Bulk send FAIL", { to: it.to, error: err?.message });
//       }
//       if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
//     }

//     res.json({ ok: true, results });
//   } catch (e) {
//     addLog("error", "Bulk endpoint FAIL", { error: e?.message });
//     console.error("[/bulk] error:", e);
//     res.status(500).json({ ok: false, message: e?.message || "Bulk gagal" });
//   }
// });

// // Logout & hapus session (perlu scan ulang)
// app.post("/logout", writeLimiter, async (req, res) => {
//   try {
//     await client.logout();
//     ready = false;
//     state = "LOGOUT";
//     me = null;
//     addLog("info", "Logout session OK");
//     setTimeout(() => {
//       try {
//         client.initialize();
//         addLog("info", "Reinitialize after logout");
//       } catch {}
//     }, 1000);
//     res.json({ ok: true });
//   } catch (e) {
//     addLog("error", "Logout FAIL", { error: e?.message });
//     res.status(500).json({ ok: false, message: e?.message || "Gagal logout" });
//   }
// });

// // reinit
// // Re-init: paksa inisialisasi ulang supaya QR baru muncul
// let _reinitLock = false;

// app.post("/reinit", async (req, res) => {
//   try {
//     if (_reinitLock) {
//       return res.json({ ok: true, message: "Already reinitializing" });
//     }
//     _reinitLock = true;

//     // kalau ada, tulis log ringkas
//     try {
//       typeof addLog === "function" &&
//         addLog("info", "Manual re-init requested");
//     } catch {}

//     ready = false;
//     state = "INIT";

//     // hentikan sesi lama bila masih nyangkut (aman diabaikan kalau sudah tidak aktif)
//     try {
//       await client.logout();
//     } catch {}

//     // inisialisasi ulang
//     setTimeout(() => {
//       try {
//         client.initialize();
//         try {
//           typeof addLog === "function" &&
//             addLog("info", "Client.initialize() called");
//         } catch {}
//       } catch (e) {
//         console.error("[/reinit] initialize fail:", e?.message || e);
//       } finally {
//         _reinitLock = false;
//       }
//     }, 300);

//     res.json({ ok: true });
//   } catch (e) {
//     _reinitLock = false;
//     try {
//       typeof addLog === "function" &&
//         addLog("error", "Manual re-init FAIL", { error: e?.message });
//     } catch {}
//     res.status(500).json({ ok: false, message: String(e?.message || e) });
//   }
// });

// // get logs
// app.get("/logs", (req, res) => {
//   const limit = Math.min(Number(req.query.limit || 200), LOG_MAX);
//   const slice = logs.slice(-limit).reverse();
//   res.json({ ok: true, items: slice });
// });

// app.listen(PORT, () => {
//   console.log(`[WA-SENDER] listening on :${PORT}`);
// });

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");
const fetch = global.fetch || require("node-fetch");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

const app = express();

// ------------ Config ------------
const PORT = Number(process.env.PORT || 4001);
const API_KEY = process.env.API_KEY || ""; // wajib
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const LOG_MAX = Number(process.env.LOG_MAX || 500);

// ------------ Logs Ring Buffer ------------
const logs = [];
function addLog(level, msg, meta = {}) {
  // kalau meta sudah berisi clientId, biarkan; kalau tidak dan meta.clientIdFrom? ignore
  const entry = {
    ts: Date.now(),
    level,
    msg,
    meta: meta || {},
  };
  logs.push(entry);
  if (logs.length > LOG_MAX) logs.splice(0, logs.length - LOG_MAX);

  // tetap tampil ke console (jika perlu)
  const clientHint = entry.meta?.clientId ? ` [${entry.meta.clientId}]` : "";
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}]${clientHint} ${msg}`;
  if (level === "error") console.error(line, entry.meta || "");
  else if (level === "warn") console.warn(line, entry.meta || "");
  else console.log(line, entry.meta || "");
}

// ------------ Middleware ------------
app.use(express.json({ limit: "5mb" }));
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGINS.length === 0) return cb(null, true);
      return ALLOWED_ORIGINS.includes(origin)
        ? cb(null, true)
        : cb(new Error("Not allowed by CORS"));
    },
  })
);

// Simple API key auth middleware (all endpoints require x-api-key)
app.use((req, res, next) => {
  if (!API_KEY)
    return res
      .status(500)
      .json({ ok: false, message: "API_KEY not set on WA server" });
  const key = req.header("x-api-key");
  if (!key || key !== API_KEY)
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  next();
});

// rate limit for write endpoints
const writeLimiter = rateLimit({ windowMs: 60_000, max: 200 });

// ------------ Multi-WA client manager ------------
/**
 * clients: Map clientId -> { client, ready, state, me, lastQRData }
 */
const clients = new Map();

function normalizeClientId(candidate) {
  return String(candidate || "").replace(/\s+/g, "_");
}

function createClient(clientId) {
  if (!clientId) throw new Error("clientId required");
  const id = normalizeClientId(clientId);
  if (clients.has(id)) return clients.get(id);

  const state = {
    client: null,
    ready: false,
    state: "INIT",
    me: null,
    lastQRData: null,
  };
  clients.set(id, state);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: id }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--no-zygote",
        "--single-process",
      ],
    },
  });

  state.client = client;

  client.on("qr", async (qr) => {
    state.state = "QR";
    state.ready = false;
    state.me = null;
    try {
      state.lastQRData = await QRCode.toDataURL(qr, { margin: 1 });
    } catch {}
    qrcodeTerminal.generate(qr, { small: true });
    addLog("info", "QR Generated", { clientId: id, note: "qr event" });
  });

  client.on("ready", async () => {
    state.state = "READY";
    state.ready = true;
    state.lastQRData = null;
    try {
      const who = await client.getMe();
      state.me = who || client.info || null;
    } catch {
      state.me = client.info || null;
    }
    addLog("info", "Ready", { clientId: id, me: state.me });
  });

  client.on("auth_failure", (m) => {
    state.state = "AUTH_FAILURE";
    state.ready = false;
    state.me = null;
    addLog("error", "Auth Failure", { clientId: id, message: m });
  });

  client.on("disconnected", (reason) => {
    state.ready = false;
    state.state = "DISCONNECTED";
    state.me = null;
    addLog("warn", "Disconnected", { clientId: id, reason });
    // try reinit after short delay
    setTimeout(() => {
      try {
        client.initialize();
      } catch (e) {
        addLog("error", "Reinit Failed", { clientId: id, error: e?.message });
      }
    }, 2000);
  });

  client.on("change_state", (s) => {
    state.state = s || state.state;
    addLog("info", `Change State: ${state.state}`, { clientId: id });
  });

  client.on("authenticated", () => {
    state.me = client.info || state.me;
    addLog("info", "Authenticated", { clientId: id });
  });

  client
    .initialize()
    .catch((err) =>
      addLog("error", `Init Fail`, { clientId: id, error: err?.message })
    );

  return state;
}

function getClientState(clientId) {
  return clients.get(normalizeClientId(clientId)) || null;
}

// ------------ Helpers ------------
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("8")) return "62" + digits;
  return digits;
}

function ensureClientExists(clientId) {
  const id = normalizeClientId(clientId);
  if (!clients.has(id)) createClient(id);
  return clients.get(id);
}

// ------------ Routes ------------

// create/init client
app.post("/clients/:clientId", (req, res) => {
  try {
    const clientId = req.params.clientId;
    if (!clientId)
      return res.status(400).json({ ok: false, message: "clientId required" });
    const state = createClient(clientId);
    return res.json({
      ok: true,
      clientId: normalizeClientId(clientId),
      state: state.state,
    });
  } catch (e) {
    addLog("error", "clients.create fail", { clientId, error: e?.message });
    return res
      .status(500)
      .json({ ok: false, message: String(e?.message || e) });
  }
});

// get qr
app.get("/qr/:clientId", (req, res) => {
  const clientId = req.params.clientId;
  if (!clientId)
    return res.status(400).json({ ok: false, message: "clientId required" });
  const s = getClientState(clientId);
  if (!s)
    return res.status(404).json({ ok: false, message: "client not found" });
  if (s.ready || !s.lastQRData) return res.status(204).end();
  res.json({ ok: true, dataUrl: s.lastQRData });
});

// status
app.get("/status/:clientId", (req, res) => {
  const clientId = req.params.clientId;
  if (!clientId)
    return res.status(400).json({ ok: false, message: "clientId required" });
  const s = getClientState(clientId);
  if (!s)
    return res.status(404).json({ ok: false, message: "client not found" });
  res.json({ ok: true, state: s.state, ready: s.ready, me: s.me });
});

// send text
app.post("/send", writeLimiter, async (req, res) => {
  try {
    const clientId = req.header("x-client-id");
    if (!clientId)
      return res
        .status(400)
        .json({ ok: false, message: "x-client-id header required" });
    const s = getClientState(clientId);
    if (!s)
      return res.status(404).json({ ok: false, message: "client not found" });
    if (!s.ready)
      return res.status(503).json({ ok: false, message: "client not ready" });

    const { to, text } = req.body || {};
    if (!to || !text)
      return res
        .status(400)
        .json({ ok: false, message: "to and text required" });

    const msisdn = normalizePhone(to);
    if (!msisdn)
      return res.status(400).json({ ok: false, message: "Invalid number" });

    const jid = `${msisdn}@c.us`;
    const sent = await s.client.sendMessage(jid, text);

    addLog("info", "Send OK", {
      clientId,
      to: msisdn,
      id: sent?.id?._serialized,
    });
    return res.json({
      ok: true,
      id: sent?.id?._serialized || null,
      to: msisdn,
    });
  } catch (e) {
    addLog("error", "Send Fail", { clientId, error: e?.message });
    return res
      .status(500)
      .json({ ok: false, message: String(e?.message || e) });
  }
});

// send document
app.post("/send-document", writeLimiter, async (req, res) => {
  try {
    const clientId = req.header("x-client-id");
    if (!clientId)
      return res
        .status(400)
        .json({ ok: false, message: "x-client-id header required" });
    const s = getClientState(clientId);
    if (!s)
      return res.status(404).json({ ok: false, message: "client not found" });
    if (!s.ready)
      return res.status(503).json({ ok: false, message: "client not ready" });

    const { to, url, base64, filename, caption, mimeType } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, message: "to required" });
    if (!url && !base64)
      return res
        .status(400)
        .json({ ok: false, message: "url or base64 required" });

    const jid = `${normalizePhone(to)}@c.us`;
    let b64;
    let mime = mimeType || "application/pdf";
    const name = filename || "file.pdf";

    if (url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      b64 = buf.toString("base64");
    } else {
      b64 = base64;
    }

    const media = new MessageMedia(mime, b64, name);
    await s.client.sendMessage(jid, media, { caption: caption || "" });

    addLog("info", "Send Document OK", { clientId, to });
    return res.json({ ok: true });
  } catch (e) {
    addLog("error", "Send Document Fail", { clientId, error: e?.message });
    return res
      .status(500)
      .json({ ok: false, message: String(e?.message || e) });
  }
});

// send image
app.post("/send-image", writeLimiter, async (req, res) => {
  try {
    const clientId = req.header("x-client-id");
    if (!clientId)
      return res
        .status(400)
        .json({ ok: false, message: "x-client-id header required" });
    const s = getClientState(clientId);
    if (!s)
      return res.status(404).json({ ok: false, message: "client not found" });
    if (!s.ready)
      return res.status(503).json({ ok: false, message: "client not ready" });

    const { to, url, base64, caption, mimeType, filename } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, message: "to required" });
    if (!url && !base64)
      return res
        .status(400)
        .json({ ok: false, message: "url or base64 required" });

    const jid = `${normalizePhone(to)}@c.us`;
    const mime = mimeType || "image/jpeg";
    const name = filename || (mime.includes("png") ? "image.png" : "image.jpg");
    let b64;
    if (url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      b64 = buf.toString("base64");
    } else {
      b64 = base64;
    }

    const media = new MessageMedia(mime, b64, name);
    const sent = await s.client.sendMessage(jid, media, {
      caption: caption || "",
    });

    addLog("info", "Send Image OK", { clientId, to });
    return res.json({ ok: true, id: sent?.id?._serialized || null });
  } catch (e) {
    addLog("error", "Send Image Fail", { clientId, error: e?.message });
    return res
      .status(500)
      .json({ ok: false, message: String(e?.message || e) });
  }
});

// logout client
app.post("/logout", writeLimiter, async (req, res) => {
  try {
    const clientId = req.header("x-client-id");
    if (!clientId)
      return res
        .status(400)
        .json({ ok: false, message: "x-client-id header required" });
    const s = getClientState(clientId);
    if (!s)
      return res.status(404).json({ ok: false, message: "client not found" });

    try {
      await s.client.logout();
    } catch (e) {
      /* ignore */
    }
    s.ready = false;
    s.state = "LOGOUT";
    s.me = null;
    addLog("info", "Logged Out", { clientId });
    // reinit after short delay
    setTimeout(() => {
      try {
        s.client.initialize();
      } catch (e) {}
    }, 1000);

    return res.json({ ok: true });
  } catch (e) {
    addLog("error", "Logout Fail", { clientId, error: e?.message });
    return res
      .status(500)
      .json({ ok: false, message: String(e?.message || e) });
  }
});

// list clients (admin)
app.get("/clients", (req, res) => {
  const data = {};
  for (const [k, v] of clients.entries()) {
    data[k] = {
      state: v.state,
      ready: v.ready,
      me: v.me,
      hasQr: !!v.lastQRData,
    };
  }
  res.json({ ok: true, clients: data });
});

// logs
app.get("/logs", (req, res) => {
  const limit = Math.min(Number(req.query.limit || 200), LOG_MAX);
  const clientId = req.query.clientId ? String(req.query.clientId) : null;

  // ambil logs terbaru sesuai limit, lalu filter dan kembalikan
  const slice = logs.slice(-Math.max(limit, 1000)).reverse(); // ambil sedikit lebih banyak utk filter
  const filtered = clientId
    ? slice
        .filter((it) => it.meta && it.meta.clientId === clientId)
        .slice(0, limit)
    : slice.slice(0, limit);

  res.json({ ok: true, items: filtered });
});

// default
app.get("/", (req, res) => res.json({ ok: true, msg: "WA server active" }));

app.listen(PORT, () => {
  console.log(`[WA-SERVER] listening on :${PORT}`);
});
