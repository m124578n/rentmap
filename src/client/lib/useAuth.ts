import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

/** 只要私人模式旗標(不需要登入動作的元件用) */
export function usePrivatePool() {
  const q = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 60_000 });
  return q.data?.private_pool ?? false;
}

export function useAuth() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 60_000 });
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      // 離線快取裡的個人資料一起清掉(public/sw.js)
      navigator.serviceWorker?.controller?.postMessage({ type: "logout" });
      qc.clear();
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const returnTo = () => encodeURIComponent(window.location.pathname + window.location.search);
  const login = () => {
    window.location.href = `/api/auth/google?return_to=${returnTo()}`;
  };
  /** 本機開發免 Google(.dev.vars 有 DEV_USER_EMAIL 才會出現) */
  const devLogin = () => {
    window.location.href = `/api/auth/dev?return_to=${returnTo()}`;
  };
  return {
    user: q.data?.user ?? null,
    enabled: q.data?.enabled ?? false,
    dev: q.data?.dev ?? false,
    /** 私人模式(本機):共用房源池、照片、聯絡人、刊登天數、開價圖層;公開版沒有(src/worker/pool.ts) */
    privatePool: q.data?.private_pool ?? false,
    /** 還沒同意的條款(非空就先擋同意畫面) */
    consentNeeded: q.data?.consent_needed ?? [],
    loading: q.isLoading,
    login,
    devLogin,
    logout: () => logout.mutate(),
  };
}
