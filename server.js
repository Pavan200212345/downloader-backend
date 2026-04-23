const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");

const app = express();
app.use(cors());

// Test route
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

// Download route (LIGHT + WORKING ON RENDER)
app.get("/download", (req, res) => {
  const url = req.query.url;

  if (!url) return res.send("No URL");

  exec(`python -m yt_dlp -f "best[ext=mp4]" -g "${url}"`, (err, stdout, stderr) => {
    if (err) {
      console.log("ERROR:", stderr);
      return res.send("Download failed ❌");
    }

    const videoUrl = stdout.split("\n")[0].trim();

    // redirect user to video file
    res.redirect(videoUrl);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
