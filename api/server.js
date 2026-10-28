// ============================================================
//  Smart Parking API  –  שרת ה-Backend של החניון
//  POST   /api/cars          ← המצלמה מדווחת על רכב שנכנס
//  GET    /api/cars          ← לוח הבקרה מושך את רשימת הרכבים
//  DELETE /api/cars/:plate   ← כפתור "שחרור רכב" + חישוב מחיר
//  GET    /api/health        ← בדיקת תקינות (ל-CI ול-Docker)
// ============================================================
const express = require("express");
const { createClient } = require("redis");

const PORT = process.env.PORT || 3000;
const REDIS_HOST = process.env.REDIS_HOST || "localhost"; // ב-Compose זה "redis" – שם השירות (DNS פנימי)
const CAPACITY = parseInt(process.env.CAPACITY || "10", 10); // כמה מקומות יש בחניון
const PRICE_PER_HOUR = parseInt(process.env.PRICE_PER_HOUR || "12", 10); // ₪ לכל שעה שהתחילה
const FREE_MINUTES = 15; // רבע שעה ראשונה חינם

// מפתחות ב-Redis
const KEY_CARS = "parking:cars"; // Sorted Set:  member = מספר רכב, score = זמן כניסה
const KEY_TOTAL = "stats:totalEntries"; // מונה כל הכניסות אי-פעם
const KEY_REVENUE = "stats:revenue"; // סך ההכנסות בש"ח

const LUCKY_PLATE = "7777777"; // 🥚 Easter Egg – הרכב הזה חונה בחינם

const WELCOME_MESSAGES = [
  "ברוך הבא! תחנה בעדינות, הרכב מימין עדיין משלם על הליסינג 😅",
  "נכנסת! זכור: חניה בשתי חניות זה לא 'חניה רחבה' 🙃",
  "ברוך הבא! המצלמה אומרת שאתה נראה מעולה היום 📸",
  "נקלטת במערכת! עכשיו רק לזכור באיזו קומה חנית 🤔",
  "ברוך הבא! מזגן דלוק? מוזיקה טובה? אפשר להיכנס 🎶",
];

const redis = createClient({ url: `redis://${REDIS_HOST}:6379` });
redis.on("error", (err) => console.error("Redis error:", err.message));

const app = express();
app.use(express.json());

// --- פונקציות עזר ---------------------------------------------------------

// לוחית ישראלית: 7 או 8 ספרות (מורידים מקפים ורווחים)
function normalizePlate(raw) {
  return String(raw || "").replace(/[\s-]/g, "");
}
function isValidPlate(plate) {
  return /^\d{7,8}$/.test(plate);
}

// חישוב מחיר: 15 דקות ראשונות חינם, אחר כך PRICE_PER_HOUR לכל שעה שהתחילה
function calcPrice(plate, enteredAt, now = Date.now()) {
  if (plate === LUCKY_PLATE) return 0;
  const minutes = Math.floor((now - enteredAt) / 60000);
  if (minutes < FREE_MINUTES) return 0;
  return Math.ceil(minutes / 60) * PRICE_PER_HOUR;
}

// --- נתיבים (Routes) -------------------------------------------------------

app.get("/api/health", async (req, res) => {
  try {
    await redis.ping();
    res.json({ status: "ok", redis: "connected" });
  } catch {
    res.status(503).json({ status: "error", redis: "disconnected" });
  }
});

// המצלמה שולחת: { "plate": "12-345-67" }
app.post("/api/cars", async (req, res) => {
  try {
    const plate = normalizePlate(req.body.plate);
    if (!isValidPlate(plate)) {
      return res.status(400).json({ error: "מספר רישוי לא תקין (צריך 7 או 8 ספרות)" });
    }

    if ((await redis.zScore(KEY_CARS, plate)) !== null) {
      return res.status(409).json({ error: `הרכב ${plate} כבר נמצא בחניון 🤨` });
    }

    const count = await redis.zCard(KEY_CARS);
    if (count >= CAPACITY) {
      return res.status(403).json({ error: "🚫 החניון מלא! נסה שוב מאוחר יותר" });
    }

    const enteredAt = Date.now();
    await redis.zAdd(KEY_CARS, { score: enteredAt, value: plate });
    await redis.incr(KEY_TOTAL);

    const message =
      plate === LUCKY_PLATE
        ? "🍀 מספר המזל! החניה עליך היום – בחינם!"
        : WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)];

    console.log(`[ENTRY] ${plate}`);
    res.status(201).json({ plate, enteredAt, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// לוח הבקרה מושך את כל המידע בבקשה אחת
app.get("/api/cars", async (req, res) => {
  try {
    const now = Date.now();
    const rows = await redis.zRangeWithScores(KEY_CARS, 0, -1); // ממוין לפי זמן כניסה
    const cars = rows
      .map(({ value, score }) => ({
        plate: value,
        enteredAt: score,
        minutes: Math.floor((now - score) / 60000),
        price: calcPrice(value, score, now),
      }))
      .reverse(); // האחרון שנכנס – ראשון ברשימה

    res.json({
      cars,
      count: cars.length,
      capacity: CAPACITY,
      isFull: cars.length >= CAPACITY,
      totalEntries: parseInt((await redis.get(KEY_TOTAL)) || "0", 10),
      revenue: parseInt((await redis.get(KEY_REVENUE)) || "0", 10),
      pricePerHour: PRICE_PER_HOUR,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// כפתור "שחרור רכב" – מוציא את הרכב ומחשב כמה לשלם
app.delete("/api/cars/:plate", async (req, res) => {
  try {
    const plate = normalizePlate(req.params.plate);
    const enteredAt = await redis.zScore(KEY_CARS, plate);
    if (enteredAt === null) {
      return res.status(404).json({ error: "הרכב לא נמצא בחניון" });
    }

    const price = calcPrice(plate, enteredAt);
    await redis.zRem(KEY_CARS, plate);
    await redis.incrBy(KEY_REVENUE, price);

    console.log(`[EXIT]  ${plate}  paid ₪${price}`);
    res.json({ plate, price, minutes: Math.floor((Date.now() - enteredAt) / 60000) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// --- הפעלה ----------------------------------------------------------------
async function start() {
  await redis.connect();
  app.listen(PORT, () => console.log(`🚗 Parking API listening on port ${PORT}`));
}

start().catch((err) => {
  console.error("Failed to start:", err.message);
  process.exit(1); // Docker יפעיל מחדש בזכות restart: unless-stopped
});
