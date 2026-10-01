# 部署 runbook(照做清單)

日期:2026-10-01
狀態:**只是文件。使用者說「好」之前,下面任何一步都不要執行**(CLAUDE.md 鐵則:不跑 `wrangler deploy`、`d1 create`、`secret put`,不建任何雲端資源)。
`package.json` 的 `npm run deploy` 故意會失敗(`echo 部署前先問過使用者 && exit 1`),正式部署用下面的指令。

相關:CLAUDE.md「已知坑」、`../business/2026-09-30-subscription-and-legal.md`「上線前待辦」、`2026-09-30-open-a-region.md`

---

## 0. 上線前要先決定 / 完成的(不是技術步驟)

- [ ] 使用者說「好」。
- [ ] 條款:`src/shared/legal.ts` 的 `OPERATOR`(經營者、信箱)填好;律師看過後依規則加版本號(改內容就加版本,使用者會被要求重新同意)。
- [ ] 登入對象:目前 `ADMIN_EMAILS` 是白名單,只有名單內的 Google 帳號能登入(`src/worker/auth.ts`)。公開給所有人要另外改程式(開放註冊),不是改設定就好。
- [ ] 私人模式**不能**出現在正式站:正式站不設 `PRIVATE_POOL`(沒設 = 公開模式)。本機的 591 / 好房房源只留在本機 D1,**不要匯出、不要推上去**。
- [ ] 金流:還沒做(等方案切分與退款規則),第一版上線可以先全免費。

## 1. Cloudflare 帳號與方案

- [ ] **Workers Paid**:通勤引擎(`/api/commute`)一次算所有房源 × 地點,免費方案每次請求 CPU 10ms 不夠(本機實測 8 萬站、3000 間、2 個地點約 0.5 秒;每個生活圈第一次載公車網路約 1 秒)。
- [ ] D1:`npx wrangler d1 create rentmap-db`,把回傳的 `database_id` 填進 `wrangler.jsonc`(目前是 `local-placeholder`)。

## 1.5 網域:`loka.shunzz.com`(2026-10-01 定)

- Workers 的自訂網域要 `shunzz.com` 的 DNS 由 Cloudflare 代管(名稱伺服器指到 Cloudflare)。如果現在 DNS 在別家:
  把整個 `shunzz.com` 的 NS 移到 Cloudflare(免費方案即可,先把原本的 DNS 紀錄搬過去);只用 CNAME 接入(partial setup)要 Business 方案,不划算。
- `wrangler.jsonc` 部署時加:`"routes": [{ "pattern": "loka.shunzz.com", "custom_domain": true }]`(憑證 Cloudflare 自動發)。
- 子網域不用另外買;`shunzz.com` 的其他用途不受影響。

## 2. 設定(`wrangler.jsonc` 的 vars)

| 變數 | 正式站的值 | 說明 |
|---|---|---|
| `APP_ORIGIN` | `https://loka.shunzz.com` | OAuth redirect、CSRF 同源檢查、本機登入開關都看它;**不能**是 localhost(否則 `/api/auth/dev` 會生效) |
| `ADMIN_EMAILS` | 允許登入的 email,逗號分隔 | 見第 0 節 |
| `PRIVATE_POOL` | **不要設** | 沒設 = 公開模式 |

改完 `wrangler.jsonc` 跑 `npm run types`、`npm run check`。

## 3. 機密(`npx wrangler secret put <NAME>`)

清單來源:`src/worker/env.ts`。

| 名稱 | 要不要放 | 說明 |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 要 | Google Cloud Console 的 OAuth client 要加正式網域的 redirect URI:`https://loka.shunzz.com/api/auth/google/callback` |
| `SESSION_SECRET` | 要 | 新產一串長亂碼,不要沿用本機的 |
| `INGEST_SECRET` | 要 | 家裡採集機推資料用的 bearer;家裡 `.env` 放同一把 |
| `ANTHROPIC_API_KEY` | 看功能 | 有用到才放 |
| `DEV_USER_EMAIL` | **不要放** | 只給本機免 Google 登入 |
| `PRIVATE_POOL` | **不要放** | 見上 |

## 4. 程式裡要改的地方

- [ ] `index.html` 的 `og:image` 改成絕對網址 `https://loka.shunzz.com/og.png`(社群平台不吃相對路徑);要的話加 `og:url`、`<link rel="canonical">`。
- [ ] `public/og.png`:介紹頁文案有改就先 `node scripts/og.mjs` 重產。
- [ ] `public/sw.js`:改過快取策略就把 `VERSION` 加一(目前 `v1`),舊快取才會清掉。第一次上線不用動。
- [ ] `public/robots.txt`:目前允許 `/`、`/about`,擋 `/api/`、`/p/`;條款頁 `/legal/*` 要不要收錄可以順便決定。

## 5. 建置與部署

```bash
npm run check && npm test          # 全過才繼續
npm run build                       # tsc + vite build → dist/
npx wrangler d1 migrations apply rentmap-db --remote   # 第一次:建所有表(migrations/ 全部)
npx wrangler deploy
```

之後每次有新 migration:先 `--remote` 套 migration,再 deploy(反過來會讓新程式查不存在的欄位)。

## 6. 第一次資料匯入(從家裡推到正式站)

資料都是在家裡抓、經 `/api/ingest/*` 推上去(Worker 不抓外站)。房源採集的推入在公開模式是 404,不會誤推。

1. 家裡 `.env`:`RENTMAP_API=https://loka.shunzz.com`、`INGEST_SECRET=`(跟第 3 節同一把)。
2. 先 `npm run data:refresh -- --plan` 看會跑什麼。
3. `npm run data:refresh`:依來源分三條線平行跑(TDX、政府資料、OSM),每項各自寫 log、結束印摘要;單項失敗用 `--only=<項目>` 重跑。
   - 順序沒有硬性依賴;通勤至少要 `bus`(公車網路),`tra.json`、`mrt-times.json` 已在 git 裡(隨部署上去)。
   - 每項多久:以家裡實測為準(log 在 `data/logs/refresh-*`),第一次建議挑使用者不在用的時段跑。
4. 跑完後,`tra.json`、`mrt-times.json`、`crime-districts.json` 若有變,commit 並重新 deploy(這三個檔是靜態檔,跟著程式上去)。
5. 驗收:登入 → `/status`(資料狀態頁)切四個生活圈看有沒有紅的;地圖輸入一個地址看報告。

之後的定期更新:`npm run data:refresh -- --due`(只跑到期的)。

## 7. 上線後

- [ ] CARTO 圖磚用量:免費額度每月 100 萬次,超過要升級或換來源;先在 CARTO 後台看用量。
- [ ] Nominatim:瀏覽器直接查(每人 1 秒一次);使用者變多時要評估自架或換服務(使用規範禁止大量使用)。
- [ ] Cloudflare 後台看 Workers 的 CPU 時間與錯誤(`observability` 已開)。
- [ ] 回滾:`npx wrangler rollback`(只回程式;D1 migration 不會自動倒回,破壞性的 migration 上線前要先想好)。
