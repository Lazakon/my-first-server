const express = require("express");
const pool = require("./db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "1mb" }));

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET sozlanmagan!");

app.get("/", (req, res) => {
  res.json({ status: "online", message: "LAZ server ishlayapti!" });
});

// Foydalanuvchini tekshirish
function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token kerak" });
    }
    req.user = jwt.verify(header.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token noto'g'ri yoki muddati tugagan" });
  }
}

// Ro'yxatdan o'tish
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
      return res.status(400).json({ error: "Ma'lumotlarni tekshiring" });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (username,email,password_hash)
       VALUES ($1,$2,$3)
       RETURNING id,username,email,created_at`,
      [username.trim(), email.trim().toLowerCase(), hash]
    );
    res.status(201).json({ status: "success", user: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Username yoki email band" });
    }
    console.error(error);
    res.status(500).json({ error: "Server xatosi" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== "string" ||
        typeof password !== "string" || password.length > 72) {
      return res.status(400).json({ error: "Email va parol kerak" });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email.trim().toLowerCase()]
    );

    if (!result.rows.length ||
        !(await bcrypt.compare(password, result.rows[0].password_hash))) {
      return res.status(401).json({ error: "Email yoki parol noto'g'ri" });
    }

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username },
      SECRET, { expiresIn: "1d" }
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

// Profilni ko'rish
app.get("/api/profile", auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id,u.username,u.email,u.bio,u.avatar_url,u.created_at,
        (SELECT COUNT(*) FROM follows WHERE following_id=u.id) AS followers_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id=u.id) AS following_count
      FROM users u WHERE u.id=$1
    `, [req.user.id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: "Profil topilmadi" });
    }
    res.json({ status: "success", user: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Profil xatosi" });
  }
});

// Profilni tahrirlash
app.put("/api/profile", auth, async (req, res) => {
  try {
    const bio = req.body.bio;
    const avatar = req.body.avatar_url;

    if (bio !== undefined &&
        (typeof bio !== "string" || bio.length > 300)) {
      return res.status(400).json({ error: "Bio 300 belgidan oshmasin" });
    }

    if (avatar !== undefined && avatar !== null && avatar !== "") {
      if (typeof avatar !== "string" || avatar.length > 2000 ||
          !/^https?:\/\/\S+$/i.test(avatar)) {
        return res.status(400).json({ error: "Rasm URL manzili noto'g'ri" });
      }
    }

    const result = await pool.query(`
      UPDATE users SET
        bio=COALESCE($1,bio),
        avatar_url=COALESCE($2,avatar_url)
      WHERE id=$3
      RETURNING id,username,email,bio,avatar_url,created_at
    `, [
      bio === undefined ? null : bio.trim(),
      avatar === undefined ? null : (avatar || null),
      req.user.id
    ]);

    res.json({ status: "success", user: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Profilni saqlash xatosi" });
  }
});

// Foydalanuvchilarni qidirish
app.get("/api/users/search", auth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 50);
    if (!q) return res.json({ users: [] });

    const result = await pool.query(`
      SELECT id,username,bio,avatar_url
      FROM users
      WHERE id<>$1 AND username ILIKE $2
      ORDER BY username LIMIT 30
    `, [req.user.id, `%${q}%`]);

    res.json({ users: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Qidiruv xatosi" });
  }
});

// Boshqa foydalanuvchi profili
app.get("/api/users/:id/profile", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "ID noto'g'ri" });
    }

    const result = await pool.query(`
      SELECT u.id,u.username,u.bio,u.avatar_url,u.created_at,
        (SELECT COUNT(*) FROM follows WHERE following_id=u.id) AS followers_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id=u.id) AS following_count,
        EXISTS(SELECT 1 FROM follows
          WHERE follower_id=$2 AND following_id=u.id) AS is_following
      FROM users u WHERE u.id=$1
    `, [id, req.user.id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: "Foydalanuvchi topilmadi" });
    }
    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Profil xatosi" });
  }
});

