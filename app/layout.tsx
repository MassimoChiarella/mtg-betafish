import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import "./globals.css";

// These values are resolved at build time, never from untrusted request headers.
const deploymentHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const origin = new URL(process.env.SITE_URL || (deploymentHost ? `https://${deploymentHost}` : "http://localhost:3000"));
if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) {
  throw new Error("SITE_URL must be an HTTP(S) URL without credentials.");
}
const title = "MTG Betafish — Commander Playtest Companion";
const description = "Stress-test Commander decks against bracket-aware matchup profiles, interaction, combat pressure, and countdown threats.";
const socialImage = new URL("/og.png", origin).toString();

export const metadata: Metadata = {
  metadataBase: origin,
  title,
  description,
  alternates: { canonical: "/" },
  icons: { icon: "/fish-icon.png" },
  openGraph: { type: "website", siteName: "MTG Betafish", url: "/", title, description, images: [{ url: socialImage, width: 1672, height: 941, alt: "MTG Betafish — stress-test your Commander deck" }] },
  twitter: { card: "summary_large_image", title, description, images: [socialImage] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        {process.env.VERCEL === "1" && (
          <>
            <Analytics configString={process.env.VERCEL_OBSERVABILITY_CLIENT_CONFIG} />
            <SpeedInsights configString={process.env.VERCEL_OBSERVABILITY_CLIENT_CONFIG} />
          </>
        )}
      </body>
    </html>
  );
}
