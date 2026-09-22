import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { MapPage } from "./routes/MapPage";
import { ListPage } from "./routes/ListPage";
import { NewPage } from "./routes/NewPage";
import { DetailPage } from "./routes/DetailPage";
import { BoardPage } from "./routes/BoardPage";

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: MapPage });
const listRoute = createRoute({ getParentRoute: () => rootRoute, path: "/list", component: ListPage });
const boardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/board", component: BoardPage });
const newRoute = createRoute({ getParentRoute: () => rootRoute, path: "/new", component: NewPage });
const detailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/p/$id", component: DetailPage });

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, listRoute, boardRoute, newRoute, detailRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
