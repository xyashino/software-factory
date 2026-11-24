import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router';
import { AppShell } from './shell';

const rootRoute = createRootRoute({ component: AppShell });

const workOrdersIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(
    () => import('@/modules/work-orders/presentation/main'),
    'Main',
  ),
});

const workOrdersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/work-orders',
  component: lazyRouteComponent(
    () => import('@/modules/work-orders/presentation/main'),
    'Main',
  ),
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([workOrdersIndexRoute, workOrdersRoute]),
  scrollRestoration: true,
});
