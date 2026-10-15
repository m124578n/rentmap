import { useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bike,
  Bus,
  Columns3,
  Compass,
  Gauge,
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
import { OPEN_REGIONS } from "@/lib/region";
import { LegalLinks } from "@/features/legal/LegalLinks";

/**
 * 介紹頁:沒登入的人在任何網址都看到這頁(也是搜尋引擎看到的那頁);登入後從「更多 → 介紹」或 /about 進來。
 * 插圖是純 CSS / SVG,不放圖檔。
 */
export function AboutPage() {
  const { user, enabled, dev, loading, login, devLogin } = useAuth();
  useEffect(() => {
    const prev = document.title;
    document.title = "落腳筆記|公司在這,住哪裡最剛好?";
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
    // 載入中也顯示「用 Google 登入」:跟預先產生的 HTML 一致,不閃字(scripts/prerender.mjs)
    <button onClick={login} className="btn-primary px-5 py-2.5 text-base" disabled={!enabled}>
      {enabled || loading ? "用 Google 登入" : "尚未設定登入"}
    </button>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16">
      {/* 首屏 */}
      <section className="grid items-center gap-8 py-10 sm:py-16 md:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="mb-3 inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {OPEN_REGIONS.map((r) => r.label).join("、")} · 落腳筆記
          </p>
          <h1 className="text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
            公司在這,
            <br />
            <span className="text-emerald-600 dark:text-emerald-400">住哪裡最剛好?</span>
          </h1>
          <p className="mt-4 max-w-prose text-neutral-600 dark:text-neutral-400">
            輸入公司(或家人、學校)的地址,就畫出 20、35、50 分鐘通勤圈:公車、捷運、台鐵,或騎車開車。
            圈裡每個行政區、捷運站周邊的租金與房價行情、生活機能、淹水、治安一起排名,預算內的先看,兩區可以並排比較,
            再一鍵連到 591 等網站找房。兩個人上班地點不同?依每週去幾天加權,找出對兩個人都剛好的地方。
          </p>
          <p className="mt-2 max-w-prose text-sm text-neutral-500">
            看中房子之後,輸入地址就是一份報告:通勤、行情、每月支出、附近有什麼;存成筆記、約看、排路線、並排比較。
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
        <div className="card mb-6 grid gap-4 border-emerald-200 sm:grid-cols-[auto_1fr] dark:border-emerald-900">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <Compass size={22} />
          </span>
          <div>
            <h2 className="text-xl font-semibold">適合你落腳的地方</h2>
            <p className="mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              不知道要在哪一區找房,就從這裡開始。通勤圈(分鐘數可以自己調)× 行政區與捷運、台鐵站周邊,每區列出通勤最短 / 中位數、
              租金或每坪房價、生活機能密度、淹水比例、竊盜件數,再依你在意的程度(權重可調)排出落腳分數,附一句話讓你知道那裡大概是什麼樣的地方。
            </p>
            <ul className="mt-3 grid gap-1.5 text-sm text-neutral-600 sm:grid-cols-2 dark:text-neutral-400">
              <li>· 多個地點:取「最遠的那個」或依每週去幾天加權</li>
              <li>· 設了預算,住不起的區直接篩掉</li>
              <li>· 勾兩個區並排比較</li>
              <li>· 分享連結給室友或家人,不用登入就能看</li>
            </ul>
          </div>
        </div>
        <h2 className="mb-1 text-xl font-semibold">鎖定房子後,每一個地址幫你查好這些</h2>
        <p className="mb-5 text-sm text-neutral-500">
          資料都來自政府開放資料與 OpenStreetMap,在家裡的電腦定期更新。
          {/* 一般 <a>(不是 router 的 Link):/area 是 Worker 直接出的公開頁,不在 SPA 裡 */}
          <a href="/area" className="ml-1 text-emerald-700 underline dark:text-emerald-400">
            先看各區租金、房價與治安 →
          </a>
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Feature icon={<Bus size={18} />} title="上下班通勤,分開算">
            公車 + 捷運 + YouBike,轉乘一次內。上班、下班可以設不同時段與星期,班距跟著時段變,走路也算紅綠燈。
          </Feature>
          <Feature icon={<Wallet size={18} />} title="每月實際支出">
            房租或房貸(自備、利率、年限可調)之外,管理費、電費、水費、網路、通勤票價(TPASS 封頂)一起加,預算可以比總支出。
          </Feature>
          <Feature icon={<LineChart size={18} />} title="比行情貴還便宜">
            租屋看租賃實價登錄、買房看買賣實價登錄的每坪單價;同區同型態、坪數相近的成交價,看得出開價合不合理,還能直接試算房貸。
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
            臺北市有住宅、機車、汽車竊盜點位,看附近近三年幾件;其他縣市看各區近一年件數與排名。
          </Feature>
          <Feature icon={<SlidersHorizontal size={18} />} title="需求符合度">
            設好預算、坪數、通勤上限、必要設備與權重,每間標綠黃紅,地圖也能照符合度上色。
          </Feature>
          <Feature icon={<Layers size={18} />} title="區域圖層">
            還沒鎖定房子?先看區域:通勤時間網格、淹水與噪音範圍;地圖任一點右鍵或輸入地址,就是一份報告。
          </Feature>
        </div>
      </section>

      {/* 流程 */}
      <section className="mt-12">
        <h2 className="mb-5 text-xl font-semibold">從看到到決定</h2>
        <ol className="grid gap-4 sm:grid-cols-4">
          <Step n={1} icon={<Compass size={16} />} title="先找落腳的區">
            輸入公司地址,看通勤圈裡哪幾區租金、機能、治安最合你意。
          </Step>
          <Step n={2} icon={<MapPin size={16} />} title="看中就存成筆記">
            貼上刊登網址或地址,通勤、行情、每月支出自動算好。
          </Step>
          <Step n={3} icon={<Route size={16} />} title="約看、排路線">
            看板拖曳換狀態;約好的幾間排出最順的順序,每間幾點到、怎麼搭。
          </Step>
          <Step n={4} icon={<Columns3 size={16} />} title="並排比較">
            2–4 間並排比價格、每月支出、通勤、機能、災害、治安。
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
          <Source icon={<Bus size={14} />}>交通部 TDX:公車路線與班表、捷運站間時間、台鐵時刻、YouBike</Source>
          <Source icon={<Bike size={14} />}>各市政府:YouBike 站點、垃圾車清運點</Source>
          <Source icon={<LineChart size={14} />}>內政部:不動產租賃與買賣實價登錄</Source>
          <Source icon={<ShieldAlert size={14} />}>經濟部水利署:淹水潛勢;臺北市、臺南市:土壤液化潛勢</Source>
          <Source icon={<Gauge size={14} />}>雙北環保局:航空噪音防制區</Source>
          <Source icon={<Siren size={14} />}>雙北警察局:竊盜點位與案件統計</Source>
          <Source icon={<ShoppingBasket size={14} />}>OpenStreetMap:生活機能、嫌惡設施</Source>
        </ul>
      </section>

      {/* 常見問題:畫面上的內容與 FAQPage 結構化資料同一份(搜尋引擎、AI 搜尋會直接引用問答) */}
      <section className="mt-12">
        <h2 className="mb-3 text-xl font-semibold">常見問題</h2>
        <div className="grid gap-2">
          {FAQ.map((f) => (
            <details key={f.q} className="card group">
              <summary className="cursor-pointer font-medium">{f.q}</summary>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{f.a}</p>
            </details>
          ))}
        </div>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd() }} />
      </section>

      <section className="mt-12 rounded-2xl bg-emerald-600 px-6 py-8 text-center text-white dark:bg-emerald-800">
        <h2 className="text-xl font-semibold">先看一個地址</h2>
        <p className="mt-1 text-sm text-emerald-50">可以加到手機主畫面,看房途中收訊不好也能打開收藏與路線。</p>
        <div className="mt-4 [&_.btn-primary]:bg-white [&_.btn-primary]:text-emerald-700 [&_.btn-primary:hover]:bg-emerald-50">{cta}</div>
      </section>

      <p className="mt-8 text-center text-xs text-neutral-400">落腳筆記 Loka Note · 地圖 © CARTO © OpenStreetMap contributors</p>
      <LegalLinks className="mt-2 justify-center" />
    </div>
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: "落腳筆記是什麼?",
    a: "輸入公司地址,就畫出通勤 20、35、50 分鐘的落腳圈,圈裡的行政區依租金、生活機能、治安、淹水排名;看中的房子輸入地址,就幫你查好上下班通勤時間、附近的租金與房價行情、每月實際支出(房租或房貸)、生活機能、淹水與治安。看中的房子可以存成筆記、收藏、排看房路線、並排比較。租屋、買房、搬家前,或只是想多了解自己住的地方都能用。",
  },
  {
    q: "目前可以查哪些地方?",
    a: `${OPEN_REGIONS.map((r) => r.label).join("、")}。以生活圈為單位,一次看一個生活圈;各行政區的租金、房價與治安對照可以在「各區行情」(/area)直接看,不用登入。`,
  },
  {
    q: "「適合我落腳的地方」怎麼排名?",
    a: "先用通勤時間把地圖分成三圈,圈裡每個行政區算出通勤中位數、實價登錄租金或每坪房價、每平方公里的超商超市餐飲等數量、淹水潛勢比例與竊盜件數,依你設的權重在這次圈內的區之間比較出分數。分數是相對的,不是絕對評價。",
  },
  {
    q: "通勤時間怎麼算?",
    a: "用交通部 TDX 的公車路線與班表、捷運站間時間、台鐵時刻,轉乘一次內,依出發時段估等車時間,走路與 YouBike 也算進去;也可以看騎車、開車大約多久。都是估計,出發前請再確認。",
  },
  {
    q: "租金和房價行情從哪裡來?",
    a: "內政部不動產租賃與買賣實價登錄。比較同一區、同建物型態、坪數相近的成交紀錄,看開價比行情高還低;買賣行情不含預售屋、親友等特殊交易與整批多棟的交易。",
  },
  {
    q: "淹水、治安資料準嗎?",
    a: "淹水潛勢來自經濟部水利署,土壤液化來自臺北市與臺南市政府,治安來自警察機關的統計。這些資料只看得出大概位置與趨勢,實際情形請以官方公告為準。",
  },
  {
    q: "我存的筆記別人看得到嗎?",
    a: "看不到,筆記只有你自己看得到。不存照片或檔案,原始刊登頁面只存網址;帳號可以隨時匯出或刪除。",
  },
];

function faqJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
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

/** 首屏插圖:公司 + 三層通勤圈 + 排名小卡(純 SVG / CSS) */
function HeroMap() {
  // 由外往內:半徑、顏色
  const rings: [number, string][] = [
    [34, "#a7f3d0"],
    [23, "#6ee7b7"],
    [12, "#34d399"],
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
        {/* 通勤圈:沿捷運線拉長,不是正圓 */}
        {rings.map(([r, c]) => (
          <path
            key={r}
            d={`M${44 - r * 1.2} ${33 + r * 0.1} C${44 - r} ${33 - r * 0.9} ${44 + r * 0.9} ${33 - r * 1.1} ${44 + r * 1.3} ${33 - r * 0.3} S${44 + r * 0.4} ${33 + r * 1.1} ${44 - r * 1.2} ${33 + r * 0.1} Z`}
            fill={c}
            fillOpacity={0.45}
            stroke="#059669"
            strokeOpacity={0.5}
            strokeWidth={0.4}
          />
        ))}
        {/* 捷運 */}
        <path d="M5 44 C30 40 40 36 52 30 S85 20 98 16" stroke="#0070bd" strokeWidth="1.6" fill="none" />
        <path d="M46 2 C48 20 40 40 46 74" stroke="#e3002c" strokeWidth="1.6" fill="none" />
        {[
          [5, 44],
          [24, 40.5],
          [52, 30],
          [78, 21],
          [47, 14],
          [43, 55],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.3" className="fill-white stroke-neutral-700" strokeWidth="0.5" />
        ))}
      </svg>
      {(
        [
          [20, 30, "20 分"],
          [70, 24, "35 分"],
          [84, 6, "50 分"],
        ] as const
      ).map(([x, y, t]) => (
        <span key={t} className="absolute rounded bg-white/80 px-1 text-[10px] font-medium text-emerald-800 dark:bg-neutral-900/80 dark:text-emerald-300" style={{ left: `${x}%`, top: `${y}%` }}>
          {t}
        </span>
      ))}
      <span className="absolute top-[44%] left-[44%] -translate-x-1/2 -translate-y-1/2 rounded bg-blue-700 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">公司</span>
      <div className="absolute right-3 bottom-3 left-3 rounded-xl border border-neutral-200 bg-white/95 p-3 text-xs shadow-lg sm:left-auto sm:w-64 dark:border-neutral-700 dark:bg-neutral-900/95">
        <p className="mb-1.5 font-semibold text-neutral-800 dark:text-neutral-100">適合你落腳的地方</p>
        {[
          ["1", "中和區", "18 分", "$16,500", "92"],
          ["2", "永和區", "21 分", "$17,800", "87"],
          ["3", "板橋區", "26 分", "$18,200", "81"],
        ].map(([n, d, m, r, sc]) => (
          <div key={n} className="flex items-center gap-2 border-t border-neutral-100 py-1 first-of-type:border-0 dark:border-neutral-800">
            <span className="w-3 text-neutral-400">{n}</span>
            <b className="flex-1">{d}</b>
            <span className="text-neutral-500">{m}</span>
            <span className="text-neutral-600 dark:text-neutral-400">{r}</span>
            <span className="rounded bg-emerald-50 px-1 font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{sc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
