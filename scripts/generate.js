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

// ═══════════════════════════════════════════════════════════════════════════
// LISTING DETAIL SITEMAPS (original)
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// LISTINGS FILTER PAGES SITEMAP (new)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all unique city slugs directly from the database.
 * This ensures EVERY city that has listings gets filter page URLs —
 * no manual list maintenance needed.
 */
async function fetchAllCities() {
  const allCities = new Set();

  let from = 0;
  const limit = 1000;

  console.log('🏙️  Fetching all unique cities from Supabase...');

  while (true) {
    const url =
      `${SUPABASE_URL}/rest/v1/${TABLE}` +
      `?select=City&limit=${limit}&offset=${from}`;

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

    for (const row of data) {
      if (row.City && row.City.trim()) {
        // "Brampton" → "brampton"
        // "Brampton (Northwest Sandalwood Parkway)" → "brampton-northwest-sandalwood-parkway"
        // "St. Catharines" → "st-catharines"
        const slug = row.City
          .trim()
          .toLowerCase()
          .replace(/\s*\(/g, ' (')         // normalize space before opening paren
          .replace(/\)\s*/g, ') ')         // normalize space after closing paren
          .replace(/\s*\(\s*/g, '-')       // replace "( " with "-"
          .replace(/\s*\)\s*/g, '')        // remove closing ")"
          .replace(/[.\s]+/g, '-')          // dots and spaces → hyphens
          .replace(/[^a-z0-9-]/g, '')       // strip non-alphanumeric
          .replace(/-+/g, '-')              // collapse multiple hyphens
          .replace(/^-|-$/g, '');           // trim leading/trailing hyphens

        if (slug) allCities.add(slug);
      }
    }

    if (data.length < limit) break;
    from += limit;
  }

  const cities = [...allCities].sort();
  console.log(`✅ Found ${cities.length} unique cities in database`);
  return cities;
}

// Structure types available in the listings filter
const STRUCTURE_TYPES = ['House', 'Condo', 'Townhouse', 'Apartment', 'Detached', 'Semi-Detached', 'Duplex', 'Triplex', 'Fourplex', 'Cottage', 'Vacant Land', 'Farm'];

// Bedroom counts to generate
const BEDS = [1, 2, 3, 4, 5];

// Bathroom counts to generate
const BATHS = [1, 2, 3];

// Price brackets for sale listings (varied ranges for different markets)
const SALE_PRICE_BRACKETS = [
  { min: 100000, max: 200000 },
  { min: 200000, max: 300000 },
  { min: 300000, max: 400000 },
  { min: 400000, max: 500000 },
  { min: 500000, max: 600000 },
  { min: 600000, max: 700000 },
  { min: 700000, max: 800000 },
  { min: 800000, max: 900000 },
  { min: 900000, max: 1000000 },
  { min: 1000000, max: 1500000 },
  { min: 1500000, max: 2000000 },
  { min: 2000000, max: 3000000 },
  { min: 3000000, max: 5000000 },
  { min: 5000000, max: 10000000 },
];

// Price brackets for lease listings
const LEASE_PRICE_BRACKETS = [
  { min: 500, max: 1000 },
  { min: 1000, max: 1500 },
  { min: 1500, max: 2000 },
  { min: 2000, max: 2500 },
  { min: 2500, max: 3000 },
  { min: 3000, max: 4000 },
  { min: 4000, max: 5000 },
  { min: 5000, max: 7500 },
  { min: 7500, max: 10000 },
];

/**
 * Generate all filter page URLs for listings
 * Strategy: generate smart combinations without creating millions of URLs
 *
 * Tier 1 (high priority) — ~3,200 URLs:
 *   - city + listingType (sale/lease) for all cities
 *   - city + type (structure) for top structure types
 *
 * Tier 2 (medium priority) — ~18,000 URLs:
 *   - city + type + beds for popular types
 *   - city + type + beds + baths
 *
 * Tier 3 (lower priority) — ~8,500 URLs:
 *   - city + listingType + price brackets
 *   - city + type + price brackets
 */
