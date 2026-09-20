import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { ListPage } from "./routes/ListPage";
import { NewPage } from "./routes/NewPage";
import { DetailPage } from "./routes/DetailPage";

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: ListPage });
const newRoute = createRoute({ getParentRoute: () => rootRoute, path: "/new", component: NewPage });
const detailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/p/$id", component: DetailPage });

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, newRoute, detailRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
