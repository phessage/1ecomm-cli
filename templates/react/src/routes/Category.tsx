import { useParams } from 'react-router-dom';
import { DtProductList } from '@1ecomm/dt-ui-react';
import { useStore } from '../store';
import { useAsync } from '../lib/useAsync';
import { toDtProducts } from '../lib/adapt';
import { ErrorNote, PageHeading } from '../components/Shell';

/** Product listing, for the whole catalog or one category. */
export function Category() {
  const { slug } = useParams();
  const { client } = useStore();

  const categories = useAsync(() => client.listCategories(), [client]);
  const current =
    categories.status === 'ready' ? categories.value.find((c) => c.slug === slug) : undefined;

  // The listing is keyed on the resolved category ID rather than the slug,
  // because the API filters by ID. Asking before categories resolve would send
  // `categoryId=undefined` and quietly return the whole catalog.
  const products = useAsync(
    () =>
      slug && !current && categories.status !== 'ready'
        ? Promise.resolve([])
        : client.listProducts({ limit: 24, ...(current ? { categoryId: current.id } : {}) }),
    [client, current?.id, categories.status, slug],
  );

  return (
    <>
      <PageHeading
        title={current?.name ?? 'Everything'}
        {...(current?.description ? { lede: current.description } : {})}
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {categories.status === 'ready' && categories.value.length > 0 ? (
          <nav className="flex flex-wrap gap-2 pt-6" aria-label="Categories">
            <a
              href="/category"
              data-testid="plp-filter-all"
              className={[
                'rounded-dt-control border px-3 py-1.5 text-sm',
                slug ? 'border-dt-border text-dt-fg-muted' : 'border-dt-accent text-dt-accent',
              ].join(' ')}
            >
              All
            </a>
            {categories.value.map((category) => (
              <a
                key={category.id}
                href={`/category/${category.slug}`}
                data-testid={`plp-filter-${category.slug}`}
                className={[
                  'rounded-dt-control border px-3 py-1.5 text-sm',
                  category.slug === slug
                    ? 'border-dt-accent text-dt-accent'
                    : 'border-dt-border text-dt-fg-muted hover:text-dt-fg',
                ].join(' ')}
              >
                {category.name}
              </a>
            ))}
          </nav>
        ) : null}

        {products.status === 'failed' ? (
          <ErrorNote error={products.error} onRetry={products.reload} />
        ) : null}
        {products.status === 'loading' ? (
          <p className="py-16 text-center text-sm text-dt-fg-muted">Loading products…</p>
        ) : null}
        {products.status === 'ready' && products.value.length === 0 ? (
          <p className="py-16 text-center text-sm text-dt-fg-muted" data-testid="plp-empty">
            Nothing here yet.
          </p>
        ) : null}
        {products.status === 'ready' && products.value.length > 0 ? (
          <div data-testid="plp-products">
            <DtProductList template="simple" products={toDtProducts(products.value)} />
          </div>
        ) : null}
      </div>
    </>
  );
}
