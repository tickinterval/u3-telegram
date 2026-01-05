const crypto = require('crypto');
const fetch = require('node-fetch');
const bs58 = require('bs58');

const DEFAULT_DECIMALS = {
  BTC: 8,
  LTC: 8,
  ETH: 18,
  BNB: 18,
  TRX: 6,
  USDT: 6,
  USDC: 6,
  SHIB: 18,
  TON: 9,
  SOL: 9,
};

const DEFAULT_PRICE_IDS = {
  BTC: 'bitcoin',
  LTC: 'litecoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  TRX: 'tron',
  USDT: 'tether',
  USDC: 'usd-coin',
  SHIB: 'shiba-inu',
  TON: 'the-open-network',
  SOL: 'solana',
};

const DEFAULT_STABLE_USD = new Set(['USDT', 'USDC']);
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const RPC_COOLDOWN_MS = 15000;
const RPC_BLOCK_CACHE_MS = 5000;

const priceCache = {
  updatedAt: 0,
  values: {},
};

const fiatCache = {
  updatedAt: 0,
  values: {},
};

const tipCache = new Map();
const rpcCooldowns = new Map();
const rpcBlockCache = new Map();

function normalizeAssets(rawAssets = []) {
  return rawAssets
    .map((asset) => {
      const code = String(asset.code || '').trim().toUpperCase();
      if (!code) {
        return null;
      }
      const title = asset.title || code;
      const decimals = Number.isFinite(Number(asset.decimals))
        ? Number(asset.decimals)
        : (DEFAULT_DECIMALS[code] || 8);
      const priceId = asset.price_id || DEFAULT_PRICE_IDS[code];
      const fixedUsdRate = Number.isFinite(Number(asset.fixed_usd_rate))
        ? Number(asset.fixed_usd_rate)
        : null;

      const networks = Array.isArray(asset.networks)
        ? asset.networks
          .map((network) => {
            const networkCode = String(network.code || '').trim().toUpperCase();
            const type = String(network.type || '').trim().toLowerCase();
            const address = String(network.address || '').trim();
            if (!networkCode || !type || !address) {
              return null;
            }
            const networkDecimals = Number.isFinite(Number(network.decimals))
              ? Number(network.decimals)
              : decimals;
            const invoiceDecimalsRaw = Number.isFinite(Number(network.invoice_decimals))
              ? Number(network.invoice_decimals)
              : decimals;
            const invoiceDecimals = Math.min(invoiceDecimalsRaw, networkDecimals);
            return {
              code: networkCode,
              type,
              address,
              api_base: network.api_base || '',
              api_key: network.api_key || '',
              contract: network.contract || '',
              chain_id: Number(network.chain_id || 0),
              rpc_url: network.rpc_url || '',
              rpc_urls: Array.isArray(network.rpc_urls) ? network.rpc_urls.filter(Boolean) : [],
              rpc_block_range: Number(network.rpc_block_range || 0),
              rpc_block_range_native: Number(network.rpc_block_range_native || 0),
              decimals: networkDecimals,
              invoice_decimals: invoiceDecimals,
              confirmations: Number(network.confirmations || 0),
            };
          })
          .filter(Boolean)
        : [];

      if (!networks.length) {
        return null;
      }

      return {
        ...asset,
        code,
        title,
        decimals,
        price_id: priceId,
        fixed_usd_rate: fixedUsdRate,
        networks,
      };
    })
    .filter(Boolean);
}

function getWalletAssets(config) {
  const wallet = (config && config.crypto_wallet) || {};
  return normalizeAssets(wallet.assets || []);
}

function getWalletAsset(config, code) {
  if (!code) {
    return null;
  }
  const assets = getWalletAssets(config);
  const target = String(code || '').toUpperCase();
  return assets.find((asset) => asset.code === target) || null;
}

function getWalletNetwork(asset, networkCode) {
  if (!asset || !networkCode) {
    return null;
  }
  const target = String(networkCode || '').toUpperCase();
  return asset.networks.find((network) => network.code === target) || null;
}

