const express = require("express");
const cors = require("cors");
const youtubedl = require("yt-dlp-exec");

const app = express();
app.use(cors());

// Test route
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

// Download route (STABLE VERSION)
app.get("/download", async (req, res) => {
  const url = req.query.url;

  if (!url) return res.send("No URL");

  try {
    const output = await youtubedl(url, {
      getUrl: true,
    });

    const videoUrl = output.split("\n")[0].trim();

    res.redirect(videoUrl);
  } catch (err) {
    console.log("ERROR:", err);
    res.send("Download failed ❌");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
