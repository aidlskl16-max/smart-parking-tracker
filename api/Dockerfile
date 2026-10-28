# ---- API Server (Node.js) ----
# alpine = אימג' קטן ומאובטח (~50MB במקום ~1GB)
FROM node:20-alpine

WORKDIR /app

# קודם מעתיקים רק את קבצי התלויות – כדי ש-Docker ישמור Cache של שלב ההתקנה
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# עכשיו את הקוד עצמו
COPY server.js ./

# לא מריצים כ-root (אבטחה)
USER node

EXPOSE 3000
CMD ["node", "server.js"]
