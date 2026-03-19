import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://3d.kbrlive.com"),
  title: {
    default: "3D Image Generator — Convert Photos to Anaglyph 3D with AI",
    template: "%s | 3D Image Generator",
  },
  description:
    "Turn any photo or video into stunning 3D anaglyph images using AI depth estimation. Get 6 outputs: anaglyph, depth map, color map, Magic Eye stereogram, side-by-side 3D. Free to start.",
  keywords: [
    "3D image generator", "anaglyph 3D", "photo to 3D", "AI depth estimation",
    "depth map generator", "stereogram maker", "Magic Eye generator",
    "3D photo converter", "red cyan 3D", "3D video converter",
    "side-by-side 3D", "cross-eye 3D",
  ],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://3d.kbrlive.com",
    siteName: "3D Image Generator",
    title: "3D Image Generator — Convert Photos to Anaglyph 3D with AI",
    description:
      "Turn any photo or video into stunning 3D anaglyph images using AI depth estimation. 6 output formats. Free to start.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "3D Image Generator — Before and after anaglyph conversion",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "3D Image Generator — Convert Photos to Anaglyph 3D with AI",
    description:
      "Turn any photo or video into stunning 3D with AI depth estimation. Free to start.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large" as const,
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "https://3d.kbrlive.com",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "3D Image Generator",
              url: "https://3d.kbrlive.com",
              description: "Convert photos and videos to 3D anaglyph images using AI depth estimation.",
              applicationCategory: "MultimediaApplication",
              operatingSystem: "Any",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
                description: "Free tier with 20 image credits",
              },
              featureList: [
                "AI depth estimation",
                "Anaglyph 3D generation",
                "Depth map visualization",
                "Magic Eye stereograms",
                "Side-by-side 3D",
                "Video to 3D conversion",
              ],
            }),
          }}
        />
        {children}
        <footer className="border-t border-gray-800 bg-black text-gray-500 text-xs py-6 px-4">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
            <p>&copy; {new Date().getFullYear()} 3D Image Generator</p>
            <nav className="flex gap-4">
              <a href="/pricing" className="hover:text-gray-300 transition-colors">Pricing</a>
              <a href="/faq" className="hover:text-gray-300 transition-colors">FAQ</a>
              <a href="/contact" className="hover:text-gray-300 transition-colors">Contact</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
