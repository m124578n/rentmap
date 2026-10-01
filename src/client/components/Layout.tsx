import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ConsentGate } from "@/features/legal/ConsentGate";
import { useEffect, useState } from "react";
import { FRESH_EVENT, STALE_EVENT } from "@/lib/api";
import { UserCog, Columns3, Database, Home, Info, Kanban, List, LogOut, Map, MapPin, Menu, Moon, Plus, Route, SlidersHorizontal, Sun } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { useTheme } from "@/lib/useTheme";
import { openPlacesDialog } from "@/features/places/places";
import { PlacesDialogHost } from "@/features/places/PlacesDialog";
import { CompareBar } from "@/features/compare/compare";
import { openRequirementsDialog } from "@/features/fit/fit";
import { RequirementsDialogHost } from "@/features/fit/RequirementsDialog";
import { AboutPage } from "@/routes/AboutPage";
import { LegalLinks } from "@/features/legal/LegalLinks";

/** index.html 裡預先產生的介紹頁有留在畫面上(scripts/prerender.mjs 的行內 script 設的) */
/** localStorage 的 key,跟 scripts/prerender.mjs 的行內 script 同一個名字 */
const SIGNED_IN_HINT = "loka_in";
const prerendered = (window as { __PRERENDERED__?: boolean }).__PRERENDERED__ === true;

/** 外框:頂欄 + 登入門檻。沒登入只看得到登入鈕。 */
export function Layout() {
  const { user, enabled, dev, loading, login, devLogin, logout, consentNeeded } = useAuth();
  // 條款頁沒登入也要看得到(同意畫面的連結、搜尋引擎)
  const legal = useRouterState({ select: (s) => s.location.pathname.startsWith("/legal/") });
  const { theme, toggle } = useTheme();
  const params = new URLSearchParams(window.location.search);
  const loginErr = params.get("login");
  // 「登入過」的旗標(localStorage,不是 session;隱私權政策只說用 session cookie,所以不用 cookie):
  // 有它的話 index.html 一開始就把預先產生的介紹頁清掉,登入的人不會先閃一下介紹頁
  useEffect(() => {
    if (loading) return;
    try {
      if (user) localStorage.setItem(SIGNED_IN_HINT, "1");
      else localStorage.removeItem(SIGNED_IN_HINT);
    } catch {
      // 無痕 / 封鎖儲存:頂多閃一下介紹頁
    }
  }, [user, loading]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 sm:px-4 sm:py-3 dark:border-neutral-800">
        <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold whitespace-nowrap">
          <Home size={18} /> 落腳筆記
          <span className="hidden text-xs font-normal text-neutral-400 sm:inline">Loka Note</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          {/* 手機:導覽在底部分頁列,頂欄只留主題與登出 */}
          {user && (
            <div className="hidden items-center gap-2 sm:flex">
              <Link to="/" className="btn-ghost" activeProps={{ className: "btn-ghost bg-neutral-100 dark:bg-neutral-800" }} activeOptions={{ exact: true }}>
                <Map size={16} /> <span className="hidden sm:inline">地圖</span>
              </Link>
              <Link to="/list" className="btn-ghost" activeProps={{ className: "btn-ghost bg-neutral-100 dark:bg-neutral-800" }}>
                <List size={16} /> <span className="hidden sm:inline">列表</span>
              </Link>
              <Link to="/board" className="btn-ghost" activeProps={{ className: "btn-ghost bg-neutral-100 dark:bg-neutral-800" }}>
                <Kanban size={16} /> <span className="hidden sm:inline">看板</span>
              </Link>
              <button onClick={openPlacesDialog} className="btn-ghost" title="我的地點(公司…)">
                <MapPin size={16} /> <span className="hidden sm:inline">我的地點</span>
              </button>
              <button onClick={openRequirementsDialog} className="btn-ghost" title="預算、坪數、通勤上限、必要設備…">
                <SlidersHorizontal size={16} /> <span className="hidden sm:inline">我的需求</span>
              </button>
              <Link to="/new" className="btn-primary">
                <Plus size={16} /> <span className="hidden sm:inline">新增</span>
              </Link>
            </div>
          )}
          {/* .btn-ghost 不在 Tailwind 的 layer 裡,會蓋過 hidden,所以手機隱藏要包一層 */}
          {user && (
            <span className="hidden sm:contents">
              <Link to="/status" className="btn-ghost" title="資料狀態(各份資料何時更新、要不要重跑)" activeProps={{ className: "btn-ghost bg-neutral-100 dark:bg-neutral-800" }}>
                <Database size={16} />
              </Link>
            </span>
          )}
          <span className={user ? "hidden sm:contents" : "contents"}>
            <button onClick={toggle} className="btn-ghost" aria-label="切換主題">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </span>
          {user && (
            <span className="hidden sm:contents">
              <Link to="/account" className="btn-ghost" aria-label="帳號" title="帳號(匯出 / 刪除)">
                <UserCog size={16} />
              </Link>
            </span>
          )}
          {user ? (
            <button onClick={logout} className="btn-ghost" title={user.name ?? ""}>
              {user.avatar && <img src={user.avatar} alt="" className="h-5 w-5 rounded-full" />}
              <LogOut size={16} />
            </button>
          ) : (
            !loading &&
            (dev ? (
              <button onClick={devLogin} className="btn-primary">
                本機登入
              </button>
            ) : (
              <button onClick={login} className="btn-primary" disabled={!enabled}>
                {enabled || loading ? "Google 登入" : "尚未設定登入"}
              </button>
            ))
          )}
        </nav>
      </header>
      <OfflineBanner />
      <main className="min-h-0 flex-1 overflow-auto">
        {loginErr === "denied" && <p className="card m-4 border-red-300 text-red-700">這個 Google 帳號不在白名單裡。</p>}
        {loginErr === "failed" && <p className="card m-4 border-red-300 text-red-700">登入失敗,再試一次。</p>}
        {legal ? (
          <Outlet />
        ) : loading ? (
          // 預先產生的介紹頁(scripts/prerender.mjs)還在畫面上時,等 /api/me 的這段先照畫介紹頁,不要閃「載入中」
          prerendered ? <AboutPage /> : <p className="p-4 text-neutral-500">載入中…</p>
        ) : user && consentNeeded.length > 0 ? (
          <ConsentGate needed={consentNeeded} onLogout={logout} />
        ) : user ? (
          <>
            <Outlet />
            <PlacesDialogHost />
            <RequirementsDialogHost />
            <CompareBar />
          </>
        ) : (
          // 沒登入:任何網址都看介紹頁(也是搜尋引擎看到的那頁)
          <AboutPage />
        )}
      </main>
      {user && <TabBar />}
    </div>
  );
}

