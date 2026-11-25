// ============================================================
//  Smart Parking API  –  שרת ה-Backend של החניון ("הטבח")
//  POST   /api/cars          ← המצלמה מדווחת על רכב שנכנס
//  GET    /api/cars          ← לוח הבקרה מושך את רשימת הרכבים
//  DELETE /api/cars/:plate   ← כפתור "שחרור רכב" + חישוב מחיר
//  GET    /api/health        ← בדיקת תקינות (ל-CI ול-Docker)
// ============================================================

// טוענים את ספריית Express – ספרייה שמקלה על בניית שרת אינטרנט ב-Node.js
const express = require("express");
// טוענים מספריית redis את הפונקציה שיוצרת חיבור למסד הנתונים Redis
const { createClient } = require("redis");

// ---------- הגדרות (אפשר לשנות אותן מבחוץ דרך docker-compose, בלי לגעת בקוד) ----------

// הפורט שהשרת מאזין לו. process.env = משתני סביבה. אם לא הוגדר – 3000
const PORT = process.env.PORT || 3000;
// הכתובת של Redis. ב-Docker Compose זה "redis" (שם השירות), ו-Docker מתרגם אותו לכתובת IP
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
// כמה מקומות חניה יש. parseInt הופך טקסט למספר שלם (10 = בסיס עשרוני)
const CAPACITY = parseInt(process.env.CAPACITY || "10", 10);
// כמה ₪ עולה כל שעה שהתחילה
const PRICE_PER_HOUR = parseInt(process.env.PRICE_PER_HOUR || "12", 10);
// כמה דקות ראשונות הן חינם
const FREE_MINUTES = 15;

// ---------- שמות המפתחות שבהם נשמר המידע ב-Redis ----------

// כאן נשמרים הרכבים. סוג "Sorted Set": לכל מספר רכב יש "ציון" = זמן הכניסה, ולכן הרשימה ממוינת לבד
const KEY_CARS = "parking:cars";
// מונה: כמה רכבים נכנסו אי-פעם
const KEY_TOTAL = "stats:totalEntries";
// מונה: כמה כסף נאסף בסך הכל
const KEY_REVENUE = "stats:revenue";

// 🥚 Easter Egg: הרכב 77-777-77 חונה בחינם
const LUCKY_PLATE = "7777777";

// רשימת הודעות "ברוך הבא" מצחיקות. בכל כניסה נבחרת אחת באקראי
const WELCOME_MESSAGES = [
  "ברוך הבא! תחנה בעדינות, הרכב מימין עדיין משלם על הליסינג 😅",
  "נכנסת! זכור: חניה בשתי חניות זה לא 'חניה רחבה' 🙃",
  "ברוך הבא! המצלמה אומרת שאתה נראה מעולה היום 📸",
  "נקלטת במערכת! עכשיו רק לזכור באיזו קומה חנית 🤔",
  "ברוך הבא! מזגן דלוק? מוזיקה טובה? אפשר להיכנס 🎶",
];

// ---------- חיבור ל-Redis ויצירת השרת ----------

// יוצרים "לקוח" שמתחבר ל-Redis בכתובת redis://redis:6379 (6379 = הפורט הקבוע של Redis)
const redis = createClient({ url: `redis://${REDIS_HOST}:6379` });
// אם יש תקלה בחיבור ל-Redis – כותבים אותה ליומן (log) במקום שהשרת יקרוס
redis.on("error", (err) => console.error("Redis error:", err.message));

// יוצרים את השרת עצמו
const app = express();
// אומרים לשרת לקרוא גוף בקשה בפורמט JSON (כמו {"plate":"1234567"}) ולהפוך אותו לאובייקט
app.use(express.json());

// --- פונקציות עזר ---------------------------------------------------------

// מנקה את מספר הרכב: מוחקת רווחים ומקפים. "12-345-67" הופך ל-"1234567"
function normalizePlate(raw) {
  // String(...) הופך לטקסט; || "" מונע קריסה אם לא נשלח כלום; replace מוחק רווחים (\s) ומקפים (-)
  return String(raw || "").replace(/[\s-]/g, "");
}
// בודקת שמספר הרכב תקין: רק ספרות (\d), באורך 7 או 8. מחזירה true/false
function isValidPlate(plate) {
  return /^\d{7,8}$/.test(plate);
}

