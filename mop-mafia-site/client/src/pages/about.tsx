import { CheckCircle2 } from 'lucide-react'
import { Link } from 'wouter'

export function AboutPage() {
  return (
    <div className="w-full pt-20">
      {/* HERO */}
      <section className="relative h-96 overflow-hidden">
        <img
          src="/mopmafia-family.jpg"
          alt="Mop Mafia family"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <h1 className="font-playfair text-5xl md:text-6xl text-white text-center">Our Story</h1>
        </div>
      </section>

      {/* THE STORY */}
      <section className="bg-white section-padding">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-playfair text-5xl text-navy mb-8">We're Not a Franchise. We're a Family.</h2>
          <p className="font-inter text-lg text-gray-700 leading-relaxed mb-6">
            Mop Mafia was born from one woman's determination to do things right. As an Italian-American single mother, our founder built this business on the values she raised her family with: pride in your work, respect for every home, and the kind of care you only get from someone who truly gives a damn.
          </p>
          <p className="font-inter text-lg text-gray-700 leading-relaxed mb-6">
            When she started, there was no franchise model. No business consultants. No shortcuts. Just a commitment to excellence and the belief that every home deserves to be treated like it matters — because it does.
          </p>
          <p className="font-inter text-lg text-gray-700 leading-relaxed mb-8">
            Years later, Amira, Layla, and Selina aren't just family — they're part of the team. And when we show up to your home, you get us. Not a contractor. Not a stranger. Us. That difference is everything.
          </p>
          <div className="flex flex-wrap gap-4">
            <div className="inline-block px-4 py-2 bg-gold/20 border border-gold rounded-full">
              <p className="text-gold font-inter font-semibold text-sm">Woman-Owned</p>
            </div>
            <div className="inline-block px-4 py-2 bg-gold/20 border border-gold rounded-full">
              <p className="text-gold font-inter font-semibold text-sm">Family-Operated</p>
            </div>
            <div className="inline-block px-4 py-2 bg-gold/20 border border-gold rounded-full">
              <p className="text-gold font-inter font-semibold text-sm">10+ Years</p>
            </div>
          </div>
        </div>
      </section>

      {/* NO CONTRACTORS EVER */}
      <section className="bg-cream section-padding">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-playfair text-5xl text-navy mb-8">No Contractors. Ever.</h2>
          <p className="font-inter text-lg text-gray-700 leading-relaxed mb-6">
            You won't find a single contractor on Mop Mafia's roster. That's intentional. Here's why:
          </p>
          <ul className="space-y-4 mb-8">
            <li className="flex gap-4">
              <CheckCircle2 className="text-gold flex-shrink-0 mt-1" />
              <span className="font-inter text-gray-700 text-lg">
                <strong>Consistency:</strong> The same people show up every time. You know who to expect. You trust them.
              </span>
            </li>
            <li className="flex gap-4">
              <CheckCircle2 className="text-gold flex-shrink-0 mt-1" />
              <span className="font-inter text-gray-700 text-lg">
                <strong>Accountability:</strong> When something's yours, you care. They care because this is their business, their name, their reputation.
              </span>
            </li>
            <li className="flex gap-4">
              <CheckCircle2 className="text-gold flex-shrink-0 mt-1" />
              <span className="font-inter text-gray-700 text-lg">
                <strong>Standards:</strong> No middleman. No cutting corners to maximize profit. It's just us doing the work we stand behind.
              </span>
            </li>
            <li className="flex gap-4">
              <CheckCircle2 className="text-gold flex-shrink-0 mt-1" />
              <span className="font-inter text-gray-700 text-lg">
                <strong>Discretion:</strong> Your home is treated with the privacy and respect it deserves. No revolving door of strangers.
              </span>
            </li>
          </ul>
          <p className="font-inter text-lg text-gray-700 leading-relaxed">
            This is the Mop Mafia difference. It's not scalable. It's not trendy. But it works.
          </p>
        </div>
      </section>

      {/* OUR VALUES */}
      <section className="bg-white section-padding">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-playfair text-5xl text-navy mb-16 text-center">Our Values</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {/* Discretion */}
            <div className="text-center">
              <div className="text-5xl mb-4">🔒</div>
              <h3 className="font-playfair text-3xl text-navy mb-4">Discretion</h3>
              <p className="font-inter text-gray-700 leading-relaxed">
                Your home is private. Your business is yours. We show up, do exceptional work, and respect the boundaries of your space.
              </p>
            </div>

            {/* Consistency */}
            <div className="text-center">
              <div className="text-5xl mb-4">⚙️</div>
              <h3 className="font-playfair text-3xl text-navy mb-4">Consistency</h3>
              <p className="font-inter text-gray-700 leading-relaxed">
                Excellence isn't a one-time event. It's the standard. Every visit. Every room. Every detail. Same quality, always.
              </p>
            </div>

            {/* Pride */}
            <div className="text-center">
              <div className="text-5xl mb-4">🏆</div>
              <h3 className="font-playfair text-3xl text-navy mb-4">Pride</h3>
              <p className="font-inter text-gray-700 leading-relaxed">
                We take pride in our work because it matters. Your home matters. The care we bring is real. It shows.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* THE TEAM */}
      <section className="bg-cream section-padding">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-playfair text-5xl text-navy mb-16 text-center">The Team</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Team Member 1 */}
            <div className="bg-white p-8 rounded-lg text-center">
              <div className="text-6xl mb-4">👩</div>
              <h3 className="font-playfair text-2xl text-navy mb-2">Founder & Owner</h3>
              <p className="font-inter text-gray-600 mb-4">
                Italian-American single mother. Started with determination and ended with a business built on family values.
              </p>
              <p className="font-inter text-sm text-gold font-semibold">Woman-Owned</p>
            </div>

            {/* Team Member 2 */}
            <div className="bg-white p-8 rounded-lg text-center">
              <div className="text-6xl mb-4">👧</div>
              <h3 className="font-playfair text-2xl text-navy mb-2">Amira</h3>
              <p className="font-inter text-gray-600">
                Brings precision and attention to detail that turns good into exceptional. Part of the core team.
              </p>
            </div>

            {/* Team Member 3 */}
            <div className="bg-white p-8 rounded-lg text-center">
              <div className="text-6xl mb-4">👧</div>
              <h3 className="font-playfair text-2xl text-navy mb-2">Layla</h3>
              <p className="font-inter text-gray-600">
                Ensures every home feels cared for. Her work speaks for itself. Family-first approach to excellence.
              </p>
            </div>
          </div>
          <div className="text-center mt-8 pt-8 border-t border-gold/20">
            <div className="text-6xl mb-4 inline-block">👧</div>
            <h3 className="font-playfair text-2xl text-navy mb-2">Selina</h3>
            <p className="font-inter text-gray-600 max-w-md mx-auto">
              Dedication and professionalism define her approach. Part of the family. Part of your home care.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-navy section-padding">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-playfair text-5xl text-white mb-4">Ready to Experience the Difference?</h2>
          <p className="font-inter text-xl text-gray-200 mb-10">
            Schedule a consultation and let's talk about what your home deserves.
          </p>
          <Link href="/book">
            <a className="inline-block px-10 py-4 bg-gold text-navy font-playfair text-lg font-bold rounded hover:opacity-90 transition-opacity">
              Book Your Clean
            </a>
          </Link>
        </div>
      </section>
    </div>
  )
}
