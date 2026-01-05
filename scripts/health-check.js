const { loadConfig } = require('../src/config');
const fetch = global.fetch || require('node-fetch');

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    const message = data && data.message ? data.message : text.slice(0, 200);
    throw new Error(`HTTP ${response.status}: ${message}`);
  }
  return data;
}

async function rpcCall(url, method, params = []) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method,
    params,
  };
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
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

function decodeAbiString(hex) {
  if (!hex || hex === '0x') {
    return null;
  }
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length === 64) {
    const buffer = Buffer.from(clean, 'hex');
    return buffer.toString('utf8').replace(/\u0000/g, '').trim() || null;
  }
  if (clean.length < 128) {
    return null;
  }
  const offset = parseInt(clean.slice(0, 64), 16);
  if (!Number.isFinite(offset)) {
    return null;
  }
  const lengthHex = clean.slice(offset * 2, offset * 2 + 64);
  const length = parseInt(lengthHex, 16);
  if (!Number.isFinite(length) || length <= 0) {
    return null;
  }
  const start = offset * 2 + 64;
  const data = clean.slice(start, start + length * 2);
  return Buffer.from(data, 'hex').toString('utf8').trim() || null;
}

async function fetchEvmTokenMeta(url, contract) {
  const symbolData = await rpcCall(url, 'eth_call', [{
    to: contract,
    data: '0x95d89b41',
  }, 'latest']);
  const decimalsData = await rpcCall(url, 'eth_call', [{
    to: contract,
    data: '0x313ce567',
  }, 'latest']);

  const symbol = decodeAbiString(symbolData);
  const decimals = Number.parseInt(decimalsData, 16);
  return {
    symbol: symbol || null,
    decimals: Number.isFinite(decimals) ? decimals : null,
  };
}

async function checkEvmContract(network, asset) {
  if (!network.contract) {
    return null;
  }
  const urls = getRpcUrls(network);
  if (urls.length) {
    for (const url of urls) {
      try {
        const code = await rpcCall(url, 'eth_getCode', [network.contract, 'latest']);
        if (!code || code === '0x') {
          return { ok: false, message: 'contract not found on chain' };
        }
        const meta = await fetchEvmTokenMeta(url, network.contract);
        const warnings = [];
        const expectedDecimals = Number.isFinite(Number(network.decimals))
          ? Number(network.decimals)
          : asset.decimals;
        if (meta.symbol && asset.code && meta.symbol.toUpperCase() !== asset.code.toUpperCase()) {
          warnings.push(`symbol ${meta.symbol}`);
        }
        if (Number.isFinite(meta.decimals) && Number.isFinite(expectedDecimals) && meta.decimals !== expectedDecimals) {
          warnings.push(`decimals ${meta.decimals}`);
        }
        const suffix = warnings.length ? ` (mismatch: ${warnings.join(', ')})` : '';
        return {
          ok: warnings.length === 0,
          message: `contract ok${suffix}`,
        };
      } catch (err) {
        continue;
      }
    }
    return { ok: false, message: 'contract check failed (rpc)' };
  }
  if (!network.api_base) {
    return { ok: false, message: 'missing rpc_url for contract check' };
  }
  const params = new URLSearchParams({
    module: 'contract',
    action: 'getsourcecode',
    address: network.contract,
  });
  if (network.api_key) {
    params.set('apikey', network.api_key);
  }
  if (network.chain_id) {
    params.set('chainid', String(network.chain_id));
  }
  const url = `${network.api_base}?${params.toString()}`;
  const data = await fetchJson(url);
  const result = Array.isArray(data.result) ? data.result[0] : null;
  if (!result || !result.SourceCode) {
    return { ok: false, message: 'contract lookup failed (api)' };
  }
  return { ok: true, message: 'contract ok (api)' };
}

async function checkEvm(network) {
  const urls = getRpcUrls(network);
  if (!urls.length) {
    if (!network.api_base) {
      return { ok: false, message: 'missing rpc_url' };
    }
    const params = new URLSearchParams({
      module: 'account',
      action: network.contract ? 'tokenbalance' : 'balance',
      address: network.address || '0x0000000000000000000000000000000000000000',
      tag: 'latest',
    });
    if (network.contract) {
      params.set('contractaddress', network.contract);
    }
    if (network.api_key) {
      params.set('apikey', network.api_key);
    }
    if (network.chain_id) {
      params.set('chainid', String(network.chain_id));
    }
    const url = `${network.api_base}?${params.toString()}`;
    const data = await fetchJson(url);
    if (!Object.prototype.hasOwnProperty.call(data, 'result')) {
      throw new Error('missing result from api');
    }
    return { ok: true, message: 'api ok (no rpc)' };
  }
  for (const url of urls) {
    try {
      await rpcCall(url, 'eth_blockNumber');
      return { ok: true, message: `rpc ok (${url})` };
    } catch (err) {
      continue;
    }
  }
  return { ok: false, message: 'all rpc endpoints failed' };
}

