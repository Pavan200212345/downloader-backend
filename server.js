const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════ MIDDLEWARE ═══════════════
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: "500kb" }));

// ═══════════════ CACHE SYSTEM ═══════════════
const cache = new Map();
const CACHE_TIME = 1000 * 60 * 10; // 10 minutes
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

// ═══════════════ RATE LIMITING ═══════════════
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
  
  return limit.count <= 15; // 15 requests per minute
}

// ═══════════════ DOWNLOAD APIS ═══════════════

// API 1: Cobalt (Best - supports YouTube, TikTok, Instagram, Facebook)
async function cobaltAPI(url) {
  console.log('🔵 Trying Cobalt API...');
  
  const { data } = await axios.post(
    "https://api.cobalt.tools/api/json",
    {
      url: url,
      vQuality: "720",
      filenamePattern: "basic",
      isAudioOnly: false
    },
    {
      headers: { 
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0"
      },
      timeout: 15000
    }
  );

  // Handle direct URL response
  if (data?.url) {
    console.log('✅ Cobalt: Direct URL found');
    return data.url;
  }

  // Handle picker response (multiple quality options)
  if (data?.picker && Array.isArray(data.picker) && data.picker.length > 0) {
    console.log('✅ Cobalt: Picker URL found');
    return data.picker[0].url;
  }

  throw new Error('Cobalt: No video URL found');
}

// API 2: TikWM (TikTok specialist)
async function tikwmAPI(url) {
  if (!url.includes('tiktok')) {
    throw new Error('Not a TikTok URL');
  }
  
  console.log('🔵 Trying TikWM API...');
  
  const { data } = await axios.post(
    "https://www.tikwm.com/api/",
    { url, hd: 1 },
    { 
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }
  );

  const videoUrl = data?.data?.hdplay || data?.data?.play;
  
  if (!videoUrl) {
    throw new Error('TikWM: No video URL');
  }

  console.log('✅ TikWM: Success');
  return videoUrl;
}

// API 3: SaveIG (Instagram specialist)
async function saveigAPI(url) {
  if (!url.includes('instagram')) {
    throw new Error('Not an Instagram URL');
  }
  
  console.log('🔵 Trying SaveIG API...');
  
  const { data } = await axios.post(
    "https://v3.saveig.app/api/ajaxSearch",
    new URLSearchParams({ q: url, t: "media", lang: "en" }),
    {
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 10000
    }
  );

  const match = data?.data?.match(/href="([^"]+)"[^>]*download/i);
  
  if (!match?.[1]) {
    throw new Error('SaveIG: No video URL');
  }

  console.log('✅ SaveIG: Success');
  return match[1];
}

// API 4: SnapTik (TikTok backup)
async function snaptikAPI(url) {
  if (!url.includes('tiktok')) {
    throw new Error('Not a TikTok URL');
  }
  
  console.log('🔵 Trying SnapTik API...');
  
  const { data } = await axios.post(
    "https://snaptik.app/abc2.php",
    new URLSearchParams({ url, lang: "en" }),
    {
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 10000
    }
  );

  const match = data?.match(/href="(https?:\/\/[^"]+\.mp4[^"]*)"/i);
  
  if (!match?.[1]) {
    throw new Error('SnapTik: No video URL');
  }

  console.log('✅ SnapTik: Success');
  return match[1];
}

// API 5: SSSTik (TikTok alternative)
async function ssstikAPI(url) {
  if (!url.includes('tiktok')) {
    throw new Error('Not a TikTok URL');
  }
  
  console.log('🔵 Trying SSSTik API...');
  
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
      timeout: 10000
    }
  );

  const match = data?.match(/href="(https?:\/\/[^"]+)"/i);
  
  if (!match?.[1] || !match[1].includes('http')) {
    throw new Error('SSSTik: No video URL');
  }

  console.log('✅ SSSTik: Success');
  return match[1];
}

// ═══════════════ MAIN DOWNLOAD FUNCTION ═══════════════
async function downloadVideo(url) {
  // List of APIs to try in order
  const apis = [
    cobaltAPI,      // Try Cobalt first (best for YouTube)
    tikwmAPI,       // TikTok
    saveigAPI,      // Instagram
    snaptikAPI,     // TikTok backup
    ssstikAPI       // TikTok backup 2
  ];

  let lastError = null;

  for (let i = 0; i < apis.length; i++) {
    try {
      const result = await apis[i](url);
      
      if (result && typeof result === 'string' && result.startsWith('http')) {
        return result;
      }
    } catch (err) {
      lastError = err.message;
      console.log(`❌ API ${i + 1} failed: ${err.message}`);
      continue; // Try next API
    }
  }

  throw new Error(lastError || 'All APIs failed');
}

// ═══════════════ MAIN ENDPOINT ═══════════════
app.post("/api/download", async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;

  // Check rate limit
  if (!checkRate(ip)) {
    return res.status(429).json({ 
      success: false, 
      error: "Too many requests. Please wait a minute." 
    });
  }

  const { url } = req.body;

  // Validate URL
  if (!url || typeof url !== 'string' || url.length > 500) {
    return res.status(400).json({ 
      success: false, 
      error: "Invalid URL format" 
    });
  }

  const cleanUrl = url.trim().toLowerCase();

  // Check cache first
  const cached = getCache(cleanUrl);
  if (cached) {
    console.log('📦 Cache hit');
    return res.json({ 
      success: true, 
      url: cached, 
      source: "cache" 
    });
  }

  console.log(`\n🎬 Processing: ${cleanUrl.substring(0, 60)}...`);

  try {
    const videoUrl = await downloadVideo(cleanUrl);
    
    // Save to cache
    setCache(cleanUrl, videoUrl);

    console.log('✅ SUCCESS! Download URL ready\n');

    return res.json({ 
      success: true, 
      url: videoUrl 
    });

  } catch (err) {
    console.error('❌ All methods failed:', err.message);
    
    return res.status(500).json({ 
      success: false, 
      error: "Could not download video. The link may be invalid, private, or the platform is blocking downloads." 
    });
  }
});

// ═══════════════ HEALTH CHECK ═══════════════
app.get("/", (req, res) => {
  res.json({
    status: "✅ Server Online",
    uptime: Math.floor(process.uptime()) + " seconds",
    cache: cache.size + " items",
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB'
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// ═══════════════ CLEANUP ═══════════════
setInterval(() => {
  const now = Date.now();
  
  // Clean old cache
  for (let [k, v] of cache.entries()) {
    if (now - v.time > CACHE_TIME) {
      cache.delete(k);
    }
  }
  
  // Clean old rate limits
  for (let [k, v] of rateLimits.entries()) {
    if (now > v.reset + 60000) {
      rateLimits.delete(k);
    }
  }

  console.log(`🧹 Cleanup done. Cache: ${cache.size}, Rate limits: ${rateLimits.size}`);
}, 300000); // Every 5 minutes

// ═══════════════ GRACEFUL SHUTDOWN ═══════════════
process.on('SIGTERM', () => {
  console.log('👋 Shutting down gracefully...');
  process.exit(0);
});

// ═══════════════ START SERVER ═══════════════
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════╗
║  🚀 Video Downloader Server Running   ║
║  📡 Port: ${PORT}                        ║
║  🌐 CORS: Enabled                      ║
║  ⚡ APIs: 5 (Cobalt, TikWM, SaveIG...) ║
╚════════════════════════════════════════╝
  `);
});

module.exports = app;
