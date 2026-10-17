/* =====================================================================
   Damashq Travel — extra country helpers (NOT visa data)
   aliases : extra search words per ISO-2 code (Arabic/English/abbreviations)
   points  : approximate [lat, lon] for territories that have no polygon of their own in
             data/countries.geojson (Natural Earth 50m folds them into a parent country or omits them).
             Used only to move the camera / draw the route — approximate, not survey data.
   ===================================================================== */
window.DAMASHQ_COUNTRY_EXTRAS = {
  aliases: {
    us: ["امريكا", "أمريكا", "الولايات المتحدة", "usa", "america", "united states"],
    gb: ["بريطانيا", "انجلترا", "إنجلترا", "uk", "britain", "england"],
    ae: ["الامارات", "الإمارات", "دبي", "ابوظبي", "uae", "dubai"],
    sa: ["السعودية", "ksa", "saudi"],
    tr: ["تركيا", "turkey", "turkiye", "türkiye", "اسطنبول", "إسطنبول", "istanbul"],
    cz: ["التشيك", "czech republic"],
    kr: ["كوريا", "korea", "south korea"],
    kp: ["كوريا", "korea", "north korea"],
    cd: ["الكونغو", "congo", "drc"],
    cg: ["الكونغو", "congo"],
    ci: ["ساحل العاج", "ivory coast"],
    mm: ["بورما", "burma"],
    sz: ["سوازيلاند", "swaziland"],
    mk: ["مقدونيا", "macedonia"],
    cv: ["الرأس الأخضر", "cape verde"],
    ps: ["فلسطين", "palestine"],
    tl: ["تيمور", "east timor"],
    vn: ["فيتنام", "vietnam", "viet nam"],
    ru: ["روسيا", "russia"],
    ir: ["ايران", "إيران", "iran"],
    sy: ["سوريا", "syria", "دمشق", "damascus"],
    la: ["لاوس", "laos"],
    bo: ["بوليفيا", "bolivia"],
    ve: ["فنزويلا", "venezuela"],
    tz: ["تنزانيا", "tanzania"],
    md: ["مولدوفا", "moldova"],
    va: ["الفاتيكان", "vatican", "holy see"],
    tw: ["تايوان", "taiwan"],
    fm: ["ميكرونيزيا", "micronesia"],
    sh: ["سانت هيلينا", "saint helena"],
    fk: ["فوكلاند", "falkland"],
    vg: ["جزر العذراء البريطانية", "british virgin islands"],
    vi: ["جزر العذراء الأمريكية", "us virgin islands"],
    sx: ["سانت مارتن", "sint maarten"],
    mf: ["سان مارتن", "saint martin"],
    bq: ["بونير", "bonaire"],
    do: ["الدومينيكان", "dominican"],
    cf: ["افريقيا الوسطى", "african republic"],
    de: ["ألمانيا", "المانيا", "deutschland"],
    gr: ["اليونان", "greece"],
    nl: ["هولندا", "holland"],
    my: ["ماليزيا", "كوالالمبور"],
    eg: ["مصر", "شرم الشيخ", "القاهرة"],
    az: ["اذربيجان", "أذربيجان", "باكو", "baku"]
  },
  points: {
    gf: [4.0, -53.0],   // French Guiana
    gp: [16.25, -61.55],// Guadeloupe
    mq: [14.65, -61.0], // Martinique
    re: [-21.1, 55.5],  // Réunion
    yt: [-12.8, 45.15], // Mayotte
    gi: [36.14, -5.35], // Gibraltar
    sj: [78.0, 16.0],   // Svalbard (Spitsbergen)
    bv: [-54.42, 3.36], // Bouvet Island
    cc: [-12.17, 96.87],// Cocos (Keeling) Islands
    cx: [-10.49, 105.63],// Christmas Island
    tk: [-9.2, -171.85],// Tokelau
    bq: [12.2, -68.3]   // Bonaire, Sint Eustatius and Saba
    // um (US Minor Outlying Islands): scattered across the Pacific — no single point, so no camera move
  }
};
