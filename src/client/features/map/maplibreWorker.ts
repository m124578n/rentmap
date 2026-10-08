/**
 * maplibre-gl v6 的 web worker 預設從「自己所在的目錄」載 maplibre-gl-worker.mjs(再 import maplibre-gl-shared.mjs),
 * 但 Vite 建置時不會把這兩個檔複製出來;正式站找不到檔案就被 SPA 規則回成 index.html,worker 靜靜地失敗、地圖全白(2026-10-08 踩過)。
 * 這裡讓 Vite 把 worker 連同相依打包成一個檔(?worker&url),再告訴 maplibre 去那裡載。
 * 用到 maplibre 畫地圖的元件(MapView、PinMap)都先 import 這支。
 */
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);
