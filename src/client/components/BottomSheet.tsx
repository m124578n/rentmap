import { useEffect, useRef, useState, type ReactNode } from "react";

export type Snap = "peek" | "half" | "full";

const PEEK_PX = 148;

/** 各段高度(px),以父容器高度算 */
export function snapHeight(snap: Snap, parentH: number) {
  if (snap === "peek") return Math.min(PEEK_PX, parentH);
  if (snap === "half") return Math.round(parentH * 0.55);
  return Math.max(PEEK_PX, parentH - 8);
}

/**
 * 手機的底部抽屜:拖上方把手在「露一點 / 一半 / 全開」三段間切換(放開時吸到最近的一段)。
 * 內容自己捲動;高度變化用 onHeight 回報,地圖拿去當底部留白。
 */
export function BottomSheet({ snap, onSnap, onHeight, children }: { snap: Snap; onSnap: (s: Snap) => void; onHeight?: (px: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [parentH, setParentH] = useState(600);
  const [drag, setDrag] = useState<{ startY: number; startH: number; h: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => setParentH(parent.clientHeight));
    ro.observe(parent);
    setParentH(parent.clientHeight);
    return () => ro.disconnect();
  }, []);

  const h = drag ? drag.h : snapHeight(snap, parentH);
  useEffect(() => {
    if (!drag) onHeight?.(h);
  }, [h, drag, onHeight]);

  const end = () => {
    if (!drag) return;
    const snaps: Snap[] = ["peek", "half", "full"];
    const nearest = snaps.reduce((a, b) => (Math.abs(snapHeight(a, parentH) - drag.h) <= Math.abs(snapHeight(b, parentH) - drag.h) ? a : b));
    setDrag(null);
    if (moved.current) onSnap(nearest);
  };

  return (
    <div
      ref={ref}
      className={`absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-2xl border-t border-neutral-200 bg-white shadow-[0_-4px_16px_rgb(0_0_0/0.12)] dark:border-neutral-800 dark:bg-neutral-900 ${drag ? "" : "transition-[height] duration-200"}`}
      style={{ height: h }}
    >
      <div
        className="flex shrink-0 cursor-grab touch-none justify-center py-2"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          moved.current = false;
          setDrag({ startY: e.clientY, startH: h, h });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          if (Math.abs(drag.startY - e.clientY) > 5) moved.current = true;
          const next = Math.min(parentH - 8, Math.max(80, drag.startH + (drag.startY - e.clientY)));
          setDrag({ ...drag, h: next });
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onClick={() => {
          // 點把手:露一點 ↔ 一半
          if (!moved.current) onSnap(snap === "peek" ? "half" : "peek");
        }}
        role="button"
        aria-label="拖曳調整面板高度"
      >
        <span className="h-1.5 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">{children}</div>
    </div>
  );
}
