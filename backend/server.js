const express = require("express");
const pool = require("./db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json());

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET sozlanmagan!");

app.get("/", (req, res) => {
  res.json({ status: "online", message: "LAZ server ishlayapti!" });
});

app.post("/api/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (typeof username !== "string" ||
        typeof email !== "string" ||
        typeof password !== "string" ||
        !username.trim() || !email.trim() ||
        password.length < 8 || password.length > 72 ||
        username.trim().length > 50 ||
        email.trim().length > 255) {
      return res.status(400).json({
        error: "Username, email va kamida 8 belgili parol kerak"
      });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username.trim(), email.trim().toLowerCase(), hash]
    );

    res.status(201).json({
      status: "success",
      user: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Username yoki email band" });
    }
    console.error(error);
    res.status(500).json({ error: "Server xatosi" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (typeof email !== "string" ||
        typeof password !== "string" || password.length > 72) {
      return res.status(400).json({ error: "Email va parol kerak" });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email.trim().toLowerCase()]
    );

    if (!result.rows.length ||
        !(await bcrypt.compare(password, result.rows[0].password_hash))) {
      return res.status(401).json({ error: "Email yoki parol noto'g'ri" });
    }

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username },
      SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      status: "success",
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server xatosi" });
  }
});

app.get("/api/profile", async (req, res) => {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token kerak" });
    }

    const decoded = jwt.verify(header.slice(7), SECRET);
    const result = await pool.query(
      "SELECT id, username, email, created_at FROM users WHERE id = $1",
      [decoded.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Foydalanuvchi topilmadi" });
    }

    res.json({ status: "success", user: result.rows[0] });
  } catch (error) {
    res.status(401).json({ error: "Token noto'g'ri yoki muddati tugagan" });
  }
});

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log("LAZ server ishga tushdi:", PORT);
  });
}

start().catch(error => {
  console.error("Server xatosi:", error.message);
  process.exit(1);
});
