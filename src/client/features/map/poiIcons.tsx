import {
  Bike,
  Church,
  Cross,
  Dumbbell,
  Factory,
  Flower2,
  Fuel,
  Hospital,
  Landmark,
  MoonStar,
  Pill,
  School,
  ShoppingBasket,
  ShoppingCart,
  Siren,
  Soup,
  Stethoscope,
  Store,
  Trash,
  Trees,
  Utensils,
  WashingMachine,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { PoiCat } from "@shared/poi";

/** 生活機能每一類的圖示(選單與地圖共用;道路、鐵道是線,治安點位另外畫,不在這裡) */
export const POI_ICON: Partial<Record<PoiCat, LucideIcon>> = {
  convenience: Store,
  supermarket: ShoppingCart,
  food: Utensils,
  ramen: Soup,
  garbage: Trash,
  market: ShoppingBasket,
  park: Trees,
  clinic: Stethoscope,
  pharmacy: Pill,
  hospital: Hospital,
  gym: Dumbbell,
  laundry: WashingMachine,
  bank: Landmark,
  school: School,
  worship: Church,
  police: Siren,
  youbike: Bike,
  fuel: Fuel,
  substation: Zap,
  funeral: Flower2,
  waste: Factory,
  cemetery: Cross,
  nightmarket: MoonStar,
};

/** 地圖上的圖示大小(CSS px);圖片畫兩倍給高解析螢幕 */
const SIZE = 24;

/**
 * lucide 圖示的向量節點 → SVG 字串(只要內層的 path / circle…)。
 * lucide-react 沒有公開節點資料,但每個圖示都是 forwardRef 元件,直接呼叫 render 會回 createElement(Icon, { icon }),
 * 從 props.icon.node 拿得到;不經過 React 渲染(在 effect 裡 flushSync 會失敗,圖示變成空的)。拿不到就回空字串(只剩色塊)。
 */
function iconSvgInner(Icon: LucideIcon): string {
  try {
    const el = (Icon as unknown as { render: (p: object, ref: null) => { props: { icon?: { node?: [string, Record<string, string>][] } } } }).render({}, null);
    const node = el.props.icon?.node ?? [];
    const esc = (v: string) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    return node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}/>`).join("");
  } catch {
    return "";
  }
}

function loadImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(SIZE * 2, SIZE * 2);
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

const cache = new Map<string, Promise<HTMLImageElement>>();

/** 一類的地圖圖示:彩色圓底 + 白色圖示 + 外框(暗色模式外框深色);同一組只畫一次 */
export function poiIconImage(cat: PoiCat, color: string, dark: boolean): Promise<HTMLImageElement> | null {
  const Icon = POI_ICON[cat];
  if (!Icon) return null;
  const key = `${cat}:${color}:${dark ? 1 : 0}`;
  let p = cache.get(key);
  if (!p) {
    const ring = dark ? "#0a0a0a" : "#ffffff";
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE * 2}" height="${SIZE * 2}" viewBox="0 0 48 48">` +
      `<circle cx="24" cy="24" r="21" fill="${color}" stroke="${ring}" stroke-width="3"/>` +
      `<g transform="translate(12 12)" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${iconSvgInner(Icon)}</g>` +
      `</svg>`;
    p = loadImage(svg);
    cache.set(key, p);
  }
  return p;
}