// מחשבת כמה לשלם. מקבלת מספר רכב, זמן כניסה, ו"עכשיו" (ברירת מחדל: הרגע הנוכחי)
function calcPrice(plate, enteredAt, now = Date.now()) {
  // רכב המזל לא משלם
  if (plate === LUCKY_PLATE) return 0;
  // כמה דקות עברו: ההפרש במילישניות חלקי 60,000 (מילישניות בדקה), מעוגל למטה
  const minutes = Math.floor((now - enteredAt) / 60000);
  // פחות מ-15 דקות – חינם
  if (minutes < FREE_MINUTES) return 0;
  // אחרת: מספר השעות מעוגל למעלה (Math.ceil) כפול המחיר לשעה. 61 דקות = 2 שעות
  return Math.ceil(minutes / 60) * PRICE_PER_HOUR;
}

// --- נתיבים (Routes): הכתובות שהשרת עונה להן ------------------------------

// GET /api/health – בדיקת תקינות. ה-CI שואל כאן "אתה חי?"
app.get("/api/health", async (req, res) => {
  // try/catch = "נסה, ואם נכשל – תטפל בשגיאה"
  try {
    // שולחים "ping" ל-Redis. אם הוא עונה – הכל תקין
    await redis.ping();
    // עונים ללקוח בהודעה שהכל בסדר
    res.json({ status: "ok", redis: "connected" });
  } catch {
    // Redis לא ענה – מחזירים קוד 503 (השירות לא זמין)
    res.status(503).json({ status: "error", redis: "disconnected" });
  }
});

