import { useState, useEffect } from 'react'
import { Link } from 'wouter'
import { Menu, X } from 'lucide-react'

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const navItems = [
    { href: '/', label: 'Home' },
    { href: '/about', label: 'About' },
    { href: '/services', label: 'Services' },
  ]

  return (
    <nav
      className={`fixed w-full z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-navy/95 backdrop-blur-md shadow-lg'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-4 md:px-12 flex items-center justify-between">
        {/* Logo */}
        <Link href="/">
          <a className="flex items-center gap-2 cursor-pointer">
            <span className="font-playfair text-2xl font-bold">
              <span className="text-white">Mop</span>
              <span className="text-gold ml-2">Mafia</span>
            </span>
          </a>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <a className={`font-inter font-medium transition-colors ${
                scrolled ? 'text-white hover:text-gold' : 'text-white hover:text-gold'
              }`}>
                {item.label}
              </a>
            </Link>
          ))}
        </div>

        {/* Desktop CTA Button */}
        <div className="hidden md:block">
          <Link href="/book">
            <a className="px-6 py-2 bg-gold text-navy font-semibold rounded hover:opacity-90 transition-opacity">
              Book Now
            </a>
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden text-white p-2"
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="md:hidden bg-navy/95 backdrop-blur-md border-t border-gold/20">
          <div className="flex flex-col gap-4 px-6 py-6">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <a
                  className="font-inter font-medium text-white hover:text-gold transition-colors block"
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </a>
              </Link>
            ))}
            <Link href="/book">
              <a
                className="px-6 py-3 bg-gold text-navy font-semibold rounded text-center hover:opacity-90 transition-opacity block"
                onClick={() => setMobileOpen(false)}
              >
                Book Now
              </a>
            </Link>
          </div>
        </div>
      )}
    </nav>
  )
}
