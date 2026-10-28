# 🅿️ SmartPark – Smart Parking License Plate Tracker

[![Docker CI/CD](https://github.com/aidlskl16-max/smart-parking-tracker/actions/workflows/docker-ci.yml/badge.svg)](https://github.com/aidlskl16-max/smart-parking-tracker/actions/workflows/docker-ci.yml)

מערכת לניהול כניסת רכבים לחניון חכם, בנויה כ-**Microservices** בעזרת **Docker Compose**.
מצלמת IoT מפענחת את מספר הרישוי ושולחת אותו ל-API, ולוח הבקרה של השומר מתעדכן **בזמן אמת – בלי לרענן את העמוד**.

**מסלול:** Track 2 – Full Stack DevOps

---

## 🏗️ ארכיטקטורה

```
   📷 מצלמת IoT                     👮 השומר (דפדפן)
        │  HTTP POST                      │  HTTP GET (כל 3 שניות)
        └──────────────┬──────────────────┘
                       ▼
          ┌──────────────────────────┐
          │   web  (Nginx)  :8080    │  ← היחיד שחשוף החוצה
          │   מגיש index.html        │
          │   /api/* → proxy ל-api   │
          └────────────┬─────────────┘
                       ▼   (רשת parking-net – Custom Bridge)
          ┌──────────────────────────┐
          │   api  (Node.js/Express) │
          │   POST / GET / DELETE    │
          └────────────┬─────────────┘
                       ▼
          ┌──────────────────────────┐
          │   redis  (Redis 7)       │
          │   appendonly = yes       │
          └────────────┬─────────────┘
                       ▼
              💾 Volume: redis_data
```

| שירות | אימג' | תפקיד |
|------|-------|-------|
| `web` | `nginx:alpine` + הקבצים שלנו | מגיש את לוח הבקרה ומעביר בקשות `/api/` לשרת ה-API (Reverse Proxy) |
| `api` | `node:20-alpine` + הקוד שלנו | Backend: מקבל רכבים מהמצלמה, מחזיר רשימה ללוח, משחרר רכבים ומחשב מחיר |
| `redis` | `redis:7-alpine` | מסד הנתונים. שומר כל שינוי לקובץ (AOF) בתוך Volume, כך שהנתונים שורדים נפילה |

---

## ✨ מה הוספנו משלנו

- 💰 **חישוב מחיר חניה** – 15 דקות ראשונות חינם, ואחר כך ₪12 לכל שעה שהתחילה. המחיר מתעדכן בלייב.
- 🚪 **כפתור "שחרור רכב"** – מוציא את הרכב ומציג כמה צריך לשלם. ההכנסות נצברות במונה.
- 🚨 **התראת חניון מלא** – באנר אדום מהבהב, והשרת חוסם כניסה (קיבולת מוגדרת ב-`CAPACITY`).
- 😂 **הודעות מצחיקות** – כל רכב שנכנס מקבל הודעת "ברוך הבא" אקראית.
- 🌙 **מצב לילה** – לשומר של משמרת הלילה. הבחירה נשמרת בדפדפן.
- 🥚 **Easter Egg** – נסו להכניס את הרכב `77-777-77` 😉
- 🇮🇱 **לוחית רישוי ישראלית** – עיצוב צהוב, בדיקת תקינות (7 או 8 ספרות) וחסימת רכב כפול.

---

## 🚀 הפעלה

דרוש: [Docker Desktop](https://www.docker.com/products/docker-desktop/)

```bash
git clone https://github.com/aidlskl16-max/smart-parking-tracker.git
cd smart-parking-tracker
docker compose up -d --build
```

פותחים בדפדפן: **http://localhost:8080**

### פקודות שימושיות

| פקודה | מה היא עושה |
|-------|-------------|
| `docker compose up -d --build` | בונה ומפעיל את כל המערכת ברקע |
| `docker compose ps` | מציג אילו קונטיינרים רצים |
| `docker compose logs -f api` | מציג לוגים של שרת ה-API בזמן אמת |
| `docker compose down` | מכבה ומוחק את הקונטיינרים – **הנתונים נשמרים ב-Volume** |
| `docker compose down -v` | מכבה **ומוחק גם את ה-Volume** (איפוס מלא) |

---

## 📡 API

| Method | נתיב | תיאור |
|--------|------|-------|
| `POST` | `/api/cars` | המצלמה מדווחת על רכב. גוף: `{"plate": "12-345-67"}` |
| `GET` | `/api/cars` | רשימת הרכבים בחניון + סטטיסטיקות (כמה בחניון, קיבולת, הכנסות) |
| `DELETE` | `/api/cars/:plate` | שחרור רכב – מחזיר כמה דקות חנה וכמה לשלם |
| `GET` | `/api/health` | בדיקת תקינות (משמש את ה-CI) |

### סימולציית מצלמה
אפשר דרך הכפתור בלוח הבקרה, או מהטרמינל:

```bash
sh camera/camera.sh 1234567      # רכב ספציפי
sh camera/camera.sh              # רכב אקראי
```

או ישירות:

```bash
curl -X POST http://localhost:8080/api/cars -H "Content-Type: application/json" -d '{"plate":"1234567"}'
```

### איך הנתונים נשמרים ב-Redis

| מפתח | סוג | תוכן |
|------|-----|------|
| `parking:cars` | Sorted Set | מספר רכב → זמן כניסה (score). ממוין אוטומטית לפי זמן |
| `stats:totalEntries` | String (מונה) | כמה רכבים נכנסו אי-פעם |
| `stats:revenue` | String (מונה) | סך ההכנסות בש"ח |

---

## 💾 הוכחת Persistence (לדמו)

```bash
docker compose up -d          # 1. מפעילים ומכניסים כמה רכבים בלוח הבקרה
docker compose down           # 2. מכבים הכל – הקונטיינרים נמחקים
docker compose up -d          # 3. מפעילים מחדש
                              # 4. מרעננים את הדפדפן – כל הרכבים עדיין שם ✅
```

**למה זה עובד?** Redis רץ עם `--appendonly yes`, כלומר כל שינוי נכתב לקובץ בתיקייה `/data`.
התיקייה הזו מחוברת ל-Volume בשם `redis_data`, ש-Docker מנהל מחוץ לקונטיינר –
ולכן `docker compose down` מוחק את הקונטיינר אבל לא את ה-Volume.
(רק `down -v` מוחק אותו.)

---

## ⚙️ CI/CD – GitHub Actions

הקובץ: `.github/workflows/docker-ci.yml` – רץ **בכל push**.

**Job 1 – `build-and-test`:**
1. `docker compose build` – בודק שכל האימג'ים נבנים
2. `docker compose up -d` – מפעיל את כל המערכת
3. מחכה ש-`/api/health` יחזיר תשובה
4. שולח רכב (POST) ובודק שהוא חוזר ב-GET
5. מבצע `down` ו-`up` ובודק שהרכב **עדיין שם** (בדיקת Volume אוטומטית)

**Job 2 – `publish` (בונוס 🏆):** רץ רק על `main` ורק אם הבדיקות עברו.
- מתחבר ל-`ghcr.io` בצורה מאובטחת עם `GITHUB_TOKEN` (בלי סיסמאות בקוד)
- מתייג אוטומטית: `v1.0.<מספר-ריצה>`, `sha-<קומיט>`, `latest`
- דוחף את שני האימג'ים: `smart-parking-tracker-api` ו-`smart-parking-tracker-web`

האימג'ים מופיעים במאגר תחת **Packages**.

---

## 🧠 החלטות ארכיטקטוניות

| החלטה | למה |
|-------|-----|
| **Nginx כ-Reverse Proxy ל-API** | הדפדפן מדבר עם פורט אחד בלבד (8080), אין בעיות CORS, וה-API לא חשוף ישירות לאינטרנט |
| **ה-API בלי `ports`** | אבטחה – אפשר להגיע אליו רק מתוך הרשת הפנימית של Docker |
| **Custom Bridge Network** | השירותים מוצאים אחד את השני לפי שם (`redis`, `api`) דרך ה-DNS הפנימי, בלי כתובות IP |
| **Redis Sorted Set** | שומר את זמן הכניסה כ-score, אז הרשימה כבר ממוינת וקל לחשב זמן חניה ומחיר |
| **`appendonly yes` + Volume** | כל שינוי נכתב לדיסק, והדיסק שורד מחיקת קונטיינר |
| **`healthcheck` + `condition: service_healthy`** | ה-API עולה רק אחרי ש-Redis באמת מוכן לקבל חיבורים |
| **`restart: unless-stopped`** | אם קונטיינר נופל – Docker מרים אותו מחדש לבד |
| **אימג'י `alpine`** | קטנים, מהירים להורדה ופחות חולשות אבטחה |
| **`USER node` ב-Dockerfile** | ה-API לא רץ כ-root |
| **`npm ci` + העתקת `package.json` לפני הקוד** | התקנה מדויקת לפי ה-lock, ו-Docker שומר Cache של שלב ההתקנה כשרק הקוד משתנה |
| **הגדרות דרך `environment`** | קיבולת ומחיר משתנים בלי לגעת בקוד |
| **בניית DOM עם `createElement` / `textContent`** | מונע הזרקת קוד (XSS) דרך מספר רכב |

---

## 📁 מבנה הפרויקט

```
smart-parking-tracker/
├── docker-compose.yml           # מגדיר את 3 השירותים, הרשת וה-Volume
├── api/
│   ├── Dockerfile
│   ├── package.json / package-lock.json
│   └── server.js                # כל הלוגיקה של ה-Backend
├── web/
│   ├── Dockerfile
│   ├── nginx.conf               # הגשת הדף + Proxy ל-API
│   └── index.html               # לוח הבקרה (HTML + CSS + JavaScript)
├── camera/
│   └── camera.sh                # סימולטור מצלמה מהטרמינל
├── .github/workflows/
│   └── docker-ci.yml            # CI/CD + פרסום ל-GHCR
├── AI_USAGE.md
└── README.md
```

---

## 👥 צוות

| שם | אחריות |
|----|--------|
| איידל סרבטר | _למשל: API, Redis, docker-compose_ |
| טל קפלן | _למשל: לוח בקרה, Nginx, GitHub Actions_ |
