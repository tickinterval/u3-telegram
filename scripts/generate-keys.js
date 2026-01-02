const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
  console.log('Usage: node scripts/generate-keys.js --count 10 --output keys.txt');
}

function generateKey() {
  const raw = crypto.randomBytes(20).toString('hex').toUpperCase();
  return `${raw.slice(0, 8)}-${raw.slice(8, 16)}-${raw.slice(16, 24)}-${raw.slice(24, 32)}-${raw.slice(32, 40)}`;
}

function run() {
  const options = parseArgs();
  if (options.help) {
    usage();
    return;
  }

  const count = options.count ? Number(options.count) : 10;
  if (!Number.isFinite(count) || count <= 0) {
    console.error('Invalid --count value.');
    process.exit(1);
  }

  const keys = [];
  for (let i = 0; i < count; i += 1) {
    keys.push(generateKey());
  }

  if (options.output) {
    const target = path.resolve(options.output);
    fs.writeFileSync(target, `${keys.join('\n')}\n`, 'utf8');
    console.log(`Generated ${count} keys -> ${target}`);
    return;
  }

  console.log(keys.join('\n'));
}

run();
