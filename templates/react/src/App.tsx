import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Footer, Header } from './components/Shell';
import { StoreProvider, useStore } from './store';
import { Home } from './routes/Home';
import { Category } from './routes/Category';
import { Product } from './routes/Product';
import { Cart } from './routes/Cart';
/* __ROUTE_IMPORT_CHECKOUT__ */
/* __ROUTE_IMPORT_ORDERS__ */

/**
 * Navigation is built from the store's own capabilities, not from a fixed list.
 *
 * A catalog-only store has no cart route to link to, and linking to one anyway
 * produces a page that can only fail. The CLI already omitted the routes the
 * store cannot serve; this keeps the header honest about the rest.
 */
function Shell() {
  const { client } = useStore();

  const nav = [
    { to: '/', label: 'Home' },
    { to: '/category', label: 'Shop' },
    ...(client.can('cart') ? [{ to: '/cart', label: 'Cart' }] : []),
    /* __NAV_ORDERS__ */
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <Header nav={nav} />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/category" element={<Category />} />
          <Route path="/category/:slug" element={<Category />} />
          <Route path="/product/:id" element={<Product />} />
          <Route path="/cart" element={<Cart />} />
          {/* __ROUTE_CHECKOUT__ */}
          {/* __ROUTE_ORDERS__ */}
          <Route
            path="*"
            element={
              <p className="mx-auto max-w-7xl px-4 py-20 text-center text-dt-fg-muted">
                That page does not exist.
              </p>
            }
          />
        </Routes>
      </main>
      <Footer nav={nav} />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </BrowserRouter>
  );
}
