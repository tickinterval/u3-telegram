const crypto = require('crypto');
const fetch = require('node-fetch');

const API_BASE = 'https://api.cryptocloud.plus/v2';

function toBase64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64').toString('utf8');
}

function verifyPostbackToken(token, secretKey) {
  if (!token || !secretKey) {
    return { valid: false, reason: 'missing' };
  }
  const parts = String(token).split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'format' };
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  let payload;
  let header;
  try {
    header = JSON.parse(decodeBase64Url(headerPart));
    payload = JSON.parse(decodeBase64Url(payloadPart));
  } catch (err) {
    return { valid: false, reason: 'decode' };
  }

  if (!header || header.alg !== 'HS256') {
    return { valid: false, reason: 'alg' };
  }

  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(signingInput)
    .digest();
  const expected = toBase64Url(signature);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signaturePart);
  if (expectedBuffer.length !== actualBuffer.length) {
    return { valid: false, reason: 'signature' };
  }
  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { valid: false, reason: 'signature' };
  }

  if (payload && payload.exp && Number.isFinite(Number(payload.exp))) {
    const now = Math.floor(Date.now() / 1000);
    if (now > Number(payload.exp)) {
      return { valid: false, reason: 'expired' };
    }
  }

  return { valid: true, payload };
}

async function createInvoice({
  apiKey,
  shopId,
  amount,
  currency,
  orderId,
  email,
  addFields,
  locale,
}) {
  const payload = {
    amount,
    shop_id: shopId,
  };

  if (currency) {
    payload.currency = currency;
  }
  if (orderId) {
    payload.order_id = orderId;
  }
  if (email) {
    payload.email = email;
  }
  if (addFields) {
    payload.add_fields = addFields;
  }

  const query = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  const response = await fetch(`${API_BASE}/invoice/create${query}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`CryptoCloud response is not JSON: ${text.slice(0, 200)}`);
  }

  const success = response.ok && data && data.status === 'success';
  if (!success) {
    throw new Error(`CryptoCloud error: ${text.slice(0, 200)}`);
  }

  return data.result || data;
}

module.exports = {
  createInvoice,
  verifyPostbackToken,
};
