const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const KEYS_PATH = path.join(DATA_DIR, 'keys.json');

const DEFAULT_STORE = {
  users: {},
  orders: {},
};

const DEFAULT_KEYS = {
  available: [],
  used: [],
  updated_at: null,
};

let lock = Promise.resolve();

async function ensureDataDir() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return fallback;
    }
    throw err;
  }
}

async function writeJson(filePath, data) {
  const raw = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(filePath, raw, 'utf8');
}

async function ensureFiles() {
  await ensureDataDir();
  try {
    await fs.promises.access(STORE_PATH);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeJson(STORE_PATH, DEFAULT_STORE);
    } else {
      throw err;
    }
  }
  try {
    await fs.promises.access(KEYS_PATH);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeJson(KEYS_PATH, DEFAULT_KEYS);
    } else {
      throw err;
    }
  }
}

function withLock(fn) {
  const run = () => fn().catch((err) => {
    throw err;
  });
  const next = lock.then(run, run);
  lock = next.catch(() => {});
  return next;
}

async function withData(fn) {
  await ensureFiles();
  return withLock(async () => {
    const store = await readJson(STORE_PATH, DEFAULT_STORE);
    const keys = await readJson(KEYS_PATH, DEFAULT_KEYS);
    const result = await fn(store, keys);
    await writeJson(STORE_PATH, store);
    await writeJson(KEYS_PATH, keys);
    return result;
  });
}

module.exports = {
  withData,
  withStore: async (fn) => {
    await ensureFiles();
    return withLock(async () => {
      const store = await readJson(STORE_PATH, DEFAULT_STORE);
      const result = await fn(store);
      await writeJson(STORE_PATH, store);
      return result;
    });
  },
  withKeys: async (fn) => {
    await ensureFiles();
    return withLock(async () => {
      const keys = await readJson(KEYS_PATH, DEFAULT_KEYS);
      const result = await fn(keys);
      await writeJson(KEYS_PATH, keys);
      return result;
    });
  },
  readStore: async () => {
    await ensureFiles();
    return withLock(async () => readJson(STORE_PATH, DEFAULT_STORE));
  },
  readKeys: async () => {
    await ensureFiles();
    return withLock(async () => readJson(KEYS_PATH, DEFAULT_KEYS));
  },
  STORE_PATH,
  KEYS_PATH,
};
