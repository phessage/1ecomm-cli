/**
 * Header, footer and the page frame.
 *
 * dt-ui has no header or footer component yet, so these are composed here from
 * its primitives and its semantic tokens. That is deliberate rather than a
 * shortfall: the shell is the part every merchant rebrands first, so it lives in
 * the project as ordinary editable code. It uses only `dt-` tokens, so it
 * repalettes with everything else.
 */
import { Link, NavLink } from 'react-router-dom';
import { DtIcon } from '@1ecomm/dt-ui-react';
import { useStore } from '../store';

/** The shop's name. Change it here; nothing else reads it. */
export const STORE_NAME = '__PROJECT_TITLE__';

interface NavItem {
  to: string;
  label: string;
}

export function Header({ nav }: { nav: NavItem[] }) {
  const { cartCount } = useStore();

  return (
    <header className="sticky top-0 z-20 border-b border-dt-border bg-dt-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="text-base font-semibold tracking-tight text-dt-fg"
          data-testid="header-home-link"
        >
          {STORE_NAME}
        </Link>

        <nav className="hidden flex-1 items-center gap-6 md:flex" aria-label="Main">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              data-testid={`header-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              className={({ isActive }) =>
                [
                  'text-sm transition-colors',
                  isActive ? 'text-dt-accent font-medium' : 'text-dt-fg-muted hover:text-dt-fg',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/cart"
            data-testid="header-cart-link"
            className="relative inline-flex items-center gap-2 rounded-dt-control px-3 py-2 text-sm text-dt-fg hover:bg-dt-surface-sunken"
          >
            <DtIcon name="24/outline/shopping-bag" label="Cart" />
            {cartCount > 0 ? (
              <span
                data-testid="header-cart-count"
                className="inline-flex min-w-5 items-center justify-center rounded-full bg-dt-accent px-1.5 text-xs font-medium text-dt-fg-inverse"
              >
                {cartCount}
              </span>
            ) : null}
          </Link>
        </div>
      </div>

      {/* The same links again, so a phone is not left without navigation. */}
      <nav
        className="flex gap-4 overflow-x-auto border-t border-dt-border px-4 py-2 md:hidden"
        aria-label="Main, compact"
      >
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              ['whitespace-nowrap text-sm', isActive ? 'text-dt-accent' : 'text-dt-fg-muted'].join(' ')
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

export function Footer({ nav }: { nav: NavItem[] }) {
  return (
    <footer className="mt-16 border-t border-dt-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 sm:px-6 lg:px-8">
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
          {nav.map((item) => (
            <Link key={item.to} to={item.to} className="text-sm text-dt-fg-muted hover:text-dt-fg">
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-dt-fg-muted">
          Powered by 1Ecomm. Built with dt-ui.
        </p>
      </div>
    </footer>
  );
}

/** A section heading plus lede, used at the top of the catalog routes. */
export function PageHeading({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-dt-fg">{title}</h1>
      {lede ? <p className="mt-2 max-w-2xl text-sm text-dt-fg-muted">{lede}</p> : null}
    </div>
  );
}

/**
 * A failure the shopper can act on.
 *
 * Every route renders this instead of an empty grid, because "no products" and
 * "the request failed" look identical otherwise, and only one of them is worth
 * retrying.
 */
export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div
      className="mx-auto my-10 max-w-xl rounded-dt-card border border-dt-border-strong bg-dt-surface-sunken p-6 text-center"
      data-testid="error-note"
      role="alert"
    >
      <p className="text-sm text-dt-fg">{error}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          data-testid="error-retry"
          className="mt-4 rounded-dt-control bg-dt-accent px-4 py-2 text-sm font-medium text-dt-fg-inverse"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
