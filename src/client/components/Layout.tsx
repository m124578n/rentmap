import { Link, Outlet } from "@tanstack/react-router";
import { Home, LogOut, Plus } from "lucide-react";
import { useAuth } from "@/lib/useAuth";

/** 外框:頂欄 + 登入門檻。沒登入只看得到登入鈕。 */
export function Layout() {
  const { user, enabled, dev, loading, login, devLogin, logout } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const loginErr = params.get("login");

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <Home size={18} /> 租屋筆記
        </Link>
        <nav className="flex items-center gap-2">
          {user && (
            <Link to="/new" className="btn-primary">
              <Plus size={16} /> 新增房源
            </Link>
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
                {enabled ? "Google 登入" : "尚未設定登入"}
              </button>
            ))
          )}
        </nav>
      </header>
      <main className="flex-1 px-4 py-4">
        {loginErr === "denied" && <p className="card mb-4 border-red-300 text-red-700">這個 Google 帳號不在白名單裡。</p>}
        {loginErr === "failed" && <p className="card mb-4 border-red-300 text-red-700">登入失敗,再試一次。</p>}
        {loading ? (
          <p className="text-neutral-500">載入中…</p>
        ) : user ? (
          <Outlet />
        ) : (
          <div className="card text-center">
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
