const express = require("express");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "LAZ server ishlayapti!",
    version: "1.0.0"
  });
});

app.get("/api/status", (req, res) => {
  res.json({ server: "running" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server ${PORT} portda ishga tushdi`);
});

app.post("/api/test", (req, res) => {
  res.json({
    status: "success",
    message: "Server ma'lumotni qabul qildi!",
    received: req.body
  });
});
