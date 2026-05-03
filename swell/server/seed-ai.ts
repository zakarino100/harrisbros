/**
 * Per-tenant AI config defaults.
 *
 * Each starter config is realistic enough that Hayden can run end-to-end
 * on day one. Boss can edit pricing, services, route cities later via
 * the (future) admin UI or by editing ai_configs directly.
 *
 * The numeric prices below already include $70 of headroom ($20 review
 * pledge + $50 transport waive) so Hayden can drop down to the floor
 * without hurting the actual margin.
 */

interface AIConfigSeed {
  enabled: number;
  model_primary: string;
  model_classifier: string;
  persona_name: string;
  business_name: string | null;
  services_json: string;
  pricing_matrix: string;
  route_cities_json: string;
  transport_waive: number;
  review_discount: number;
  business_hours_json: string;
  max_msgs_per_lead: number;
  max_tokens_per_msg: number;
  custom_brand_notes: string | null;
  pricing_locked: number;
}

export function defaultAIConfigForTenant(tenantId: string): AIConfigSeed | null {
  switch (tenantId) {
    case "mackwash":
      return {
        enabled: 1,
        model_primary: "claude-sonnet-4-6",
        model_classifier: "claude-haiku-4-5",
        persona_name: "Hayden",
        business_name: "Mack Wash",
        services_json: JSON.stringify([
          // Mack bills STRICTLY $150/hr. All prices = estimated hours x $150.
          // Base prices include $70 headroom ($20 review pledge + $50 transport waive).
          // Floor = actual $150/hr rate for the job. Do NOT go below floor.
          { key: "house_wash_sm",  label: "House Wash — Under 1,500 sqft",       base_price: 295, floor: 225, notes: "~1.5 hrs @ $150/hr = $225. Base includes $70 headroom for discounts." },
          { key: "house_wash_md",  label: "House Wash — 1,500–2,500 sqft",       base_price: 370, floor: 300, notes: "~2 hrs @ $150/hr = $300. Base includes $70 headroom." },
          { key: "house_wash_lg",  label: "House Wash — 2,500–4,000 sqft",       base_price: 520, floor: 450, notes: "~3 hrs @ $150/hr = $450. Base includes $70 headroom." },
          { key: "house_wash_xl",  label: "House Wash — 4,000+ sqft",            base_price: 670, floor: 600, notes: "~4 hrs @ $150/hr = $600. Base includes $70 headroom. Quote may vary for very large homes." },
          { key: "driveway",       label: "Driveway Pressure Wash",              base_price: 220, floor: 150, notes: "~1 hr @ $150/hr = $150. Base includes $70 headroom." },
          { key: "bundle_sm",      label: "House Wash + Driveway — Under 1,500", base_price: 445, floor: 375, notes: "~2.5 hrs @ $150/hr = $375. Best value — same trip. Base includes $70 headroom." },
          { key: "bundle_md",      label: "House Wash + Driveway — 1,500–2,500", base_price: 520, floor: 450, notes: "~3 hrs @ $150/hr = $450. Best value. Base includes $70 headroom." },
          { key: "bundle_lg",      label: "House Wash + Driveway — 2,500–4,000", base_price: 670, floor: 600, notes: "~4 hrs @ $150/hr = $600. Best value. Base includes $70 headroom." },
          { key: "walkway_patio",  label: "Walkway / Patio",                     base_price: 145, floor: 75,  notes: "~30–45 min add-on. Up to ~400 sqft." },
        ]),
        pricing_matrix: JSON.stringify({
          hourly_rate: 150,
          billing: "strictly $150/hr",
          avg_ticket: 300,
          quoting_rules: "Quote the house wash price ONLY based on sqft tier. Do NOT proactively quote driveway or walkway pricing — driveway size varies too much and must be measured on-site. If the customer asks about the driveway, say: 'We will quote that for you when we come out — we need to measure it to get you an accurate price, but we can put together a bundle deal to get everything done while we are there.' Then continue closing the house wash. Focus on locking in the house wash first. Upsell happens on-site.",
          notes: "Do NOT go below floor price. $20 off for a Google review pledge and $50 transport waive are baked into base prices. Never offer both discounts simultaneously.",
        }),
        route_cities_json: JSON.stringify([
          "Douglasville", "Lithia Springs", "Mableton", "Powder Springs",
          "Austell", "Hiram", "Dallas", "Villa Rica", "Smyrna", "Marietta",
        ]),
        transport_waive: 50,
        review_discount: 20,
        business_hours_json: JSON.stringify({
          tz: "America/New_York",
          open: "08:00",
          close: "19:00",
          days: [1, 2, 3, 4, 5, 6], // Mon–Sat
        }),
        max_msgs_per_lead: 30,
        max_tokens_per_msg: 600,
        custom_brand_notes:
          "Mack Wash is a local owner-operated pressure washing company in Douglasville GA. Soft-wash on houses — no high-pressure on siding/vinyl. Mack bills strictly $150/hr.\n\nQUOTING RULE: Quote the house wash price only based on sqft. Do NOT proactively bundle or quote driveway pricing — driveway size varies significantly and must be measured on-site. If the customer asks about driveway, say we will quote it when we come out but can do a bundle deal while there. Always close the house wash first.\n\nIf the lead already provided home size on the FB form, use it immediately without asking again. Junk removal coming soon — add to waitlist and hand off if asked.",
        pricing_locked: 1,
      };

    case "harris_bros":
      return {
        enabled: 1,
        model_primary: "claude-sonnet-4-6",
        model_classifier: "claude-haiku-4-5",
        persona_name: "Hayden",
        business_name: "Harris Brothers",
        services_json: JSON.stringify([
          // Pricing is pane-count based. Base prices include $70 headroom.
          // Exterior only:
          { key: "ext_25",  label: "Exterior Windows — 25 panes",         base_price: 295, floor: 225, notes: "Exterior only." },
          { key: "ext_40",  label: "Exterior Windows — 40 panes",         base_price: 395, floor: 325, notes: "Exterior only." },
          { key: "ext_60",  label: "Exterior Windows — 60 panes",         base_price: 495, floor: 425, notes: "Exterior only." },
          { key: "ext_80",  label: "Exterior Windows — 80 panes",         base_price: 645, floor: 575, notes: "Exterior only." },
          // Interior + Exterior:
          { key: "int_25",  label: "Interior + Exterior — 25 panes",      base_price: 215, floor: 145, notes: "Interior add-on to exterior price." },
          { key: "int_40",  label: "Interior + Exterior — 40 panes",      base_price: 265, floor: 195, notes: "Interior add-on to exterior price." },
          { key: "int_60",  label: "Interior + Exterior — 60 panes",      base_price: 315, floor: 245, notes: "Interior add-on to exterior price." },
          { key: "int_80",  label: "Interior + Exterior — 80 panes",      base_price: 415, floor: 345, notes: "Interior add-on to exterior price." },
          // Screens:
          { key: "screens_25", label: "Screen Cleaning — 25 panes",       base_price: 50,  floor: 50,  notes: "Add-on." },
          { key: "screens_40", label: "Screen Cleaning — 40 panes",       base_price: 100, floor: 100, notes: "Add-on." },
          { key: "screens_60", label: "Screen Cleaning — 60 panes",       base_price: 150, floor: 150, notes: "Add-on." },
          { key: "screens_80", label: "Screen Cleaning — 80 panes",       base_price: 200, floor: 200, notes: "Add-on." },
          // Recurring plans:
          { key: "quarterly",  label: "Quarterly Plan (4x/year)",          base_price: 0, floor: 0, notes: "Discount applied: 25=$100 off, 40=$125, 60=$150, 80=$200. Includes RainGuard, 14-day rain guarantee, touchup visits." },
          { key: "biannual",   label: "Bi-Annual Plan (2x/year)",          base_price: 0, floor: 0, notes: "Discount: 25=$50, 40=$60, 60=$75, 80=$100 off per visit." },
        ]),
        pricing_matrix: JSON.stringify({
          notes: "Ask how many windows/panes and whether they want exterior only or interior+exterior. Suggest screens as an add-on. Always pitch the quarterly plan — it includes RainGuard technology, a 14-day rain guarantee, and touchup visits. Many of these leads are warm re-contacts who didn't close previously.",
          quarterly_bonus: "RainGuard rain protection + 14-day rain guarantee + 1 complimentary touchup visit between cleanings",
        }),
        route_cities_json: JSON.stringify([
          // Tulsa market
          "Tulsa", "Broken Arrow", "Owasso", "Bixby", "Jenks", "Sand Springs",
          // Joplin market (MO + OK + KS)
          "Joplin", "Carthage", "Neosho", "Webb City", "Seneca",
          // Arkansas
          "Bentonville", "Rogers", "Springdale", "Bella Vista", "Fayetteville",
          // Springfield MO
          "Springfield", "Nixa", "Ozark", "Republic",
        ]),
        transport_waive: 50,
        review_discount: 20,
        business_hours_json: JSON.stringify({
          tz: "America/Chicago",  // Tulsa/Joplin/Springfield are Central
          open: "08:00",
          close: "18:00",
          days: [1, 2, 3, 4, 5, 6],
        }),
        max_msgs_per_lead: 30,
        max_tokens_per_msg: 600,
        custom_brand_notes:
          "Harris Brothers is a residential window cleaning company with routes in Tulsa OK, Joplin MO, Bentonville/Rogers AR, and Springfield MO. Owner is Rowdy. Pricing is pane-count based — ask how many windows and whether interior cleaning is needed too. Screens are a natural add-on. The quarterly plan is the flagship offer: RainGuard technology, rain guarantee, touchup visits. Many leads are previous contacts that didn’t close — warm re-engage tone, not a cold pitch.",
        pricing_locked: 1,
      };

    default:
      return null;
  }
}
