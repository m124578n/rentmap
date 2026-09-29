import { Link, Outlet } from "@tanstack/react-router";
import { Home, Kanban, List, LogOut, Map, MapPin, Moon, Plus, Sun } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { useTheme } from "@/lib/useTheme";
import { openPlacesDialog } from "@/features/places/places";
import { PlacesDialogHost } from "@/features/places/PlacesDialog";

/** 外框:頂欄 + 登入門檻。沒登入只看得到登入鈕。 */
export function Layout() {
  const { user, enabled, dev, loading, login, devLogin, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const params = new URLSearchParams(window.location.search);
  const loginErr = params.get("login");

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 sm:px-4 sm:py-3 dark:border-neutral-800">
        <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold whitespace-nowrap">
          <Home size={18} /> 租屋筆記
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
              <Link to="/new" className="btn-primary">
                <Plus size={16} /> <span className="hidden sm:inline">新增</span>
              </Link>
            </div>
          )}
          <button onClick={toggle} className="btn-ghost" aria-label="切換主題">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
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
                {enabled ? "Google 登入" : "尚未設定登入"}
              </button>
            ))
          )}
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        {loginErr === "denied" && <p className="card m-4 border-red-300 text-red-700">這個 Google 帳號不在白名單裡。</p>}
        {loginErr === "failed" && <p className="card m-4 border-red-300 text-red-700">登入失敗,再試一次。</p>}
        {loading ? (
          <p className="p-4 text-neutral-500">載入中…</p>
        ) : user ? (
          <>
            <Outlet />
            <PlacesDialogHost />
          </>
        ) : (
          <div className="card m-4 text-center">
            <p className="mb-3">先登入才看得到你的房源。</p>
            {dev ? (
              <button onClick={devLogin} className="btn-primary">
                本機登入
              </button>
            ) : (
              <button onClick={login} className="btn-primary" disabled={!enabled}>
                Google 登入
              </button>
            )}
          </div>
        )}
      </main>
      {user && <TabBar />}
    </div>
  );
}

/** 手機底部分頁列(sm 以上隱藏,導覽在頂欄) */
function TabBar() {
  const tab = "flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] text-neutral-500";
  const active = { className: `${tab} text-emerald-700 dark:text-emerald-400` };
  return (
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
      <button onClick={openPlacesDialog} className={tab}>
        <MapPin size={20} /> 我的地點
      </button>
      <Link to="/new" className={tab} activeProps={active}>
        <Plus size={20} /> 新增
      </Link>
    </nav>
  );
}
