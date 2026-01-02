const crypto = require('crypto');
const fetch = require('node-fetch');

const API_BASE = 'https://cardlink.link/api/v1';

function buildSignature(outSum, invId, apiToken) {
  return crypto
    .createHash('md5')
    .update(`${outSum}:${invId}:${apiToken}`)
    .digest('hex')
    .toUpperCase();
}

function verifyPostbackSignature(payload, apiToken) {
  if (!payload || !payload.OutSum || !payload.InvId || !payload.SignatureValue) {
    return false;
  }
  const expected = buildSignature(payload.OutSum, payload.InvId, apiToken);
  return expected === String(payload.SignatureValue).toUpperCase();
}

async function createBill({
  apiToken,
  amount,
  orderId,
  description,
  custom,
  shopId,
  currencyIn,
  payerPaysCommission,
  successUrl,
  failUrl,
  name,
  paymentMethod,
}) {
  const params = new URLSearchParams();
  params.set('amount', String(amount));
  params.set('shop_id', shopId);
  params.set('order_id', orderId);
  params.set('type', 'normal');
  if (description) {
    params.set('description', description);
  }
  if (custom) {
    params.set('custom', custom);
  }
  if (currencyIn) {
    params.set('currency_in', currencyIn);
  }
  if (payerPaysCommission === 0 || payerPaysCommission === 1) {
    params.set('payer_pays_commission', String(payerPaysCommission));
  }
  if (successUrl) {
    params.set('success_url', successUrl);
  }
  if (failUrl) {
    params.set('fail_url', failUrl);
  }
  if (name) {
    params.set('name', name);
  }
  if (paymentMethod) {
    params.set('payment_method', paymentMethod);
  }

  const response = await fetch(`${API_BASE}/bill/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
    body: params,
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Cardlink response is not JSON: ${text.slice(0, 200)}`);
  }

  const success = data && (data.success === true || data.success === 'true');
  if (!response.ok || !success) {
    throw new Error(`Cardlink error: ${text.slice(0, 200)}`);
  }

  return data;
}

module.exports = {
  createBill,
  verifyPostbackSignature,
  buildSignature,
};
