import type { Metadata } from "next";
import "./globals.css";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: `${BRAND} — neuroradiology oral exam practice`, template: `%s · ${BRAND}` },
  description: "Spoken neuroradiology oral-examination practice with evidence-linked feedback. Independent practice tool; not affiliated with any examining board.",
  robots: { index: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
