"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Create" },
  { href: "/library", label: "Library" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

/**
 * Global site nav. Every page used to be an island — the only cross-links were
 * in the footer, so there was no way back from /library without the browser's
 * back button.
 */
export default function SiteNav() {
  const pathname = usePathname();
  // The admin dashboard has its own chrome and tab bar.
  if (pathname?.startsWith("/admin")) return null;

  return (
    <header className="sticky top-0 z-40 bg-black/80 backdrop-blur-sm border-b border-gray-800/60">
      <nav className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center gap-4">
        <Link
          href="/"
          className="font-bold text-sm bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent whitespace-nowrap shrink-0"
        >
          3D Images
        </Link>
        <div className="flex items-center gap-1 overflow-x-auto ml-auto">
          {LINKS.map((l) => {
            const active =
              l.href === "/" ? pathname === "/" : pathname?.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? "bg-gray-800 text-cyan-400"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-900"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