// POST /api/cars – המצלמה שולחת רכב חדש: { "plate": "12-345-67" }
// async = הפונקציה יכולה "לחכות" (await) לתשובות מ-Redis
app.post("/api/cars", async (req, res) => {
  try {
    // לוקחים את מספר הרכב מגוף הבקשה ומנקים אותו
    const plate = normalizePlate(req.body.plate);
    // בדיקה 1: האם המספר תקין?
    if (!isValidPlate(plate)) {
      // לא תקין – קוד 400 ("בקשה שגויה"). return עוצר את הפונקציה כאן
      return res.status(400).json({ error: "מספר רישוי לא תקין (צריך 7 או 8 ספרות)" });
    }

    // בדיקה 2: האם הרכב כבר בחניון? zScore מחזיר את זמן הכניסה שלו, או null אם הוא לא קיים
    if ((await redis.zScore(KEY_CARS, plate)) !== null) {
      // כבר בפנים – קוד 409 ("התנגשות")
      return res.status(409).json({ error: `הרכב ${plate} כבר נמצא בחניון 🤨` });
    }

    // בדיקה 3: כמה רכבים יש עכשיו? zCard סופר כמה פריטים יש ברשימה
    const count = await redis.zCard(KEY_CARS);
    // אם הגענו לקיבולת – החניון מלא
    if (count >= CAPACITY) {
      // קוד 403 ("אסור") – לא נותנים להיכנס
      return res.status(403).json({ error: "🚫 החניון מלא! נסה שוב מאוחר יותר" });
    }

    // כל הבדיקות עברו! שומרים את הזמן הנוכחי (במילישניות מאז 1970)
    const enteredAt = Date.now();
    // מוסיפים את הרכב לרשימה ב-Redis, עם זמן הכניסה כ"ציון"
    await redis.zAdd(KEY_CARS, { score: enteredAt, value: plate });
    // מגדילים ב-1 את מונה הכניסות הכולל
    await redis.incr(KEY_TOTAL);

    // בוחרים הודעת ברוך הבא:
    const message =
      // אם זה רכב המזל...
      plate === LUCKY_PLATE
        // ...הודעה מיוחדת
        ? "🍀 מספר המזל! החניה עליך היום – בחינם!"
        // אחרת – הודעה אקראית מהרשימה. Math.random נותן מספר בין 0 ל-1
        : WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)];

    // כותבים ליומן של השרת שרכב נכנס (רואים את זה ב-docker compose logs)
    console.log(`[ENTRY] ${plate}`);
    // עונים למצלמה: קוד 201 ("נוצר בהצלחה") עם הפרטים וההודעה
    res.status(201).json({ plate, enteredAt, message });
  } catch (err) {
    // משהו לא צפוי נכשל – כותבים ליומן ועונים בקוד 500 ("שגיאת שרת")
    console.error(err);
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// GET /api/cars – לוח הבקרה מבקש את כל המידע, בבקשה אחת
app.get("/api/cars", async (req, res) => {
  try {
    // שומרים את "עכשיו" פעם אחת, כדי שכל החישובים יהיו לפי אותו רגע
    const now = Date.now();
    // מביאים מ-Redis את כל הרכבים עם זמני הכניסה (0 עד -1 = מההתחלה עד הסוף)
    const rows = await redis.zRangeWithScores(KEY_CARS, 0, -1);
    // הופכים כל שורה לאובייקט מסודר עם כל מה שהמסך צריך
    const cars = rows
      // map = "לכל פריט ברשימה, תיצור פריט חדש"
      .map(({ value, score }) => ({
        // מספר הרכב
        plate: value,
        // זמן הכניסה
        enteredAt: score,
        // כמה דקות הוא כבר בחניון
        minutes: Math.floor((now - score) / 60000),
        // כמה הוא צריך לשלם כרגע
        price: calcPrice(value, score, now),
      }))
      // הופכים את הסדר: האחרון שנכנס יופיע ראשון
      .reverse();

    // עונים ללוח הבקרה עם כל המידע
    res.json({
      // רשימת הרכבים
      cars,
      // כמה רכבים יש
      count: cars.length,
      // כמה מקומות יש בסך הכל
      capacity: CAPACITY,
      // האם החניון מלא (true/false) – לפי זה מוצגת ההתראה האדומה
      isFull: cars.length >= CAPACITY,
      // סה"כ כניסות. אם המונה עוד לא קיים – 0
      totalEntries: parseInt((await redis.get(KEY_TOTAL)) || "0", 10),
      // סה"כ הכנסות
      revenue: parseInt((await redis.get(KEY_REVENUE)) || "0", 10),
      // המחיר לשעה (כדי להציג אותו בתחתית המסך)
      pricePerHour: PRICE_PER_HOUR,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// DELETE /api/cars/:plate – כפתור "שחרור רכב". ‎:plate = מספר הרכב שמגיע בכתובת עצמה
app.delete("/api/cars/:plate", async (req, res) => {
  try {
    // לוקחים את מספר הרכב מהכתובת ומנקים אותו
    const plate = normalizePlate(req.params.plate);
    // מוצאים מתי הרכב נכנס
    const enteredAt = await redis.zScore(KEY_CARS, plate);
    // אם הוא לא ברשימה...
    if (enteredAt === null) {
      // ...קוד 404 ("לא נמצא")
      return res.status(404).json({ error: "הרכב לא נמצא בחניון" });
    }

    // מחשבים כמה לשלם
    const price = calcPrice(plate, enteredAt);
    // מוחקים את הרכב מהרשימה (zRem = remove)
    await redis.zRem(KEY_CARS, plate);
    // מוסיפים את התשלום למונה ההכנסות
    await redis.incrBy(KEY_REVENUE, price);

    // כותבים ליומן שהרכב יצא וכמה שילם
    console.log(`[EXIT]  ${plate}  paid ₪${price}`);
    // עונים ללוח הבקרה: כמה לשלם וכמה דקות חנה
    res.json({ plate, price, minutes: Math.floor((Date.now() - enteredAt) / 60000) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// --- הפעלת השרת -----------------------------------------------------------

// פונקציה שמפעילה הכל
async function start() {
  // קודם מתחברים ל-Redis (ומחכים שהחיבור יצליח)
  await redis.connect();
  // ורק אחר כך מתחילים להאזין לבקשות בפורט 3000
  app.listen(PORT, () => console.log(`🚗 Parking API listening on port ${PORT}`));
}

// מריצים את start. אם נכשל (למשל Redis לא זמין)...
start().catch((err) => {
  // ...כותבים את השגיאה...
  console.error("Failed to start:", err.message);
  // ...ויוצאים עם קוד שגיאה. Docker יפעיל את השרת מחדש בזכות restart: unless-stopped
  process.exit(1);
});
