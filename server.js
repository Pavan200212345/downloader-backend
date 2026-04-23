const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");

const app = express();
app.use(cors());

// Test route
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

// Download route (STABLE VERSION FOR RENDER)
app.get("/download", (req, res) => {
  const url = req.query.url;

  if (!url) return res.send("No URL");

  // Simple yt-dlp command (most stable)
  exec(`npx yt-dlp -g "${url}"`, (err, stdout, stderr) => {
    if (err) {
      console.log("ERROR:", stderr);
      return res.send("Download failed ❌");
    }

    // Extract video URL
    const videoUrl = stdout.split("\n")[0].trim();

    // Redirect user to actual video
    res.redirect(videoUrl);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
