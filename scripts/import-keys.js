const fs = require('fs');
const path = require('path');

const { withKeys } = require('../src/storage');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (!value.startsWith('--')) {
      continue;
    }
    const key = value.slice(2);
    if (key === 'help') {
      options.help = true;
      continue;
    }
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      i += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function usage() {
  console.log('Usage: node scripts/import-keys.js --file <path> --product <code> --days <number>');
  console.log('Optional: --format json|txt');
}

function normalizeEntry(entry, fallbackProduct, fallbackDays) {
  if (typeof entry === 'string') {
    return {
      key: entry.trim(),
      product_code: fallbackProduct,
      days: fallbackDays,
    };
  }

  if (entry && typeof entry === 'object') {
    const keyValue = entry.key || entry.value;
    const product = entry.product_code || entry.product || fallbackProduct;
    const daysValue = entry.days || fallbackDays;
    return {
      key: keyValue ? String(keyValue).trim() : '',
      product_code: product,
      days: daysValue ? Number(daysValue) : null,
    };
  }

  return null;
}

function loadEntries(filePath, format) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if ((format && format.toLowerCase() === 'json') || filePath.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && Array.isArray(parsed.keys)) {
      return parsed.keys;
    }
    throw new Error('JSON file must contain an array of keys or { "keys": [...] }.');
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

async function run() {
  const options = parseArgs();
  if (options.help) {
    usage();
    return;
  }

  const filePath = options.file;
  if (!filePath) {
    usage();
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const product = options.product;
  const days = options.days ? Number(options.days) : null;
  const format = options.format;

  const entries = loadEntries(resolvedPath, format);
  const prepared = entries
    .map((entry) => normalizeEntry(entry, product, days))
    .filter((entry) => entry && entry.key);

  if (!prepared.length) {
    console.error('No keys found in the input file.');
    process.exit(1);
  }

  const invalid = prepared.filter((entry) => !entry.product_code || !entry.days);
  if (invalid.length) {
    console.error('Each key must include product and days (or specify --product and --days).');
    process.exit(1);
  }

  const now = new Date().toISOString();
  const result = await withKeys((keys) => {
    const existing = new Set([
      ...keys.available.map((item) => item.key),
      ...keys.used.map((item) => item.key),
    ]);

    let added = 0;
    let skipped = 0;
    for (const entry of prepared) {
      if (existing.has(entry.key)) {
        skipped += 1;
        continue;
      }
      keys.available.push({
        key: entry.key,
        product_code: entry.product_code,
        days: Number(entry.days),
        added_at: now,
      });
      existing.add(entry.key);
      added += 1;
    }
    keys.updated_at = now;
    return { added, skipped };
  });

  console.log(`Imported: ${result.added}, skipped duplicates: ${result.skipped}`);
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
