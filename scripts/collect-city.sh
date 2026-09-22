#!/usr/bin/env bash
# 一個城市三種房型批次採集:bash scripts/collect-city.sh <region:1 台北|3 新北> [pages=5]
# 要脫離式跑:( bash scripts/collect-city.sh 3 & )
cd "$(dirname "$0")/.." || exit 1
export PYTHONIOENCODING=utf-8
REGION=${1:-1}; PAGES=${2:-5}; TS=$(date +%Y%m%d-%H%M)
case $REGION in 1) CITY=taipei;; 3) CITY=newtaipei;; *) CITY=r$REGION;; esac
for KIND in 1 2 3; do
  npm run collect -- list "https://rent.591.com.tw/list?region=$REGION&kind=$KIND" --pages=1-$PAGES > "data/logs/collect-$CITY-kind$KIND-$TS.log" 2>&1
done
echo "ALL DONE $TS" > "data/logs/collect-$CITY-DONE-$TS.log"
