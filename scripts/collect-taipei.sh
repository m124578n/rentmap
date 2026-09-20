#!/usr/bin/env bash
# 台北市批次採集:獨立套房 5 頁 → 分租套房 3 頁 → 整層住家 5 頁(補照片連結)。log 在 data/logs/
cd "$(dirname "$0")/.." || exit 1
export PYTHONIOENCODING=utf-8
TS=$(date +%Y%m%d-%H%M)
npm run collect -- list "https://rent.591.com.tw/list?region=1&kind=2" --pages=1-5 > "data/logs/collect-taipei-suite-$TS.log" 2>&1
npm run collect -- list "https://rent.591.com.tw/list?region=1&kind=3" --pages=1-3 > "data/logs/collect-taipei-share-$TS.log" 2>&1
npm run collect -- list "https://rent.591.com.tw/list?region=1&kind=1" --pages=1-5 > "data/logs/collect-taipei-home-photos-$TS.log" 2>&1
echo "ALL DONE $TS" > "data/logs/collect-taipei-DONE-$TS.log"
