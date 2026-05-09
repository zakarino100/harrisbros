import { Link } from 'wouter'
import { Star, ShieldCheck, Users, Award, Home } from 'lucide-react'

export function LandingPage() {
  return (
    <div className="w-full">
      {/* SECTION 1: HERO */}
      <section
        className="min-h-screen flex items-center justify-center relative bg-cover bg-center"
        style={{
          backgroundImage: "url('/mopmafia-hero.jpg')",
          backgroundAttachment: 'scroll',
        }}
        aria-label="Hero — White-Glove Luxury Home Cleaning"
      >
        <div className="absolute inset-0 bg-black/55"></div>
        <div className="relative z-10 text-center px-6 max-w-4xl">
          <div className="inline-block px-4 py-2 border border-gold/50 rounded-full mb-8">
            <p className="text-gold text-sm font-inter font-semibold tracking-widest uppercase">
              Woman-Owned · Family-Operated · 5-Star Rated
            </p>
          </div>
          <h1 className="font-playfair text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight">
            White-Glove Cleaning for Homes That Deserve the Best
          </h1>
          <p className="font-inter text-lg md:text-xl text-gray-100 mb-10 max-w-2xl mx-auto">
            We specialize in luxury homes where every detail matters. No contractors — just family.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/book">
              <a className="btn-gold rounded inline-block">
                Request a Custom Quote
              </a>
            </Link>
            <Link href="/about">
              <a className="btn-outline rounded inline-block">
                Learn Our Story
              </a>
            </Link>
          </div>
        </div>
      </section>

      {/* SECTION 2: TRUST BAR */}
      <section className="bg-navy py-12 md:py-16" aria-label="Trust signals">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <p className="text-gold text-4xl md:text-5xl font-playfair font-bold">100+</p>
              <p className="text-white font-inter text-sm md:text-base mt-2">Five-Star Reviews</p>
            </div>
            <div className="text-center">
              <p className="text-gold text-4xl md:text-5xl font-playfair font-bold">♀</p>
              <p className="text-white font-inter text-sm md:text-base mt-2">Woman-Owned</p>
            </div>
            <div className="text-center">
              <p className="text-gold text-4xl md:text-5xl font-playfair font-bold">0</p>
              <p className="text-white font-inter text-sm md:text-base mt-2">Contractors. Ever.</p>
            </div>
            <div className="text-center">
              <p className="text-gold text-4xl md:text-5xl font-playfair font-bold">10+</p>
              <p className="text-white font-inter text-sm md:text-base mt-2">Years Experience</p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: POSITIONING — image split */}
      <section className="bg-white" aria-label="Why Mop Mafia">
        <div className="grid grid-cols-1 lg:grid-cols-2 h-auto lg:min-h-screen">
          <div className="h-96 lg:h-full">
            <img
              src="/mopmafia-neighborhood.jpg"
              alt="Luxury residential neighborhood served by Mop Mafia"
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="bg-navy flex items-center justify-center p-8 md:p-16">
            <div className="max-w-xl">
              <p className="text-gold text-sm font-inter font-semibold tracking-widest uppercase mb-4">
                Why Mop Mafia
              </p>
              <h2 className="font-playfair text-4xl md:text-5xl text-white mb-6 leading-tight">
                We Only Work With Homes That Deserve This Standard
              </h2>
              <p className="font-inter text-gray-100 text-lg leading-relaxed mb-8">
                Mop Mafia isn't for everyone — and that's by design. We specialize exclusively in luxury residential properties where attention to detail, discretion, and consistency aren't negotiable. Every job is handled by our family. Every time.
              </p>
              <div className="flex flex-wrap gap-3">
                <span className="inline-block px-4 py-2 bg-gold/20 border border-gold rounded-full text-gold font-inter font-semibold text-sm">Serving $1M+ Homes</span>
                <span className="inline-block px-4 py-2 bg-gold/20 border border-gold rounded-full text-gold font-inter font-semibold text-sm">Fully Insured</span>
                <span className="inline-block px-4 py-2 bg-gold/20 border border-gold rounded-full text-gold font-inter font-semibold text-sm">5-Star Rated</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: SERVICES */}
      <section className="bg-cream section-padding" aria-label="Our cleaning services">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-gold text-sm font-inter font-semibold tracking-widest uppercase mb-4">What We Offer</p>
            <h2 className="font-playfair text-5xl text-navy">Tailored to Your Home's Needs</h2>
            <p className="font-inter text-gray-600 mt-4 max-w-2xl mx-auto">
              Every home is different. We craft a cleaning plan around yours — not a package off a shelf.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white border-t-4 border-navy p-8 hover:shadow-lg transition-shadow">
              <div className="text-4xl mb-4">✨</div>
              <h3 className="font-playfair text-2xl text-navy mb-3">Standard Clean</h3>
              <p className="font-inter text-gray-600 text-sm mb-6">
                Regular maintenance for pristine living spaces. Perfect for homes that want to stay immaculate between visits.
              </p>
              <Link href="/services">
                <a className="text-gold font-inter font-semibold hover:opacity-70 transition-opacity flex items-center gap-2">
                  See What's Included →
                </a>
              </Link>
            </div>

            <div className="bg-white border-t-4 border-navy p-8 hover:shadow-lg transition-shadow">
              <div className="text-4xl mb-4">🏆</div>
              <h3 className="font-playfair text-2xl text-navy mb-3">Deep Clean</h3>
              <p className="font-inter text-gray-600 text-sm mb-6">
                Comprehensive refresh for every corner. For when good isn't good enough. We go deeper — into every surface, every detail.
              </p>
              <Link href="/services">
                <a className="text-gold font-inter font-semibold hover:opacity-70 transition-opacity flex items-center gap-2">
                  See What's Included →
                </a>
              </Link>
            </div>

            <div className="bg-white border-t-4 border-navy p-8 hover:shadow-lg transition-shadow">
              <div className="text-4xl mb-4">🔄</div>
              <h3 className="font-playfair text-2xl text-navy mb-3">Move In / Move Out</h3>
              <p className="font-inter text-gray-600 text-sm mb-6">
                Make it shine for your next chapter. Full property refresh for transitions that demand absolute perfection.
              </p>
              <Link href="/services">
                <a className="text-gold font-inter font-semibold hover:opacity-70 transition-opacity flex items-center gap-2">
                  See What's Included →
                </a>
              </Link>
            </div>
          </div>
          <div className="text-center mt-12">
            <p className="font-inter text-gray-500 mb-6">Every quote is custom. Fill out the form and we'll reach out personally.</p>
            <Link href="/book">
              <a className="btn-gold rounded inline-block">Request Your Custom Quote</a>
            </Link>
          </div>
        </div>
      </section>

      {/* SECTION 5: PHOTO GALLERY ROW */}
      <section className="bg-white" aria-label="Gallery of our work">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0">
          <div className="h-64 md:h-80 overflow-hidden">
            <img src="/mopmafia-bathroom.jpg" alt="Luxury bathroom cleaned by Mop Mafia" className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" loading="lazy" />
          </div>
          <div className="h-64 md:h-80 overflow-hidden">
            <img src="/mopmafia-kitchen.jpg" alt="Luxury kitchen professionally cleaned" className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" loading="lazy" />
          </div>
          <div className="h-64 md:h-80 overflow-hidden">
            <img src="/mopmafia-living.jpg" alt="Immaculate luxury living room" className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" loading="lazy" />
          </div>
          <div className="h-64 md:h-80 overflow-hidden">
            <img src="/mopmafia-bedroom.jpg" alt="Pristine luxury master bedroom" className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" loading="lazy" />
          </div>
        </div>
      </section>

      {/* SECTION 6: FAMILY */}
      <section className="bg-white" aria-label="Our family story">
        <div className="grid grid-cols-1 lg:grid-cols-2 h-auto lg:min-h-screen">
          <div className="bg-navy flex items-center justify-center p-8 md:p-16 order-2 lg:order-1">
            <div className="max-w-xl">
              <h2 className="font-playfair text-5xl text-white mb-8 leading-tight">
                We're Not a Franchise. We're a Family.
              </h2>
              <p className="font-inter text-gray-100 text-lg leading-relaxed mb-8">
                Mop Mafia was born from one woman's determination to do things right. As an Italian-American single mother, our founder built this business on the values she raised her family with: pride in your work, respect for every home, and the kind of care you only get from someone who truly gives a damn. Amira, Layla, and Selina aren't just family — they're part of the team. When we show up to your home, you get us. Not a contractor. Not a stranger. Us.
              </p>
              <div className="flex flex-wrap gap-4">
                <span className="inline-block px-4 py-2 bg-gold/20 border border-gold rounded-full text-gold font-inter font-semibold text-sm">Woman-Owned</span>
                <span className="inline-block px-4 py-2 bg-gold/20 border border-gold rounded-full text-gold font-inter font-semibold text-sm">Family-Operated</span>
                <span className="inline-block px-4 py-2 bg-gold/20 border border-gold rounded-full text-gold font-inter font-semibold text-sm">No Contractors. Ever.</span>
              </div>
            </div>
          </div>
          <div className="h-96 lg:h-full order-1 lg:order-2">
            <img
              src="/mopmafia-family.jpg"
              alt="Mop Mafia founder and daughters — the family team"
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        </div>
      </section>

      {/* SECTION 7: FOYER FULL-WIDTH IMAGE BREAK */}
      <section className="relative h-96 md:h-[500px] overflow-hidden" aria-hidden="true">
        <img
          src="/mopmafia-foyer.jpg"
          alt="Grand luxury home entryway"
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-navy/60 flex items-center justify-center">
          <div className="text-center max-w-2xl px-6">
            <p className="font-playfair text-3xl md:text-4xl text-white italic">"Your home is a reflection of who you are. We treat it that way."</p>
            <p className="text-gold font-inter text-sm mt-4 tracking-widest uppercase">— Mop Mafia</p>
          </div>
        </div>
      </section>

      {/* SECTION 8: REVIEWS */}
      <section className="bg-cream section-padding" aria-label="Customer reviews">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-gold text-sm font-inter font-semibold tracking-widest uppercase mb-4">Reviews</p>
            <h2 className="font-playfair text-5xl text-navy mb-4">Five Stars. Every Single Time.</h2>
            <div className="flex justify-center gap-2 mb-2">
              {[...Array(5)].map((_, i) => (
                <Star key={i} size={28} className="fill-gold text-gold" />
              ))}
            </div>
            <p className="font-inter text-gray-500 text-sm">100+ verified Google reviews</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => <Star key={i} size={16} className="fill-gold text-gold" />)}
              </div>
              <p className="font-cormorant italic text-lg text-gray-700 mb-6">
                "I have never seen my kitchen look this clean. They treat my home like it's their own. Absolutely worth every penny — and then some."
              </p>
              <p className="font-inter font-semibold text-navy">Jennifer M.</p>
              <p className="font-inter text-sm text-gray-500">Verified Google Review · Cary, NC</p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => <Star key={i} size={16} className="fill-gold text-gold" />)}
              </div>
              <p className="font-cormorant italic text-lg text-gray-700 mb-6">
                "We've tried 4 different cleaning services over the years. Mop Mafia is the only one we've kept. The difference is night and day — they care."
              </p>
              <p className="font-inter font-semibold text-navy">Robert D.</p>
              <p className="font-inter text-sm text-gray-500">Verified Google Review · Raleigh, NC</p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => <Star key={i} size={16} className="fill-gold text-gold" />)}
              </div>
              <p className="font-cormorant italic text-lg text-gray-700 mb-6">
                "The attention to detail is unmatched. My realtor actually asked if we renovated before listing. That's how good these ladies are."
              </p>
              <p className="font-inter font-semibold text-navy">Sarah K.</p>
              <p className="font-inter text-sm text-gray-500">Verified Google Review · Chapel Hill, NC</p>
            </div>
          </div>

          {/* Extra 2 reviews */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => <Star key={i} size={16} className="fill-gold text-gold" />)}
              </div>
              <p className="font-cormorant italic text-lg text-gray-700 mb-6">
                "We have a 6,000 sq ft home and finding someone who actually cleans it properly has been a 10-year struggle. Mop Mafia solved that on their first visit."
              </p>
              <p className="font-inter font-semibold text-navy">Marcus T.</p>
              <p className="font-inter text-sm text-gray-500">Verified Google Review · Durham, NC</p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-sm">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => <Star key={i} size={16} className="fill-gold text-gold" />)}
              </div>
              <p className="font-cormorant italic text-lg text-gray-700 mb-6">
                "Trusted them with my home after our move-in. Every cabinet, every closet, every corner. They didn't miss a thing. Completely blown away."
              </p>
              <p className="font-inter font-semibold text-navy">Diane L.</p>
              <p className="font-inter text-sm text-gray-500">Verified Google Review · Wake Forest, NC</p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 9: WHY CUSTOM QUOTE */}
      <section className="bg-navy section-padding" aria-label="Why we quote custom">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-gold text-sm font-inter font-semibold tracking-widest uppercase mb-4">Our Approach</p>
              <h2 className="font-playfair text-4xl md:text-5xl text-white mb-6 leading-tight">
                No Published Rates. That's Intentional.
              </h2>
              <p className="font-inter text-gray-200 text-lg leading-relaxed">
                A 3,000 sq ft home and a 9,000 sq ft estate aren't the same job. Neither are a monthly maintenance visit and a move-out deep clean. We quote every home individually — because that's the only honest way to do it.
              </p>
              <p className="font-inter text-gray-300 text-lg leading-relaxed mt-4">
                Fill out the form, tell us about your home, and we'll be in touch personally to discuss what you need.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-6">
              {[
                { icon: <Home size={28} className="text-gold" />, title: "Every Home is Unique", desc: "Square footage, surfaces, frequency — we price it right." },
                { icon: <ShieldCheck size={28} className="text-gold" />, title: "Fully Insured", desc: "Bonded and insured. Your home is always protected." },
                { icon: <Users size={28} className="text-gold" />, title: "Always Family", desc: "No strangers. The same trusted team, every visit." },
                { icon: <Award size={28} className="text-gold" />, title: "5-Star Standard", desc: "We don't leave until it's exactly right. Every time." },
              ].map((item, i) => (
                <div key={i} className="bg-white/10 p-6 rounded-lg">
                  <div className="mb-3">{item.icon}</div>
                  <h4 className="font-playfair text-white text-lg mb-2">{item.title}</h4>
                  <p className="font-inter text-gray-300 text-sm">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 10: ESTATE IMAGE BREAK */}
      <section className="relative h-64 md:h-96 overflow-hidden" aria-hidden="true">
        <img
          src="/mopmafia-estate.jpg"
          alt="Luxury estate neighborhood in North Carolina"
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/30"></div>
      </section>

      {/* SECTION 11: CTA */}
      <section className="bg-navy section-padding relative" aria-label="Request a quote">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold to-transparent"></div>
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-playfair text-5xl text-white mb-4">Ready to Experience What Clean Really Looks Like?</h2>
          <p className="font-inter text-xl text-gray-200 mb-4">
            Fill out our short form and we'll reach out personally within 24 hours.
          </p>
          <p className="font-inter text-gray-400 text-sm mb-10">No pricing lists. No packages. Just a conversation about your home.</p>
          <Link href="/book">
            <a className="inline-block px-10 py-4 bg-gold text-navy font-playfair text-lg font-bold rounded hover:opacity-90 transition-opacity">
              Request Your Custom Quote →
            </a>
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-navy text-white border-t border-gold/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            <div>
              <h3 className="font-playfair text-2xl mb-2">
                <span className="text-white">Mop</span>
                <span className="text-gold ml-2">Mafia</span>
              </h3>
              <p className="font-inter text-gray-300 text-sm mb-4">
                White-Glove Cleaning for Homes That Deserve the Best
              </p>
              <p className="font-inter text-gray-400 text-xs">Woman-Owned · Family-Operated · No Contractors · North Carolina</p>
            </div>
            <div className="flex flex-col gap-3">
              <Link href="/"><a className="font-inter text-gray-300 hover:text-gold transition-colors">Home</a></Link>
              <Link href="/about"><a className="font-inter text-gray-300 hover:text-gold transition-colors">About</a></Link>
              <Link href="/services"><a className="font-inter text-gray-300 hover:text-gold transition-colors">Services</a></Link>
              <Link href="/book"><a className="font-inter text-gray-300 hover:text-gold transition-colors">Request a Quote</a></Link>
            </div>
            <div>
              <p className="font-inter text-sm text-gray-300 mb-2">Phone</p>
              <a href="tel:+19844646019" className="font-playfair text-lg text-gold hover:opacity-80 transition-opacity">(984) 464-6019</a>
              <p className="font-inter text-sm text-gray-300 mt-4">Service Area</p>
              <p className="font-inter text-gray-300">Raleigh · Cary · Durham · Chapel Hill · Wake Forest · NC</p>
            </div>
          </div>
          <div className="border-t border-gold/20 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="font-inter text-sm text-gray-400">
              © {new Date().getFullYear()} Mop Mafia. All rights reserved.
            </p>
            <div className="flex gap-4">
              <span className="text-gold text-xs font-inter">Woman-Owned</span>
              <span className="text-gold text-xs font-inter">Family-Operated</span>
              <span className="text-gold text-xs font-inter">No Contractors</span>
              <a href="/privacy.html" className="text-gray-500 text-xs font-inter hover:text-gold">Privacy</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
