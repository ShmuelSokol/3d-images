import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Free to start with 20 image credits. Buy 100 credits for $20. Convert photos and videos to 3D anaglyph with AI.",
  alternates: { canonical: "https://3d.kbrlive.com/pricing" },
};

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="max-w-4xl mx-auto px-4 py-16">
        <Link href="/" className="text-cyan-400 hover:text-cyan-300 text-sm mb-8 inline-block">&larr; Back to Generator</Link>

        <h1 className="text-3xl sm:text-4xl font-bold text-center mb-4">Simple Pricing</h1>
        <p className="text-gray-400 text-center mb-12 max-w-lg mx-auto">
          Start free. Pay only when you need more.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {/* Free tier */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="text-lg font-semibold mb-2">Free</h2>
            <p className="text-3xl font-bold mb-1">$0</p>
            <p className="text-gray-500 text-sm mb-6">No account required</p>
            <ul className="space-y-3 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">&#10003;</span>
                20 image credits
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">&#10003;</span>
                All 6 output formats
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">&#10003;</span>
                Adjustable depth intensity
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5">&#10007;</span>
                <span className="text-gray-500">No video processing</span>
              </li>
            </ul>
            <Link
              href="/"
              className="mt-6 block text-center py-2.5 bg-gray-800 hover:bg-gray-700 rounded-xl text-sm font-medium transition-colors"
            >
              Get Started
            </Link>
          </div>

          {/* Pro tier */}
          <div className="bg-gray-900 border border-purple-700/50 rounded-2xl p-6 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full text-xs font-medium">
              Most Popular
            </div>
            <h2 className="text-lg font-semibold mb-2">Pro</h2>
            <p className="text-3xl font-bold mb-1">$9.99<span className="text-base font-normal text-gray-400">/mo</span></p>
            <p className="text-gray-500 text-sm mb-6">200 credits/month included</p>
            <ul className="space-y-3 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">&#10003;</span>
                200 credits per month
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400 mt-0.5">&#9733;</span>
                Video processing
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">&#10003;</span>
                All 6 output formats
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">&#10003;</span>
                Cancel anytime
              </li>
            </ul>
            <Link
              href="/"
              className="mt-6 block text-center py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl text-sm font-medium transition-all"
            >
              Upgrade to Pro
            </Link>
          </div>

          {/* Credits pack */}
          <div className="bg-gray-900 border border-cyan-800/50 rounded-2xl p-6 relative">
            <h2 className="text-lg font-semibold mb-2">Credits Pack</h2>
            <p className="text-3xl font-bold mb-1">$20</p>
            <p className="text-gray-500 text-sm mb-6">100 credits &middot; $0.20 each</p>
            <ul className="space-y-3 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">&#10003;</span>
                100 image credits
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">&#10003;</span>
                Credits never expire
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">&#10003;</span>
                All 6 output formats
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5">&#10007;</span>
                <span className="text-gray-500">No video processing</span>
              </li>
            </ul>
            <Link
              href="/"
              className="mt-6 block text-center py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl text-sm font-medium transition-all"
            >
              Buy Credits
            </Link>
          </div>
        </div>

        <p className="text-center text-gray-600 text-xs mt-8">
          All prices in USD. Pro is a monthly subscription. Credits packs are one-time purchases.
        </p>
      </div>
    </main>
  );
}