function isWalletEnabled(config) {
  const wallet = (config && config.crypto_wallet) || {};
  const assets = getWalletAssets(config);
  return Boolean(wallet.enabled && assets.length);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Wallet API response is not JSON: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    const message = data && data.message ? data.message : text.slice(0, 200);
    throw new Error(`Wallet API error: ${message}`);
  }
  return data;
}

async function getUsdPrice(asset, cacheSec = 60) {
  if (!asset) {
    throw new Error('Missing asset for price lookup.');
  }
  if (asset.fixed_usd_rate) {
    return asset.fixed_usd_rate;
  }
  if (DEFAULT_STABLE_USD.has(asset.code)) {
    return 1;
  }
  if (!asset.price_id) {
    throw new Error(`Missing price_id for ${asset.code}.`);
  }

  const now = Date.now();
  if (now - priceCache.updatedAt < cacheSec * 1000 && priceCache.values[asset.code]) {
    return priceCache.values[asset.code];
  }

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(asset.price_id)}&vs_currencies=usd`;
  const data = await fetchJson(url);
  const price = data && data[asset.price_id] && data[asset.price_id].usd;
  if (!price) {
    throw new Error(`Missing price for ${asset.code}.`);
  }

  priceCache.updatedAt = now;
  priceCache.values[asset.code] = Number(price);
  return priceCache.values[asset.code];
}

async function getUsdPerFiat(fiatCurrency, cacheSec = 300) {
  const fiat = String(fiatCurrency || '').toUpperCase();
  if (!fiat || fiat === 'USD') {
    return 1;
  }

  const now = Date.now();
  if (now - fiatCache.updatedAt < cacheSec * 1000 && fiatCache.values[fiat]) {
    return fiatCache.values[fiat];
  }

  const url = `https://api.exchangerate.host/latest?base=USD&symbols=${encodeURIComponent(fiat)}`;
  const data = await fetchJson(url);
  const rate = data && data.rates && data.rates[fiat];
  if (!rate) {
    throw new Error(`Missing fiat rate for ${fiat}.`);
  }

  fiatCache.updatedAt = now;
  fiatCache.values[fiat] = Number(rate);
  return fiatCache.values[fiat];
}

async function quoteFiatToAsset({
  fiatAmount,
  fiatCurrency,
  asset,
  decimals,
  priceCacheSec = 60,
  fiatCacheSec = 300,
}) {
  const usdPerFiat = await getUsdPerFiat(fiatCurrency, fiatCacheSec);
  const amountUsd = Number(fiatAmount) / usdPerFiat;
  const priceUsd = await getUsdPrice(asset, priceCacheSec);
  const amount = amountUsd / priceUsd;
  const decimalsToUse = Number.isFinite(Number(decimals))
    ? Number(decimals)
    : asset.decimals;
  const baseAtomic = decimalToAtomic(amount, decimalsToUse);

  if (baseAtomic <= 0n) {
    throw new Error('Unable to calculate crypto amount.');
  }

  return {
    amountUsd,
    priceUsd,
    baseAtomic,
    decimals: decimalsToUse,
  };
}

function decimalToAtomic(value, decimals) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error('Invalid decimal amount.');
  }
  const fixed = normalized.toFixed(decimals);
  const parts = fixed.split('.');
  const whole = parts[0].replace('-', '');
  const fraction = parts[1] || '';
  const combined = `${whole}${fraction}`.replace(/^0+/, '') || '0';
  const atomic = BigInt(combined);
  return normalized < 0 ? -atomic : atomic;
}

