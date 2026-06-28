import { QueryClient } from "@tanstack/react-query";
import { createRouter, createHashHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  // Hash history -> działa pod file:// (Capacitor APK) i pod zwykłym HTTP/S
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createHashHistory(),
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });

  return router;
};
