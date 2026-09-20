import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export function useAuth() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 60_000 });
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  const login = () => {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/api/auth/google?return_to=${returnTo}`;
  };
  return { user: q.data?.user ?? null, enabled: q.data?.enabled ?? false, loading: q.isLoading, login, logout: () => logout.mutate() };
}
