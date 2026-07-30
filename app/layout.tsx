import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const description =
  "An evidence-backed research terminal that separates Astro's public statements, archived framework, and probabilistic inference.";

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
    openGraph: {
      title: "Astro Intelligence",
      description:
        "What Astro said. What the framework implies. What may happen next.",
      type: "website",
      images: [
        {
          url: image,
          width: 1680,
          height: 945,
          alt: "Astro Intelligence — evidence-backed trading research",
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
