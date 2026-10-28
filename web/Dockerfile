# ---- Web Server (Nginx) ----
FROM nginx:alpine

# ההגדרות שלנו: מגיש את הדאשבורד ומעביר בקשות /api/ לשרת ה-API
COPY nginx.conf /etc/nginx/conf.d/default.conf

# קובץ לוח הבקרה
COPY index.html /usr/share/nginx/html/index.html

EXPOSE 80
