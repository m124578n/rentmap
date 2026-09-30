import { useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bike,
  Bus,
  CalendarClock,
  Columns3,
  Gauge,
  Kanban,
  Layers,
  LineChart,
  MapPin,
  Route,
  ShieldAlert,
  ShoppingBasket,
  Siren,
  SlidersHorizontal,
  Trash2,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { LegalLinks } from "@/features/legal/LegalLinks";

/**
 * 介紹頁:沒登入的人在任何網址都看到這頁(也是搜尋引擎看到的那頁);登入後從「更多 → 介紹」或 /about 進來。
 * 插圖是純 CSS / SVG,不放圖檔。
 */
export function AboutPage() {
  const { user, enabled, dev, login, devLogin } = useAuth();
  useEffect(() => {
    const prev = document.title;
    document.title = "租屋筆記|雙北租屋的通勤、行情、生活機能與災害,一張地圖看完";
    return () => {
      document.title = prev;
    };
  }, []);

  const cta = user ? (
    <Link to="/" className="btn-primary px-5 py-2.5 text-base">
      打開地圖
    </Link>
  ) : dev ? (
    <button onClick={devLogin} className="btn-primary px-5 py-2.5 text-base">
      本機登入
    </button>
  ) : (
    <button onClick={login} className="btn-primary px-5 py-2.5 text-base" disabled={!enabled}>
      {enabled ? "用 Google 登入" : "尚未設定登入"}
    </button>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16">
      {/* 首屏 */}
      <section className="grid items-center gap-8 py-10 sm:py-16 md:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="mb-3 inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            雙北租屋 · 個人找房工具
          </p>
          <h1 className="text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
            找房要查的東西,
            <br />
            <span className="text-emerald-600 dark:text-emerald-400">一張地圖看完。</span>
          </h1>
          <p className="mt-4 max-w-prose text-neutral-600 dark:text-neutral-400">
            591、好房的物件每天自動收進來。每一間都幫你算好上下班怎麼搭、每月實際要花多少、比行情貴還便宜,
            附近有什麼、會不會淹水、治安如何。看完再收藏、約看、排路線、並排比較,最後決定。
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {cta}
            <a href="#features" className="text-sm text-neutral-600 underline dark:text-neutral-400">
              看看能做什麼
            </a>
          </div>
          {!user && <p className="mt-3 text-xs text-neutral-500">目前是私人使用,只有白名單帳號能登入。</p>}
        </div>
        <HeroMap />
      </section>

      {/* 功能 */}
      <section id="features" className="scroll-mt-4">
        <h2 className="mb-1 text-xl font-semibold">每一間房,幫你查好這些</h2>
        <p className="mb-5 text-sm text-neutral-500">資料都來自政府開放資料與 OpenStreetMap,在家裡的電腦定期更新。</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Feature icon={<Bus size={18} />} title="上下班通勤,分開算">
            公車 + 捷運 + YouBike,轉乘一次內。上班、下班可以設不同時段與星期,班距跟著時段變,走路也算紅綠燈。
          </Feature>
          <Feature icon={<Wallet size={18} />} title="每月實際支出">
            房租之外,管理費、台電累進或房東每度電價、水費、網路、通勤票價(TPASS 封頂)一起加,預算可以比總支出。
          </Feature>
          <Feature icon={<LineChart size={18} />} title="比行情貴還便宜">
            內政部租賃實價登錄,同區同房型、坪數房數相近的成交價;另外列出目前刊登中的開價,看得出殺價空間。
          </Feature>
          <Feature icon={<ShoppingBasket size={18} />} title="生活機能">
            超商、超市、餐飲、市場、公園、診所、運動、YouBike…走路 500m / 1km 內有幾個、最近的在哪。
          </Feature>
          <Feature icon={<Trash2 size={18} />} title="垃圾車追不追得到">
            房東沒寫垃圾代收的話,看附近的垃圾車幾點來、一週幾天;需求可以設「下班後追得到」。
          </Feature>
          <Feature icon={<ShieldAlert size={18} />} title="嫌惡設施與災害">
            加油站、變電所、殯葬、快速道路、鐵道高架的最近距離;淹水潛勢、土壤液化、松山機場航空噪音。
          </Feature>
          <Feature icon={<Siren size={18} />} title="治安">
            臺北市警察局的住宅、機車、汽車竊盜點位,看附近近三年幾件;雙北各區近一年件數與排名。
          </Feature>
          <Feature icon={<SlidersHorizontal size={18} />} title="需求符合度">
            設好預算、坪數、通勤上限、必要設備與權重,每間標綠黃紅,地圖也能照符合度上色。
          </Feature>
          <Feature icon={<Layers size={18} />} title="區域圖層">
            還沒看到喜歡的房?先看區域:通勤時間網格、每坪租金、淹水與噪音範圍;地圖任一點右鍵也能看附近。
          </Feature>
        </div>
      </section>

      {/* 流程 */}
      <section className="mt-12">
        <h2 className="mb-5 text-xl font-semibold">從看到到決定</h2>
        <ol className="grid gap-4 sm:grid-cols-4">
          <Step n={1} icon={<MapPin size={16} />} title="設好地點與需求">
            公司、家人住處;預算、通勤上限、要電梯寵物開伙。
          </Step>
          <Step n={2} icon={<Kanban size={16} />} title="收藏、聯絡、約看">
            看板拖曳換狀態,寫私人備註與標籤,降價有紀錄。
          </Step>
          <Step n={3} icon={<Route size={16} />} title="排看房路線">
            約好的幾間排出最順的順序,每間幾點到、怎麼搭。
          </Step>
          <Step n={4} icon={<Columns3 size={16} />} title="並排比較">
            2–4 間並排比租金、支出、通勤、機能、災害、治安。
          </Step>
        </ol>
      </section>

      {/* 資料來源 */}
      <section className="mt-12 grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <div>
          <h2 className="mb-2 text-xl font-semibold">資料來源</h2>
          <p className="text-sm text-neutral-500">
            通勤與距離都是估計,出發前請再確認;災害與治安資料只看得出大概位置,實際請以官方為準。
          </p>
        </div>
        <ul className="grid gap-1.5 text-sm text-neutral-600 sm:grid-cols-2 dark:text-neutral-400">
          <Source icon={<Bus size={14} />}>交通部 TDX:公車路線、班表、捷運站間時間</Source>
          <Source icon={<Bike size={14} />}>臺北市 / 新北市:YouBike 站點、垃圾車清運點</Source>
          <Source icon={<LineChart size={14} />}>內政部:不動產租賃實價登錄</Source>
          <Source icon={<ShieldAlert size={14} />}>經濟部水利署:淹水潛勢;臺北市:土壤液化潛勢</Source>
          <Source icon={<Gauge size={14} />}>雙北環保局:航空噪音防制區</Source>
          <Source icon={<Siren size={14} />}>雙北警察局:竊盜點位與案件統計</Source>
          <Source icon={<ShoppingBasket size={14} />}>OpenStreetMap:生活機能、嫌惡設施</Source>
          <Source icon={<CalendarClock size={14} />}>591、好房:刊登中的物件(只存連結與文字)</Source>
        </ul>
      </section>

      <section className="mt-12 rounded-2xl bg-emerald-600 px-6 py-8 text-center text-white dark:bg-emerald-800">
        <h2 className="text-xl font-semibold">開始找房</h2>
        <p className="mt-1 text-sm text-emerald-50">可以加到手機主畫面,看房途中收訊不好也能打開收藏與路線。</p>
        <div className="mt-4 [&_.btn-primary]:bg-white [&_.btn-primary]:text-emerald-700 [&_.btn-primary:hover]:bg-emerald-50">{cta}</div>
      </section>

      <p className="mt-8 text-center text-xs text-neutral-400">地圖 © CARTO © OpenStreetMap contributors</p>
      <LegalLinks className="mt-2 justify-center" />
    </div>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="card">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{icon}</span>
        <h3 className="font-medium">{title}</h3>
      </div>
      <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">{children}</p>
    </div>
  );
}

function Step({ n, icon, title, children }: { n: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="card">
      <div className="mb-1.5 flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">{n}</span>
        {icon}
      </div>
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{children}</p>
    </li>
  );
}

function Source({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

/** 首屏插圖:簡化的地圖 + 捷運線 + 價格標記 + 一張房源小卡(純 SVG / CSS) */
function HeroMap() {
  const pins: [number, number, string, string][] = [
    [18, 30, "1.8萬", "#059669"],
    [52, 22, "2.4萬", "#6b7280"],
    [70, 48, "3.2萬", "#7c3aed"],
    [34, 62, "1.5萬", "#d97706"],
    [82, 74, "2.1萬", "#6b7280"],
  ];
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-neutral-200 bg-[#f3f1ec] shadow-sm dark:border-neutral-800 dark:bg-neutral-900" aria-hidden>
      <svg viewBox="0 0 100 75" className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        {/* 街廓 */}
        <g className="stroke-white dark:stroke-neutral-800" strokeWidth="1.2" fill="none">
          {[12, 26, 40, 54, 68].map((y) => (
            <path key={y} d={`M0 ${y} L100 ${y + 3}`} />
          ))}
          {[15, 35, 55, 75, 92].map((x) => (
            <path key={x} d={`M${x} 0 L${x - 4} 75`} />
          ))}
        </g>
        {/* 河 */}
        <path d="M0 58 C20 52 30 70 55 64 S90 50 100 56" className="stroke-sky-200 dark:stroke-sky-900" strokeWidth="4" fill="none" />
        {/* 淹水範圍 */}
        <ellipse cx="30" cy="60" rx="12" ry="6" className="fill-sky-400/25" />
        {/* 捷運 */}
        <path d="M5 40 C30 36 45 40 60 32 S85 20 98 18" stroke="#0070bd" strokeWidth="1.6" fill="none" />
        <path d="M48 2 C50 20 44 40 50 74" stroke="#e3002c" strokeWidth="1.6" fill="none" />
        {/* 通勤路線(虛線) */}
        <path d="M34 62 C40 50 46 44 58 33" stroke="#059669" strokeWidth="1.1" strokeDasharray="2 1.4" fill="none" />
        {[
          [5, 40],
          [30, 37.5],
          [60, 32],
          [98, 18],
          [49, 20],
          [47, 55],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.3" className="fill-white stroke-neutral-700" strokeWidth="0.5" />
        ))}
      </svg>
      {pins.map(([x, y, label, c]) => (
        <span
          key={label}
          className="absolute -translate-x-1/2 -translate-y-full rounded-full border-2 border-white px-2 py-0.5 text-[11px] font-semibold text-white shadow dark:border-neutral-900"
          style={{ left: `${x}%`, top: `${(y / 75) * 100}%`, background: c }}
        >
          {label}
        </span>
      ))}
      <span className="absolute top-[40%] left-[58%] rounded bg-blue-700 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">公司</span>
      <div className="absolute right-3 bottom-3 left-3 rounded-xl border border-neutral-200 bg-white/95 p-3 text-xs shadow-lg sm:left-auto sm:w-60 dark:border-neutral-700 dark:bg-neutral-900/95">
        <div className="flex items-baseline justify-between">
          <b className="text-base text-emerald-700 dark:text-emerald-400">$15,000</b>
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">比行情 -8%</span>
        </div>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">上班約 24 分 · 公車轉捷運</p>
        <p className="text-neutral-600 dark:text-neutral-400">每月支出約 $17,380</p>
        <p className="mt-1 flex gap-1">
          <span className="rounded bg-sky-50 px-1 text-[10px] text-sky-700 dark:bg-sky-950 dark:text-sky-300">淹水 0.3–0.5m</span>
          <span className="rounded bg-neutral-100 px-1 text-[10px] dark:bg-neutral-800">超商 12</span>
          <span className="rounded bg-neutral-100 px-1 text-[10px] dark:bg-neutral-800">垃圾車 19:30</span>
        </p>
      </div>
    </div>
  );
}
