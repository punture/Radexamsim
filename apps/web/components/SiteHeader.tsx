"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { BRAND } from "@/lib/brand";

export type NavItem = readonly [href: string, label: string];

/**
 * The one header used by the public site, the learner app and the owner console: the brand,
 * a few main links, optional "More" links, and actions on the right. On narrow screens the
 * links move into a single Menu. Open menus close on navigation and on a click elsewhere.
 */
export function SiteHeader({
  home,
  suffix,
  label,
  links,
  more = [],
  actions,
  wide = false,
}: {
  home: string;
  suffix?: string;
  label: string;
  links: readonly NavItem[];
  more?: readonly NavItem[];
  actions?: ReactNode;
  wide?: boolean;
}) {
  const path = usePathname();
  const ref = useRef<HTMLElement>(null);
  const closeMenus = () => ref.current?.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
  useEffect(closeMenus, [path]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenus();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  const current = (href: string) => (path === href || (href !== home && path.startsWith(`${href}/`)) ? ("page" as const) : undefined);
  const item = ([href, text]: NavItem) => (
    <Link key={href} href={href} aria-current={current(href)}>
      {text}
    </Link>
  );
  return (
    <header className="site-header" ref={ref}>
      <div className={wide ? "container-wide" : "container"}>
        <div className="header-main">
          <Link href={home} className="brand">
            <span className="brand-mark" aria-hidden>N</span>
            {BRAND}
            {suffix && <span className="muted hide-sm" style={{ fontWeight: 500 }}>{suffix}</span>}
          </Link>
          <nav className="nav nav-desktop" aria-label={label}>
            {links.map(item)}
            {more.length > 0 && (
              <details className="menu">
                <summary>More</summary>
                <div className="menu-panel">{more.map(item)}</div>
              </details>
            )}
          </nav>
        </div>
        <div className="header-actions">
          {actions}
          <details className="nav-menu">
            <summary>Menu</summary>
            <nav aria-label={`${label} (compact)`}>{[...links, ...more].map(item)}</nav>
          </details>
        </div>
      </div>
    </header>
  );
}

/** Shown while sign-in is switched off for testing (DEV_AUTO_LOGIN). */
export function TestModePill() {
  return (
    <span className="test-pill hide-sm" title="Sign-in is switched off on this development build (DEV_AUTO_LOGIN)">
      Testing mode
    </span>
  );
}
