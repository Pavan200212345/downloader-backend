const express = require("express");
const cors = require("cors");
const { exec } = require("child_process"); // ✅ REQUIRED

const app = express();
app.use(cors());

// Test route
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

// Download route
app.get("/download", (req, res) => {
  const url = req.query.url;

  if (!url) return res.send("No URL");

  const filePath = require("path").join(__dirname, "video.mp4");

  const { exec } = require("child_process");

  exec(`python -m yt_dlp -f "bestvideo+bestaudio" --merge-output-format mp4 -o "${filePath}" "${url}"`, (err, stdout, stderr) => {
    if (err) {
      console.log(stderr);
      return res.send("Download failed ❌");
    }

    res.download(filePath, "video.mp4");
  });
});

const PORT = process.env.PORT || 3000; // ✅ better for deploy
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});