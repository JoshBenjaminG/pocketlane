import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pocketlane — Your GBA library",
  description: "A private, local-first Game Boy Advance player for your browser.",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Pocketlane — Your GBA library",
    description: "A private, local-first Game Boy Advance player for your browser.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Pocketlane — Your GBA library. Private by default." }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = {
  themeColor: "#171713",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
