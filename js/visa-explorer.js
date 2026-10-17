/* =====================================================================
   Damashq Travel — Visa Explorer: interactive 3D globe + country search + visa panel
   Inputs (all relative paths, so it works under a GitHub Pages sub-path):
     data/countries.geojson   real country boundaries (Natural Earth 50m, user supplied)
     data/countries.json      250 countries/territories: ISO-2 code, AR/EN names, flag URL (user supplied ZIP)
     data/visa-data.js        verified visa information (window.DAMASHQ_VISA)
     data/country-extras.js   search aliases + approximate points for territories without polygons
   Rendering: Three.js r128 (already loaded by the page). Everything that is not 3D (data, search,
   panel, picking) works even if WebGL/Three.js is unavailable.
   ===================================================================== */
(function () {
  'use strict';
  var root = document.getElementById('visa-explorer');
  if (!root) return;

  /* ---------- helpers & config ---------- */
  var $ = function (s, r) { return (r || root).querySelector(s); };
  var RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DEV = /^(localhost|127\.|\[::1\])/.test(location.hostname) || location.protocol === 'file:' || /[?&]debug\b/.test(location.search);
  var VISA = window.DAMASHQ_VISA || { countries: {}, messages: {} };
  var EXTRA = window.DAMASHQ_COUNTRY_EXTRAS || { aliases: {}, points: {} };
  var MSG = Object.assign({ noData: 'للاستفسار عن سعر التأشيرة والمتطلبات، تواصل معنا', nationality: '' }, VISA.messages || {});
  var ERBIL = { lat: 36.19, lon: 44.01 };
  var DEG = Math.PI / 180;
  // popular destinations already used on the existing site (tours / booking form): Turkey, UAE, Malaysia, Egypt, Azerbaijan
  var POPULAR = ['tr', 'ae', 'my', 'eg', 'az', 'iq'];
  // route arcs drawn from Erbil: [label, lat, lon] — same destinations as the existing hero globe
  var ROUTES = [['Istanbul', 41.0, 29.0], ['Dubai', 25.2, 55.3], ['Kuala Lumpur', 3.1, 101.7], ['Sharm El-Sheikh', 27.9, 34.3], ['Baku', 40.4, 49.9]];

  function warn() { if (DEV && window.console) console.warn.apply(console, ['[visa-explorer]'].concat([].slice.call(arguments))); }
  function fail() { if (window.console) console.error.apply(console, ['[visa-explorer]'].concat([].slice.call(arguments))); }

  /* Arabic/Latin-insensitive normaliser for search */
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFKD')
      .replace(/[\u0300-\u036f\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^a-z0-9\u0600-\u06FF\u0750-\u077F\s]/g, ' ')
      .replace(/(^|\s)ال(?=[\u0600-\u06FF]{2})/g, '$1').replace(/\s+/g, ' ').trim();
  }

  /* contact number: reuse the number already used by the site's WhatsApp buttons (never hard-code a new one) */
  function siteWhatsApp() {
    var a = document.querySelector('a[href*="wa.me/"]');
    var m = a && a.getAttribute('href').match(/wa\.me\/(\d+)/);
    return m ? m[1] : null;
  }
  function siteTel() {
    var a = document.querySelector('a[href^="tel:"]');
    return a ? a.getAttribute('href') : null;
  }

  /* ---------- state ---------- */
  var countries = [];            // [{code,name_en,name_ar,flag_url,iso3,search}]
  var byCode = Object.create(null);
  var geo = null;                // {groups: Map(code|'#n' -> group), list: [group]}
  var geoState = 'idle';         // idle | loading | ok | error
  var selected = null;           // country object
  var gl = null;                 // globe controller (null when 3D is unavailable)

  /* ---------- flags (dataset URL -> png fallback -> emoji/code badge) ---------- */
  function emoji(code) {
    if (!/^[a-z]{2}$/.test(code)) return '';
    return String.fromCodePoint(0x1F1E6 + code.charCodeAt(0) - 97, 0x1F1E6 + code.charCodeAt(1) - 97);
  }
  function flagEl(c) {
    var w = document.createElement('span'); w.className = 'vx-flag'; w.setAttribute('aria-hidden', 'true');
    var img = new Image(), stage = 0; img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
    img.onerror = function () {
      if (stage === 0 && c.code) { stage = 1; img.src = 'https://flagcdn.com/w80/' + c.code + '.png'; return; }
      img.remove(); w.classList.add('fb'); w.textContent = c.code ? c.code.toUpperCase() : '—';
    };
    img.src = c.flag_url || ('https://flagcdn.com/' + c.code + '.svg');
    w.appendChild(img); return w;
  }

  /* ---------- load country list ---------- */
  function loadCountries() {
    return fetch('data/countries.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for data/countries.json');
      return r.json();
    }).then(function (list) {
      var seen = Object.create(null);
      list.forEach(function (c) {
        var code = String(c.code || '').trim().toLowerCase();
        if (!/^[a-z]{2}$/.test(code) || seen[code]) { if (seen[code]) warn('duplicate country code ignored:', code); return; }
        seen[code] = 1;
        var o = { code: code, name_en: c.name_en || code.toUpperCase(), name_ar: c.name_ar || c.name_en || code.toUpperCase(), flag_url: c.flag_url, iso3: '' };
        countries.push(o); byCode[code] = o;
      });
      countries.sort(function (a, b) { return a.name_ar.localeCompare(b.name_ar, 'ar'); });
      indexSearch();
    });
  }
  function indexSearch() {
    countries.forEach(function (c) {
      var al = (EXTRA.aliases && EXTRA.aliases[c.code]) || [];
      c.terms = [c.name_ar, c.name_en, c.code, c.iso3].concat(al).map(norm).filter(Boolean);
      c.hay = ' ' + c.terms.join(' | ') + ' ';
    });
  }

  /* ---------- GeoJSON indexing ---------- */
  function ringArea(r) { var s = 0; for (var i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(s / 2); }
  function ringCentroid(r) {
    var a = 0, cx = 0, cy = 0;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
    }
    if (Math.abs(a) < 1e-9) return r[0];
    return [cx / (3 * a), cy / (3 * a)];
  }
  function indexGeo(fc) {
    if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error('data/countries.geojson is not a FeatureCollection');
    var groups = Object.create(null), list = [], n = 0;
    fc.features.forEach(function (f) {
      var p = f.properties || {}, g = f.geometry; if (!g) return;
      var polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
      if (!polys) return;
      // match by ISO identifiers, never by name. ISO_A2_EH repairs the -99 values (France, Norway, Kosovo…)
      var code = null, cand = [p.ISO_A2_EH, p.ISO_A2];
      for (var i = 0; i < cand.length; i++) if (cand[i] && cand[i] !== '-99' && /^[A-Za-z]{2}$/.test(cand[i])) { code = cand[i].toLowerCase(); break; }
      var key = code || ('#' + (n++));
      var grp = groups[key];
      if (!grp) {
        grp = groups[key] = { key: key, code: code, polys: [], names: [], iso3: (p.ISO_A3_EH && p.ISO_A3_EH !== '-99') ? p.ISO_A3_EH : (p.ISO_A3 !== '-99' ? p.ISO_A3 : ''), label: p.NAME_AR || p.NAME_EN || p.NAME || '' };
        list.push(grp);
      }
      grp.names.push(p.NAME, p.NAME_LONG, p.NAME_EN, p.NAME_AR, p.ABBREV, p.FORMAL_EN);
      polys.forEach(function (rings) {
        var xs = 1e9, ys = 1e9, xe = -1e9, ye = -1e9;
        rings[0].forEach(function (q) { if (q[0] < xs) xs = q[0]; if (q[0] > xe) xe = q[0]; if (q[1] < ys) ys = q[1]; if (q[1] > ye) ye = q[1]; });
        grp.polys.push({ rings: rings, bb: [xs, ys, xe, ye], area: ringArea(rings[0]) });
      });
    });
    list.forEach(function (grp) {
      var bb = [1e9, 1e9, -1e9, -1e9], big = grp.polys[0];
      grp.polys.forEach(function (q) {
        if (q.bb[0] < bb[0]) bb[0] = q.bb[0]; if (q.bb[1] < bb[1]) bb[1] = q.bb[1]; if (q.bb[2] > bb[2]) bb[2] = q.bb[2]; if (q.bb[3] > bb[3]) bb[3] = q.bb[3];
        if (q.area > big.area) big = q;
      });
      grp.bb = bb;
      grp.center = ringCentroid(big.rings[0]);                         // [lon, lat] of the largest landmass
      if (!(grp.center[0] >= big.bb[0] && grp.center[0] <= big.bb[2] && grp.center[1] >= big.bb[1] && grp.center[1] <= big.bb[3])) grp.center = [(big.bb[0] + big.bb[2]) / 2, (big.bb[1] + big.bb[3]) / 2];
      grp.extent = Math.max((big.bb[2] - big.bb[0]) * Math.cos(grp.center[1] * DEG), big.bb[3] - big.bb[1]);   // degrees, of the main landmass
      if (grp.code && byCode[grp.code]) {
        byCode[grp.code].geo = grp;
        if (grp.iso3) byCode[grp.code].iso3 = grp.iso3;
        // extra search terms from the boundary file (alternate names), never used for matching geometry
        byCode[grp.code].geoNames = grp.names.filter(Boolean);
      } else if (grp.code) { warn('GeoJSON ISO code not in country list:', grp.code, grp.label); }
    });
    indexSearch();
    countries.forEach(function (c) { if (c.geoNames) { c.terms = c.terms.concat(c.geoNames.map(norm).filter(Boolean)); c.hay = ' ' + c.terms.join(' | ') + ' '; } });
    return { groups: groups, list: list };
  }
  function loadGeo() {
    if (geoState === 'loading' || geoState === 'ok') return Promise.resolve();
    geoState = 'loading'; setStatus('جاري تحميل حدود الدول…');
    return fetch('data/countries.geojson').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' while loading data/countries.geojson (check that the file is deployed next to index.html)');
      return r.json();
    }).then(function (fc) {
      geo = indexGeo(fc); geoState = 'ok';
      if (DEV) {
        var missing = countries.filter(function (c) { return !c.geo; }).map(function (c) { return c.code; });
        if (missing.length) warn(missing.length + ' list entries have no polygon in the GeoJSON (search/panel only):', missing.join(','));
      }
      if (gl) gl.setGeo(geo);
      setStatus('');
      document.dispatchEvent(new CustomEvent('vx:geo-ready'));
    }).catch(function (e) {
      geoState = 'error'; fail('could not load country boundaries:', e);
      setStatus('تعذّر تحميل حدود الدول' + (DEV ? ' — ' + e.message : ''), true);
    });
  }

  /* ---------- picking: lat/lon -> country (point in polygon on the real GeoJSON) ---------- */
  function inRing(x, y, r) {
    var c = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var a = r[i], b = r[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function inPoly(x, y, p, pad) {
    var bb = p.bb; pad = pad || 0;
    if (x < bb[0] - pad || x > bb[2] + pad || y < bb[1] - pad || y > bb[3] + pad) return false;
    var c = false; for (var i = 0; i < p.rings.length; i++) if (inRing(x, y, p.rings[i])) c = !c;   // even-odd: outer ring + holes
    return c;
  }
  /* returns a geo group, or null. `pad` (deg) lets tiny states be hit near their location */
  function pickGeo(lat, lon, pad) {
    if (!geo) return null;
    var best = null, i, j, g;
    for (i = 0; i < geo.list.length; i++) {
      g = geo.list[i];
      if (lon < g.bb[0] || lon > g.bb[2] || lat < g.bb[1] || lat > g.bb[3]) continue;
      for (j = 0; j < g.polys.length; j++) if (inPoly(lon, lat, g.polys[j])) return g;
    }
    if (pad) {                                 // generous second pass for micro-states / small islands
      var bd = 1e9;
      for (i = 0; i < geo.list.length; i++) {
        g = geo.list[i];
        if (g.extent > 3) continue;
        for (j = 0; j < g.polys.length; j++) {
          var q = g.polys[j];
          if (lon < q.bb[0] - pad || lon > q.bb[2] + pad || lat < q.bb[1] - pad || lat > q.bb[3] + pad) continue;
          var d = Math.hypot((q.bb[0] + q.bb[2]) / 2 - lon, (q.bb[1] + q.bb[3]) / 2 - lat);
          if (d < bd) { bd = d; best = g; }
        }
      }
    }
    return best;
  }

  /* ---------- status line ---------- */
  function setStatus(t, err) {
    var el = $('#vx-status'); if (!el) return;
    el.textContent = ''; if (!t) return;
    var s = document.createElement('span'); if (err) s.className = 'err'; s.textContent = t; el.appendChild(s);
  }

  /* ---------- visa panel ---------- */
  function verifiedVisa(code) {
    var v = VISA.countries && VISA.countries[code];
    return v && typeof v === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(v.verified || '')) ? v : null;
  }
  function money(p) {
    if (!p || typeof p.amount !== 'number' || !isFinite(p.amount)) return '';
    var lab = (VISA.currencyLabels && VISA.currencyLabels[p.currency]) || p.currency || '';
    return /^[$€₺]$/.test(lab) ? lab + p.amount.toLocaleString('en') : p.amount.toLocaleString('en') + ' ' + lab;
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function row(label, valueNode) { var r = el('div', 'vx-row'); r.appendChild(el('span', '', label)); var b = el('b'); if (typeof valueNode === 'string') b.textContent = valueNode; else b.appendChild(valueNode); r.appendChild(b); return r; }
  function listSec(title, items) {
    if (!items || !items.length) return null;
    var s = el('div', 'vx-sec'); s.appendChild(el('h4', '', title)); var u = el('ul');
    items.forEach(function (t) { u.appendChild(el('li', '', t)); }); s.appendChild(u); return s;
  }
  function renderPanel(c) {
    var p = $('#vx-panel'); p.textContent = ''; p.classList.remove('on');
    if (!c) {
      var ph = el('div', 'vx-ph'); var i = el('i', 'fa-solid fa-earth-asia'); ph.appendChild(i);
      ph.appendChild(el('b', '', 'اختر دولة لعرض معلومات التأشيرة'));
      ph.appendChild(el('span', '', 'انقر على أي دولة في الكرة الأرضية أو ابحث عنها بالاسم أو برمز ISO.'));
      p.appendChild(ph); return;
    }
    p.classList.add('on'); void p.offsetWidth;
    var hd = el('div', 'vx-hd'); hd.appendChild(flagEl(c));
    var t = el('div'); t.appendChild(el('h3', '', c.name_ar)); t.appendChild(el('div', 'vx-en', c.name_en));
    var iso = el('div', 'vx-iso'); iso.appendChild(el('span', '', c.code.toUpperCase())); if (c.iso3) iso.appendChild(el('span', '', c.iso3));
    t.appendChild(iso); hd.appendChild(t); p.appendChild(hd);

    var v = verifiedVisa(c.code);
    if (v) {
      var price = money(v.price);
      if (price) p.appendChild(row('سعر التأشيرة', el('span', 'vx-price', price)));
      if (v.visaType) p.appendChild(row('نوع التأشيرة', v.visaType));
      if (v.processing) p.appendChild(row('مدة المعالجة', v.processing));
      var d = listSec('المستندات المطلوبة', v.documents); if (d) p.appendChild(d);
      var cs = listSec('شروط مهمة', v.conditions); if (cs) p.appendChild(cs);
      if (v.nationalityNote !== false && MSG.nationality) p.appendChild(el('p', 'vx-note warn', MSG.nationality));
      p.appendChild(el('p', 'vx-note', 'آخر تحقق من المعلومات: ' + v.verified));
    } else {
      p.appendChild(el('div', 'vx-contact', MSG.noData));
    }
    if (geoState === 'ok' && !c.geo && !(EXTRA.points && EXTRA.points[c.code])) p.appendChild(el('p', 'vx-note', 'لا تتوفر حدود لهذا الإقليم في ملف الحدود الحالي، لذلك لا يمكن إبرازه على الكرة.'));

    var wa = siteWhatsApp(), cta = el('div', 'vx-cta');
    if (wa) {
      var text = 'مرحباً دمشق للسفر، أود الاستفسار عن التأشيرة إلى: ' + c.name_ar + ' (' + c.name_en + ') — ' + c.code.toUpperCase();
      var a = el('a', 'btn btn-wa'); a.href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent(text); a.target = '_blank'; a.rel = 'noopener';
      a.innerHTML = '<i class="fa-brands fa-whatsapp"></i> '; a.appendChild(document.createTextNode('استفسر عبر الواتساب')); cta.appendChild(a);
    }
    var tel = siteTel();
    if (tel) { var b = el('a', 'btn btn-ghost'); b.href = tel; b.innerHTML = '<i class="fa-solid fa-phone"></i> '; b.appendChild(document.createTextNode('اتصل بنا')); cta.appendChild(b); }
    p.appendChild(cta);
  }

  /* ---------- selection ---------- */
  function select(code, opts) {
    opts = opts || {};
    var c = typeof code === 'string' ? byCode[code.toLowerCase()] : code;
    if (!c) return false;
    selected = c; renderPanel(c);
    document.querySelectorAll('#vx-pop .vx-card').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.code === c.code)); });
    if (opts.fromSearch) { var q = $('#vx-q'); q.value = c.name_ar; $('#vx-clear').hidden = false; }
    if (gl) gl.focus(c, opts);
    if (opts.scroll) { var pn = $('#vx-panel'); if (pn.getBoundingClientRect().top > innerHeight * .9) pn.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'nearest' }); }
    return true;
  }

  /* ---------- search UI (combobox) ---------- */
  function score(c, q, tokens) {
    var t = c.terms, i, best = 0;
    if (q.length <= 3 && (c.code === q || c.iso3 && norm(c.iso3) === q)) return 100;
    for (i = 0; i < t.length; i++) { if (t[i] === q) best = Math.max(best, 90); else if (t[i].indexOf(q) === 0) best = Math.max(best, 70); }
    if (best) return best;
    for (i = 0; i < tokens.length; i++) if (c.hay.indexOf(' ' + tokens[i]) < 0) return 0;   // every word must start a word of the name
    return 50;
  }
  function search(query) {
    var q = norm(query);
    if (!q) return countries.slice();
    var tokens = q.split(' ');
    return countries.map(function (c) { return { c: c, s: score(c, q, tokens) }; }).filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s || a.c.name_ar.localeCompare(b.c.name_ar, 'ar'); }).map(function (x) { return x.c; });
  }
  function setupSearch() {
    var inp = $('#vx-q'), ul = $('#vx-list'), cnt = $('#vx-count'), clr = $('#vx-clear'), res = [], act = -1;
    function paint() {
      ul.textContent = '';
      if (!res.length) { var li = el('li', 'vx-empty-s', 'لا توجد نتائج مطابقة — جرّب اسماً آخر أو رمز ISO'); li.setAttribute('role', 'presentation'); li.style.cursor = 'default'; ul.appendChild(li); }
      var frag = document.createDocumentFragment();
      res.forEach(function (c, i) {
        var li = el('li'); li.id = 'vx-o-' + c.code; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === act)); li.dataset.code = c.code;
        li.appendChild(flagEl(c));
        var nm = el('span', 'nm'); nm.appendChild(el('b', '', c.name_ar)); nm.appendChild(el('small', '', c.name_en)); li.appendChild(nm);
        li.appendChild(el('span', 'cd', c.code.toUpperCase())); frag.appendChild(li);
      });
      ul.appendChild(frag);
      cnt.textContent = inp.value.trim() ? (res.length + ' نتيجة من ' + countries.length) : (countries.length + ' دولة وإقليم');
      inp.setAttribute('aria-activedescendant', act >= 0 && res[act] ? 'vx-o-' + res[act].code : '');
    }
    function open() { ul.hidden = false; inp.setAttribute('aria-expanded', 'true'); }
    function close() { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); act = -1; inp.setAttribute('aria-activedescendant', ''); }
    function update() { res = search(inp.value); act = res.length && inp.value.trim() ? 0 : -1; clr.hidden = !inp.value; paint(); open(); ul.scrollTop = 0; }
    function choose(code) { select(code, { fromSearch: true, scroll: true }); close(); }
    function move(d) {
      if (!res.length) return; act = (act + d + res.length) % res.length; paint();
      var o = document.getElementById('vx-o-' + res[act].code); if (o) o.scrollIntoView({ block: 'nearest' });
    }
    inp.addEventListener('input', update);
    inp.addEventListener('focus', function () { if (ul.hidden) update(); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (ul.hidden) update(); else move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { if (!ul.hidden && res[act]) { e.preventDefault(); choose(res[act].code); } }
      else if (e.key === 'Escape') { close(); }
    });
    ul.addEventListener('mousedown', function (e) { e.preventDefault(); });
    ul.addEventListener('click', function (e) { var li = e.target.closest('li[data-code]'); if (li) choose(li.dataset.code); });
    clr.addEventListener('click', function () { inp.value = ''; update(); inp.focus(); });
    document.addEventListener('pointerdown', function (e) { if (!e.target.closest('.vx-search')) close(); });
    res = countries.slice(); paint(); close();
    // expose for tests / debugging
    return { search: search, update: update };
  }
  function setupPopular() {
    var box = $('#vx-pop');
    POPULAR.forEach(function (code) {
      var c = byCode[code]; if (!c) return;
      var b = el('button', 'vx-card'); b.type = 'button'; b.dataset.code = code; b.setAttribute('aria-pressed', 'false');
      b.appendChild(flagEl(c)); b.appendChild(el('span', '', c.name_ar));
      b.addEventListener('click', function () { select(code, { scroll: true }); });
      box.appendChild(b);
    });
  }

  /* =====================================================================
     TEXTURES — painted straight from the GeoJSON polygons (equirectangular), so borders are the
     real boundaries and always sit exactly on the globe surface.
     ===================================================================== */
  function xy(lon, lat, W, H) { return [(lon + 180) / 360 * W, (90 - lat) / 180 * H]; }
  function tracePoly(ctx, p, W, H) {
    p.rings.forEach(function (r) {
      for (var i = 0; i < r.length; i++) { var q = xy(r[i][0], r[i][1], W, H); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
      ctx.closePath();
    });
  }
  /* stroke rings but skip the artificial cut along ±180° (Russia, Fiji, Antarctica are split there) */
  function strokePoly(ctx, p, W, H) {
    ctx.beginPath();
    p.rings.forEach(function (r) {
      var pen = false;
      for (var i = 0; i < r.length; i++) {
        var a = r[i], b = r[(i + 1) % r.length];
        var cut = (Math.abs(a[0]) >= 179.9999 && Math.abs(b[0]) >= 179.9999) || Math.abs(a[0] - b[0]) > 180;
        var qa = xy(a[0], a[1], W, H);
        if (!pen) { ctx.moveTo(qa[0], qa[1]); pen = true; }
        if (cut) { pen = false; continue; }
        var qb = xy(b[0], b[1], W, H); ctx.lineTo(qb[0], qb[1]);
      }
    });
    ctx.stroke();
  }
  function paintBase(cv, geo) {
    var W = cv.width, H = cv.height, c = cv.getContext('2d'), k = W / 2048;
    var g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a2540'); g.addColorStop(.5, '#0c3152'); g.addColorStop(1, '#0a2540');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // faint graticule
    c.strokeStyle = 'rgba(140,200,255,.07)'; c.lineWidth = Math.max(1, k * .8); c.beginPath();
    for (var lo = -180; lo <= 180; lo += 30) { var x = (lo + 180) / 360 * W; c.moveTo(x, 0); c.lineTo(x, H); }
    for (var la = -60; la <= 60; la += 30) { var y = (90 - la) / 180 * H; c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    if (!geo) return;
    // land
    c.fillStyle = '#17496f';
    geo.list.forEach(function (grp) { grp.polys.forEach(function (p) { c.beginPath(); tracePoly(c, p, W, H); c.fill('evenodd'); }); });
    // soft inner tone: countries with a verified visa entry get a slightly warmer land colour
    c.fillStyle = 'rgba(230,184,102,.10)';
    geo.list.forEach(function (grp) { if (grp.code && verifiedVisa(grp.code)) grp.polys.forEach(function (p) { c.beginPath(); tracePoly(c, p, W, H); c.fill('evenodd'); }); });
    // borders + coastlines (thin, softly lit)
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = 'rgba(127,227,255,.30)'; c.lineWidth = 2.6 * k;
    geo.list.forEach(function (grp) { grp.polys.forEach(function (p) { strokePoly(c, p, W, H); }); });
    c.strokeStyle = 'rgba(236,214,160,.92)'; c.lineWidth = 0.95 * k;
    geo.list.forEach(function (grp) { grp.polys.forEach(function (p) { strokePoly(c, p, W, H); }); });
  }
  function paintSpec(cv, geo) {      // ocean = shiny, land = matte
    var W = cv.width, H = cv.height, c = cv.getContext('2d');
    c.fillStyle = '#9aa'; c.fillRect(0, 0, W, H); if (!geo) return;
    c.fillStyle = '#000';
    geo.list.forEach(function (grp) { grp.polys.forEach(function (p) { c.beginPath(); tracePoly(c, p, W, H); c.fill('evenodd'); }); });
  }
  function paintSelection(fill, line, grp) {
    [fill, line].forEach(function (cv) { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); });
    if (!grp) return;
    var W = fill.width, H = fill.height, f = fill.getContext('2d'), l = line.getContext('2d'), k = W / 2048;
    f.fillStyle = 'rgba(230,184,102,.55)';
    grp.polys.forEach(function (p) { f.beginPath(); tracePoly(f, p, W, H); f.fill('evenodd'); });
    l.lineJoin = 'round'; l.lineCap = 'round';
    l.strokeStyle = 'rgba(127,227,255,.55)'; l.lineWidth = 6 * k; grp.polys.forEach(function (p) { strokePoly(l, p, W, H); });
    l.strokeStyle = '#fff6dc'; l.lineWidth = 2.2 * k; grp.polys.forEach(function (p) { strokePoly(l, p, W, H); });
  }

  /* =====================================================================
     3D GLOBE (Three.js r128)
     Coordinate convention (matches THREE.SphereGeometry + equirectangular map):
       P(lat,lon) = ( cos(lat)·cos(lon),  sin(lat),  −cos(lat)·sin(lon) )
     ===================================================================== */
  function P(T, lat, lon, r) {
    lat *= DEG; lon *= DEG; r = r == null ? 1 : r;
    return new T.Vector3(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon));
  }
  function initGlobe() {
    var T = window.THREE, frame = $('#vx-frame'), canvas = $('#vx-canvas');
    if (!T || !canvas) { showFallback('no-three'); return null; }
    var rd;
    try { rd = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (e) { fail('WebGL unavailable', e); showFallback('no-webgl'); return null; }
    if (!rd.getContext()) { showFallback('no-webgl'); return null; }

    var small = innerWidth < 760 || /Mobi|Android/i.test(navigator.userAgent);
    var maxTex = rd.capabilities.maxTextureSize || 2048;
    var TW = (!small && maxTex >= 4096) ? 4096 : 2048;           // base texture width (height = width/2)
    var SW = 2048;                                                // selection overlay width
    rd.setClearColor(0x000000, 0);
    if (T.sRGBEncoding) rd.outputEncoding = T.sRGBEncoding;

    var scene = new T.Scene(), cam = new T.PerspectiveCamera(40, 1, .1, 200);
    var world = new T.Group(); scene.add(world);              // rotates with the user
    var globeGroup = new T.Group(); world.add(globeGroup);

    /* textures */
    function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    var baseCv = mkCanvas(TW, TW / 2), specCv = mkCanvas(1024, 512);
    paintBase(baseCv, null); paintSpec(specCv, null);
    var aniso = Math.min(8, rd.capabilities.getMaxAnisotropy ? rd.capabilities.getMaxAnisotropy() : 1);
    var baseTex = new T.CanvasTexture(baseCv); baseTex.anisotropy = aniso; if (T.sRGBEncoding) baseTex.encoding = T.sRGBEncoding;
    var specTex = new T.CanvasTexture(specCv);

    /* earth: lit by a fixed "sun" (terminator = soft shadow), emissive copy of the map keeps borders readable on the night side */
    var earthMat = new T.MeshPhongMaterial({ map: baseTex, specularMap: specTex, specular: new T.Color(0x4a7a9a), shininess: 28,
      emissive: new T.Color(0x5c7a96), emissiveMap: baseTex, emissiveIntensity: .55 });
    var earth = new T.Mesh(new T.SphereGeometry(1, 96, 64), earthMat); globeGroup.add(earth);

    /* selection overlays (fill + glowing outline) */
    var selFillCv = mkCanvas(SW, SW / 2), selLineCv = mkCanvas(SW, SW / 2);
    var selFillTex = new T.CanvasTexture(selFillCv), selLineTex = new T.CanvasTexture(selLineCv);
    if (T.sRGBEncoding) { selFillTex.encoding = T.sRGBEncoding; selLineTex.encoding = T.sRGBEncoding; }
    var selGeo = new T.SphereGeometry(1.0025, 96, 64);
    var selFill = new T.Mesh(selGeo, new T.MeshBasicMaterial({ map: selFillTex, transparent: true, opacity: 0, depthWrite: false }));
    var selLine = new T.Mesh(new T.SphereGeometry(1.004, 96, 64), new T.MeshBasicMaterial({ map: selLineTex, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
    globeGroup.add(selFill); globeGroup.add(selLine);

    /* lights */
    scene.add(new T.AmbientLight(0x3c5f80, .75));
    var sun = new T.DirectionalLight(0xfff1d6, 1.35); sun.position.set(4.5, 2.4, 4); scene.add(sun);
    var rim = new T.DirectionalLight(0x4aa8ff, .5); rim.position.set(-4, -1, -3); scene.add(rim);

    /* atmosphere: outer glow (back faces) + thin lit rim on the surface */
    var atmVS = 'varying vec3 vN;varying vec3 vV;void main(){vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}';
    var glow = new T.Mesh(new T.SphereGeometry(1.16, 64, 48), new T.ShaderMaterial({ transparent: true, side: T.BackSide, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: atmVS, fragmentShader: 'varying vec3 vN;varying vec3 vV;void main(){float a=clamp(-dot(normalize(vN),normalize(vV))*2.2,0.,1.);gl_FragColor=vec4(.30,.62,.95,1.)*pow(a,2.2)*.95;}' }));
    scene.add(glow);
    var rimMesh = new T.Mesh(new T.SphereGeometry(1.012, 64, 48), new T.ShaderMaterial({ transparent: true, side: T.FrontSide, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: atmVS, fragmentShader: 'varying vec3 vN;varying vec3 vV;void main(){float f=pow(1.-clamp(dot(vN,vV),0.,1.),3.2);gl_FragColor=vec4(.42,.78,1.,1.)*f*.55;}' }));
    scene.add(rimMesh);

    /* particles: far stars + a faint drifting dust halo around the planet */
    function cloud(n, r0, r1, size, color, op) {
      var a = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) { var u = Math.random() * 2 - 1, t = Math.random() * 6.2832, s = Math.sqrt(1 - u * u), r = r0 + Math.random() * (r1 - r0); a[i * 3] = r * s * Math.cos(t); a[i * 3 + 1] = r * u; a[i * 3 + 2] = r * s * Math.sin(t); }
      var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(a, 3));
      return new T.Points(g, new T.PointsMaterial({ color: color, size: size, sizeAttenuation: true, transparent: true, opacity: op, depthWrite: false }));
    }
    var stars = cloud(small ? 700 : 1400, 40, 90, .16, 0xffffff, .75); scene.add(stars);
    var dust = cloud(small ? 120 : 260, 1.3, 2.3, .012, 0xf0d9a0, .5); scene.add(dust);

    /* Erbil: marker, beacon, pulse rings */
    var ev = P(T, ERBIL.lat, ERBIL.lon, 1), Z = new T.Vector3(0, 0, 1);
    var erbilCore = new T.Mesh(new T.SphereGeometry(.018, 20, 20), new T.MeshBasicMaterial({ color: 0xfff2c8 })); erbilCore.position.copy(ev).multiplyScalar(1.006); globeGroup.add(erbilCore);
    var erbilHalo = new T.Mesh(new T.SphereGeometry(.04, 20, 20), new T.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: .3, depthWrite: false, blending: T.AdditiveBlending })); erbilHalo.position.copy(erbilCore.position); globeGroup.add(erbilHalo);
    globeGroup.add(new T.Line(new T.BufferGeometry().setFromPoints([ev.clone().multiplyScalar(1.006), ev.clone().multiplyScalar(1.09)]), new T.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: .85 })));
    var rings = [0, .5].map(function (ph) {
      var m = new T.Mesh(new T.RingGeometry(.016, .022, 48), new T.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
      m.position.copy(ev).multiplyScalar(1.005); m.quaternion.setFromUnitVectors(Z, ev.clone().normalize()); globeGroup.add(m); return { m: m, ph: ph };
    });

    /* routes from Erbil */
    function arcPts(a, b, n, lift) {
      var ang = a.angleTo(b), pts = [], sn = Math.sin(ang) || 1e-6;
      for (var k = 0; k <= n; k++) {
        var t = k / n, v = a.clone().multiplyScalar(Math.sin((1 - t) * ang) / sn).add(b.clone().multiplyScalar(Math.sin(t * ang) / sn)).normalize();
        pts.push(v.multiplyScalar(1.002 + Math.sin(Math.PI * t) * lift * (.35 + ang / Math.PI)));
      }
      return pts;
    }
    var routes = ROUTES.map(function (d, i) {
      var b = P(T, d[1], d[2], 1), pts = arcPts(ev.clone().normalize(), b.clone().normalize(), 72, .22);
      var geom = new T.BufferGeometry().setFromPoints(pts), mat = new T.LineBasicMaterial({ color: 0xe6b866, transparent: true, opacity: .55, depthWrite: false });
      var line = new T.Line(geom, mat); globeGroup.add(line);
      var dm = new T.Mesh(new T.SphereGeometry(.009, 10, 10), new T.MeshBasicMaterial({ color: 0xffffff })); globeGroup.add(dm);
      var end = new T.Mesh(new T.SphereGeometry(.008, 10, 10), new T.MeshBasicMaterial({ color: 0xe6b866 })); end.position.copy(b).multiplyScalar(1.004); globeGroup.add(end);
      return { pts: pts, line: line, dot: dm, off: i * .35, n: pts.length - 1 };
    });
    /* arc to the selected country */
    var selArc = null, selDot = new T.Mesh(new T.SphereGeometry(.013, 12, 12), new T.MeshBasicMaterial({ color: 0x9be9ff })); selDot.visible = false; globeGroup.add(selDot);
    var selPin = new T.Mesh(new T.RingGeometry(.02, .028, 40), new T.MeshBasicMaterial({ color: 0x9be9ff, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending })); globeGroup.add(selPin);
    var selPts = null, selT0 = 0;
    function setSelArc(lat, lon) {
      if (selArc) { globeGroup.remove(selArc); selArc.geometry.dispose(); selArc.material.dispose(); selArc = null; }
      selPts = null; selDot.visible = false; selPin.material.opacity = 0;
      if (lat == null) return;
      var b = P(T, lat, lon, 1);
      selPin.position.copy(b).multiplyScalar(1.006); selPin.quaternion.setFromUnitVectors(Z, b.clone().normalize());
      if (b.angleTo(ev) < .04) return;                          // selected country is Erbil's own
      selPts = arcPts(ev.clone().normalize(), b.clone().normalize(), 96, .26);
      selArc = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(selPts), 96, .0032, 6, false), new T.MeshBasicMaterial({ color: 0x9be9ff, transparent: true, opacity: .95, depthWrite: false, blending: T.AdditiveBlending }));
      selArc.geometry.setDrawRange(0, 0); globeGroup.add(selArc);
    }

    /* Erbil label (DOM) */
    var lbl = $('#vx-erbil'), lbls = $('#vx-labels');
    /* camera state ------------------------------------------------------ */
    var CAM_MIN = 1.38, CAM_MAX = 5.4, CAM_START = 3.7;
    var st = { y: 0, x: 0, d: CAM_START }, tg = { y: 0, x: 0, d: CAM_START };
    function viewFor(lat, lon) { return { y: -(lon * DEG + Math.PI / 2), x: Math.max(-1.25, Math.min(1.25, lat * DEG)) }; }
    function nearestYaw(y, ref) { var d = (y - ref) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return ref + d; }
    function flyTo(lat, lon, dist) {
      var v = viewFor(lat, lon); tg.y = nearestYaw(v.y, st.y); tg.x = v.x; tg.d = Math.max(CAM_MIN, Math.min(CAM_MAX, dist));
      if (RM) { st.y = tg.y; st.x = tg.x; st.d = tg.d; }
      dirty = true; run();
    }
    var ev0 = viewFor(ERBIL.lat, ERBIL.lon);
    tg.y = ev0.y; tg.x = ev0.x * .85; tg.d = CAM_START;
    if (RM) { st.y = tg.y; st.x = tg.x; st.d = tg.d; }
    else { st.y = ev0.y + 1.9; st.x = ev0.x * .6; st.d = 5.0; }          // cinematic intro: swing in towards Erbil

    /* sizing ---------------------------------------------------------- */
    var W = 0, H = 0;
    function resize() {
      var r = frame.getBoundingClientRect(); W = Math.max(200, Math.round(r.width)); H = Math.max(200, Math.round(r.height));
      rd.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2)); rd.setSize(W, H, false);
      cam.aspect = W / H; cam.updateProjectionMatrix(); dirty = true;
    }
    var dirty = true;
    if (window.ResizeObserver) new ResizeObserver(resize).observe(frame); else addEventListener('resize', resize);
    resize();

    /* picking ---------------------------------------------------------- */
    var ray = new T.Raycaster(), ndc = new T.Vector2(), inv = new T.Matrix4(), sph = new T.Sphere(new T.Vector3(0, 0, 0), 1), hitPt = new T.Vector3();
    function latLonAt(clientX, clientY) {
      var r = canvas.getBoundingClientRect(); ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      cam.updateMatrixWorld(); world.updateMatrixWorld(true);
      ray.setFromCamera(ndc, cam);
      if (!ray.ray.intersectSphere(sph, hitPt)) return null;           // analytic: cheap enough to run on every mouse move
      inv.copy(globeGroup.matrixWorld).invert();
      var p = hitPt.clone().applyMatrix4(inv).normalize();
      return { lat: Math.asin(Math.max(-1, Math.min(1, p.y))) / DEG, lon: Math.atan2(-p.z, p.x) / DEG };
    }
    function groupAt(cx, cy) {
      var ll = latLonAt(cx, cy); if (!ll) return null;
      return { g: pickGeo(ll.lat, ll.lon, Math.max(.35, st.d * .22)), ll: ll };
    }

    /* interaction -------------------------------------------------------- */
    var ptrs = new Map(), drag = null, pinch0 = 0, vel = { y: 0, x: 0 }, lastInteract = performance.now(), auto = !RM, tip = $('#vx-tip'), hoverKey = null;
    var tools = { in: $('#vx-zin'), out: $('#vx-zout'), reset: $('#vx-reset'), spin: $('#vx-spin') };
    function speed() { return .0055 * (st.d / CAM_START) * 1.0; }
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: 0 };
      if (ptrs.size === 2) { var a = Array.from(ptrs.values()); pinch0 = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); drag = null; }
      canvas.classList.add('drag'); vel.y = vel.x = 0; lastInteract = performance.now(); tip.hidden = true;
    });
    canvas.addEventListener('pointermove', function (e) {
      var p = ptrs.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      if (ptrs.size === 2) {
        var a = Array.from(ptrs.values()), dd = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (pinch0) { tg.d = st.d = Math.max(CAM_MIN, Math.min(CAM_MAX, st.d * pinch0 / dd)); dirty = true; } pinch0 = dd; lastInteract = performance.now(); return;
      }
      if (drag && p) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
        var k = speed(); vel.y = dx * k; vel.x = dy * k;
        st.y += dx * k; st.x = Math.max(-1.35, Math.min(1.35, st.x + dy * k)); tg.y = st.y; tg.x = st.x; dirty = true; lastInteract = performance.now();
      } else if (!ptrs.size && e.pointerType === 'mouse') hover(e);
    });
    function end(e) {
      var wasDrag = drag; ptrs.delete(e.pointerId); canvas.classList.remove('drag'); if (ptrs.size < 2) pinch0 = 0;
      if (wasDrag && ptrs.size === 0) {
        if (wasDrag.moved < 7 && performance.now() - wasDrag.t < 600) clickAt(e.clientX, e.clientY);
        drag = null;
      }
      lastInteract = performance.now();
    }
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', function (e) { ptrs.delete(e.pointerId); drag = null; canvas.classList.remove('drag'); });
    canvas.addEventListener('pointerleave', function () { tip.hidden = true; canvas.classList.remove('hit'); hoverKey = null; });
    canvas.addEventListener('wheel', function (e) {
      var nd = st.d * Math.exp(e.deltaY * .0012);
      if ((e.deltaY > 0 && st.d >= CAM_MAX - .001) || (e.deltaY < 0 && st.d <= CAM_MIN + .001)) return;      // let the page scroll at the limits
      e.preventDefault(); tg.d = Math.max(CAM_MIN, Math.min(CAM_MAX, nd)); st.d += (tg.d - st.d) * .6; lastInteract = performance.now(); dirty = true;
    }, { passive: false });
    function hover(e) {
      var h = groupAt(e.clientX, e.clientY), g = h && h.g, key = g ? g.key : null;
      if (key === hoverKey) { if (g && !tip.hidden) positionTip(e); return; }
      hoverKey = key;
      if (!g) { tip.hidden = true; canvas.classList.remove('hit'); return; }
      var c = g.code && byCode[g.code]; canvas.classList.add('hit');
      tip.textContent = c ? c.name_ar + ' — ' + c.name_en : (g.label || ''); tip.hidden = false; positionTip(e);
    }
    function positionTip(e) { var r = frame.getBoundingClientRect(); tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (e.clientY - r.top) + 'px'; }
    function clickAt(cx, cy) {
      var h = groupAt(cx, cy); if (!h) return;
      if (!h.g) return;
      if (!h.g.code || !byCode[h.g.code]) { setStatus((h.g.label || 'هذه المنطقة') + ' — غير مدرجة ضمن قائمة الدول'); setTimeout(function () { setStatus(''); }, 2600); return; }
      select(h.g.code, { fromGlobe: true, scroll: true });
    }
    function zoom(f) { tg.d = Math.max(CAM_MIN, Math.min(CAM_MAX, tg.d * f)); lastInteract = performance.now(); if (RM) st.d = tg.d; dirty = true; run(); }
    if (tools.in) tools.in.addEventListener('click', function () { zoom(.78); });
    if (tools.out) tools.out.addEventListener('click', function () { zoom(1.28); });
    if (tools.reset) tools.reset.addEventListener('click', function () { flyTo(ERBIL.lat, ERBIL.lon, CAM_START); lastInteract = performance.now(); });
    if (tools.spin) { tools.spin.setAttribute('aria-pressed', String(auto)); tools.spin.addEventListener('click', function () { auto = !auto; tools.spin.setAttribute('aria-pressed', String(auto)); tools.spin.setAttribute('aria-label', auto ? 'إيقاف الدوران التلقائي' : 'تشغيل الدوران التلقائي'); }); }
    if (RM && tools.spin) { auto = false; tools.spin.setAttribute('aria-pressed', 'false'); tools.spin.hidden = true; }
    if (lbl) lbl.addEventListener('click', function () { flyTo(ERBIL.lat, ERBIL.lon, 2.3); });
    frame.addEventListener('keydown', function (e) {
      var k = .12 * st.d / CAM_START, used = true;
      if (e.key === 'ArrowLeft') { tg.y = st.y -= k; } else if (e.key === 'ArrowRight') { tg.y = st.y += k; }
      else if (e.key === 'ArrowUp') { tg.x = st.x = Math.max(-1.35, st.x - k); } else if (e.key === 'ArrowDown') { tg.x = st.x = Math.min(1.35, st.x + k); }
      else if (e.key === '+' || e.key === '=') zoom(.85); else if (e.key === '-' || e.key === '_') zoom(1.18); else used = false;
      if (used) { e.preventDefault(); lastInteract = performance.now(); dirty = true; }
    });

    /* selection from the UI ------------------------------------------------ */
    var selStart = 0, curGroup = null, selTarget = null;
    function focus(c, opts) {
      var grp = c && c.geo, lat, lon, ext;
      var pt = c && EXTRA.points && EXTRA.points[c.code];
      if (grp) { lon = grp.center[0]; lat = grp.center[1]; ext = grp.extent; }
      else if (pt) { lat = pt[0]; lon = pt[1]; ext = 4; }
      curGroup = grp || null; selStart = performance.now();
      paintSelection(selFillCv, selLineCv, grp); selFillTex.needsUpdate = true; selLineTex.needsUpdate = true; dirty = true; run();
      auto = false; if (tools.spin) tools.spin.setAttribute('aria-pressed', 'false');
      if (lat == null) { setSelArc(null); selTarget = null; dirty = true; return; }
      selTarget = [lat, lon];
      flyTo(lat, lon, 1.34 + Math.min(ext, 70) * .034 + (ext > 40 ? .3 : 0));
      setSelArc(lat, lon); dirty = true;
    }
    function setGeo(g) {
      paintBase(baseCv, g); paintSpec(specCv, g); baseTex.needsUpdate = true; specTex.needsUpdate = true;
      if (selected && selected.geo) focus(selected);
      dirty = true; run();
    }

    /* render loop --------------------------------------------------------------- */
    var vis = true, raf = 0, last = performance.now(), t0 = performance.now(), tv = new T.Vector3(), tp = new T.Vector3(), cp = new T.Vector3();
    function frameFn(now) {
      raf = 0; if (!vis) return;
      var dt = Math.min(.1, (now - last) / 1000); last = now; var t = (now - t0) / 1000;
      // camera easing (inertia after a drag, optional slow auto-rotation, eased fly-to)
      var ke = RM ? 1 : 1 - Math.exp(-dt * 3.6);
      if (!drag && ptrs.size === 0) {
        if (Math.abs(vel.y) > 1e-5 || Math.abs(vel.x) > 1e-5) {
          st.y += vel.y; st.x = Math.max(-1.35, Math.min(1.35, st.x + vel.x)); tg.y = st.y; tg.x = st.x; vel.y *= .93; vel.x *= .93;
        } else {
          if (auto && !RM && now - lastInteract > 3500) tg.y += dt * .07;
          st.y += (tg.y - st.y) * ke; st.x += (tg.x - st.x) * ke;
        }
      }
      st.d += (tg.d - st.d) * ke;
      world.rotation.set(st.x, st.y, 0, 'XYZ');
      cam.position.set(0, 0, st.d);
      cam.near = Math.max(.05, st.d - 1.3); cam.updateProjectionMatrix();
      // ambient motion
      if (!RM) { stars.rotation.y = t * .004; dust.rotation.y = t * .02; dust.rotation.x = Math.sin(t * .1) * .1; }
      // overlay animation
      var sa = RM ? 1 : Math.min(1, (now - selStart) / 700);
      selFill.material.opacity = curGroup ? (RM ? .55 : sa * (.5 + .12 * Math.sin(t * 2.2))) : 0;
      selLine.material.opacity = curGroup ? (RM ? .95 : sa * (.8 + .2 * Math.sin(t * 3))) : 0;
      // Erbil pulse
      rings.forEach(function (r) { var u = RM ? .35 : ((t * .5 + r.ph) % 1); r.m.scale.setScalar(1 + u * 6.5); r.m.material.opacity = (1 - u) * .75 * (RM ? .5 : 1); });
      erbilHalo.scale.setScalar(RM ? 1 : .85 + .15 * Math.sin(t * 3));
      // route arcs: reveal then travelling dot
      routes.forEach(function (o) {
        var f = RM ? 1 : Math.min(1, Math.max(0, (t - .8 - o.off) / 1.6)); o.line.geometry.setDrawRange(0, Math.max(2, Math.floor(f * (o.n + 1))));
        o.dot.visible = f >= 1; if (o.dot.visible) o.dot.position.copy(o.pts[Math.min(o.n, Math.floor((((RM ? .5 : t * .2) + o.off) % 1) * o.n))]);
      });
      if (selArc && selPts) {
        var f2 = RM ? 1 : Math.min(1, (now - selStart) / 1100), idx = Math.floor(f2 * 96) * 6 * 6;       // tube = 96 segments × 6 radial sides × 6 indices
        selArc.geometry.setDrawRange(0, idx); selDot.visible = f2 >= 1;
        if (selDot.visible) selDot.position.copy(selPts[Math.min(96, Math.floor(((RM ? .5 : t * .35) % 1) * 96))]);
        selPin.material.opacity = f2 >= 1 ? (RM ? .8 : .5 + .4 * Math.sin(t * 4)) : 0; selPin.scale.setScalar(RM ? 1 : 1 + .25 * Math.sin(t * 4));
      }
      rd.render(scene, cam);
      // Erbil DOM label
      if (lbl) {
        world.updateMatrixWorld(); tv.copy(ev).multiplyScalar(1.1).applyMatrix4(globeGroup.matrixWorld); cp.copy(cam.position);
        var facing = tv.clone().normalize().dot(cp) > 1.0 + .02;
        tp.copy(tv).project(cam);
        lbl.style.transform = 'translate3d(' + ((tp.x + 1) / 2 * W).toFixed(1) + 'px,' + ((1 - tp.y) / 2 * H).toFixed(1) + 'px,0) translate(-50%,-135%)';
        lbl.style.opacity = facing ? 1 : 0; lbl.tabIndex = facing ? 0 : -1;
      }
      var moving = !RM || dirty || now - selStart < 1400 || Math.abs(tg.y - st.y) > 1e-4 || Math.abs(tg.x - st.x) > 1e-4 || Math.abs(tg.d - st.d) > 1e-4 || Math.abs(vel.y) > 1e-5;
      dirty = false;
      if (moving) raf = requestAnimationFrame(frameFn);
    }
    function run() { if (!raf && vis) { last = performance.now(); raf = requestAnimationFrame(frameFn); } }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { vis = es[0].isIntersecting && !document.hidden; run(); }, { threshold: 0 }).observe(frame);
    document.addEventListener('visibilitychange', function () { vis = !document.hidden; run(); });
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); showFallback('lost'); });
    ['pointerdown', 'wheel', 'keydown'].forEach(function (ev2) { frame.addEventListener(ev2, run, { passive: true }); });
    run();
    return { focus: focus, setGeo: setGeo, flyTo: flyTo, latLonAt: latLonAt, _dbg: { st: st, tg: tg } };
  }

  function showFallback(why) {
    var f = $('#vx-fallback'); if (f) f.hidden = false;
    var cv = $('#vx-canvas'); if (cv) cv.style.display = 'none';
    var tools = $('.vx-tools'); if (tools) tools.hidden = true;
    var l = $('#vx-erbil'); if (l) l.hidden = true;
    var h = $('.vx-hint'); if (h) h.textContent = 'ابحث عن الدولة من القائمة لعرض معلومات التأشيرة.';
    if (window.console) console.warn('[visa-explorer] 3D globe disabled:', why);
  }

  /* ---------- boot ---------- */
  function boot() {
    renderPanel(null);
    var searchApi = null;
    loadCountries().then(function () {
      searchApi = setupSearch(); setupPopular();
      window.DVisa = { select: select, search: search, pick: function (lat, lon, pad) { var g = pickGeo(lat, lon, pad); return g ? { key: g.key, code: g.code, label: g.label } : null; },
        get countries() { return countries; }, get geo() { return geo; }, byCode: byCode, verifiedVisa: verifiedVisa, paintBase: paintBase, paintSelection: paintSelection, get globe() { return gl; } };
      var lazy = function () { if (geoState === 'idle') loadGeo(); };
      // start the 3D scene when the section approaches the viewport, so the hero stays fast
      var started = false;
      function start() {
        if (started) return; started = true;
        gl = initGlobe();
        if (gl) { lazy(); if (geo) gl.setGeo(geo); }
      }
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); start(); } }, { rootMargin: '700px 0px' });
        io.observe(root);
      } else start();
      // three.js is loaded with `defer`; if it is still missing when we start, wait for window load once
      document.dispatchEvent(new CustomEvent('vx:ready'));
    }).catch(function (e) {
      fail('could not load data/countries.json', e);
      var s = $('#vx-count'); if (s) s.textContent = 'تعذّر تحميل قائمة الدول' + (DEV ? ' — ' + e.message : '');
      showFallback('countries-json');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
