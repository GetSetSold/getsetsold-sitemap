const fs = require('fs');

// ─── Config ────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;   // set in GitHub Secrets
const SUPABASE_KEY = process.env.SUPABASE_KEY;   // set in GitHub Secrets
const TABLE        = 'property';
const BASE_URL     = 'https://www.getsetsold.ca/real-estate';
const SITEMAP_PATH = './public/sitemap.xml';
// ───────────────────────────────────────────────────────────────────────────

// Supabase REST has a 1000-row default limit — this loops until all rows fetched
async function fetchAllListings() {
  let all      = [];
  let from     = 0;
  const limit  = 1000;

  console.log('📦 Fetching listings from Supabase...');

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${TABLE}` +
      `?select=ListingURL,ModificationTimestamp,OriginalEntryTimestamp` +
      `&limit=${limit}&offset=${from}`;

    const res = await fetch(url, {
      headers: {
        apikey:        SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase error ${res.status}: ${err}`);
    }

    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) break;

    all  = all.concat(data);
    console.log(`  → fetched ${all.length} listings so far...`);

    if (data.length < limit) break; // last page
    from += limit;
  }

  return all;
}

function buildSlug(listingURL) {
  // Handles all these formats safely:
  //   www.realtor.ca/real-estate/25569111/slug
  //   https://www.realtor.ca/real-estate/25569111/slug
  //   25569111/slug   (already a slug)
  return listingURL
    .replace(/^(https?:\/\/)?(www\.)?realtor\.ca\/real-estate\//, '')
    .replace(/\/$/, '')   // remove trailing slash
    .trim();
}

function buildSitemapXML(listings) {
  const today = new Date().toISOString().split('T')[0];

  const urlBlocks = listings
    .filter((l) => l.ListingURL && l.ListingURL.trim() !== '')
    .map((l) => {
      const slug    = buildSlug(l.ListingURL);
      const lastmod = (l.ModificationTimestamp || l.OriginalEntryTimestamp || today).split('T')[0];

      return (
        `  <url>\n` +
        `    <loc>${BASE_URL}/${slug}</loc>\n` +
        `    <lastmod>${lastmod}</lastmod>\n` +
        `    <changefreq>daily</changefreq>\n` +
        `    <priority>0.8</priority>\n` +
        `  </url>`
      );
    });

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urlBlocks.join('\n') + '\n' +
    `</urlset>`
  );
}

async function pingGoogle() {
  const sitemapUrl = encodeURIComponent('https://listings.getsetsold.ca/sitemap.xml');
  try {
    const res = await fetch(`https://www.google.com/ping?sitemap=${sitemapUrl}`);
    console.log(`📡 Google ping: ${res.status === 200 ? '✅ success' : `⚠️  status ${res.status}`}`);
  } catch (e) {
    console.warn('⚠️  Google ping failed (non-critical):', e.message);
  }
}

async function run() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY environment variables.');
  }

  const listings = await fetchAllListings();
  console.log(`✅ Total listings fetched: ${listings.length}`);

  const xml = buildSitemapXML(listings);

  fs.mkdirSync('./public', { recursive: true });
  fs.writeFileSync(SITEMAP_PATH, xml, 'utf8');
  console.log(`✅ Sitemap written → ${SITEMAP_PATH}`);
  console.log(`   Contains ${listings.length} URLs`);
  console.log(`   Preview: ${BASE_URL}/${buildSlug(listings[0]?.ListingURL ?? 'n/a')}`);

  await pingGoogle();
}

run().catch((err) => {
  console.error('❌ Sitemap generation failed:', err);
  process.exit(1);
});
