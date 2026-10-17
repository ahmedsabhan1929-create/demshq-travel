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
    nationality: "قد تختلف شروط التأشيرة وأسعارها حسب جنسية جواز السفر. يرجى تأكيد جنسية المسافر مع الشركة قبل الحجز."
  },
  currencyLabels: { USD: "$", IQD: "د.ع", EUR: "€", AED: "د.إ", TRY: "₺" },
  countries: {
    // (empty on purpose: no visa price/requirement has been verified yet)
  }
};