async function checkUtxo(network) {
  if (!network.api_base) {
    return { ok: false, message: 'missing api_base' };
  }
  const url = `${network.api_base}/blocks/tip/height`;
  const response = await fetch(url);
  const text = await response.text();
  const height = Number(text);
  if (!Number.isFinite(height)) {
    throw new Error(`Invalid height: ${text.slice(0, 50)}`);
  }
  return { ok: true, message: `tip ${height}` };
}

async function checkTron(network, address) {
  const apiBase = network.api_base || 'https://api.trongrid.io';
  const headers = network.api_key ? { 'TRON-PRO-API-KEY': network.api_key } : {};
  const accountUrl = `${apiBase}/v1/accounts/${address}`;
  const account = await fetchJson(accountUrl, { headers });
  if (!account || !account.data) {
    throw new Error('account lookup failed');
  }
  if (network.contract) {
    const txUrl = `${apiBase}/v1/accounts/${address}/transactions/trc20?only_confirmed=true&limit=1&order_by=block_timestamp,desc&contract_address=${network.contract}`;
    await fetchJson(txUrl, { headers });
  }
  return { ok: true, message: 'tron ok' };
}

async function checkTronContract(network) {
  if (!network.contract) {
    return null;
  }
  try {
    const apiBase = network.api_base || 'https://api.trongrid.io';
    const headers = network.api_key ? { 'TRON-PRO-API-KEY': network.api_key } : {};
    const accountUrl = `${apiBase}/v1/accounts/${network.contract}`;
    const account = await fetchJson(accountUrl, { headers });
    const accountHex = account && Array.isArray(account.data) && account.data[0] && account.data[0].address;
    if (!accountHex || !accountHex.startsWith('41')) {
      return { ok: false, message: 'contract lookup failed (tron account)' };
    }

    const body = JSON.stringify({ value: accountHex });
    const contract = await fetchJson(`${apiBase}/wallet/getcontract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    });

    if (!contract || !contract.bytecode) {
      return { ok: false, message: 'contract lookup failed (tron)' };
    }
    return { ok: true, message: 'contract ok (tron)' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function checkTon(network, address) {
  const apiBase = network.api_base || 'https://toncenter.com/api/v2';
  const headers = network.api_key ? { 'X-API-Key': network.api_key } : {};
  const url = `${apiBase}/getTransactions?address=${encodeURIComponent(address)}&limit=1`;
  const data = await fetchJson(url, { headers });
  if (!data || data.ok === false) {
    throw new Error('ton response error');
  }
  return { ok: true, message: 'ton ok' };
}

async function checkSolana(network, address) {
  const apiBase = network.api_base || 'https://api.mainnet-beta.solana.com';
  await rpcCall(apiBase, 'getSignaturesForAddress', [address, { limit: 1 }]);
  return { ok: true, message: 'solana ok' };
}

async function checkNetwork(asset, network) {
  try {
    switch (network.type) {
      case 'evm':
        return await checkEvm(network);
      case 'utxo':
        return await checkUtxo(network);
      case 'tron':
        return await checkTron(network, network.address);
      case 'ton':
        return await checkTon(network, network.address);
      case 'solana':
        return await checkSolana(network, network.address);
      default:
        return { ok: false, message: `unsupported type ${network.type}` };
    }
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function run() {
  const config = loadConfig();
  const assets = (config.crypto_wallet && config.crypto_wallet.assets) || [];
  const results = [];

  for (const asset of assets) {
    const networks = Array.isArray(asset.networks) ? asset.networks : [];
    for (const network of networks) {
      const title = `${asset.code} ${network.code}`.trim();
      const result = await checkNetwork(asset, network);
      results.push({ title, ...result });
      if (network.type === 'evm' && network.contract) {
        const contractCheck = await checkEvmContract(network, asset);
        if (contractCheck) {
          results.push({
            title: `${asset.code} ${network.code} contract`,
            ...contractCheck,
          });
        }
      }
      if (network.type === 'tron' && network.contract) {
        const contractCheck = await checkTronContract(network);
        if (contractCheck) {
          results.push({
            title: `${asset.code} ${network.code} contract`,
            ...contractCheck,
          });
        }
      }
    }
  }

  for (const result of results) {
    const prefix = result.ok ? 'OK' : 'FAIL';
    console.log(`${prefix} ${result.title}: ${result.message}`);
  }

  const failed = results.filter((item) => !item.ok);
  if (failed.length) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error(`Health check failed: ${err.message}`);
  process.exitCode = 1;
});