/** 手機底部分頁列(sm 以上隱藏,導覽在頂欄):常用四個 + 「更多」 */
function TabBar() {
  const [more, setMore] = useState(false);
  const tab = "flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] text-neutral-500";
  const active = { className: `${tab} text-emerald-700 dark:text-emerald-400` };
  return (
    <>
      <nav className="flex border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden dark:border-neutral-800 dark:bg-neutral-900">
        <Link to="/" className={tab} activeProps={active} activeOptions={{ exact: true }}>
          <Map size={20} /> 地圖
        </Link>
        <Link to="/list" className={tab} activeProps={active}>
          <List size={20} /> 列表
        </Link>
        <Link to="/board" className={tab} activeProps={active}>
          <Kanban size={20} /> 看板
        </Link>
        <Link to="/new" className={tab} activeProps={active}>
          <Plus size={20} /> 新增
        </Link>
        <button onClick={() => setMore(true)} className={tab} aria-haspopup="dialog">
          <Menu size={20} /> 更多
        </button>
      </nav>
      {more && <MoreSheet onClose={() => setMore(false)} />}
    </>
  );
}

/** 手機「更多」:不常用但要找得到的入口 */
function MoreSheet({ onClose }: { onClose: () => void }) {
  const { theme, toggle } = useTheme();
  const row = "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-neutral-100 active:bg-neutral-100 dark:hover:bg-neutral-800 dark:active:bg-neutral-800";
  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:hidden" onClick={onClose}>
      <div
        role="dialog"
        aria-label="更多"
        className="w-full rounded-t-2xl bg-white p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" />
        <button className={row} onClick={go(openPlacesDialog)}>
          <MapPin size={18} /> 我的地點
          <span className="ml-auto text-xs text-neutral-400">公司、家人住處</span>
        </button>
        <button className={row} onClick={go(openRequirementsDialog)}>
          <SlidersHorizontal size={18} /> 我的需求
          <span className="ml-auto text-xs text-neutral-400">預算、通勤、設備</span>
        </button>
        <Link to="/tour" className={row} onClick={onClose}>
          <Route size={18} /> 看房路線
        </Link>
        <Link to="/compare" className={row} onClick={onClose}>
          <Columns3 size={18} /> 比較表
        </Link>
        <Link to="/status" className={row} onClick={onClose}>
          <Database size={18} /> 資料狀態
        </Link>
        <Link to="/about" className={row} onClick={onClose}>
          <Info size={18} /> 介紹
        </Link>
        <Link to="/account" className={row} onClick={onClose}>
          <UserCog size={18} /> 帳號(匯出 / 刪除)
        </Link>
        <button className={row} onClick={toggle}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />} {theme === "dark" ? "淺色模式" : "深色模式"}
        </button>
        <LegalLinks className="px-3 pt-2" />
      </div>
    </div>
  );
}

/** 斷線或 Service Worker 回的是上次的快取時,頂欄下面一條提示 */
function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    const st = () => setStale(true);
    const fr = () => setStale(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener(STALE_EVENT, st);
    window.addEventListener(FRESH_EVENT, fr);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener(STALE_EVENT, st);
      window.removeEventListener(FRESH_EVENT, fr);
    };
  }, []);
  if (!offline && !stale) return null;
  return (
    <p role="status" className="bg-amber-100 px-3 py-1 text-center text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
      {offline ? "離線中" : "網路很慢"},顯示的是上次的資料;新增、收藏等變更要等連線恢復。
    </p>
  );
}
