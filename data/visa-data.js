/* =====================================================================
   Damashq Travel — VISA DATA (edit this file to publish visa information)
   ---------------------------------------------------------------------
   Rules:
   - Only add a country when its information has been VERIFIED by the company.
   - Key = ISO 3166-1 alpha-2 code in lowercase (same codes as data/countries.json).
   - An entry is shown on the website ONLY if it has a `verified` date (YYYY-MM-DD).
     Entries without `verified` are ignored and the visitor sees the
     "contact us" message instead. Never publish guesses.
   - Every field except `verified` is optional; missing fields are simply not shown.
   - Visa rules often depend on passport nationality. Keep `nationalityNote: true`
     (the default) unless the rule truly applies to every traveler.

   Entry format (copy, uncomment, fill in with REAL verified values):

   //  tr: {
   //    verified: "YYYY-MM-DD",              // date the company verified this info (required)
   //    visaType: "…",                        // e.g. the exact visa category name
   //    price: { amount: 0, currency: "USD" },// currency code: USD, IQD, EUR …
   //    processing: "…",                      // verified processing time, free text
   //    documents: ["…", "…"],                // required documents
   //    conditions: ["…"],                    // important conditions / restrictions
   //    nationalityNote: true,                // show "confirm passport nationality" note
   //    source: "…"                           // internal note: where it was verified (not shown)
   //  },
   ===================================================================== */
window.DAMASHQ_VISA = {
  messages: {
    // shown for every country that has no verified entry below
    noData: "للاستفسار عن سعر التأشيرة والمتطلبات، تواصل معنا",
    noPrice: "يرجى التواصل لمعرفة السعر",
    estimateNote: "السعر تقديري وقد يتغير حسب نوع التأشيرة والرسوم والخدمات المطلوبة. يرجى التواصل لتأكيد السعر النهائي.",
    nationality: "قد تختلف شروط التأشيرة وأسعارها حسب جنسية جواز السفر. يرجى تأكيد جنسية المسافر مع الشركة قبل الحجز."
  },
  // number used by the "اتصل بنا" button (tel: link)
  contact: { tel: "+9647701716661" },
  // ESTIMATED starting prices in USD (company-supplied, NOT official fees and NOT verified).
  // Key = lowercase ISO-2 code. Edit/add numbers here; no design change needed.
  // A country with a full `verified` entry in `countries` below overrides this price.
  estimatedPrices: {
    currency: "USD",
    values: {
      tr: 50, ae: 120, sa: 100, qa: 80, jo: 60, eg: 50, lb: 50, ge: 40, az: 60, th: 70,
      my: 40, id: 70, in: 60, cn: 100, gb: 200, fr: 180, de: 180, it: 180, es: 180, gr: 170,
      nl: 180, ch: 180, us: 250, ca: 200, au: 180
    }
  },
  currencyLabels: { USD: "$", IQD: "د.ع", EUR: "€", AED: "د.إ", TRY: "₺" },
  countries: {
    // (empty on purpose: no visa price/requirement has been verified yet)
  }
};
