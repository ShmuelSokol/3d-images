import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Frequently asked questions about the 3D Image Generator — how it works, pricing, supported formats, and more.",
  alternates: { canonical: "https://3d.kbrlive.com/faq" },
};

const FAQ_ITEMS = [
  {
    q: "What are anaglyph 3D images?",
    a: "Anaglyph images encode depth using red and cyan color channels. When viewed with red/cyan 3D glasses, objects appear to pop out of or recede into the screen, creating a real 3D depth effect.",
  },
  {
    q: "Do I need 3D glasses?",
    a: "For anaglyph output, yes — you need red/cyan 3D glasses. However, Magic Eye (autostereogram) and side-by-side outputs work without any glasses using cross-eye or parallel viewing techniques.",
  },
  {
    q: "What image formats are supported?",
    a: "We support JPG, PNG, and WebP for images, and MP4 for videos. Videos can be up to 60 seconds long.",
  },
  {
    q: "Is it free?",
    a: "Yes! You get 20 free image credits without even creating an account. Sign up for 50 free credits. Additional credits are available for $20 per 100 credits.",
  },
  {
    q: "How does the AI depth estimation work?",
    a: "We use Depth Anything V2, a state-of-the-art neural network that predicts per-pixel depth from a single 2D image. The model analyzes visual cues like perspective, occlusion, and texture to estimate how far each pixel is from the camera.",
  },
  {
    q: "Can I convert videos to 3D?",
    a: "Yes! Upload MP4 videos up to 60 seconds. Each frame gets depth-estimated and converted. You get 3 video outputs: anaglyph 3D, Magic Eye, and side-by-side 3D — all with the original audio preserved.",
  },
  {
    q: "What outputs do I get?",
    a: "Each image produces 6 outputs: anaglyph 3D (red/cyan glasses), grayscale depth map, color depth map (heat visualization), Magic Eye stereogram, side-by-side 3D, and the original. Videos produce 3 outputs: anaglyph, Magic Eye, and side-by-side.",
  },
  {
    q: "Can I adjust the 3D effect strength?",
    a: "Yes. You can adjust the depth intensity before uploading (1-20 scale). Higher values create a more dramatic 3D pop-out effect, while lower values give a subtler depth.",
  },
  {
    q: "Do I need to keep the page open while processing?",
    a: "No. Processing happens on our servers. You can close the page and come back later — your results will be waiting for you.",
  },
  {
    q: "Do credits expire?",
    a: "No. Purchased credits never expire. Free anonymous credits are tied to your browser session.",
  },
];

export default function FAQPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQ_ITEMS.map((item) => ({
              "@type": "Question",
              name: item.q,
              acceptedAnswer: { "@type": "Answer", text: item.a },
            })),
          }),
        }}
      />

      <div className="max-w-3xl mx-auto px-4 py-16">
        <Link href="/" className="text-cyan-400 hover:text-cyan-300 text-sm mb-8 inline-block">&larr; Back to Generator</Link>

        <h1 className="text-3xl sm:text-4xl font-bold text-center mb-12">Frequently Asked Questions</h1>

        <div className="space-y-6">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-base font-semibold text-gray-100 mb-2">{item.q}</h2>
              <p className="text-sm text-gray-400 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link
            href="/"
            className="px-6 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl text-sm font-semibold transition-all inline-block"
          >
            Try It Now
          </Link>
        </div>
      </div>
    </main>
  );
}
