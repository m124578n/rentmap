import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
import { Layout } from "./components/Layout";

// 每一頁各自一個檔:地圖引擎(maplibre,約一半的 JS)只有地圖頁才載
const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: lazyRouteComponent(() => import("./routes/MapPage"), "MapPage") });
const listRoute = createRoute({ getParentRoute: () => rootRoute, path: "/list", component: lazyRouteComponent(() => import("./routes/ListPage"), "ListPage") });
const boardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/board", component: lazyRouteComponent(() => import("./routes/BoardPage"), "BoardPage") });
const newRoute = createRoute({ getParentRoute: () => rootRoute, path: "/new", component: lazyRouteComponent(() => import("./routes/NewPage"), "NewPage") });
const compareRoute = createRoute({ getParentRoute: () => rootRoute, path: "/compare", component: lazyRouteComponent(() => import("./routes/ComparePage"), "ComparePage") });
const tourRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tour", component: lazyRouteComponent(() => import("./routes/TourPage"), "TourPage") });
const statusRoute = createRoute({ getParentRoute: () => rootRoute, path: "/status", component: lazyRouteComponent(() => import("./routes/StatusPage"), "StatusPage") });
const aboutRoute = createRoute({ getParentRoute: () => rootRoute, path: "/about", component: lazyRouteComponent(() => import("./routes/AboutPage"), "AboutPage") });
const accountRoute = createRoute({ getParentRoute: () => rootRoute, path: "/account", component: lazyRouteComponent(() => import("./routes/AccountPage"), "AccountPage") });
const legalRoute = createRoute({ getParentRoute: () => rootRoute, path: "/legal/$doc", component: lazyRouteComponent(() => import("./routes/LegalPage"), "LegalPage") });
const detailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/p/$id", component: lazyRouteComponent(() => import("./routes/DetailPage"), "DetailPage") });

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, listRoute, boardRoute, newRoute, compareRoute, tourRoute, statusRoute, aboutRoute, accountRoute, legalRoute, detailRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
