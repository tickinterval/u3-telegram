const { MAIN_MENU_TEXTS, TEXT, CURRENCY_LABELS } = require('./i18n-data');

function createI18n({ languageDefault }) {
  const defaultLang = languageDefault || 'ru';

  function t(lang, key, vars = {}) {
    const pack = TEXT[lang] || TEXT[defaultLang] || TEXT.ru;
    const template = pack[key] || (TEXT.ru && TEXT.ru[key]) || '';
    return template.replace(/\{(\w+)\}/g, (match, name) => {
      if (Object.prototype.hasOwnProperty.call(vars, name)) {
        return String(vars[name]);
      }
      return match;
    });
  }

  function getCurrencyLabel(lang, currency) {
    const labels = CURRENCY_LABELS[lang] || CURRENCY_LABELS.ru;
    return labels[currency] || currency;
  }

  function formatPriceList(prices, lang) {
    const order = ['RUB', 'UAH', 'USD', 'CNY'];
    const parts = order
      .filter((code) => Object.prototype.hasOwnProperty.call(prices, code))
      .map((code) => {
        const label = getCurrencyLabel(lang, code);
        return `${prices[code]} ${label}`;
      });
    return parts.join(', ');
  }

  function formatDaysLabel(lang, days) {
    switch (lang) {
      case 'en':
        return `${days} days`;
      case 'uk':
        return `${days} днів`;
      case 'zh':
        return `${days} 天`;
      default:
        return `${days} дней`;
    }
  }

  function formatPriceLine(lang, days, prices) {
    const daysLabel = formatDaysLabel(lang, days);
    return `${daysLabel}: ${formatPriceList(prices, lang)}`;
  }

  function formatOrderStatus(lang, status) {
    const map = {
      CREATED: t(lang, 'status_created'),
      AWAITING_PAYMENT: t(lang, 'status_awaiting_payment'),
      EXPIRED: t(lang, 'status_expired'),
      ERROR: t(lang, 'status_error'),
      PAID_NO_KEY: t(lang, 'status_paid_no_key'),
      FULFILLED: t(lang, 'status_fulfilled'),
    };
    return map[status] || status || 'UNKNOWN';
  }

  return {
    t,
    getCurrencyLabel,
    formatPriceList,
    formatDaysLabel,
    formatPriceLine,
    formatOrderStatus,
  };
}

module.exports = {
  MAIN_MENU_TEXTS,
  TEXT,
  CURRENCY_LABELS,
  createI18n,
};