function randomInt(min, max) {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function selectUniqueAmount({
  baseAtomic,
  usedAmounts,
  uniqueAmountMax,
  maxAttempts = 200,
}) {
  const base = typeof baseAtomic === 'bigint' ? baseAtomic : BigInt(baseAtomic);
  const used = usedAmounts || new Set();
  const maxOffset = BigInt(Math.max(0, Number(uniqueAmountMax || 0)));

  for (let i = 0; i < maxAttempts; i += 1) {
    const offset = maxOffset > 0 ? BigInt(randomInt(1, Number(maxOffset))) : BigInt(0);
    const candidate = base + offset;
    const key = candidate.toString();
    if (!used.has(key)) {
      return { amountAtomic: candidate, offset };
    }
  }

  throw new Error('Unable to reserve unique amount.');
}

function formatAtomicAmount(amountAtomic, decimals) {
  const value = typeof amountAtomic === 'bigint' ? amountAtomic : BigInt(amountAtomic);
  if (!decimals) {
    return value.toString();
  }
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const raw = absolute.toString().padStart(decimals + 1, '0');
  const whole = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, '');
  const formatted = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${formatted}` : formatted;
}

async function getBlockstreamTipHeight(apiBase) {
  const cached = tipCache.get(apiBase);
  const now = Date.now();
  if (cached && now - cached.updatedAt < 30 * 1000) {
    return cached.height;
  }
  const response = await fetch(`${apiBase}/blocks/tip/height`);
  const text = await response.text();
  const height = Number(text);
  if (!Number.isFinite(height)) {
    throw new Error('Invalid block height response.');
  }
  tipCache.set(apiBase, { height, updatedAt: now });
  return height;
}

async function findUtxoPayment({
  network,
  address,
  amountAtomic,
  minConfirmations,
}) {
  const apiBase = network.api_base || '';
  if (!apiBase) {
    throw new Error('Missing api_base for UTXO network.');
  }
  const txs = await fetchJson(`${apiBase}/address/${address}/txs`);
  if (!Array.isArray(txs)) {
    return null;
  }

  const target = BigInt(amountAtomic);
  const tipHeight = await getBlockstreamTipHeight(apiBase);

  for (const tx of txs) {
    if (!Array.isArray(tx.vout)) {
      continue;
    }
    const status = tx.status || {};
    const confirmations = status.confirmed ? (tipHeight - status.block_height + 1) : 0;
    if (confirmations < minConfirmations) {
      continue;
    }
    for (const output of tx.vout) {
      if (output.scriptpubkey_address !== address) {
        continue;
      }
      const value = BigInt(output.value);
      if (value === target) {
        return { txid: tx.txid, confirmations };
      }
    }
  }

  return null;
}

async function findEvmPayment({
  network,
  address,
  amountAtomic,
  minConfirmations,
}) {
  if (!network.api_base) {
    throw new Error('Missing api_base for EVM network.');
  }
  const isToken = Boolean(network.contract);
  const params = new URLSearchParams({
    module: 'account',
    action: isToken ? 'tokentx' : 'txlist',
    address,
    sort: 'desc',
  });
  if (network.api_key) {
    params.set('apikey', network.api_key);
  }
  if (network.chain_id) {
    params.set('chainid', String(network.chain_id));
  }
  if (isToken) {
    params.set('contractaddress', network.contract);
  }

  const url = `${network.api_base}?${params.toString()}`;
  const data = await fetchJson(url);
  const items = data && data.result;
  if (!Array.isArray(items)) {
    return null;
  }

  const target = BigInt(amountAtomic);
  const normalizedAddress = address.toLowerCase();

  for (const tx of items) {
    if (!tx.to || String(tx.to).toLowerCase() !== normalizedAddress) {
      continue;
    }
    if (tx.isError && tx.isError !== '0') {
      continue;
    }
    if (tx.txreceipt_status && tx.txreceipt_status !== '1') {
      continue;
    }

    const confirmations = Number(tx.confirmations || 0);
    if (confirmations < minConfirmations) {
      continue;
    }
    if (BigInt(tx.value || 0) === target) {
      return { txid: tx.hash, confirmations };
    }
  }

  return null;
}

async function evmRpcCall(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }
  if (!response.ok) {
    throw new Error(`RPC HTTP error: ${response.status}`);
  }
  return data.result;
}

function getRpcUrls(network) {
  if (Array.isArray(network.rpc_urls) && network.rpc_urls.length) {
    return network.rpc_urls;
  }
  if (network.rpc_url) {
    return [network.rpc_url];
  }
  return [];
}

function isRateLimitError(err) {
  const message = String(err && err.message ? err.message : '').toLowerCase();
  return message.includes('limit')
    || message.includes('rate')
    || message.includes('too many requests')
    || message.includes('429');
}

function isBlockRangeError(err) {
  const message = String(err && err.message ? err.message : '').toLowerCase();
  return message.includes('block range')
    || message.includes('range is too large')
    || message.includes('invalid block range');
}

async function evmRpcCallWithFallback(network, method, params = []) {
  const urls = getRpcUrls(network);
  if (!urls.length) {
    throw new Error('Missing rpc_url for EVM network.');
  }
  const now = Date.now();
  let lastError;
  let bestUrl = urls[0];
  let bestUntil = Number.POSITIVE_INFINITY;

  for (const url of urls) {
    const cooldownUntil = rpcCooldowns.get(url) || 0;
    if (cooldownUntil > now) {
      if (cooldownUntil < bestUntil) {
        bestUntil = cooldownUntil;
        bestUrl = url;
      }
      continue;
    }
    try {
      const result = await evmRpcCall(url, method, params);
      return { result, url };
    } catch (err) {
      lastError = err;
      if (isRateLimitError(err)) {
        rpcCooldowns.set(url, now + RPC_COOLDOWN_MS);
        continue;
      }
      throw err;
    }
  }

  if (bestUrl && bestUntil !== Number.POSITIVE_INFINITY) {
    try {
      const result = await evmRpcCall(bestUrl, method, params);
      return { result, url: bestUrl };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('RPC error: all endpoints failed.');
}

async function getEvmBlockNumber(network) {
  const urls = getRpcUrls(network);
  const now = Date.now();
  for (const url of urls) {
    const cached = rpcBlockCache.get(url);
    if (cached && now - cached.updatedAt < RPC_BLOCK_CACHE_MS) {
      return cached.height;
    }
  }
  const response = await evmRpcCallWithFallback(network, 'eth_blockNumber');
  const height = Number.parseInt(response.result, 16);
  if (Number.isFinite(height) && response.url) {
    rpcBlockCache.set(response.url, { height, updatedAt: now });
  }
  return height;
}

function toHexBlock(value) {
  return `0x${value.toString(16)}`;
}

async function getEvmBlockWithTransactions(network, blockNumber) {
  const response = await evmRpcCallWithFallback(
    network,
    'eth_getBlockByNumber',
    [toHexBlock(blockNumber), true],
  );
  return response.result;
}

function toTopicAddress(address) {
  const normalized = address.toLowerCase().replace(/^0x/, '');
  return `0x${normalized.padStart(64, '0')}`;
}

async function findEvmTokenPaymentViaRpc({
  network,
  address,
  amountAtomic,
  minConfirmations,
  startBlock,
  lastCheckedBlock,
  pendingTx,
}) {
  if (!network.rpc_url) {
    throw new Error('Missing rpc_url for EVM token network.');
  }
  if (!network.contract) {
    throw new Error('Missing contract for EVM token network.');
  }

  const latest = await getEvmBlockNumber(network);
  if (pendingTx && pendingTx.block_number) {
    const confirmations = latest - Number(pendingTx.block_number) + 1;
    if (confirmations >= minConfirmations) {
      return { found: true, txid: pendingTx.txid, confirmations };
    }
    return {
      found: false,
      pending_tx: pendingTx,
      last_checked_block: latest,
    };
  }

  const range = network.rpc_block_range || 1000;
  let fromBlock;
  if (Number.isFinite(Number(lastCheckedBlock))) {
    fromBlock = Number(lastCheckedBlock) + 1;
  } else if (Number.isFinite(Number(startBlock))) {
    fromBlock = Math.max(0, Number(startBlock));
  } else {
    fromBlock = Math.max(0, latest - range);
  }
  if (fromBlock > latest) {
    return { found: false, last_checked_block: latest };
  }

  const target = typeof amountAtomic === 'bigint' ? amountAtomic : BigInt(amountAtomic);
  let chunkSize = range;
  let current = fromBlock;
  let lastChecked = null;

  while (current <= latest) {
    const toBlock = Math.min(current + chunkSize, latest);
    const params = [{
      fromBlock: toHexBlock(current),
      toBlock: toHexBlock(toBlock),
      address: network.contract,
      topics: [TRANSFER_TOPIC, null, toTopicAddress(address)],
    }];

    let logs;
    try {
      const response = await evmRpcCallWithFallback(network, 'eth_getLogs', params);
      logs = response.result;
    } catch (err) {
      if (isBlockRangeError(err) && chunkSize > 50) {
        chunkSize = Math.max(50, Math.floor(chunkSize / 2));
        continue;
      }
      throw err;
    }

    if (Array.isArray(logs)) {
      for (const log of logs) {
        const value = BigInt(log.data || '0x0');
        if (value !== target) {
          continue;
        }
        const blockNumber = Number.parseInt(log.blockNumber, 16);
        const confirmations = latest - blockNumber + 1;
        if (confirmations < minConfirmations) {
          return {
            found: false,
            pending_tx: { txid: log.transactionHash, block_number: blockNumber },
            last_checked_block: latest,
          };
        }
        return {
          found: true,
          txid: log.transactionHash,
          confirmations,
        };
      }
    }

    lastChecked = toBlock;
    current = toBlock + 1;
  }

  return { found: false, last_checked_block: lastChecked ?? latest };
}

async function findEvmNativePaymentViaRpc({
  network,
  address,
  amountAtomic,
  minConfirmations,
  startBlock,
  lastCheckedBlock,
  pendingTx,
}) {
  if (!network.rpc_url) {
    throw new Error('Missing rpc_url for EVM native network.');
  }

  const latest = await getEvmBlockNumber(network);
  const normalizedAddress = address.toLowerCase();
  const target = typeof amountAtomic === 'bigint' ? amountAtomic : BigInt(amountAtomic);

  if (pendingTx && pendingTx.block_number) {
    const confirmations = latest - Number(pendingTx.block_number) + 1;
    if (confirmations >= minConfirmations) {
      return { found: true, txid: pendingTx.txid, confirmations };
    }
    return {
      found: false,
      pending_tx: pendingTx,
      last_checked_block: Number.isFinite(Number(lastCheckedBlock)) ? Number(lastCheckedBlock) : null,
    };
  }

  const range = network.rpc_block_range_native || network.rpc_block_range || 1200;
  let fromBlock;
  if (Number.isFinite(Number(lastCheckedBlock))) {
    fromBlock = Number(lastCheckedBlock) + 1;
  } else if (Number.isFinite(Number(startBlock))) {
    fromBlock = Number(startBlock);
  } else {
    fromBlock = Math.max(0, latest - range);
  }

  if (fromBlock > latest) {
    return { found: false, last_checked_block: latest };
  }

  for (let blockNumber = fromBlock; blockNumber <= latest; blockNumber += 1) {
    const block = await getEvmBlockWithTransactions(network, blockNumber);
    const transactions = block && block.transactions;
    if (!Array.isArray(transactions)) {
      continue;
    }
    for (const tx of transactions) {
      if (!tx.to) {
        continue;
      }
      if (String(tx.to).toLowerCase() !== normalizedAddress) {
        continue;
      }
      const value = BigInt(tx.value || '0x0');
      if (value !== target) {
        continue;
      }
      const confirmations = latest - blockNumber + 1;
      if (confirmations >= minConfirmations) {
        return { found: true, txid: tx.hash, confirmations };
      }
      return {
        found: false,
        pending_tx: { txid: tx.hash, block_number: blockNumber },
        last_checked_block: latest,
      };
    }
  }

  return { found: false, last_checked_block: latest };
}

function tronHexToBase58(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const buffer = Buffer.from(clean, 'hex');
  const hash1 = crypto.createHash('sha256').update(buffer).digest();
  const hash2 = crypto.createHash('sha256').update(hash1).digest();
  const checksum = hash2.slice(0, 4);
  return bs58.encode(Buffer.concat([buffer, checksum]));
}

async function findTronPayment({
  network,
  address,
  amountAtomic,
  minConfirmations,
}) {
  const apiBase = network.api_base || 'https://api.trongrid.io';
  const headers = network.api_key ? { 'TRON-PRO-API-KEY': network.api_key } : {};
  const target = BigInt(amountAtomic);

  if (network.contract) {
    const url = `${apiBase}/v1/accounts/${address}/transactions/trc20?only_confirmed=true&limit=50&order_by=block_timestamp,desc&contract_address=${network.contract}`;
    const data = await fetchJson(url, { headers });
    const items = data && data.data;
    if (!Array.isArray(items)) {
      return null;
    }
    for (const tx of items) {
      if (tx.to !== address) {
        continue;
      }
      if (BigInt(tx.value || 0) === target) {
        return { txid: tx.transaction_id, confirmations: Math.max(1, minConfirmations) };
      }
    }
    return null;
  }

  const url = `${apiBase}/v1/accounts/${address}/transactions?only_confirmed=true&limit=50&order_by=block_timestamp,desc`;
  const data = await fetchJson(url, { headers });
  const items = data && data.data;
  if (!Array.isArray(items)) {
    return null;
  }

  for (const tx of items) {
    const contract = tx.raw_data && Array.isArray(tx.raw_data.contract) ? tx.raw_data.contract[0] : null;
    if (!contract || contract.type !== 'TransferContract') {
      continue;
    }
    const value = contract.parameter && contract.parameter.value ? contract.parameter.value : null;
    if (!value || !value.to_address) {
      continue;
    }
    const toAddress = tronHexToBase58(value.to_address);
    if (toAddress !== address) {
      continue;
    }
    if (BigInt(value.amount || 0) === target) {
      return { txid: tx.txID || tx.txid || tx.transaction_id, confirmations: Math.max(1, minConfirmations) };
    }
  }

  return null;
}

async function findTonPayment({
  network,
  address,
  amountAtomic,
  minConfirmations,
}) {
  const apiBase = network.api_base || 'https://toncenter.com/api/v2';
  const headers = network.api_key ? { 'X-API-Key': network.api_key } : {};
  const url = `${apiBase}/getTransactions?address=${encodeURIComponent(address)}&limit=20`;
  const data = await fetchJson(url, { headers });
  const items = data && data.result;
  if (!Array.isArray(items)) {
    return null;
  }

  const target = BigInt(amountAtomic);
  for (const tx of items) {
    const incoming = tx.in_msg;
    if (!incoming || incoming.destination !== address) {
      continue;
    }
    if (BigInt(incoming.value || 0) === target) {
      return { txid: tx.transaction_id || tx.hash, confirmations: Math.max(1, minConfirmations) };
    }
  }

  return null;
}

async function rpcCall(apiBase, method, params) {
  const response = await fetch(apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }
  return data.result;
}

async function findSolanaPayment({
  network,
  address,
  amountAtomic,
  minConfirmations,
}) {
  const apiBase = network.api_base || 'https://api.mainnet-beta.solana.com';
  const signatures = await rpcCall(apiBase, 'getSignaturesForAddress', [
    address,
    { limit: 20 },
  ]);

  if (!Array.isArray(signatures)) {
    return null;
  }
  const target = BigInt(amountAtomic);

  for (const sig of signatures) {
    if (sig.err) {
      continue;
    }
    const tx = await rpcCall(apiBase, 'getTransaction', [
      sig.signature,
      { encoding: 'jsonParsed' },
    ]);
    if (!tx || !tx.meta || tx.meta.err) {
      continue;
    }
    const keys = tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys;
    const index = Array.isArray(keys)
      ? keys.findIndex((key) => (key.pubkey || key) === address)
      : -1;
    if (index === -1) {
      continue;
    }
    const pre = tx.meta.preBalances && tx.meta.preBalances[index];
    const post = tx.meta.postBalances && tx.meta.postBalances[index];
    if (!Number.isFinite(pre) || !Number.isFinite(post)) {
      continue;
    }
    const delta = BigInt(post - pre);
    if (delta === target) {
      const confirmations = sig.confirmations === null ? minConfirmations : Number(sig.confirmations || 0);
      if (confirmations < minConfirmations) {
        continue;
      }
      return { txid: sig.signature, confirmations };
    }
  }

  return null;
}

async function findWalletPayment({
  asset,
  network,
  address,
  amountAtomic,
  minConfirmations = 1,
  startBlock,
  lastCheckedBlock,
  pendingTx,
}) {
  const confirmations = Number.isFinite(Number(minConfirmations)) ? Number(minConfirmations) : 1;
  switch (network.type) {
    case 'utxo':
      return findUtxoPayment({
        network,
        address,
        amountAtomic,
        minConfirmations: confirmations,
      }).then((result) => (result ? { found: true, ...result } : { found: false }));
    case 'evm':
      if (network.rpc_url && !network.contract) {
        return findEvmNativePaymentViaRpc({
          network,
          address,
          amountAtomic,
          minConfirmations: confirmations,
          startBlock,
          lastCheckedBlock,
          pendingTx,
        });
      }
      if (network.rpc_url && network.contract) {
        return findEvmTokenPaymentViaRpc({
          network,
          address,
          amountAtomic,
          minConfirmations: confirmations,
          startBlock,
          lastCheckedBlock,
          pendingTx,
        });
      }
      return findEvmPayment({
        network,
        address,
        amountAtomic,
        minConfirmations: confirmations,
      }).then((result) => (result ? { found: true, ...result } : { found: false }));
    case 'tron':
      return findTronPayment({
        network,
        address,
        amountAtomic,
        minConfirmations: confirmations,
      }).then((result) => (result ? { found: true, ...result } : { found: false }));
    case 'ton':
      return findTonPayment({
        network,
        address,
        amountAtomic,
        minConfirmations: confirmations,
      }).then((result) => (result ? { found: true, ...result } : { found: false }));
    case 'solana':
      return findSolanaPayment({
        network,
        address,
        amountAtomic,
        minConfirmations: confirmations,
      }).then((result) => (result ? { found: true, ...result } : { found: false }));
    default:
      throw new Error(`Unsupported network type: ${network.type}`);
  }
}

async function findEvmPaymentByTxid({
  network,
  address,
  amountAtomic,
  minConfirmations = 1,
  txid,
}) {
  if (!network.rpc_url && (!Array.isArray(network.rpc_urls) || !network.rpc_urls.length)) {
    throw new Error('Missing rpc_url for EVM network.');
  }
  if (!txid) {
    throw new Error('Missing txid.');
  }

  const receiptResponse = await evmRpcCallWithFallback(network, 'eth_getTransactionReceipt', [txid]);
  const receipt = receiptResponse.result;
  if (!receipt || !receipt.blockNumber) {
    return { found: false };
  }
  if (receipt.status && receipt.status !== '0x1' && receipt.status !== 1) {
    return { found: false };
  }

  const blockNumber = Number.parseInt(receipt.blockNumber, 16);
  const latest = await getEvmBlockNumber(network);
  const confirmations = latest - blockNumber + 1;
  const required = Number.isFinite(Number(minConfirmations)) ? Number(minConfirmations) : 1;

  if (confirmations < required) {
    return {
      found: false,
      pending_tx: { txid, block_number: blockNumber },
      last_checked_block: latest,
    };
  }

  const target = typeof amountAtomic === 'bigint' ? amountAtomic : BigInt(amountAtomic);
  const normalizedAddress = String(address || '').toLowerCase();

  if (network.contract) {
    const contract = String(network.contract || '').toLowerCase();
    const toTopic = toTopicAddress(address).toLowerCase();
    const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
    for (const log of logs) {
      if (!log || !log.topics || log.topics.length < 3) {
        continue;
      }
      if (String(log.address || '').toLowerCase() !== contract) {
        continue;
      }
      if (String(log.topics[0] || '').toLowerCase() !== TRANSFER_TOPIC) {
        continue;
      }
      if (String(log.topics[2] || '').toLowerCase() !== toTopic) {
        continue;
      }
      const value = BigInt(log.data || '0x0');
      if (value === target) {
        return { found: true, txid, confirmations };
      }
    }
    return { found: false, confirmations };
  }

  const txResponse = await evmRpcCallWithFallback(network, 'eth_getTransactionByHash', [txid]);
  const tx = txResponse.result;
  if (!tx || !tx.to) {
    return { found: false, confirmations };
  }
  if (String(tx.to || '').toLowerCase() !== normalizedAddress) {
    return { found: false, confirmations };
  }
  const value = BigInt(tx.value || '0x0');
  if (value !== target) {
    return { found: false, confirmations };
  }
  return { found: true, txid, confirmations };
}

module.exports = {
  getWalletAssets,
  getWalletAsset,
  getWalletNetwork,
  isWalletEnabled,
  quoteFiatToAsset,
  selectUniqueAmount,
  formatAtomicAmount,
  findWalletPayment,
  findEvmPaymentByTxid,
  getEvmBlockNumber,
};
