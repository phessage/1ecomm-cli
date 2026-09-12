import { Link } from 'react-router-dom';
import type { Category } from '../lib/commerce';

/**
 * Category tiles.
 *
 * Written rather than reusing `dt-product-list`, because a category is not a
 * product. `DtProduct` requires a price, so routing categories through it
 * printed "$0" under every tile — a real price, for a thing that has none.
 *
 * dt-ui has no category component yet. When it gains one, this goes away.
 */
export function CategoryTiles({
  heading,
  categories,
}: {
  heading: string;
  categories: Category[];
}) {
  if (categories.length === 0) return null;

  return (
    <section className="py-12" data-testid="home-categories">
      <h2 className="text-lg font-semibold tracking-tight text-dt-fg">{heading}</h2>
      <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
        {categories.map((category) => (
          <li key={category.id}>
            <Link
              to={`/category/${category.slug || category.id}`}
              data-testid={`home-category-${category.slug}`}
              className="group block"
            >
              <div className="aspect-square overflow-hidden rounded-dt-card bg-dt-surface-sunken">
                {category.imageUrl ? (
                  <img
                    src={category.imageUrl}
                    alt={category.name}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : null}
              </div>
              <p className="mt-3 text-sm font-medium text-dt-fg">{category.name}</p>
              {category.description ? (
                <p className="mt-1 line-clamp-2 text-sm text-dt-fg-muted">{category.description}</p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
