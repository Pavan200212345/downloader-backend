const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// ===== IMPROVED CORS =====
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: "500kb" }));

// ===== SIMPLE CACHE =====
const cache = new Map();
const pending = new Map();
const CACHE_TIME = 1000 * 60 * 10; // 10min
const MAX_CACHE = 200;

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

// ===== RATE LIMIT =====
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
  
  return limit.count <= 10; // 10 per minute
}

// ===== QUEUE =====
class SimpleQueue {
  constructor(max = 3) {
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

const queue = new SimpleQueue(3);

// ===== TIMEOUT =====
function withTimeout(fn, ms = 8000) {
  return Promise.race([
    fn(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), ms)
    )
  ]);
}

// ===== IMPROVED APIS =====
const apis = [
  // 1. TikWM - Fast and reliable
  async (url) => {
    const { data } = await axios.post(
      "https://www.tikwm.com/api/",
      { url, hd: 1 },
      { 
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }
    );
    if (data?.data?.hdplay || data?.data?.play) {
      return data.data.hdplay || data.data.play;
    }
    throw new Error('No video URL');
  },

  // 2. SaveIG - Instagram focused
  async (url) => {
    const { data } = await axios.post(
      "https://v3.saveig.app/api/ajaxSearch",
      new URLSearchParams({ q: url, t: "media", lang: "en" }),
      {
        headers: { 
          "Content-Type": "application/x-www-form-urlencoded",
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 8000
      }
    );
    const match = data?.data?.match(/href="([^"]+)"[^>]*download/i);
    if (match?.[1]) return match[1];
    throw new Error('No video URL');
  },

  // 3. SnapTik - Backup
  async (url) => {
    const { data } = await axios.post(
      "https://snaptik.app/abc2.php",
      new URLSearchParams({ url, lang: "en" }),
      {
        headers: { 
          "Content-Type": "application/x-www-form-urlencoded",
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 8000
      }
    );
    const match = data?.match(/href="(https?:\/\/[^"]+\.mp4[^"]*)"/i);
    if (match?.[1]) return match[1];
    throw new Error('No video URL');
  },

  // 4. SSSTik - Alternative
  async (url) => {
    const { data } = await axios.post(
      "https://ssstik.io/abc?url=dl",
      new URLSearchParams({ 
        id: url,
        locale: 'en',
        tt: 'download'
      }),
      {
        headers: { 
          "Content-Type": "application/x-www-form-urlencoded",
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 8000
      }
    );
    const match = data?.match(/href="(https?:\/\/[^"]+)"/i);
    if (match?.[1] && match[1].includes('http')) return match[1];
    throw new Error('No video URL');
  }
];

// ===== VALIDATE URL =====
function isValidUrl(url) {
  const patterns = [
    /tiktok\.com/i,
    /instagram\.com/i,
    /youtube\.com/i,
    /youtu\.be/i,
    /facebook\.com/i,
    /fb\.watch/i
  ];
  return patterns.some(p => p.test(url));
}

// ===== MAIN ENDPOINT =====
app.post("/api/download", async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;

  // Rate limit
  if (!checkRate(ip)) {
    return res.status(429).json({ 
      success: false, 
      error: "Too many requests. Please wait a minute." 
    });
  }

  const { url } = req.body;

  // Validation
  if (!url || typeof url !== 'string' || url.length > 500) {
    return res.status(400).json({ 
      success: false, 
      error: "Invalid URL format" 
    });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ 
      success: false, 
      error: "URL must be from TikTok, Instagram, YouTube, or Facebook" 
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
    } catch (err) {
      return res.status(500).json({ 
        success: false, 
        error: "Processing failed" 
      });
    }
  }

  // Create task
  const task = queue.add(async () => {
    let lastError = null;
    
    for (let i = 0; i < apis.length; i++) {
      try {
        console.log(`Trying API ${i + 1}/${apis.length} for ${key.substring(0, 50)}...`);
        const result = await withTimeout(() => apis[i](key), 8000);
        
        if (result && typeof result === 'string' && result.startsWith('http')) {
          console.log(`✅ Success with API ${i + 1}`);
          setCache(key, result);
          return result;
        }
      } catch (err) {
        lastError = err.message;
        console.log(`❌ API ${i + 1} failed: ${err.message}`);
      }
    }
    
    throw new Error(lastError || 'All APIs failed');
  });

  pending.set(key, task);

  try {
    const result = await task;
    return res.json({ 
      success: true, 
      url: result 
    });
  } catch (err) {
    console.error('Download failed:', err.message);
    return res.status(500).json({ 
      success: false, 
      error: "Could not download video. The link may be invalid or the platform may be blocking downloads." 
    });
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
    pending: pending.size,
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// ===== CLEANUP =====
setInterval(() => {
  const now = Date.now();
  
  for (let [k, v] of cache.entries()) {
    if (now - v.time > CACHE_TIME) cache.delete(k);
  }
  
  for (let [k, v] of rateLimits.entries()) {
    if (now > v.reset + 60000) rateLimits.delete(k);
  }
}, 300000);

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});

// ===== START =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});

module.exports = app;
