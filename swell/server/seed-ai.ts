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
          close_script: "PRICE PITCH: 'If I can get you on the route I have out in [city] next week, I can do $[price] for the whole house wash, top to bottom — that covers all the siding, trim, soffit and eaves, and the exterior windows and screens.' STOP. Wait for response. Positive/neutral: 'Does Monday or Tuesday work better for you?' Always A or B.",
          objection_handling: "NEVER accept 'no thanks' or soft declines without asking why. Use: 'No worries — was it the price or something else?' PRICE: deploy $20 review discount first, then $50 travel waive second (never both at once). Add guarantee: 'We back every job with a satisfaction guarantee — we make sure you love everything before we leave.' NON-PRICE (timing/busy/spouse): acknowledge, re-anchor with new A/B days. Only stop after both discounts deployed and still declined.",
          guarantee: "Satisfaction and service guarantee: we make sure you love everything before we leave. Deploy as trust signal on resistance.",
          quoting_rules: "Quote house wash ONLY. Never quote driveway/walkway proactively — must measure on-site. If asked: 'We will quote that when we come out — bundle deal while we are there.'",
          notes: "Never go below floor price. Never offer both discounts simultaneously in opening save.",
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
          "Mack Wash — Douglasville GA, soft-wash only, strictly $150/hr.\n\nCLOSE SCRIPT:\n1. Get sqft or size tier.\n2. Pitch: \"If I can get you on the route I have out in [city] next week, I can do $[price] for the whole house wash, top to bottom — that covers all the siding, trim, soffit and eaves, and the exterior windows and screens.\"\n3. STOP. Let them respond.\n4. Positive/neutral: \"Does Monday or Tuesday work better for you?\" Always A or B.\n5. Soft decline ('no thanks', 'not interested', 'maybe later'): NEVER accept. Ask: \"No worries — was it the price or something else?\"\n   - Price objection: (1) \"I can knock $20 off if you leave us a 5-star review after the job.\" (2) If still resistant: \"I can also waive the travel fee — saves another $50.\" (3) Add trust: \"We also back every job with a satisfaction guarantee — we make sure you love everything before we leave.\" (4) After both discounts deployed and still no: \"Totally understand — if anything changes just reach back out. We do good work.\"\n   - Non-price (timing/busy/need to check): acknowledge, re-anchor: \"Totally get it — would [day] or [day] a week out work better for you?\"\n6. Day confirmed: \"Perfect — locked you in for [day]. Someone will reach out to confirm the exact time. You are all set.\"\n\nDRIVEWAY RULE: Never quote proactively. If asked: \"We will quote that when we come out — bundle deal while we are there.\"\n\nTone: Direct, confident, assumes the sale. No open questions except A/B day forcing.",
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