function generateFilterPageURLs(cities) {
  const urls = [];
  const today = new Date().toISOString().split('T')[0];

  // Helper to add URL with priority
  function addURL(path, priority, changefreq) {
    urls.push({ loc: `https://www.getsetsold.ca${path}`, priority, changefreq, lastmod: today });
  }

  const TOP_TYPES = ['House', 'Condo', 'Townhouse', 'Apartment'];
  const ALL_TYPES = STRUCTURE_TYPES;

  // ── Tier 1: city × listingType ──
  // e.g. /listings?city=Cayuga&listingType=sale
  console.log('  🔹 Tier 1: city × listingType...');
  for (const city of cities) {
    // Base city page (no filter = shows all)
    addURL(`/listings?city=${city}`, '0.9', 'daily');
    // For Sale
    addURL(`/listings?city=${city}&listingType=sale`, '0.9', 'daily');
    // For Lease
    addURL(`/listings?city=${city}&listingType=lease`, '0.8', 'daily');
  }

  // ── Tier 1b: city × structure type ──
  // e.g. /listings?city=Cayuga&type=House
  console.log('  🔹 Tier 1b: city × structure type (top 4)...');
  for (const city of cities) {
    for (const type of TOP_TYPES) {
      addURL(`/listings?city=${city}&type=${encodeURIComponent(type)}`, '0.8', 'daily');
    }
  }

  // ── Tier 2: city × type × beds ──
  // e.g. /listings?city=Cayuga&type=House&beds=2
  console.log('  🔹 Tier 2: city × type × beds...');
  for (const city of cities) {
    for (const type of TOP_TYPES) {
      for (const beds of BEDS) {
        addURL(`/listings?city=${city}&type=${encodeURIComponent(type)}&beds=${beds}`, '0.7', 'weekly');
      }
    }
  }

  // ── Tier 2b: city × type × beds × baths ──
  // e.g. /listings?city=Cayuga&type=House&beds=2&baths=2
  console.log('  🔹 Tier 2b: city × type × beds × baths...');
  for (const city of cities) {
    for (const type of TOP_TYPES) {
      for (const beds of BEDS) {
        for (const baths of BATHS) {
          addURL(
            `/listings?city=${city}&type=${encodeURIComponent(type)}&beds=${beds}&baths=${baths}`,
            '0.6', 'weekly'
          );
        }
      }
    }
  }

  // ── Tier 3: city × listingType × price brackets (sale) ──
  // e.g. /listings?city=Cayuga&listingType=sale&priceMin=300000&priceMax=400000
  console.log('  🔹 Tier 3: city × listingType × price brackets (sale)...');
  for (const city of cities) {
    for (const bracket of SALE_PRICE_BRACKETS) {
      addURL(
        `/listings?city=${city}&listingType=sale&priceMin=${bracket.min}&priceMax=${bracket.max}`,
        '0.6', 'weekly'
      );
    }
  }

  // ── Tier 3b: city × listingType × price brackets (lease) ──
  console.log('  🔹 Tier 3b: city × listingType × price brackets (lease)...');
  for (const city of cities) {
    for (const bracket of LEASE_PRICE_BRACKETS) {
      addURL(
        `/listings?city=${city}&listingType=lease&priceMin=${bracket.min}&priceMax=${bracket.max}`,
        '0.6', 'weekly'
      );
    }
  }

  // ── Tier 3c: city × type × listingType (sale) ──
  // Remaining structure types (less popular ones)
  console.log('  🔹 Tier 3c: city × all structure types (remaining)...');
  const remainingTypes = ALL_TYPES.filter(t => !TOP_TYPES.includes(t));
  for (const city of cities) {
    for (const type of remainingTypes) {
      addURL(`/listings?city=${city}&type=${encodeURIComponent(type)}`, '0.5', 'weekly');
    }
  }

  // ── Tier 3d: remaining types × beds ──
  console.log('  🔹 Tier 3d: city × remaining types × beds...');
  for (const city of cities) {
    for (const type of remainingTypes) {
      for (const beds of BEDS) {
        addURL(
          `/listings?city=${city}&type=${encodeURIComponent(type)}&beds=${beds}`,
          '0.5', 'weekly'
        );
      }
    }
  }

  return urls;
}