// Obuna bo'lish
app.post("/api/follow/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id === req.user.id) {
      return res.status(400).json({ error: "Bu foydalanuvchiga obuna bo'lib bo'lmaydi" });
    }

    const result = await pool.query(
      `INSERT INTO follows(follower_id,following_id)
       VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id`,
      [req.user.id, id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Foydalanuvchi topilmadi yoki obuna mavjud" });
    }
    res.json({ status: "success", following: true });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(404).json({ error: "Foydalanuvchi topilmadi" });
    }
    console.error(error);
    res.status(500).json({ error: "Obuna xatosi" });
  }
});

// Obunadan chiqish
app.delete("/api/follow/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "ID noto'g'ri" });
    }
    await pool.query(
      "DELETE FROM follows WHERE follower_id=$1 AND following_id=$2",
      [req.user.id, id]
    );
    res.json({ status: "success", following: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Obunadan chiqish xatosi" });
  }
});

// Suhbat xabarlarini olish
app.get("/api/messages/:userId", auth, async (req, res) => {
  try {
    const otherId = Number(req.params.userId);
    if (!Number.isInteger(otherId) || otherId < 1 ||
        otherId === req.user.id) {
      return res.status(400).json({ error: "Foydalanuvchi ID noto'g'ri" });
    }

    const result = await pool.query(`
      SELECT id,sender_id,receiver_id,body,created_at
      FROM messages
      WHERE (sender_id=$1 AND receiver_id=$2)
         OR (sender_id=$2 AND receiver_id=$1)
      ORDER BY created_at ASC LIMIT 100
    `, [req.user.id, otherId]);

    res.json({ messages: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Xabarlarni olish xatosi" });
  }
});

// Xabar yuborish
app.post("/api/messages/:userId", auth, async (req, res) => {
  try {
    const otherId = Number(req.params.userId);
    const body = req.body.body;

    if (!Number.isInteger(otherId) || otherId < 1 ||
        otherId === req.user.id ||
        typeof body !== "string" || !body.trim() ||
        body.length > 4000) {
      return res.status(400).json({ error: "Xabar yoki foydalanuvchi ID noto'g'ri" });
    }

    const result = await pool.query(`
      INSERT INTO messages(sender_id,receiver_id,body)
      VALUES($1,$2,$3)
      RETURNING id,sender_id,receiver_id,body,created_at
    `, [req.user.id, otherId, body.trim()]);

    res.status(201).json({
      status: "success",
      message: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(404).json({ error: "Foydalanuvchi topilmadi" });
    }
    console.error(error);
    res.status(500).json({ error: "Xabar yuborish xatosi" });
  }
});


// ADMIN PANEL API
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID || 0);

function adminOnly(req, res, next) {
  if (!ADMIN_USER_ID || Number(req.user.id) !== ADMIN_USER_ID) {
    return res.status(403).json({ error: "Admin ruxsati yo'q" });
  }
  next();
}

app.get("/api/admin/stats", auth, adminOnly, async (req, res) => {
  try {
    const users = await pool.query("SELECT COUNT(*) FROM users");
    const messages = await pool.query("SELECT COUNT(*) FROM messages");
    res.json({
      users: Number(users.rows[0].count),
      messages: Number(messages.rows[0].count)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Statistika xatosi" });
  }
});

app.get("/api/admin/users", auth, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id,username,email,created_at FROM users ORDER BY id DESC LIMIT 100"
    );
    res.json({ users: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Foydalanuvchilarni olish xatosi" });
  }
});

// Ma'lumotlar bazasini tayyorlash
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

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS avatar_url TEXT
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS follows (
      id SERIAL PRIMARY KEY,
      follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(follower_id,following_id),
      CHECK(follower_id <> following_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS messages_conversation_idx
    ON messages(sender_id,receiver_id,created_at)
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

