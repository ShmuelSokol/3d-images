import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-700 mb-4">404</h1>
        <p className="text-gray-400 mb-6">This page doesn&apos;t exist.</p>
        <Link href="/" className="text-cyan-400 hover:text-cyan-300 text-sm">
          &larr; Back to 3D Image Generator
        </Link>
      </div>
    </main>
  );
}
