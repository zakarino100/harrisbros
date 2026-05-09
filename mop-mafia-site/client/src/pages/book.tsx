import { Star } from 'lucide-react'
import { QuoteTool } from '../components/quote-tool'

export function BookPage() {
  return (
    <div className="w-full pt-20">
      {/* HERO */}
      <section className="bg-navy py-16">
        <div className="max-w-5xl mx-auto px-6 md:px-12 text-center">
          <h1 className="font-playfair text-5xl md:text-6xl text-white mb-4">
            Let's Get Your Home Ready
          </h1>
          <p className="font-inter text-xl text-gray-200">
            Request your personalized quote below. We'll be in touch within 24 hours.
          </p>
        </div>
      </section>

      {/* TRUST BAR */}
      <section className="bg-cream section-padding">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-gold text-4xl md:text-5xl font-playfair font-bold">100+</p>
              <p className="text-navy font-inter text-sm md:text-base mt-2">Five-Star Reviews</p>
            </div>
            <div>
              <p className="text-gold text-4xl md:text-5xl font-playfair font-bold">♀</p>
              <p className="text-navy font-inter text-sm md:text-base mt-2">Woman-Owned</p>
            </div>
            <div>
              <p className="text-gold text-4xl md:text-5xl font-playfair font-bold">0</p>
              <p className="text-navy font-inter text-sm md:text-base mt-2">Contractors</p>
            </div>
            <div>
              <p className="text-gold text-4xl md:text-5xl font-playfair font-bold">10+</p>
              <p className="text-navy font-inter text-sm md:text-base mt-2">Years Experience</p>
            </div>
          </div>
        </div>
      </section>

      {/* QUOTE FORM SECTION */}
      <section className="bg-white section-padding">
        <div className="max-w-7xl mx-auto">
          <QuoteTool />
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="bg-cream section-padding">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-playfair text-5xl text-navy mb-4 text-center">What Our Clients Say</h2>
          <p className="font-inter text-center text-gray-600 mb-12 text-lg">
            Real testimonials from real homes we've transformed.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Review 1 */}
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={16} className="fill-gold text-gold" />
                ))}
              </div>
              <p className="font-cormorant italic text-lg text-gray-700 mb-4">
                "I have never seen my kitchen look this clean. They treat my home like it's their own. Worth every penny."
              </p>
              <p className="font-inter font-semibold text-navy">Jennifer M.</p>
              <p className="font-inter text-sm text-gray-500">Verified Google Review</p>
            </div>

            {/* Review 2 */}
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={16} className="fill-gold text-gold" />
                ))}
              </div>
              <p className="font-cormorant italic text-lg text-gray-700 mb-4">
                "We've tried 4 different cleaning services over the years. Mop Mafia is the only one we've kept. The difference is night and day."
              </p>
              <p className="font-inter font-semibold text-navy">Robert D.</p>
              <p className="font-inter text-sm text-gray-500">Verified Google Review</p>
            </div>

            {/* Review 3 */}
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={16} className="fill-gold text-gold" />
                ))}
              </div>
              <p className="font-cormorant italic text-lg text-gray-700 mb-4">
                "The attention to detail is unmatched. My realtor actually asked if we renovated before listing."
              </p>
              <p className="font-inter font-semibold text-navy">Sarah K.</p>
              <p className="font-inter text-sm text-gray-500">Verified Google Review</p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-navy section-padding">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-playfair text-5xl text-white mb-12 text-center">Booking Questions?</h2>
          
          <div className="space-y-8">
            <div>
              <h3 className="font-playfair text-xl text-gold mb-3">How long does the quote process take?</h3>
              <p className="font-inter text-gray-100">We review all requests within 24 hours and will contact you directly to discuss your home's specific needs and provide an accurate quote.</p>
            </div>

            <div className="border-b border-gold/20"></div>

            <div>
              <h3 className="font-playfair text-xl text-gold mb-3">What if I need an urgent cleaning?</h3>
              <p className="font-inter text-gray-100">Call us directly at (984) 464-6019. We do our best to accommodate rush requests based on our schedule.</p>
            </div>

            <div className="border-b border-gold/20"></div>

            <div>
              <h3 className="font-playfair text-xl text-gold mb-3">Do you require a deposit?</h3>
              <p className="font-inter text-gray-100">Details about deposits and payment terms will be discussed during your quote consultation. We make it simple and transparent.</p>
            </div>

            <div className="border-b border-gold/20"></div>

            <div>
              <h3 className="font-playfair text-xl text-gold mb-3">Can I customize a service plan?</h3>
              <p className="font-inter text-gray-100">Absolutely. We work with you to create a custom maintenance schedule and service package that fits your home's needs and your budget.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-cream section-padding text-center">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-playfair text-5xl text-navy mb-6">Ready to Get Started?</h2>
          <p className="font-inter text-lg text-gray-700 mb-4">
            Scroll back up to fill out the form, or give us a call.
          </p>
          <a href="tel:(984)464-6019" className="inline-block px-10 py-4 bg-gold text-navy font-playfair text-lg font-bold rounded hover:opacity-90 transition-opacity">
            Call Us: (984) 464-6019
          </a>
        </div>
      </section>
    </div>
  )
}
