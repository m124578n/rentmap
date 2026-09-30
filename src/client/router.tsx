import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { MapPage } from "./routes/MapPage";
import { ListPage } from "./routes/ListPage";
import { NewPage } from "./routes/NewPage";
import { DetailPage } from "./routes/DetailPage";
import { BoardPage } from "./routes/BoardPage";
import { ComparePage } from "./routes/ComparePage";
import { TourPage } from "./routes/TourPage";
import { StatusPage } from "./routes/StatusPage";
import { AboutPage } from "./routes/AboutPage";

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: MapPage });
const listRoute = createRoute({ getParentRoute: () => rootRoute, path: "/list", component: ListPage });
const boardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/board", component: BoardPage });
const newRoute = createRoute({ getParentRoute: () => rootRoute, path: "/new", component: NewPage });
const compareRoute = createRoute({ getParentRoute: () => rootRoute, path: "/compare", component: ComparePage });
const tourRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tour", component: TourPage });
const statusRoute = createRoute({ getParentRoute: () => rootRoute, path: "/status", component: StatusPage });
const aboutRoute = createRoute({ getParentRoute: () => rootRoute, path: "/about", component: AboutPage });
const detailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/p/$id", component: DetailPage });

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, listRoute, boardRoute, newRoute, compareRoute, tourRoute, statusRoute, aboutRoute, detailRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
