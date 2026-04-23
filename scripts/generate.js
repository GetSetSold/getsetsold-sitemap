const fs = require('fs');

// ─── Config ────────────────────────────────────────────────────────────────
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_KEY;
const TABLE             = 'property';
const BASE_URL          = 'https://www.getsetsold.ca/real-estate';
const SITEMAP_HOST      = 'https://listings.getsetsold.ca';
const PUBLIC_DIR        = './public';
const CHUNK_SIZE        = 30000; // stay under ~7 MB per file (Google's limit is 50k URLs or 10 MB uncompressed)

// ─── Pre-Construction Config ─────────────────────────────────────────────────
// Uses the same Supabase instance by default. Override with PRECON_SB_URL / PRECON_SB_KEY
// if pre-construction data lives in a separate database.
const PRECON_SB_URL     = process.env.PRECON_SB_URL  || SUPABASE_URL;
const PRECON_SB_KEY     = process.env.PRECON_SB_KEY  || SUPABASE_KEY;
const PRECON_BASE_URL   = 'https://www.getsetsold.ca/pre-construction';
// ─────────────────────────────────────────────────────────────────────────────

// ─── IndexNow Config ───────────────────────────────────────────────────────
const INDEXNOW_KEY      = '975deb2fa4f34a198c0468286722e45c';
const INDEXNOW_HOST     = 'www.getsetsold.ca';
const INDEXNOW_KEY_URL  = `https://www.getsetsold.ca/${INDEXNOW_KEY}.txt`;
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const INDEXNOW_BATCH    = 10000; // Bing allows up to 10,000 URLs per request
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
        const slug = row.City
          .trim()
          .toLowerCase()
          .replace(/\s*\(/g, ' (')
          .replace(/\)\s*/g, ') ')
          .replace(/\s*\(\s*/g, '-')
          .replace(/\s*\)\s*/g, '')
          .replace(/[.\s]+/g, '-')
          .replace(/[^a-z0-9-]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

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

// Price brackets for sale listings
const SALE_PRICE_BRACKETS = [
  { min: 100000,  max: 200000   },
  { min: 200000,  max: 300000   },
  { min: 300000,  max: 400000   },
  { min: 400000,  max: 500000   },
  { min: 500000,  max: 600000   },
  { min: 600000,  max: 700000   },
  { min: 700000,  max: 800000   },
  { min: 800000,  max: 900000   },
  { min: 900000,  max: 1000000  },
  { min: 1000000, max: 1500000  },
  { min: 1500000, max: 2000000  },
  { min: 2000000, max: 3000000  },
  { min: 3000000, max: 5000000  },
  { min: 5000000, max: 10000000 },
];

// Price brackets for lease listings
const LEASE_PRICE_BRACKETS = [
  { min: 500,  max: 1000  },
  { min: 1000, max: 1500  },
  { min: 1500, max: 2000  },
  { min: 2000, max: 2500  },
  { min: 2500, max: 3000  },
  { min: 3000, max: 4000  },
  { min: 4000, max: 5000  },
  { min: 5000, max: 7500  },
  { min: 7500, max: 10000 },
];

function generateFilterPageURLs(cities) {
  const urls = [];
  const today = new Date().toISOString().split('T')[0];

  function addURL(path, priority, changefreq) {
    urls.push({ loc: `https://www.getsetsold.ca${path}`, priority, changefreq, lastmod: today });
  }

  const TOP_TYPES      = ['House', 'Condo', 'Townhouse', 'Apartment'];
  const remainingTypes = STRUCTURE_TYPES.filter(t => !TOP_TYPES.includes(t));

  // Tier 1: city × listingType
  console.log('  🔹 Tier 1: city × listingType...');
  for (const city of cities) {
    addURL(`/listings?city=${city}`,                   '0.9', 'daily');
    addURL(`/listings?city=${city}&listingType=sale`,  '0.9', 'daily');
    addURL(`/listings?city=${city}&listingType=lease`, '0.8', 'daily');
  }

  // Tier 1b: city × structure type (top 4)
  console.log('  🔹 Tier 1b: city × structure type (top 4)...');
  for (const city of cities) {
    for (const type of TOP_TYPES) {
      addURL(`/listings?city=${city}&type=${encodeURIComponent(type)}`, '0.8', 'daily');
    }
  }

  // Tier 2: city × type × beds
  console.log('  🔹 Tier 2: city × type × beds...');
  for (const city of cities) {
    for (const type of TOP_TYPES) {
      for (const beds of BEDS) {
        addURL(`/listings?city=${city}&type=${encodeURIComponent(type)}&beds=${beds}`, '0.7', 'weekly');
      }
    }
  }

  // Tier 2b: city × type × beds × baths
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

  // Tier 3: city × listingType × price brackets (sale)
  console.log('  🔹 Tier 3: city × listingType × price brackets (sale)...');
  for (const city of cities) {
    for (const bracket of SALE_PRICE_BRACKETS) {
      addURL(
        `/listings?city=${city}&listingType=sale&priceMin=${bracket.min}&priceMax=${bracket.max}`,
        '0.6', 'weekly'
      );
    }
  }

  // Tier 3b: city × listingType × price brackets (lease)
  console.log('  🔹 Tier 3b: city × listingType × price brackets (lease)...');
  for (const city of cities) {
    for (const bracket of LEASE_PRICE_BRACKETS) {
      addURL(
        `/listings?city=${city}&listingType=lease&priceMin=${bracket.min}&priceMax=${bracket.max}`,
        '0.6', 'weekly'
      );
    }
  }

  // Tier 3c: city × remaining structure types
  console.log('  🔹 Tier 3c: city × all structure types (remaining)...');
  for (const city of cities) {
    for (const type of remainingTypes) {
      addURL(`/listings?city=${city}&type=${encodeURIComponent(type)}`, '0.5', 'weekly');
    }
  }

  // Tier 3d: city × remaining types × beds
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

// ─── XML helper ─────────────────────────────────────────────────────────────
function escapeXml(str) {
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}
// ────────────────────────────────────────────────────────────────────────────

function buildFilterPagesSitemapXML(urlEntries) {
  const urlBlocks = urlEntries.map(u =>
    `  <url>\n` +
    `    <loc>${escapeXml(u.loc)}</loc>\n` +
    `    <lastmod>${u.lastmod}</lastmod>\n` +
    `    <changefreq>${u.changefreq}</changefreq>\n` +
    `    <priority>${u.priority}</priority>\n` +
    `  </url>`
  );

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urlBlocks.join('\n') + '\n' +
    `</urlset>`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PRE-CONSTRUCTION SITEMAPS (builders, projects, models)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Paginated fetch helper for any Supabase table.
 */
async function paginatedFetch(baseUrl, apiKey, table, select, limit = 1000) {
  const all  = [];
  let from   = 0;

  while (true) {
    const url =
      `${baseUrl}/rest/v1/${table}` +
      `?select=${select}&limit=${limit}&offset=${from}`;

    const res = await fetch(url, {
      headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase error ${res.status} on ${table}: ${err}`);
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    all.push(...data);
    if (data.length < limit) break;
    from += limit;
  }

  return all;
}

/**
 * Fetch all pre-construction URLs from Supabase (builders → projects → models).
 * Uses nested PostgREST joins so each level carries parent slugs.
 */
async function fetchPreconData() {
  console.log('🏗️  Fetching pre-construction data from Supabase...');

  // 1. Fetch all builders (no timestamp column — use slug only)
  const builders = await paginatedFetch(
    PRECON_SB_URL, PRECON_SB_KEY, 'builders', 'slug'
  );
  console.log(`  ✅ Builders: ${builders.length}`);

  // 2. Fetch all projects with builder slug (has created_at)
  const projects = await paginatedFetch(
    PRECON_SB_URL, PRECON_SB_KEY,
    'projects', 'slug,created_at,builder:builder_id(slug)'
  );
  console.log(`  ✅ Projects: ${projects.length}`);

  // 3. Fetch all home models with project + builder slug (no timestamp column)
  const models = await paginatedFetch(
    PRECON_SB_URL, PRECON_SB_KEY,
    'home_models', 'slug,project:project_id(slug,builder:builder_id(slug))'
  );
  console.log(`  ✅ Home models: ${models.length}`);

  return { builders, projects, models };
}

/**
 * Build the pre-construction URL list.
 *
 * Priority tiers:
 *   0.9  /pre-construction             (main index)
 *   0.8  /pre-construction/{builder}   (builder detail)
 *   0.8  /pre-construction/{builder}/{project}  (project detail)
 *   0.7  /pre-construction/{builder}/{project}/{model}  (model detail)
 */
function buildPreconURLs({ builders, projects, models }) {
  const today = new Date().toISOString().split('T')[0];
  const urls  = [];

  function add(path, priority, changefreq, lastmod) {
    urls.push({
      loc:        `${PRECON_BASE_URL}${path}`,
      priority,
      changefreq,
      lastmod:    lastmod || today,
    });
  }

  // Main pre-construction index page
  add('', '0.9', 'daily', today);

  // Builder pages
  for (const b of builders) {
    if (!b.slug) continue;
    add(`/${b.slug}`, '0.8', 'weekly', today);
  }

  // Project pages
  for (const p of projects) {
    if (!p.slug || !p.builder?.slug) continue;
    const lm = (p.created_at || today).split('T')[0];
    add(`/${p.builder.slug}/${p.slug}`, '0.8', 'weekly', lm);
  }

  // Model pages
  for (const m of models) {
    if (!m.slug || !m.project?.slug || !m.project?.builder?.slug) continue;
    add(`/${m.project.builder.slug}/${m.project.slug}/${m.slug}`, '0.7', 'weekly', today);
  }

  return urls;
}

// ═══════════════════════════════════════════════════════════════════════════
// SITEMAP INDEX & PING
// ═══════════════════════════════════════════════════════════════════════════

function buildSitemapIndexXML(sitemapEntries) {
  const today = new Date().toISOString().split('T')[0];

  const sitemapBlocks = sitemapEntries.map(s =>
    `  <sitemap>\n` +
    `    <loc>${escapeXml(s.loc)}</loc>\n` +
    `    <lastmod>${today}</lastmod>\n` +
    `  </sitemap>`
  );

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
// INDEXNOW SUBMISSION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submit URLs to IndexNow — instantly notifies Bing, Yandex, Seznam, etc.
 * Splits into batches of 10,000 (the API maximum per request).
 *
 * HTTP response codes:
 *   200 — URLs accepted immediately
 *   202 — URLs queued, will be processed shortly
 *   400 — Bad request / malformed JSON
 *   403 — Key not found at keyLocation URL  ← most common setup issue
 *   422 — URLs don't match the declared host
 *   429 — Rate limited, slow down submissions
 */
async function submitToIndexNow(urls) {
  if (!urls || urls.length === 0) {
    console.log('⚠️  IndexNow: no URLs to submit.');
    return;
  }

  const totalBatches = Math.ceil(urls.length / INDEXNOW_BATCH);
  console.log(`\n🔔 IndexNow: submitting ${urls.length.toLocaleString()} URLs across ${totalBatches} batch(es)...`);

  let totalAccepted = 0;
  let totalFailed   = 0;

  for (let i = 0; i < urls.length; i += INDEXNOW_BATCH) {
    const batch    = urls.slice(i, i + INDEXNOW_BATCH);
    const batchNum = Math.floor(i / INDEXNOW_BATCH) + 1;

    try {
      const res = await fetch(INDEXNOW_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body:    JSON.stringify({
          host:        INDEXNOW_HOST,
          key:         INDEXNOW_KEY,
          keyLocation: INDEXNOW_KEY_URL,
          urlList:     batch,
        }),
      });

      if (res.status === 200 || res.status === 202) {
        const label = res.status === 200 ? 'accepted' : 'queued';
        console.log(`  ✅ Batch ${batchNum}/${totalBatches}: ${batch.length.toLocaleString()} URLs ${label} (HTTP ${res.status})`);
        totalAccepted += batch.length;
      } else {
        const body = await res.text().catch(() => '');
        console.warn(`  ⚠️  Batch ${batchNum}/${totalBatches}: HTTP ${res.status} — ${body || 'no response body'}`);

        if (res.status === 403) {
          console.warn(`      → Key file not found. Ensure this URL exists and contains only the key string:`);
          console.warn(`        ${INDEXNOW_KEY_URL}`);
        } else if (res.status === 422) {
          console.warn(`      → URL host mismatch. All submitted URLs must be under: ${INDEXNOW_HOST}`);
        } else if (res.status === 429) {
          console.warn(`      → Rate limited. Consider reducing how often you run this script.`);
        }

        totalFailed += batch.length;
      }
    } catch (e) {
      console.warn(`  ⚠️  Batch ${batchNum}/${totalBatches}: network error — ${e.message}`);
      totalFailed += batch.length;
    }

    // Brief pause between batches to be polite to the API
    if (i + INDEXNOW_BATCH < urls.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n  IndexNow result:`);
  console.log(`    ✅ Accepted / queued : ${totalAccepted.toLocaleString()} URLs`);
  if (totalFailed > 0) {
    console.log(`    ❌ Failed            : ${totalFailed.toLocaleString()} URLs`);
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

  // ── Part 1: Listing detail sitemaps ──────────────────────────────────────
  console.log('\n════════════════════════════════════════════');
  console.log('PART 1: Listing Detail Sitemaps');
  console.log('════════════════════════════════════════════\n');

  const listings = await fetchAllListings();
  console.log(`✅ Total listings fetched: ${listings.length.toLocaleString()}`);

  // Collect listing detail URLs now for IndexNow submission later
  const listingDetailURLs = listings
    .filter(l => l.ListingURL && l.ListingURL.trim())
    .map(l => `${BASE_URL}/${buildSlug(l.ListingURL)}`);

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
    console.log(`  ✅ sitemap-${num}.xml → ${chunk.length.toLocaleString()} listing URLs`);
    sitemapEntries.push({ loc: `${SITEMAP_HOST}/sitemap-${num}.xml` });
  });

  // ── Part 2: Listings filter pages sitemap ────────────────────────────────
  console.log('\n════════════════════════════════════════════');
  console.log('PART 2: Listings Filter Pages Sitemap');
  console.log('════════════════════════════════════════════\n');

  const CITIES = await fetchAllCities();

  console.log('\n🔗 Generating filter page URLs...');
  const filterURLs = generateFilterPageURLs(CITIES);
  console.log(`✅ Total filter page URLs generated: ${filterURLs.length.toLocaleString()}`);

  const filterChunks = [];
  for (let i = 0; i < filterURLs.length; i += CHUNK_SIZE) {
    filterChunks.push(filterURLs.slice(i, i + CHUNK_SIZE));
  }

  filterChunks.forEach((chunk, i) => {
    const num      = i + 1;
    const filename = `${PUBLIC_DIR}/sitemap-filter-${num}.xml`;
    const xml      = buildFilterPagesSitemapXML(chunk);
    fs.writeFileSync(filename, xml, 'utf8');
    console.log(`  ✅ sitemap-filter-${num}.xml → ${chunk.length.toLocaleString()} filter page URLs`);
    sitemapEntries.push({ loc: `${SITEMAP_HOST}/sitemap-filter-${num}.xml` });
  });

  // ── Part 3: Pre-Construction sitemaps ───────────────────────────────────
  console.log('\n════════════════════════════════════════════');
  console.log('PART 3: Pre-Construction Sitemaps');
  console.log('════════════════════════════════════════════\n');

  let preconURLs = [];
  try {
    console.log(`  PRECON_SB_URL : ${PRECON_SB_URL}`);
    console.log(`  PRECON_SB_KEY : ${PRECON_SB_KEY ? '***' + PRECON_SB_KEY.slice(-6) : '(not set — using main SUPABASE_KEY)'}`);

    const preconData = await fetchPreconData();
    preconURLs = buildPreconURLs(preconData);
    console.log(`✅ Total pre-construction URLs: ${preconURLs.length.toLocaleString()}`);
  } catch (err) {
    console.warn('⚠️  Pre-construction sitemap generation failed (non-fatal):');
    console.warn(`   Error: ${err.message}`);
    console.warn(`   Stack: ${err.stack}`);
    console.warn('   Check PRECON_SB_URL / PRECON_SB_KEY env vars if on a separate Supabase instance.');
  }

  if (preconURLs.length > 0) {
    const preconChunks = [];
    for (let i = 0; i < preconURLs.length; i += CHUNK_SIZE) {
      preconChunks.push(preconURLs.slice(i, i + CHUNK_SIZE));
    }

    preconChunks.forEach((chunk, i) => {
      const num      = i + 1;
      const filename = `${PUBLIC_DIR}/sitemap-precon-${num}.xml`;
      const xml      = buildFilterPagesSitemapXML(chunk); // reuse the generic builder
      fs.writeFileSync(filename, xml, 'utf8');
      console.log(`  ✅ sitemap-precon-${num}.xml → ${chunk.length.toLocaleString()} pre-con URLs`);
      sitemapEntries.push({ loc: `${SITEMAP_HOST}/sitemap-precon-${num}.xml` });
    });
  }

  // ── Write sitemap index ───────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════');
  console.log('SITEMAP INDEX');
  console.log('════════════════════════════════════════════\n');

  const indexXml = buildSitemapIndexXML(sitemapEntries);
  fs.writeFileSync(`${PUBLIC_DIR}/sitemap.xml`, indexXml, 'utf8');

  console.log(`✅ sitemap.xml (index) → points to ${sitemapEntries.length} sitemap files`);
  sitemapEntries.forEach(s => console.log(`   ${s.loc}`));
  console.log(`\n   Submit this to Google: ${SITEMAP_HOST}/sitemap.xml`);

  // ── Ping Google ───────────────────────────────────────────────────────────
  console.log('\n📡 Pinging Google...');
  await pingGoogle(`${SITEMAP_HOST}/sitemap.xml`);

  // ── IndexNow submission (Bing + others) ───────────────────────────────────
  console.log('\n════════════════════════════════════════════');
  console.log('INDEXNOW SUBMISSION (Bing + Yandex + others)');
  console.log('════════════════════════════════════════════');

  const allURLsForIndexNow = [
    ...listingDetailURLs,
    ...filterURLs.map(u => u.loc),
    ...preconURLs.map(u => u.loc),
  ];

  await submitToIndexNow(allURLsForIndexNow);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('════════════════════════════════════════════\n');
  console.log(`  Listing detail sitemaps    : ${detailChunks.length} files, ${listings.length.toLocaleString()} URLs`);
  console.log(`  Filter pages sitemaps      : ${filterChunks.length} files, ${filterURLs.length.toLocaleString()} URLs`);
  console.log(`  Pre-construction sitemaps  : ${preconURLs.length > 0 ? `${Math.ceil(preconURLs.length / CHUNK_SIZE)} files, ${preconURLs.length.toLocaleString()} URLs` : 'skipped (error or no data)'}`);
  console.log(`  Total sitemaps in index    : ${sitemapEntries.length}`);
  console.log(`  Total URLs in all sitemaps : ${(listings.length + filterURLs.length + preconURLs.length).toLocaleString()}`);
  console.log(`  Total URLs sent to IndexNow: ${allURLsForIndexNow.length.toLocaleString()}`);
  console.log(`\n  ─── IndexNow key file reminder ───────────────────────────`);
  console.log(`  Make sure this URL is live and returns your key as plain text:`);
  console.log(`  https://www.getsetsold.ca/${INDEXNOW_KEY}.txt`);
  console.log(`  File contents must be exactly: ${INDEXNOW_KEY}`);

  if (preconURLs.length > 0) {
    console.log(`\n  ─── Pre-construction URLs breakdown ──────────────────────`);
    const builders = preconURLs.filter(u => {
      const parts = u.loc.replace(PRECON_BASE_URL, '').split('/').filter(Boolean);
      return parts.length === 1;
    });
    const projects = preconURLs.filter(u => {
      const parts = u.loc.replace(PRECON_BASE_URL, '').split('/').filter(Boolean);
      return parts.length === 2;
    });
    const models = preconURLs.filter(u => {
      const parts = u.loc.replace(PRECON_BASE_URL, '').split('/').filter(Boolean);
      return parts.length === 3;
    });
    console.log(`     Main index : 1`);
    console.log(`     Builders   : ${builders.length}`);
    console.log(`     Projects   : ${projects.length}`);
    console.log(`     Models     : ${models.length}`);
  }
}

run().catch((err) => {
  console.error('❌ Sitemap generation failed:', err);
  process.exit(1);
});
