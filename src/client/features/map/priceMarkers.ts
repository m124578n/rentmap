import * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { PropertySummary } from "@shared/schemas";
import { priceOf } from "@/features/listing/age";
import { priceShort } from "@shared/price";

/**
 * 房源價格標記 + 群集。
 * 標記仍是 HTML(顏色、收藏、必看金框、降價箭頭都照舊),但只把「沒被群集」的放上地圖:
 * 一個 cluster GeoJSON source 決定誰被群集,每次畫面變動用 querySourceFeatures 看目前畫面裡的群集 / 單點,
 * 群集畫成一顆「N 間 · 最低價」的泡泡,點了放大到展開。
 * 有收藏(找房狀態)的和選中的永遠單獨顯示、不進群集。
 */
const SRC = "props";
const PROBE = "props-probe";
/** 這個縮放以上不群集(街廓等級,重疊的也看得到) */
const CLUSTER_MAX_ZOOM = 15;

const NEUTRAL = "#6b7280";
const STAGE_COLOR: Record<string, string> = {
  saved: "#059669",
  contacted: "#d97706",
  scheduled: "#d97706",
  visited: "#2563eb",
  considering: "#2563eb",
  finalist: "#7c3aed",
  rejected: "#9ca3af",
  signed: "#111827",
};

export function priceLabel(rent: number | null) {
  return priceShort({ rent });
}

interface Entry {
  marker: maplibregl.Marker;
  el: HTMLButtonElement;
  on: boolean;
}

export class PriceMarkers {
  private map: maplibregl.Map;
  private markers = new Map<number, Entry>();
  private clusters = new Map<number, Entry>();
  private pinned = new Set<number>();
  private all = new Set<number>();
  private fc: FeatureCollection = { type: "FeatureCollection", features: [] };
  private selected: number | null = null;
  private queued = false;

  constructor(
    map: maplibregl.Map,
    private onSelect: (id: number) => void,
  ) {
    this.map = map;
    const kick = () => this.schedule();
    map.on("move", kick);
    map.on("moveend", kick);
    map.on("sourcedata", (e) => {
      if (e.sourceId === SRC) kick();
    });
  }

  /** style 載入 / 換主題後呼叫:source 不在就補上(setStyle 會把自訂 source 清掉) */
  attach() {
    const map = this.map;
    if (map.getSource(SRC)) return;
    map.addSource(SRC, {
      type: "geojson",
      data: this.fc,
      cluster: true,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
      clusterRadius: 48,
      clusterProperties: { min_rent: ["min", ["get", "rent"]] },
    });
    // 看不見的圖層:source 要有圖層用到才會載入,querySourceFeatures 才有東西
    map.addLayer({ id: PROBE, type: "circle", source: SRC, paint: { "circle-radius": 0, "circle-opacity": 0, "circle-stroke-width": 0 } });
    this.schedule();
  }

  /** 房源或上色方式變了:更新每個標記的外觀,重建 source */
  setItems(items: PropertySummary[], colorOf?: (p: PropertySummary) => string | undefined) {
    const seen = new Set<number>();
    this.pinned.clear();
    const features: FeatureCollection["features"] = [];
    for (const p of items) {
      if (p.lat == null || p.lng == null) continue;
      seen.add(p.id);
      let e = this.markers.get(p.id);
      if (!e) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "rh-marker";
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.onSelect(p.id);
        });
        e = { marker: new maplibregl.Marker({ element: el, anchor: "bottom" }), el, on: false };
        this.markers.set(p.id, e);
      }
      e.marker.setLngLat([p.lng, p.lat]);
      const color = colorOf?.(p) ?? (p.stage ? (STAGE_COLOR[p.stage] ?? NEUTRAL) : NEUTRAL);
      const drop = (priceOf(p)?.totalDelta ?? 0) < 0;
      e.el.textContent = (drop ? "↓" : "") + priceShort(p);
      e.el.classList.toggle("is-drop", drop);
      e.el.title = p.title;
      e.el.style.setProperty("--c", color);
      e.el.classList.toggle("is-rejected", p.stage === "rejected");
      e.el.classList.toggle("is-fav", !!p.stage);
      e.el.classList.toggle("is-top", (p.priority ?? 0) >= 3);
      if (p.stage && p.stage !== "rejected") this.pinned.add(p.id);
      else features.push({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { id: p.id, rent: p.rent ?? 1e9 } });
    }
    for (const [id, e] of this.markers)
      if (!seen.has(id)) {
        e.marker.remove();
        this.markers.delete(id);
      }
    this.all = seen;
    this.fc = { type: "FeatureCollection", features };
    (this.map.getSource(SRC) as maplibregl.GeoJSONSource | undefined)?.setData(this.fc);
    this.schedule();
  }

  setSelected(id: number | null) {
    this.selected = id;
    for (const [mid, e] of this.markers) e.el.classList.toggle("is-selected", mid === id);
    this.schedule();
  }

  /** 一個 frame 最多同步一次 */
  private schedule() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.sync();
    });
  }

  private sync() {
    const map = this.map;
    if (!map.getSource(SRC)) return;
    const show = new Set<number>(this.pinned);
    if (this.selected != null && this.all.has(this.selected)) show.add(this.selected);
    const clusters = new Map<number, { lng: number; lat: number; count: number; min: number }>();
    for (const f of map.querySourceFeatures(SRC)) {
      const pr = f.properties as { cluster?: boolean; cluster_id?: number; point_count?: number; min_rent?: number; id?: number };
      if (pr.cluster) {
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        clusters.set(pr.cluster_id!, { lng, lat, count: pr.point_count!, min: pr.min_rent! });
      } else if (pr.id != null) show.add(pr.id);
    }
    for (const [id, e] of this.markers) toggle(e, show.has(id), map);

    for (const [cid, c] of clusters) {
      let e = this.clusters.get(cid);
      if (!e) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "rh-cluster";
        el.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          const src = map.getSource(SRC) as maplibregl.GeoJSONSource;
          const zoom = await src.getClusterExpansionZoom(cid).catch(() => map.getZoom() + 1.5);
          map.easeTo({ center: e!.marker.getLngLat(), zoom: Math.min(zoom + 0.2, 17), duration: 400 });
        });
        e = { marker: new maplibregl.Marker({ element: el }), el, on: false };
        this.clusters.set(cid, e);
      }
      e.marker.setLngLat([c.lng, c.lat]);
      e.el.innerHTML = `<b>${c.count}</b><span>${c.min < 1e9 ? `${priceLabel(c.min)}起` : "間"}</span>`;
      e.el.title = `${c.count} 間,點一下放大`;
      e.el.style.setProperty("--s", `${Math.min(56, 34 + Math.log2(c.count) * 3)}px`);
      toggle(e, true, map);
    }
    for (const [cid, e] of this.clusters)
      if (!clusters.has(cid)) {
        e.marker.remove();
        this.clusters.delete(cid);
      }
  }
}

function toggle(e: Entry, on: boolean, map: maplibregl.Map) {
  if (on === e.on) return;
  if (on) e.marker.addTo(map);
  else e.marker.remove();
  e.on = on;
}
