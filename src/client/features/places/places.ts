import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlaceUpdate } from "@shared/schemas";
import { api } from "@/lib/api";
import { usePlan } from "@/lib/plan";

/** 我的地點(公司、爸媽家…) */
export function usePlaces() {
  return useQuery({ queryKey: ["places"], queryFn: api.listPlaces, staleTime: 5 * 60_000 });
}

/**
 * 通勤算得到的地點:方案內最早建的 N 個(伺服器也只算這幾個,見 routes/commute.ts 的 maxPlaces)。
 * 降回免費後多的地點還留著、清單看得到,但通勤不算它;前端也要用同一份,不然篩選、上色會把每間都當成「搭不到」。
 */
export function useCommutePlaces() {
  const q = usePlaces();
  const max = usePlan().ent.places;
  const items = q.data ? [...q.data.items].sort((a, b) => a.id - b.id).slice(0, max) : undefined;
  return { ...q, data: items ? { ...q.data!, items } : undefined, hidden: q.data ? q.data.items.length - (items?.length ?? 0) : 0 };
}

export function usePlaceMutations() {
  const qc = useQueryClient();
  // 面板的機車 / 開車(drive-at)的 key 沒有地點,要一起清
  const done = () => {
    qc.invalidateQueries({ queryKey: ["places"] });
    qc.invalidateQueries({ queryKey: ["drive-at"] });
  };
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
