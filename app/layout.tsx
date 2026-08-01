import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const description =
  "Astro now, Hermes next, the levels that matter, and what changed.";

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host =
    incoming.get("x-forwarded-host") ??
    incoming.get("host") ??
    "localhost:3000";
  const protocol =
    incoming.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;

  return {
    title: "Astro Intelligence",
    description,
    icons: {
      icon: "/favicon.svg",
    },
    openGraph: {
      title: "Astro Intelligence",
      description:
        "What Astro said. What the framework implies. What may happen next.",
      type: "website",
      images: [
        {
          url: image,
          width: 1693,
          height: 929,
          alt: "Astro Intelligence — live BTC chart with public Astro overlays",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Astro Intelligence",
      description:
        "What Astro said. What the framework implies. What may happen next.",
      images: [image],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
