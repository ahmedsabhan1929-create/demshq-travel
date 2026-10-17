# Damashq Travel — Visa Explorer

Files added: `css/visa-explorer.css`, `js/visa-explorer.js`, `data/visa-data.js`, `data/country-extras.js`,
`data/countries.geojson` (your file, unchanged), `data/countries.json` (from your flags ZIP).
`index.html` was modified only to: link the CSS, add a "مستكشف التأشيرات" nav link (desktop, mobile, footer),
insert the `#visa-explorer` section after the programs section, and load the 3 scripts.

## Updating visa information
Edit `data/visa-data.js` → `countries`. Key = lowercase ISO-2 code. An entry shows ONLY if it has a `verified: "YYYY-MM-DD"` date.
All other countries show: «للاستفسار عن سعر التأشيرة والمتطلبات، تواصل معنا». The WhatsApp/phone come from the site's existing links.

## Deploy (GitHub Pages)
Upload `index.html`, `css/`, `js/`, `data/` keeping the same folder layout. All paths are relative, so a repo sub-path works.
Flags load from flagcdn.com (URLs in `data/countries.json`); on failure the code badge is shown.
