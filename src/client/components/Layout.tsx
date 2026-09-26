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
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <Home size={18} /> 租屋筆記
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          {user && (
            <>
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
            </>
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
    </div>
  );
}
