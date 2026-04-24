const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ===== CACHE =====
const cache = new Map();
const CACHE_TIME = 1000 * 60 * 10;

function getCache(url) {
  const data = cache.get(url);
  if (!data) return null;
  if (Date.now() - data.time > CACHE_TIME) {
    cache.delete(url);
    return null;
  }
  return data.value;
}

function setCache(url, value) {
  cache.set(url, { value, time: Date.now() });
}

// ===== CLEAN URL =====
function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.search = "";
    return url.toString();
  } catch {
    return u;
  }
}

// ===== TIMEOUT =====
async function withTimeout(fn, ms = 5000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(t);
  }
}

// ===== PROVIDERS =====
const providers = [

  async (url) => {
    const r = await withTimeout(signal =>
      axios.post("https://www.tikwm.com/api/", { url, hd: 1 }, { signal })
    );
    return r.data?.data?.hdplay || r.data?.data?.play;
  },

  async (url) => {
    const r = await withTimeout(signal =>
      axios.post(
        "https://v3.saveig.app/api/ajaxSearch",
        new URLSearchParams({ q: url, t: "media", lang: "en" }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal }
      )
    );
    return r.data?.data?.match(/href="([^"]+)"[^>]*download/i)?.[1];
  },

  async (url) => {
    const r = await withTimeout(signal =>
      axios.post(
        "https://snapinsta.app/action.php",
        new URLSearchParams({ url }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal }
      )
    );
    return r.data?.match(/href="([^"]+\\.mp4)"/)?.[1];
  },

  async (url) => {
    const r = await withTimeout(signal =>
      axios.post(
        "https://api.tikmate.app/api/lookup",
        new URLSearchParams({ url }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal }
      )
    );
    if (r.data?.token && r.data?.id) {
      return `https://tikmate.app/download/${r.data.token}/${r.data.id}.mp4`;
    }
    return null;
  }

];

// ===== MAIN API =====
app.post("/api/download", async (req, res) => {
  let { url } = req.body;

  if (!url) {
    return res.json({ success: false });
  }

  url = normalizeUrl(url);

  // ===== CACHE =====
  const cached = getCache(url);
  if (cached) {
    return res.json({ success: true, url: cached });
  }

  // ===== FAST PARALLEL TRY =====
  try {
    const first = await Promise.any([
      providers[0](url),
      providers[1](url)
    ]);

    if (first) {
      setCache(url, first);
      return res.json({ success: true, url: first });
    }
  } catch {}

  // ===== SEQUENTIAL =====
  for (let i = 2; i < providers.length; i++) {
    try {
      const result = await providers[i](url);
      if (result) {
        setCache(url, result);
        return res.json({ success: true, url: result });
      }
    } catch {}
  }

  // ===== RETRY =====
  await new Promise(r => setTimeout(r, 1200));

  for (let fn of providers) {
    try {
      const result = await fn(url);
      if (result) {
        setCache(url, result);
        return res.json({ success: true, url: result });
      }
    } catch {}
  }

  return res.json({ success: false });
});

// ===== HEALTH =====
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
