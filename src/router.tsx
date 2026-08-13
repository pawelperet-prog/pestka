import { QueryClient } from "@tanstack/react-query";
import { createRouter, createHashHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = (queryClient: QueryClient) => {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createHashHistory(),
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });

  return router;
};
