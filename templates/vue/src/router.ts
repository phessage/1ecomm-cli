import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import Home from './routes/Home.vue';
import Category from './routes/Category.vue';
import Product from './routes/Product.vue';
import Cart from './routes/Cart.vue';
import NotFound from './routes/NotFound.vue';
/* __ROUTE_IMPORT_CHECKOUT__ */
/* __ROUTE_IMPORT_ORDERS__ */

/**
 * Routes the store can actually serve.
 *
 * The CLI omitted the route files a store's capabilities do not permit, so the
 * markers below resolve to nothing for those. A catalog-only store gets no
 * checkout route rather than one that is reachable and always fails.
 */
const routes: RouteRecordRaw[] = [
  { path: '/', component: Home },
  { path: '/category', component: Category },
  { path: '/category/:slug', component: Category },
  { path: '/product/:id', component: Product },
  { path: '/cart', component: Cart },
  /* __ROUTE_CHECKOUT__ */
  /* __ROUTE_ORDERS__ */
  // Anything else, including a route the store's capabilities kept out of this
  // list. Without this a shopper reaching /orders on a store that cannot place
  // orders gets a blank frame rather than an answer.
  { path: '/:pathMatch(.*)*', component: NotFound },
];

export const router = createRouter({ history: createWebHistory(), routes });
