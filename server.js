const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

// Test route
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

// SIMPLE REDIRECT LOGIC (NO yt-dlp)
app.get("/download", (req, res) => {
  const url = req.query.url;

  if (!url) return res.send("No URL");

  try {
    // Direct redirect (basic fallback)
    res.redirect(url);
  } catch (err) {
    console.log(err);
    res.send("Download failed ❌");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
