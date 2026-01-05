const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function normalizeBaseUrl(value) {
  if (!value) {
    return '';
  }
  return value.replace(/\/+$/, '');
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('Missing config.json. Copy config.example.json to config.json and заполните настройки.');
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);

  if (!config.telegram_bot_token) {
    throw new Error('config.json: telegram_bot_token is required.');
  }
  config.cardlink = config.cardlink || {};
  config.cryptocloud = config.cryptocloud || {};
  config.crypto_wallet = config.crypto_wallet || {};

  const hasCardlink = Boolean(config.cardlink.api_token && config.cardlink.shop_id);
  const hasCryptocloud = Boolean(config.cryptocloud.api_key && config.cryptocloud.shop_id);
  config.crypto_wallet.assets = Array.isArray(config.crypto_wallet.assets) ? config.crypto_wallet.assets : [];
  const hasWallet = Boolean(
    config.crypto_wallet.enabled !== false && config.crypto_wallet.assets.length,
  );

  if (!hasCardlink && !hasCryptocloud && !hasWallet) {
    throw new Error('config.json: configure cardlink, cryptocloud, or crypto_wallet settings.');
  }

  const fallbackCurrency = (
    config.payment_currency
    || config.cardlink.currency_in
    || config.cryptocloud.currency
    || 'USD'
  ).toUpperCase();

  config.payment_currency = fallbackCurrency;

  if (hasCardlink) {
    config.cardlink.currency_in = (config.cardlink.currency_in || fallbackCurrency).toUpperCase();
    config.cardlink.payer_pays_commission = Number(config.cardlink.payer_pays_commission || 0);
  }

  if (hasCryptocloud) {
    config.cryptocloud.currency = (config.cryptocloud.currency || fallbackCurrency).toUpperCase();
    if (config.cryptocloud.locale) {
      config.cryptocloud.locale = String(config.cryptocloud.locale);
    }
  }
  if (config.crypto_wallet.enabled !== false) {
    config.crypto_wallet.enabled = Boolean(config.crypto_wallet.assets.length);
  }
  config.crypto_wallet.poll_interval_sec = Number(config.crypto_wallet.poll_interval_sec || 20);
  config.crypto_wallet.invoice_ttl_minutes = Number(config.crypto_wallet.invoice_ttl_minutes || 45);
  config.crypto_wallet.unique_amount_max = Number(config.crypto_wallet.unique_amount_max || 999);
  config.crypto_wallet.price_cache_sec = Number(config.crypto_wallet.price_cache_sec || 60);
  config.crypto_wallet.fiat_rate_cache_sec = Number(config.crypto_wallet.fiat_rate_cache_sec || 300);
  config.language_default = config.language_default || 'ru';
  config.support_links = config.support_links || {};
  config.admin_telegram_ids = Array.isArray(config.admin_telegram_ids) ? config.admin_telegram_ids : [];
  config.server = config.server || {};
  config.server.port = config.server.port || 3000;
  config.server.base_url = normalizeBaseUrl(config.server.base_url || '');
  config.products = Array.isArray(config.products) ? config.products : [];
  config.terms = config.terms || {};

  return config;
}

module.exports = {
  loadConfig,
  CONFIG_PATH,
};
