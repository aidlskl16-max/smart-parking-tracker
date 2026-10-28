#!/bin/sh
# ============================================================
#  סימולציה של מצלמת ה-IoT: שולחת מספר רכב לשרת ב-HTTP POST
#  שימוש:   sh camera/camera.sh 1234567
#  בלי מספר – נשלח מספר אקראי
# ============================================================
PLATE=${1:-$(shuf -i 1000000-99999999 -n 1)}
echo "📷 Camera detected plate: $PLATE"
curl -s -X POST http://localhost:8080/api/cars \
     -H "Content-Type: application/json" \
     -d "{\"plate\":\"$PLATE\"}"
echo
