import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "3D Image Generator",
  description: "Upload a photo and generate anaglyph 3D images with AI depth estimation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
