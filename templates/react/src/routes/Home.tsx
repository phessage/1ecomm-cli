import { useNavigate } from 'react-router-dom';
import { DtProductList, DtIncentives, DtFaq, DtNewsletter } from '@1ecomm/dt-ui-react';
import { useStore } from '../store';
import { useAsync } from '../lib/useAsync';
import { toDtProducts } from '../lib/adapt';
import { ErrorNote, STORE_NAME } from '../components/Shell';
import { CategoryTiles } from '../components/CategoryTiles';

/**
 * The hero.
 *
 * dt-ui has no hero component, so this is project code — which is the right
 * place for it anyway, since the hero is the first thing a merchant rewrites.
 * It uses only dt- tokens, so it follows the chosen palette and light/dark mode
 * without knowing which they are.
 */
function Hero() {
  const navigate = useNavigate();
  return (
    <section className="border-b border-dt-border bg-dt-surface-sunken">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <p className="text-sm font-medium text-dt-accent">New season</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-dt-fg sm:text-5xl">
          {STORE_NAME}
        </h1>
        <p className="mt-4 max-w-xl text-base text-dt-fg-muted">
          Everything here is served live by 1Ecomm — real catalog, real stock, real prices.
        </p>
        <button
          type="button"
          data-testid="hero-shop-cta"
          onClick={() => navigate('/category')}
          className="mt-8 rounded-dt-control bg-dt-accent px-5 py-3 text-sm font-medium text-dt-fg-inverse hover:bg-dt-accent-hover"
        >
          Shop everything
        </button>
      </div>
    </section>
  );
}

export function Home() {
  const { client, addToCart } = useStore();
  const navigate = useNavigate();

  const products = useAsync(() => client.listProducts({ limit: 8 }), [client]);
  const categories = useAsync(() => client.listCategories(), [client]);

  return (
    <>
      <Hero />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {categories.status === 'ready' ? (
          <CategoryTiles heading="Shop by category" categories={categories.value.slice(0, 4)} />
        ) : null}

        {products.status === 'failed' ? (
          <ErrorNote error={products.error} onRetry={products.reload} />
        ) : null}

        {products.status === 'loading' ? (
          <p className="py-16 text-center text-sm text-dt-fg-muted">Loading products…</p>
        ) : null}

        {products.status === 'ready' ? (
          products.value.length === 0 ? (
            <p className="py-16 text-center text-sm text-dt-fg-muted" data-testid="home-empty">
              This store has no published products yet.
            </p>
          ) : (
            <div data-testid="home-products">
              <DtProductList
                template="inline-price-and-cta-link"
                heading="Latest"
                products={toDtProducts(products.value)}
                viewAll={{ label: 'View all', href: '/category' }}
                addToCartLabel="Add to bag"
                onAddToCart={(product) => {
                  // A card's quick-add cannot choose a variant, so it opens the
                  // product page where the choice lives. Posting a bare
                  // productId for a product that HAS variants is rejected with
                  // HTTP 400, and a button that always fails is worse than a
                  // button that navigates.
                  void addToCart;
                  navigate(product.href);
                }}
              />
            </div>
          )
        ) : null}

        <DtIncentives
          template="icons"
          heading="Why shop with us"
          incentives={[
            { name: 'Free delivery', description: 'On every order, no minimum.', icon: '24/outline/truck' },
            { name: 'Secure checkout', description: 'Payments handled by 1Ecomm.', icon: '24/outline/shield-check' },
            { name: 'Easy returns', description: 'Thirty days, no questions.', icon: '24/outline/receipt-refund' },
          ]}
        />

        <DtFaq
          template="centered-accordion"
          heading="Questions"
          faqs={[
            {
              question: 'How long does delivery take?',
              answer: 'Orders are dispatched within one working day and usually arrive in three to five.',
            },
            {
              question: 'Can I change my order?',
              answer: 'Contact us before it ships and we will amend it where we can.',
            },
          ]}
        />

        <DtNewsletter
          template="side-by-side"
          heading="Stay in touch"
          description="Occasional emails about new arrivals. No noise."
        />
      </div>
    </>
  );
}