function buildFilterPagesSitemapXML(urlEntries) {
  const urlBlocks = urlEntries.map(u => {
    return (
      `  <url>\n` +
      `    <loc>${u.loc}</loc>\n` +
      `    <lastmod>${u.lastmod}</lastmod>\n` +
      `    <changefreq>${u.changefreq}</changefreq>\n` +
      `    <priority>${u.priority}</priority>\n` +
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

// ═══════════════════════════════════════════════════════════════════════════
// SITEMAP INDEX & PING
// ═══════════════════════════════════════════════════════════════════════════

function buildSitemapIndexXML(sitemapEntries) {
  const today = new Date().toISOString().split('T')[0];

  const sitemapBlocks = sitemapEntries.map(s => {
    return (
      `  <sitemap>\n` +
      `    <loc>${s.loc}</loc>\n` +
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

async function pingGoogle(sitemapUrl) {
  const encoded = encodeURIComponent(sitemapUrl);
  try {
    const res = await fetch(`https://www.google.com/ping?sitemap=${encoded}`);
    console.log(`📡 Google ping: ${res.status === 200 ? '✅ success' : `⚠️  status ${res.status}`}`);
  } catch (e) {
    console.warn('⚠️  Google ping failed (non-critical):', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function run() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY environment variables.');
  }

  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  // ── Part 1: Listing detail sitemaps (original) ──
  console.log('\n════════════════════════════════════════════');
  console.log('PART 1: Listing Detail Sitemaps');
  console.log('════════════════════════════════════════════\n');

  const listings = await fetchAllListings();
  console.log(`✅ Total listings fetched: ${listings.length}`);

  const detailChunks = [];
  for (let i = 0; i < listings.length; i += CHUNK_SIZE) {
    detailChunks.push(listings.slice(i, i + CHUNK_SIZE));
  }

  console.log(`📄 Splitting into ${detailChunks.length} sitemap file(s)...`);

  const sitemapEntries = [];

  detailChunks.forEach((chunk, i) => {
    const num      = i + 1;
    const filename = `${PUBLIC_DIR}/sitemap-${num}.xml`;
    const xml      = buildSitemapXML(chunk);
    fs.writeFileSync(filename, xml, 'utf8');
    console.log(`  ✅ sitemap-${num}.xml → ${chunk.length} listing URLs`);
    sitemapEntries.push({ loc: `${SITEMAP_HOST}/sitemap-${num}.xml` });
  });

  // ── Part 2: Listings filter pages sitemap ──
  console.log('\n════════════════════════════════════════════');
  console.log('PART 2: Listings Filter Pages Sitemap');
  console.log('════════════════════════════════════════════\n');

  // ── Fetch all cities from DB ──
  const CITIES = await fetchAllCities();

  console.log('\n🔗 Generating filter page URLs...');
  const filterURLs = generateFilterPageURLs(CITIES);
  console.log(`✅ Total filter page URLs generated: ${filterURLs.length}`);

  // Split filter pages sitemap if needed (unlikely to exceed 50k but safe)
  const filterChunks = [];
  for (let i = 0; i < filterURLs.length; i += CHUNK_SIZE) {
    filterChunks.push(filterURLs.slice(i, i + CHUNK_SIZE));
  }

  filterChunks.forEach((chunk, i) => {
    const num      = i + 1;
    const filename = `${PUBLIC_DIR}/sitemap-filter-${num}.xml`;
    const xml      = buildFilterPagesSitemapXML(chunk);
    fs.writeFileSync(filename, xml, 'utf8');
    console.log(`  ✅ sitemap-filter-${num}.xml → ${chunk.length} filter page URLs`);
    sitemapEntries.push({ loc: `${SITEMAP_HOST}/sitemap-filter-${num}.xml` });
  });

  // ── Write sitemap index ──
  console.log('\n════════════════════════════════════════════');
  console.log('SITEMAP INDEX');
  console.log('════════════════════════════════════════════\n');

  const indexXml = buildSitemapIndexXML(sitemapEntries);
  fs.writeFileSync(`${PUBLIC_DIR}/sitemap.xml`, indexXml, 'utf8');

  console.log(`✅ sitemap.xml (index) → points to ${sitemapEntries.length} sitemap files`);
  sitemapEntries.forEach(s => console.log(`   ${s.loc}`));
  console.log(`\n   Submit this to Google: ${SITEMAP_HOST}/sitemap.xml`);

  // ── Ping Google ──
  console.log('\n📡 Pinging Google...');
  await pingGoogle(`${SITEMAP_HOST}/sitemap.xml`);

  // ── Summary ──
  console.log('\n════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('════════════════════════════════════════════\n');
  console.log(`  Listing detail sitemaps:   ${detailChunks.length} files, ${listings.length} URLs`);
  console.log(`  Filter pages sitemaps:     ${filterChunks.length} files, ${filterURLs.length} URLs`);
  console.log(`  Total sitemaps in index:   ${sitemapEntries.length}`);
  console.log(`  Total URLs in all sitemaps: ${listings.length + filterURLs.length}`);
}

run().catch((err) => {
  console.error('❌ Sitemap generation failed:', err);
  process.exit(1);
});
