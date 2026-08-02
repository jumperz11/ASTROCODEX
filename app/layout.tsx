import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const description =
  "See every Astro post, every real AI action, and whether Hermes is learning.";

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host =
    incoming.get("x-forwarded-host") ??
    incoming.get("host") ??
    "localhost:3000";
  const protocol =
    incoming.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og-v4.png`;

  return {
    title: "Astro Intelligence",
    description,
    icons: {
      icon: "/favicon.svg",
    },
    openGraph: {
      title: "Astro Intelligence",
      description,
      type: "website",
      images: [
        {
          url: image,
          width: 1731,
          height: 909,
          alt: "Astro Intelligence — Astro posts, AI Console, and Learning",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Astro Intelligence",
      description,
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
