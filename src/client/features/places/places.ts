import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlaceUpdate } from "@shared/schemas";
import { api } from "@/lib/api";

/** 我的地點(公司、爸媽家…) */
export function usePlaces() {
  return useQuery({ queryKey: ["places"], queryFn: api.listPlaces, staleTime: 5 * 60_000 });
}

export function usePlaceMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["places"] });
  return {
    create: useMutation({ mutationFn: api.createPlace, onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...input }: PlaceUpdate & { id: number }) => api.updatePlace(id, input), onSuccess: done }),
    remove: useMutation({ mutationFn: api.deletePlace, onSuccess: done }),
  };
}

// 目前的通勤目的地:只是這台瀏覽器的偏好,放 localStorage(讀不到就當沒選)
const KEY = "rentmap.commuteTo";
const EVT = "rentmap:commute-to";

function read(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setCommuteTarget(id: number | null) {
  try {
    if (id == null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(id));
  } catch {
    /* 私密模式之類,忽略 */
  }
  window.dispatchEvent(new Event(EVT));
}

export function useCommuteTarget(): [number | null, (id: number | null) => void] {
  const [id, setId] = useState(read);
  useEffect(() => {
    const on = () => setId(read());
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  return [id, setCommuteTarget];
}

// 「我的地點」對話框:任何地方都能叫出來(公車區塊、頂欄、地圖上的地點標記),Layout 裡放一個 PlacesDialogHost
const OPEN_EVT = "rentmap:places-dialog";
export function openPlacesDialog() {
  window.dispatchEvent(new Event(OPEN_EVT));
}
export function usePlacesDialogOpen(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_EVT, on);
    return () => window.removeEventListener(OPEN_EVT, on);
  }, []);
  return [open, setOpen];
}
