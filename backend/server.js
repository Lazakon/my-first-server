const express = require("express");
const pool = require("./db");

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

// PostgreSQL ulanishini tekshirish
app.get("/api/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      status: "success",
      database: "connected",
      time: result.rows[0].now
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Database connection failed"
    });
  }
});

// Test jadvaliga ma'lumot yozish
app.post("/api/test-data", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message kerak"
      });
    }

    const result = await pool.query(
      "INSERT INTO test_records (message) VALUES ($1) RETURNING *",
      [message]
    );

    res.json({
      status: "saved",
      data: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: "Save failed" });
  }
});

// Bazadan ma'lumot o'qish
app.get("/api/test-data", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM test_records ORDER BY id DESC"
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Read failed" });
  }
});

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS test_records (
      id SERIAL PRIMARY KEY,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("PostgreSQL tayyor!");

  const PORT = process.env.PORT || 3000;

  app.listen(PORT, "0.0.0.0", () => {
    console.log("Server ishga tushdi:", PORT);
  });
}

start().catch(error => {
  console.error("Server xatosi:", error.message);
  process.exit(1);
});
