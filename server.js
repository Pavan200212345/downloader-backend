const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "500kb" }));

// ===== SIMPLE CACHE =====
const cache = new Map();
const pending = new Map();
const CACHE_TIME = 1000 * 60 * 10; // 10min
const MAX_CACHE = 300; // REDUCED

function getCache(url) {
  const data = cache.get(url);
  if (!data || Date.now() - data.time > CACHE_TIME) {
    cache.delete(url);
    return null;
  }
  return data.value;
}

function setCache(url, value) {
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  cache.set(url, { value, time: Date.now() });
}

// ===== SIMPLE RATE LIMIT =====
const rateLimits = new Map();

function checkRate(ip) {
  const now = Date.now();
  const limit = rateLimits.get(ip) || { count: 0, reset: now + 60000 };
  
  if (now > limit.reset) {
    limit.count = 0;
    limit.reset = now + 60000;
  }
  
  limit.count++;
  rateLimits.set(ip, limit);
  
  return limit.count <= 8; // 8 per minute
}

// ===== SIMPLE QUEUE =====
class SimpleQueue {
  constructor(max = 5) { // REDUCED to 5
    this.max = max;
    this.running = 0;
    this.queue = [];
  }

  async add(fn) {
    while (this.running >= this.max) {
      await new Promise(r => this.queue.push(r));
    }
    
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const queue = new SimpleQueue(5);

// ===== TIMEOUT =====
function withTimeout(fn, ms = 4000) {
  return Promise.race([
    fn(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), ms)
    )
  ]);
}

// ===== ONLY 4 BEST APIS ===== 
const apis = [
  // 1. TikWM (Fast & Reliable)
  async (url) => {
    const { data } = await axios.post(
      "https://www.tikwm.com/api/",
      { url, hd: 1 },
      { timeout: 4000 }
    );
    return data?.data?.hdplay || data?.data?.play;
  },

  // 2. SaveIG (Instagram)
  async (url) => {
    const { data } = await axios.post(
      "https://v3.saveig.app/api/ajaxSearch",
      new URLSearchParams({ q: url, t: "media", lang: "en" }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 4000
      }
    );
    return data?.data?.match(/href="([^"]+)"[^>]*download/i)?.[1];
  },

  // 3. SnapTik (Backup)
  async (url) => {
    const { data } = await axios.post(
      "https://snaptik.app/abc2.php",
      new URLSearchParams({ url, lang: "en" }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 4500
      }
    );
    return data?.match(/href="(https?:\/\/[^"]+\.mp4[^"]*)"/i)?.[1];
  },

  // 4. TikDD (Backup)
  async (url) => {
    const { data } = await axios.post(
      "https://tikdd.cc/wp-json/aio-dl/video-data/",
      { url },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 4500
      }
    );
    return data?.medias?.[0]?.url;
  }
];

// ===== MAIN ENDPOINT =====
app.post("/api/download", async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;

  // Rate limit
  if (!checkRate(ip)) {
    return res.status(429).json({ 
      success: false, 
      error: "Too many requests" 
    });
  }

  const { url } = req.body;

  if (!url || typeof url !== 'string' || url.length > 500) {
    return res.status(400).json({ 
      success: false, 
      error: "Invalid URL" 
    });
  }

  const key = url.trim().toLowerCase();

  // Check cache
  const cached = getCache(key);
  if (cached) {
    return res.json({ success: true, url: cached, source: "cache" });
  }

  // Check pending
  if (pending.has(key)) {
    try {
      const result = await pending.get(key);
      return res.json({ success: !!result, url: result });
    } catch {
      return res.status(500).json({ success: false });
    }
  }

  // Create task
  const task = queue.add(async () => {
    for (let api of apis) {
      try {
        const result = await withTimeout(() => api(key), 4500);
        if (result) {
          setCache(key, result);
          return result;
        }
      } catch {}
    }
    return null;
  });

  pending.set(key, task);

  try {
    const result = await task;
    return res.json({ 
      success: !!result, 
      url: result || null 
    });
  } catch {
    return res.status(500).json({ success: false });
  } finally {
    pending.delete(key);
  }
});

// ===== HEALTH =====
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    cache: cache.size,
    pending: pending.size
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ===== CLEANUP =====
setInterval(() => {
  const now = Date.now();
  
  // Clean cache
  for (let [k, v] of cache.entries()) {
    if (now - v.time > CACHE_TIME) cache.delete(k);
  }
  
  // Clean rate limits
  for (let [k, v] of rateLimits.entries()) {
    if (now > v.reset + 60000) rateLimits.delete(k);
  }
}, 300000); // 5min

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  process.exit(0);
});

// ===== START =====
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

module.exports = app;
