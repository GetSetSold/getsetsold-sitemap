const fs = require('fs');

// ─── Config ────────────────────────────────────────────────────────────────
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_KEY;
const TABLE          = 'property';
const BASE_URL       = 'https://www.getsetsold.ca/real-estate';
const SITEMAP_HOST   = 'https://listings.getsetsold.ca';
const PUBLIC_DIR     = './public';
const CHUNK_SIZE     = 45000; // stay safely under Google's 50k limit
// ───────────────────────────────────────────────────────────────────────────

async function fetchAllListings() {
  let all     = [];
  let from    = 0;
  const limit = 1000;

  console.log('📦 Fetching listings from Supabase...');

  while (true) {
    const url =
      `${SUPABASE_URL}/rest/v1/${TABLE}` +
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

    all = all.concat(data);
    console.log(`  → fetched ${all.length} listings so far...`);

    if (data.length < limit) break;
    from += limit;
  }

  return all;
}

function buildSlug(listingURL) {
  return listingURL
    .replace(/^(https?:\/\/)?(www\.)?realtor\.ca\/real-estate\//, '')
    .replace(/\/$/, '')
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

function buildSitemapIndexXML(totalChunks) {
  const today = new Date().toISOString().split('T')[0];

  const sitemapBlocks = Array.from({ length: totalChunks }, (_, i) => {
    const num = i + 1;
    return (
      `  <sitemap>\n` +
      `    <loc>${SITEMAP_HOST}/sitemap-${num}.xml</loc>\n` +
      `    <lastmod>${today}</lastmod>\n` +
      `  </sitemap>`
    );
  });

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    sitemapBlocks.join('\n') + '\n' +
    `</sitemapindex>`
  );
}

async function pingGoogle() {
  const sitemapUrl = encodeURIComponent(`${SITEMAP_HOST}/sitemap.xml`);
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

  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  // Split into chunks of CHUNK_SIZE
  const chunks = [];
  for (let i = 0; i < listings.length; i += CHUNK_SIZE) {
    chunks.push(listings.slice(i, i + CHUNK_SIZE));
  }

  console.log(`📄 Splitting into ${chunks.length} sitemap file(s) of up to ${CHUNK_SIZE} URLs each...`);

  // Write each sitemap-N.xml
  chunks.forEach((chunk, i) => {
    const num      = i + 1;
    const filename = `${PUBLIC_DIR}/sitemap-${num}.xml`;
    const xml      = buildSitemapXML(chunk);
    fs.writeFileSync(filename, xml, 'utf8');
    console.log(`  ✅ sitemap-${num}.xml → ${chunk.length} URLs`);
  });

  // Write sitemap.xml as the index
  const indexXml = buildSitemapIndexXML(chunks.length);
  fs.writeFileSync(`${PUBLIC_DIR}/sitemap.xml`, indexXml, 'utf8');
  console.log(`✅ sitemap.xml (index) → points to ${chunks.length} sitemap files`);
  console.log(`   Submit this to Google: ${SITEMAP_HOST}/sitemap.xml`);

  await pingGoogle();
}

run().catch((err) => {
  console.error('❌ Sitemap generation failed:', err);
  process.exit(1);
});
