import { useState } from 'react'
import { Mail, Phone, MapPin, Send } from 'lucide-react'

export function QuoteTool() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    serviceType: 'standard',
    bedrooms: '',
    bathrooms: '',
    squareFeet: '',
    frequency: 'weekly',
    message: ''
  })

  const [submitted, setSubmitted] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    // Build email subject and body
    const emailSubject = `Quote Request from ${formData.name}`
    const emailBody = `
Name: ${formData.name}
Email: ${formData.email}
Phone: ${formData.phone}
Address: ${formData.address}

Service Type: ${formData.serviceType}
Bedrooms: ${formData.bedrooms}
Bathrooms: ${formData.bathrooms}
Square Feet: ${formData.squareFeet}
Desired Frequency: ${formData.frequency}

Additional Message:
${formData.message}
    `.trim()

    // Open email client
    window.location.href = `mailto:contact@mop-mafia.com?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
    
    setSubmitted(true)
    setTimeout(() => {
      setSubmitted(false)
      setFormData({
        name: '',
        email: '',
        phone: '',
        address: '',
        serviceType: 'standard',
        bedrooms: '',
        bathrooms: '',
        squareFeet: '',
        frequency: 'weekly',
        message: ''
      })
    }, 2000)
  }

  return (
    <div className="w-full">
      {submitted && (
        <div className="mb-8 p-6 bg-green-50 border-2 border-green-200 rounded-lg">
          <p className="font-inter font-semibold text-green-800">
            ✓ Thank you! Your quote request has been sent. We'll be in touch within 24 hours.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        {/* Form */}
        <div className="lg:col-span-2">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block font-inter font-semibold text-navy mb-2">Full Name *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg font-inter focus:outline-none focus:border-gold"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label className="block font-inter font-semibold text-navy mb-2">Email *</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg font-inter focus:outline-none focus:border-gold"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block font-inter font-semibold text-navy mb-2">Phone Number *</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg font-inter focus:outline-none focus:border-gold"
                  placeholder="(555) 123-4567"
                />
              </div>
              <div>
                <label className="block font-inter font-semibold text-navy mb-2">Service Type *</label>
                <select
                  name="serviceType"
                  value={formData.serviceType}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg font-inter focus:outline-none focus:border-gold"
                >
                  <option value="standard">Standard Clean</option>
                  <option value="deep">Deep Clean</option>
                  <option value="moveInOut">Move In/Move Out</option>
                  <option value="custom">Custom Service</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-inter font-semibold text-navy mb-2">Property Address *</label>
              <input
                type="text"
                name="address"
                value={formData.address}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg font-inter focus:outline-none focus:border-gold"
                placeholder="123 Luxury Lane, NC 12345"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block font-inter font-semibold text-navy mb-2">Bedrooms</label>
                <input
                  type="number"
                  name="bedrooms"
                  value={formData.bedrooms}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg font-inter focus:outline-none focus:border-gold"
                  placeholder="4"
                />
              </div>
              <div>
                <label className="block font-inter font-semibold text-navy mb-2">Bathrooms</label>
                <input
                  type="number"
                  name="bathrooms"
                  value={formData.bathrooms}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg font-inter focus:outline-none focus:border-gold"
                  placeholder="3"
                />
              </div>
              <div>
                <label className="block font-inter font-semibold text-navy mb-2">Square Feet</label>
                <input
                  type="number"
                  name="squareFeet"
                  value={formData.squareFeet}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg font-inter focus:outline-none focus:border-gold"
                  placeholder="5000"
                />
              </div>
            </div>

            <div>
              <label className="block font-inter font-semibold text-navy mb-2">Desired Frequency *</label>
              <select
                name="frequency"
                value={formData.frequency}
                onChange={handleChange}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg font-inter focus:outline-none focus:border-gold"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="oneTime">One-Time</option>
              </select>
            </div>

            <div>
              <label className="block font-inter font-semibold text-navy mb-2">Additional Notes</label>
              <textarea
                name="message"
                value={formData.message}
                onChange={handleChange}
                rows={4}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg font-inter focus:outline-none focus:border-gold"
                placeholder="Tell us about any specific needs, concerns, or preferences..."
              ></textarea>
            </div>

            <button
              type="submit"
              className="w-full px-8 py-4 bg-gold text-navy font-playfair text-lg font-bold rounded hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <Send size={20} />
              Request Your Quote
            </button>
          </form>
        </div>

        {/* Contact Info */}
        <div className="space-y-8">
          <div className="bg-navy text-white p-8 rounded-lg">
            <h3 className="font-playfair text-2xl mb-6 text-gold">Quick Contact</h3>
            
            <div className="space-y-6">
              <div className="flex gap-4">
                <Phone className="text-gold flex-shrink-0" size={24} />
                <div>
                  <p className="font-inter text-sm text-gray-300">Call us directly</p>
                  <a href="tel:(984)464-6019" className="font-playfair text-xl text-gold font-bold hover:opacity-80 transition-opacity">
                    (984) 464-6019
                  </a>
                </div>
              </div>

              <div className="flex gap-4">
                <Mail className="text-gold flex-shrink-0" size={24} />
                <div>
                  <p className="font-inter text-sm text-gray-300">Email us</p>
                  <a href="mailto:contact@mop-mafia.com" className="font-playfair text-lg text-gold font-bold hover:opacity-80 transition-opacity break-all">
                    contact@mop-mafia.com
                  </a>
                </div>
              </div>

              <div className="flex gap-4">
                <MapPin className="text-gold flex-shrink-0" size={24} />
                <div>
                  <p className="font-inter text-sm text-gray-300">Serving</p>
                  <p className="font-playfair text-lg text-gold font-bold">North Carolina</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-cream p-8 rounded-lg border-l-4 border-gold">
            <h4 className="font-playfair text-xl text-navy font-bold mb-4">Response Time</h4>
            <p className="font-inter text-gray-700 mb-4">
              We review all quotes within 24 hours and will contact you to discuss your home's specific needs.
            </p>
            <p className="font-inter text-sm text-gold font-semibold">
              No automated responses — just personal attention.
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="font-playfair text-xl text-navy font-bold">Why Choose Us</h4>
            <ul className="space-y-3">
              <li className="flex gap-2 font-inter text-gray-700">
                <span className="text-gold">✓</span> Woman-Owned & Family-Operated
              </li>
              <li className="flex gap-2 font-inter text-gray-700">
                <span className="text-gold">✓</span> No Contractors — Just Us
              </li>
              <li className="flex gap-2 font-inter text-gray-700">
                <span className="text-gold">✓</span> Insured & Bonded
              </li>
              <li className="flex gap-2 font-inter text-gray-700">
                <span className="text-gold">✓</span> 100+ Five-Star Reviews
              </li>
              <li className="flex gap-2 font-inter text-gray-700">
                <span className="text-gold">✓</span> Serving $1M+ Homes
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
