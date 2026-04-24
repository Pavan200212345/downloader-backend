const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS']
}));

app.use(express.json({ limit: "500kb" }));

const cache = new Map();
const CACHE_TIME = 1000 * 60 * 10;

// ===== MAIN DOWNLOAD FUNCTION =====
async function downloadVideo(url) {
  // Check cache
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < CACHE_TIME) {
    return cached.url;
  }

  // Try Cobalt first (supports all platforms)
  try {
    const { data } = await axios.post(
      "https://api.cobalt.tools/api/json",
      { url, vQuality: "720" },
      {
        headers: { 
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        timeout: 15000
      }
    );

    let videoUrl = data?.url;
    
    // Handle picker response (multiple quality options)
    if (!videoUrl && data?.picker && Array.isArray(data.picker)) {
      videoUrl = data.picker[0]?.url;
    }

    if (videoUrl) {
      cache.set(url, { url: videoUrl, time: Date.now() });
      return videoUrl;
    }
  } catch (err) {
    console.log('Cobalt failed:', err.message);
  }

  // Fallback APIs
  if (url.includes('tiktok')) {
    try {
      const { data } = await axios.post(
        "https://www.tikwm.com/api/",
        { url, hd: 1 },
        { timeout: 8000 }
      );
      
      const videoUrl = data?.data?.hdplay || data?.data?.play;
      if (videoUrl) {
        cache.set(url, { url: videoUrl, time: Date.now() });
        return videoUrl;
      }
    } catch (err) {
      console.log('TikWM failed:', err.message);
    }
  }

  if (url.includes('instagram')) {
    try {
      const { data } = await axios.post(
        "https://v3.saveig.app/api/ajaxSearch",
        new URLSearchParams({ q: url, t: "media", lang: "en" }),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 8000
        }
      );
      
      const match = data?.data?.match(/href="([^"]+)"[^>]*download/i);
      if (match?.[1]) {
        cache.set(url, { url: match[1], time: Date.now() });
        return match[1];
      }
    } catch (err) {
      console.log('SaveIG failed:', err.message);
    }
  }

  throw new Error('All download methods failed');
}

// ===== ENDPOINT =====
app.post("/api/download", async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ 
      success: false, 
      error: "Invalid URL" 
    });
  }

  try {
    const videoUrl = await downloadVideo(url.trim());
    
    res.json({ 
      success: true, 
      url: videoUrl 
    });
  } catch (err) {
    console.error('Download failed:', err.message);
    
    res.status(500).json({ 
      success: false, 
      error: "Could not download video. Please verify the link is valid and public." 
    });
  }
});

app.get("/", (req, res) => {
  res.json({ status: "ok", cache: cache.size });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

module.exports = app;
