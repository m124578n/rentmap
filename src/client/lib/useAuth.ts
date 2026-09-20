import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export function useAuth() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 60_000 });
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
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
    loading: q.isLoading,
    login,
    devLogin,
    logout: () => logout.mutate(),
  };
}
