import { CheckCircle2 } from 'lucide-react'
import { Link } from 'wouter'

export function ServicesPage() {
  const services = [
    {
      name: 'Standard Clean',
      icon: '✨',
      description: 'Regular maintenance for pristine living spaces',
      checklist: [
        'Dust surfaces and furniture',
        'Vacuum all carpets',
        'Mop hard floors',
        'Clean bathrooms (toilets, sinks, mirrors)',
        'Wipe down kitchen counters',
        'Empty trash cans',
        'Straighten and organize',
        'Fresh towels and linens'
      ]
    },
    {
      name: 'Deep Clean',
      icon: '🏆',
      description: 'Comprehensive refresh of every space',
      checklist: [
        'Everything from Standard Clean',
        'Clean inside cabinets',
        'Baseboards and molding',
        'Light fixtures and ceiling',
        'Windows (inside and out)',
        'Door handles and frames',
        'Behind and under furniture',
        'Detailed upholstery care'
      ]
    },
    {
      name: 'Move In/Move Out',
      icon: '🔄',
      description: 'Full property refresh for transitions',
      checklist: [
        'Complete deep clean of all areas',
        'Interior windows throughout',
        'Appliance interiors',
        'Closets and storage areas',
        'Walls and baseboards',
        'Grout cleaning',
        'Carpet shampooing',
        'Final walkthrough quality check'
      ]
    },
    {
      name: 'Custom Services',
      icon: '⭐',
      description: 'Specialized services tailored to your home',
      checklist: [
        'Post-event cleaning',
        'Seasonal deep cleans',
        'Specialty surface care',
        'Exterior power washing',
        'Carpet and upholstery care',
        'Window and gutter cleaning',
        'Accent furniture cleaning',
        'Custom maintenance plans'
      ]
    }
  ]

  const faqs = [
    {
      q: 'How often should I schedule a clean?',
      a: 'This depends on your lifestyle and home. Luxury properties often benefit from weekly or bi-weekly service, but we can customize a schedule that works for you.'
    },
    {
      q: 'Do you provide your own cleaning supplies?',
      a: 'Yes, we bring professional-grade, luxury-appropriate supplies. If you have specific brands or products you prefer, let us know and we\'ll use those.'
    },
    {
      q: 'Are you insured and bonded?',
      a: 'Absolutely. We maintain full insurance coverage and are bonded for your peace of mind and protection.'
    },
    {
      q: 'What areas do you serve?',
      a: 'We primarily serve the luxury residential market in North Carolina. Contact us about your specific location.'
    },
    {
      q: 'How much notice do I need to give?',
      a: 'Regular clients have standing appointments. For new services, we recommend at least a week\'s notice, but we\'ll do our best to accommodate your schedule.'
    },
    {
      q: 'What if I\'m not satisfied?',
      a: 'We stand behind our work 100%. If anything doesn\'t meet our standards, we\'ll make it right. Your satisfaction is non-negotiable.'
    }
  ]

  return (
    <div className="w-full pt-20">
      {/* HERO */}
      <section className="relative h-96 overflow-hidden">
        <img
          src="/mopmafia-kitchen.jpg"
          alt="Luxury kitchen"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <div className="text-center">
            <h1 className="font-playfair text-5xl md:text-6xl text-white mb-4">Our Services</h1>
            <p className="font-inter text-xl text-gray-100">Specialized cleaning for luxury homes</p>
          </div>
        </div>
      </section>

      {/* SERVICES GRID */}
      <section className="bg-white section-padding">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {services.map((service, index) => (
              <div key={index} className="bg-cream p-10 border-l-4 border-gold rounded-lg">
                <div className="text-5xl mb-4">{service.icon}</div>
                <h3 className="font-playfair text-3xl text-navy mb-2">{service.name}</h3>
                <p className="font-inter text-gray-600 text-sm mb-6 min-h-12">{service.description}</p>
                <div className="space-y-3 mb-8">
                  {service.checklist.map((item, idx) => (
                    <div key={idx} className="flex gap-3">
                      <CheckCircle2 className="text-gold flex-shrink-0 mt-0.5" size={18} />
                      <span className="font-inter text-gray-700 text-sm">{item}</span>
                    </div>
                  ))}
                </div>

                <Link href="/book">
                  <a className="inline-block px-6 py-2 bg-navy text-gold font-inter font-semibold rounded hover:opacity-90 transition-opacity">
                    Request Quote
                  </a>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ SECTION */}
      <section className="bg-navy section-padding">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-playfair text-5xl text-white mb-16 text-center">Frequently Asked Questions</h2>
          
          <div className="space-y-8">
            {faqs.map((faq, index) => (
              <div key={index}>
                <h3 className="font-playfair text-xl text-gold mb-3">{faq.q}</h3>
                <p className="font-inter text-gray-100 leading-relaxed">{faq.a}</p>
                {index < faqs.length - 1 && <div className="border-b border-gold/20 mt-8"></div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TRUST BAR */}
      <section className="bg-cream section-padding">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="font-playfair text-4xl text-gold font-bold">100%</p>
              <p className="font-inter text-navy text-sm mt-2">Satisfaction Guaranteed</p>
            </div>
            <div>
              <p className="font-playfair text-4xl text-gold font-bold">♀</p>
              <p className="font-inter text-navy text-sm mt-2">Woman-Owned</p>
            </div>
            <div>
              <p className="font-playfair text-4xl text-gold font-bold">🔒</p>
              <p className="font-inter text-navy text-sm mt-2">Insured & Bonded</p>
            </div>
            <div>
              <p className="font-playfair text-4xl text-gold font-bold">⏰</p>
              <p className="font-inter text-navy text-sm mt-2">Flexible Scheduling</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-navy section-padding">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-playfair text-5xl text-white mb-4">Ready to Experience the Difference?</h2>
          <p className="font-inter text-xl text-gray-200 mb-10">
            Let's discuss your home's needs and create a custom cleaning plan.
          </p>
          <Link href="/book">
            <a className="inline-block px-10 py-4 bg-gold text-navy font-playfair text-lg font-bold rounded hover:opacity-90 transition-opacity">
              Request Your Quote
            </a>
          </Link>
        </div>
      </section>
    </div>
  )
}
