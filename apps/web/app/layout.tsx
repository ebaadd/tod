import type { CSSProperties, ReactNode } from "react";
import brand from "../../../config/brand.json";
import "./globals.css";
import "./inbox-upgrade.css";

export const metadata = {
  title: `${brand.name} — ${brand.fullName}`,
  description: brand.tagline
};

export default function Layout({ children }: { children: ReactNode }) {
  const style = {
    "--primary": brand.colors.primary,
    "--secondary": brand.colors.secondary,
    "--accent": brand.colors.accent
  } as CSSProperties;

  return (
    <html lang="en">
      <body style={style}>
        <header>
          <a className="brand" href="/">{brand.name}<span>✦</span></a>
          <a href="/dashboard">My inbox ↗</a>
        </header>
        <main>{children}</main>
        <footer>
          {brand.name} · Anonymous to the recipient, not untraceable.
        </footer>
      </body>
    </html>
  );
}
