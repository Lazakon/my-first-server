const express = require("express");
const pool = require("./db");

const app = express();
app.use(express.json());

async function createUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("Users jadvali tayyor!");
}

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

app.post("/api/test", (req, res) => {
  res.json({
    status: "success",
    received: req.body
  });
});

const PORT = process.env.PORT || 3000;

createUsersTable()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server ${PORT} portda ishga tushdi`);
    });
  })
  .catch(console.error);
