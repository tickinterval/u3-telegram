const crypto = require('crypto');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const { loadConfig } = require('./config');
const {
  withData,
  withStore,
  readKeys,
  readStore,
} = require('./storage');
const { createBill, verifyPostbackSignature } = require('./cardlink');
const {
  createInvoice: createCryptocloudInvoice,
  verifyPostbackToken: verifyCryptocloudPostbackToken,
} = require('./cryptocloud');
const {
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
} = require('./wallet');

const config = loadConfig();
const hasCardlink = Boolean(config.cardlink && config.cardlink.api_token && config.cardlink.shop_id);
const hasCryptocloud = Boolean(config.cryptocloud && config.cryptocloud.api_key && config.cryptocloud.shop_id);
const hasWallet = isWalletEnabled(config);
const bot = new TelegramBot(config.telegram_bot_token, { polling: true });

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const MAIN_MENU_TEXTS = {
  ru: [
    'u3ware - все дороги ведут к нам',
    '├ моментальная выдача',
    '├ поддержка, которая поможет с любым',
    '├ работаем уже более двух лет (тык) (https://t.me/u3ware)',
    '├ больше тысячи отзывов (тык) (https://t.me/u3ware)',
    '',
    'отзывы: @u3ware',
    'правила: @u3ware',
    'поддержка: @u3ware',
    '',
    '® @u3ware',
  ].join('\n'),
  en: [
    'u3ware - all roads lead to us',
    '├ instant delivery',
    '├ support that helps with anything',
    '├ we have been working for over two years (link) (https://t.me/u3ware)',
    '├ over a thousand reviews (link) (https://t.me/u3ware)',
    '',
    'reviews: @u3ware',
    'rules: @u3ware',
    'support: @u3ware',
    '',
    '® @u3ware',
  ].join('\n'),
  uk: [
    'u3ware - всi дороги ведуть до нас',
    '├ миттєва видача',
    '├ підтримка, яка допоможе з будь-чим',
    '├ працюємо вже понад два роки (тик) (https://t.me/u3ware)',
    '├ більше тисячі вiдгуків (тик) (https://t.me/u3ware)',
    '',
    'вiдгуки: @u3ware',
    'правила: @u3ware',
    'пiдтримка: @u3ware',
    '',
    '® @u3ware',
  ].join('\n'),
  zh: [
    'u3ware - 所有道路都通向我们',
    '├ 即时发货',
    '├ 支持可协助任何问题',
    '├ 已运营两年以上 (链接) (https://t.me/u3ware)',
    '├ 超过一千条评价 (链接) (https://t.me/u3ware)',
    '',
    '评价: @u3ware',
    '规则: @u3ware',
    '支持: @u3ware',
    '',
    '® @u3ware',
  ].join('\n'),
};
const TEXT = {
  ru: {
    agree_button: 'Принимаю',
    back_button: 'Назад',
    chat_label: 'Чат',
    choose_duration: 'Выберите срок:',
    choose_language: 'Язык:',
    creating_payment: 'Создаю оплату...',
    instruction_title: 'Инструкция',
    main_menu: MAIN_MENU_TEXTS.ru,
    no_keys_after_payment: 'Оплата прошла, но ключи закончились. Поддержка уже уведомлена.',
    out_of_stock: 'Ключи для этого тарифа закончились. Попробуйте позже или напишите в поддержку.',
    pay_button: 'Оплатить',
    payment_error: 'Не удалось создать ссылку на оплату. Попробуйте позже.',
    payment_failed: 'Оплата не прошла. Если деньги списались — напишите в поддержку.',
    payment_link: 'Ссылка на оплату:',
    payment_note: 'После оплаты ключ будет выдан автоматически.',
    payment_method: 'Выберите способ оплаты:',
    wallet_choose_coin: 'Выберите монету:',
    wallet_choose_network: 'Выберите сеть:',
    wallet_payment_title: 'Оплата криптовалютой',
    wallet_coin_label: 'Монета',
    wallet_network_label: 'Сеть',
    wallet_address_label: 'Адрес',
    wallet_amount_label: 'Сумма',
    wallet_expires_label: 'Действует',
    wallet_exact_amount: 'Отправьте точную сумму. Уникальные суммы используются для автопроверки.',
    wallet_invoice_expired: 'Инвойс истёк. Создайте новый платёж.',
    wallet_check_usage: 'Использование: /check <txid>',
    wallet_check_invalid: 'Неверный txid. Пример: /check 0x...',
    wallet_check_processing: 'Проверяю транзакцию...',
    wallet_check_not_found: 'Транзакция не найдена или не подходит под заказ.',
    wallet_check_not_supported: 'Ручная проверка недоступна для этой сети (нет RPC).',
    wallet_check_error: 'Не удалось проверить транзакцию. Попробуйте позже.',
    payment_received: 'Оплата получена. Ваш ключ:',
    keys_button: 'Ключи',
    keys_title: 'Мои заказы',
    keys_empty: 'Заказов пока нет.',
    order_status_label: 'Статус',
    order_id_label: 'Заказ',
    order_key_button: 'Получить ключ',
    order_key_missing: 'Ключ для этого заказа недоступен.',
    order_key_title: 'Ваш ключ:',
    keys_more: '... ещё {count}',
    price_label: 'цена',
    product_blitz_subtitle: 'dlc for pc',
    prices_title: 'цены:',
    profile_title: 'Профиль',
    products_empty: 'Пока нет доступных товаров.',
    products_title: 'Товары',
    purchases: 'Куплено ключей: {count}',
    support_label: 'Поддержка',
    terms_accepted: 'Спасибо! Теперь выберите раздел.',
    terms_intro: 'Чтобы продолжить, примите условия использования и политику конфиденциальности.',
    status_created: 'Создан',
    status_awaiting_payment: 'Ожидает оплату',
    status_expired: 'Истёк',
    status_error: 'Ошибка',
    status_paid_no_key: 'Оплачен, ключи закончились',
    status_fulfilled: 'Выполнен',
  },
  en: {
    agree_button: 'I agree',
    back_button: 'Back',
    chat_label: 'Community chat',
    choose_duration: 'Choose duration:',
    choose_language: 'Language:',
    creating_payment: 'Creating a payment link...',
    instruction_title: 'Instructions',
    main_menu: MAIN_MENU_TEXTS.en,
    no_keys_after_payment: 'Payment received, but keys are out of stock. Support has been notified.',
    out_of_stock: 'Keys for this plan are out of stock. Please try later or contact support.',
    pay_button: 'Pay',
    payment_error: 'Failed to create a payment link. Please try again later.',
    payment_failed: 'Payment failed. If you were charged, contact support.',
    payment_link: 'Payment link:',
    payment_note: 'After payment, the key will be issued automatically.',
    payment_method: 'Select a payment method:',
    wallet_choose_coin: 'Choose a coin:',
    wallet_choose_network: 'Choose a network:',
    wallet_payment_title: 'Wallet payment',
    wallet_coin_label: 'Coin',
    wallet_network_label: 'Network',
    wallet_address_label: 'Address',
    wallet_amount_label: 'Amount',
    wallet_expires_label: 'Expires in',
    wallet_exact_amount: 'Send the exact amount. Unique amounts are used for auto-check.',
    wallet_invoice_expired: 'Invoice expired. Please create a new payment.',
    wallet_check_usage: 'Usage: /check <txid>',
    wallet_check_invalid: 'Invalid txid. Example: /check 0x...',
    wallet_check_processing: 'Checking transaction...',
    wallet_check_not_found: 'Transaction not found or does not match any order.',
    wallet_check_not_supported: 'Manual check is not available for this network (missing RPC).',
    wallet_check_error: 'Unable to check transaction right now. Please try again later.',
    payment_received: 'Payment received. Your access key:',
    keys_button: 'Keys',
    keys_title: 'My orders',
    keys_empty: 'No orders yet.',
    order_status_label: 'Status',
    order_id_label: 'Order',
    order_key_button: 'Get key',
    order_key_missing: 'Key is not available for this order.',
    order_key_title: 'Your access key:',
    keys_more: '... {count} more',
    price_label: 'price',
    product_blitz_subtitle: 'dlc for pc',
    prices_title: 'prices:',
    profile_title: 'Profile',
    products_empty: 'No products available yet.',
    products_title: 'Products',
    purchases: 'Purchased keys: {count}',
    support_label: 'Support',
    terms_accepted: 'Thanks! You can now choose a section.',
    terms_intro: 'To continue, accept the terms of use and privacy policy.',
    status_created: 'Created',
    status_awaiting_payment: 'Awaiting payment',
    status_expired: 'Expired',
    status_error: 'Error',
    status_paid_no_key: 'Paid, no keys left',
    status_fulfilled: 'Fulfilled',
  },
  uk: {
    agree_button: 'Погоджуюсь',
    back_button: 'Назад',
    chat_label: 'Чат',
    choose_duration: 'Оберіть термін:',
    choose_language: 'Мова:',
    creating_payment: 'Створюю оплату...',
    instruction_title: 'Інструкція',
    main_menu: MAIN_MENU_TEXTS.uk,
    no_keys_after_payment: 'Оплату отримано, але ключі закінчились. Підтримку повідомлено.',
    out_of_stock: 'Ключі для цього тарифу закінчились. Спробуйте пізніше або напишіть у підтримку.',
    pay_button: 'Оплатити',
    payment_error: 'Не вдалося створити посилання на оплату. Спробуйте пізніше.',
    payment_failed: 'Оплата не пройшла. Якщо кошти списались — зверніться в підтримку.',
    payment_link: 'Посилання на оплату:',
    payment_note: 'Після оплати ключ буде видано автоматично.',
    payment_method: 'Оберіть спосіб оплати:',
    wallet_choose_coin: 'Оберіть монету:',
    wallet_choose_network: 'Оберіть мережу:',
    wallet_payment_title: 'Оплата криптовалютою',
    wallet_coin_label: 'Монета',
    wallet_network_label: 'Мережа',
    wallet_address_label: 'Адреса',
    wallet_amount_label: 'Сума',
    wallet_expires_label: 'Дійсний',
    wallet_exact_amount: 'Надішліть точну суму. Унікальні суми використовуются для автоперевірки.',
    wallet_invoice_expired: 'Інвойс завершився. Створіть новий платіж.',
    wallet_check_usage: 'Використання: /check <txid>',
    wallet_check_invalid: 'Невірний txid. Приклад: /check 0x...',
    wallet_check_processing: 'Перевіряю транзакцію...',
    wallet_check_not_found: 'Транзакцію не знайдено або вона не підходить до замовлення.',
    wallet_check_not_supported: 'Ручна перевірка недоступна для цієї мережі (немає RPC).',
    wallet_check_error: 'Не вдалося перевірити транзакцію. Спробуйте пізніше.',
    payment_received: 'Оплату отримано. Ваш ключ:',
    keys_button: 'Ключі',
    keys_title: 'Мої замовлення',
    keys_empty: 'Замовлень поки немає.',
    order_status_label: 'Статус',
    order_id_label: 'Замовлення',
    order_key_button: 'Отримати ключ',
    order_key_missing: 'Ключ для цього замовлення недоступний.',
    order_key_title: 'Ваш ключ:',
    keys_more: '... ще {count}',
    price_label: 'ціна',
    product_blitz_subtitle: 'dlc for pc',
    prices_title: 'ціни:',
    profile_title: 'Профіль',
    products_empty: 'Поки що немає доступних товарів.',
    products_title: 'Товари',
    purchases: 'Куплено ключів: {count}',
    support_label: 'Підтримка',
    terms_accepted: 'Дякуємо! Тепер оберіть розділ.',
    terms_intro: 'Щоб продовжити, прийміть умови використання та політику конфіденційності.',
    status_created: 'Створено',
    status_awaiting_payment: 'Очікує оплату',
    status_expired: 'Строк дії минув',
    status_error: 'Помилка',
    status_paid_no_key: 'Оплачено, ключі закінчились',
    status_fulfilled: 'Виконано',
  },
  zh: {
    agree_button: '同意',
    back_button: '返回',
    chat_label: '社群',
    choose_duration: '选择时长:',
    choose_language: '语言:',
    creating_payment: '正在创建支付...',
    instruction_title: '说明',
    main_menu: MAIN_MENU_TEXTS.zh,
    no_keys_after_payment: '已收到付款，但钥匙已售罄。支持已收到通知。',
    out_of_stock: '此套餐钥匙已售罄。请稍后再试或联系支持。',
    pay_button: '支付',
    payment_error: '无法创建支付链接。请稍后再试。',
    payment_failed: '支付失败。如果已扣款，请联系支持。',
    payment_link: '支付链接:',
    payment_note: '支付完成后会自动发放钥匙。',
    payment_method: '选择支付方式:',
    wallet_choose_coin: '选择币种:',
    wallet_choose_network: '选择网络:',
    wallet_payment_title: '钱包支付',
    wallet_coin_label: '币种',
    wallet_network_label: '网络',
    wallet_address_label: '地址',
    wallet_amount_label: '金额',
    wallet_expires_label: '有效期',
    wallet_exact_amount: '请发送精确金额。唯一金额用于自动校验。',
    wallet_invoice_expired: '发票已过期。请创建新的支付。',
    wallet_check_usage: '用法: /check <txid>',
    wallet_check_invalid: '无效 txid。示例: /check 0x...',
    wallet_check_processing: '正在检查交易...',
    wallet_check_not_found: '未找到交易或与订单不匹配。',
    wallet_check_not_supported: '该网络不支持手动检查（缺少 RPC）。',
    wallet_check_error: '暂时无法检查交易，请稍后再试。',
    payment_received: '已收到付款。您的钥匙:',
    keys_button: '钥匙',
    keys_title: '我的订单',
    keys_empty: '暂无订单。',
    order_status_label: '状态',
    order_id_label: '订单',
    order_key_button: '获取钥匙',
    order_key_missing: '该订单暂无钥匙。',
    order_key_title: '您的钥匙:',
    keys_more: '... 还有 {count}',
    price_label: '价格',
    product_blitz_subtitle: 'PC 版 DLC。',
    prices_title: '价格:',
    profile_title: '个人资料',
    products_empty: '暂无可用商品。',
    products_title: '商品',
    purchases: '已购买钥匙: {count}',
    support_label: '支持',
    terms_accepted: '谢谢！现在请选择一个部分。',
    terms_intro: '要继续，请接受使用条款和隐私政策。',
    status_created: '已创建',
    status_awaiting_payment: '等待付款',
    status_expired: '已过期',
    status_error: '错误',
    status_paid_no_key: '已付款，钥匙已售罄',
    status_fulfilled: '已完成',
  },
};
const CURRENCY_LABELS = {
  ru: {
    RUB: '₽',
    UAH: '₴',
    USD: '$',
    CNY: '¥',
  },
  en: {
    RUB: '₽',
    UAH: '₴',
    USD: '$',
    CNY: '¥',
  },
  uk: {
    RUB: '₽',
    UAH: '₴',
    USD: '$',
    CNY: '¥',
  },
  zh: {
    RUB: '₽',
    UAH: '₴',
    USD: '$',
    CNY: '¥',
  },
};
function nowIso() {
  return new Date().toISOString();
}

function t(lang, key, vars = {}) {
  const pack = TEXT[lang] || TEXT[config.language_default] || TEXT.ru;
  const template = pack[key] || TEXT.ru[key] || '';
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

function buildWalletInvoiceMessage(lang, asset, network, payment) {
  const amountAtomic = payment.invoice_amount_atomic || payment.amount_atomic;
  const decimals = Number.isFinite(Number(payment.invoice_decimals))
    ? Number(payment.invoice_decimals)
    : (Number.isFinite(Number(network.decimals)) ? Number(network.decimals) : asset.decimals);
  const amountText = amountAtomic ? formatAtomicAmount(amountAtomic, decimals) : payment.amount_crypto || '';

  const expiresAt = payment.expires_at ? Date.parse(payment.expires_at) : null;
  const expiresInMinutes = Number.isFinite(expiresAt)
    ? Math.max(0, Math.ceil((expiresAt - Date.now()) / (60 * 1000)))
    : null;
  const expiresText = expiresInMinutes !== null ? `${expiresInMinutes} min` : '';

  const lines = [
    `${t(lang, 'wallet_coin_label')}: *${asset.code}*`,
    `${t(lang, 'wallet_network_label')}: *${network.code}*`,
    '',
    `${t(lang, 'wallet_address_label')}: \`${network.address}\``,
    `${t(lang, 'wallet_amount_label')}: \`${amountText} ${asset.code}\``,
    `${t(lang, 'wallet_expires_label')}: ${expiresText}`,
    '',
    `_${t(lang, 'wallet_exact_amount')}_`,
    t(lang, 'payment_note'),
  ];

  return { text: lines.join('\n'), expiresInMinutes };
}

function parseCommand(text) {
  if (!text) {
    return null;
  }
  const trimmed = String(text).trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }
  const [raw, ...args] = trimmed.split(/\s+/);
  const command = raw.slice(1).split('@')[0].toLowerCase();
  if (!command) {
    return null;
  }
  return { command, args };
}

function normalizeTxid(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) {
    return null;
  }
  const match = cleaned.match(/^(0x)?[0-9a-fA-F]{64}$/);
  if (!match) {
    return null;
  }
  return cleaned.startsWith('0x') ? cleaned.toLowerCase() : `0x${cleaned.toLowerCase()}`;
}

function generateOrderId(userId) {
  const random = crypto.randomBytes(3).toString('hex');
  return `tg-${userId}-${Date.now()}-${random}`;
}

function getNextOrderId(store) {
  if (!store.meta) {
    store.meta = { order_seq: 0 };
  }
  let seq = Number(store.meta.order_seq || 0);
  if (!seq) {
    let max = 0;
    for (const id of Object.keys(store.orders || {})) {
      if (/^\d+$/.test(id)) {
        const value = Number(id);
        if (Number.isFinite(value) && value > max) {
          max = value;
        }
      }
    }
    seq = max;
  }
  seq += 1;
  store.meta.order_seq = seq;
  return String(seq);
}

function findProduct(code) {
  return config.products.find((product) => product.code === code);
}

function findDuration(product, days) {
  return product.durations.find((item) => Number(item.days) === Number(days));
}

function getDisplayProductTitle(product) {
  if (product.code === 'blitz') {
    return '🐟 u3ware';
  }
  return product.title;
}
function getProductDescription(product, lang) {
  if (product.code !== 'blitz') {
    return null;
  }
  const lines = [
    getDisplayProductTitle(product),
    '',
    t(lang, 'product_blitz_subtitle'),
    '',
    t(lang, 'prices_title'),
  ];
  for (const duration of product.durations) {
    const priceList = formatPriceList(duration.prices, lang);
    lines.push(`├ ${formatDaysLabel(lang, duration.days)}: ${priceList}`);
  }
  return lines.join('\n');
}
async function ensureUser(tgUser) {
  return withStore((store) => {
    const id = String(tgUser.id);
    const existing = store.users[id] || {
      id,
      accepted: false,
      language: config.language_default,
      purchase_count: 0,
    };
    existing.username = tgUser.username || existing.username || '';
    existing.first_name = tgUser.first_name || existing.first_name || '';
    existing.last_seen_at = nowIso();
    store.users[id] = existing;
    return existing;
  });
}

async function updateUser(userId, updates) {
  return withStore((store) => {
    const id = String(userId);
    const existing = store.users[id] || {
      id,
      accepted: false,
      language: config.language_default,
      purchase_count: 0,
    };
    Object.assign(existing, updates, { updated_at: nowIso() });
    store.users[id] = existing;
    return existing;
  });
}

async function getUser(userId) {
  const store = await readStore();
  return store.users[String(userId)];
}

async function sendOrEditMessage(chatId, userId, text, options = {}, preferredMessageId = null) {
  const safeOptions = { ...options };
  if (!Object.prototype.hasOwnProperty.call(safeOptions, 'reply_markup')) {
    safeOptions.reply_markup = { inline_keyboard: [] };
  }

  const user = await getUser(userId);
  const messageId = preferredMessageId || (user && user.last_message_id);

  if (messageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...safeOptions,
      });
      await updateUser(userId, { last_message_id: messageId });
      return { message_id: messageId };
    } catch (err) {
      const description = err && err.response && err.response.body && err.response.body.description;
      if (description && description.includes('message is not modified')) {
        await updateUser(userId, { last_message_id: messageId });
        return { message_id: messageId };
      }
    }
  }

  const sent = await bot.sendMessage(chatId, text, safeOptions);
  await updateUser(userId, { last_message_id: sent.message_id });
  return sent;
}

async function sendMessageOnly(chatId, userId, text, options = {}) {
  const safeOptions = { ...options };
  if (!Object.prototype.hasOwnProperty.call(safeOptions, 'reply_markup')) {
    safeOptions.reply_markup = { inline_keyboard: [] };
  }
  const sent = await bot.sendMessage(chatId, text, safeOptions);
  await updateUser(userId, { last_message_id: sent.message_id });
  return sent;
}

async function sendTerms(chatId, userId, lang) {
  const text = [
    t(lang, 'terms_intro'),
    '',
    config.terms.text || '',
    config.terms.policy || '',
  ].filter(Boolean).join('\n');

  return sendOrEditMessage(chatId, userId, text, {
    reply_markup: {
      inline_keyboard: [[{ text: t(lang, 'agree_button'), callback_data: 'agree_terms' }]],
    },
    disable_web_page_preview: true,
  });
}

async function sendMainMenu(chatId, userId, lang) {
  const buttons = config.products.map((product) => [
    { text: getDisplayProductTitle(product), callback_data: `product:${product.code}` },
  ]);
  buttons.push([{ text: t(lang, 'profile_title'), callback_data: 'menu_profile' }]);

  return sendOrEditMessage(chatId, userId, t(lang, 'main_menu'), {
    reply_markup: { inline_keyboard: buttons },
    disable_web_page_preview: true,
  });
}

async function sendProfile(chatId, user) {
  const lang = user.language || config.language_default;
  const text = [
    t(lang, 'purchases', { count: user.purchase_count || 0 }),
    '',
    t(lang, 'choose_language'),
  ].join('\n');

  const keyboard = {
    inline_keyboard: [
      [
        { text: '🇷🇺', callback_data: 'lang:ru' },
        { text: '🇬🇧', callback_data: 'lang:en' },
      ],
      [
        { text: '🇺🇦', callback_data: 'lang:uk' },
        { text: '🇨🇳', callback_data: 'lang:zh' },
      ],
      [{ text: t(lang, 'keys_button'), callback_data: 'menu_keys' }],
      [{ text: t(lang, 'back_button'), callback_data: 'menu_main' }],
    ],
  };

  return sendOrEditMessage(chatId, user.id, text, { reply_markup: keyboard });
}

async function sendKeysList(chatId, userId, lang) {
  const store = await readStore();
  const orders = Object.values(store.orders || {})
    .filter((order) => String(order.user_id) === String(userId))
    .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));

  if (!orders.length) {
    return sendOrEditMessage(chatId, userId, t(lang, 'keys_empty'), {
      reply_markup: {
        inline_keyboard: [[{ text: t(lang, 'back_button'), callback_data: 'menu_profile' }]],
      },
    });
  }

  const maxItems = 10;
  const shown = orders.slice(0, maxItems);
  const lines = [t(lang, 'keys_title'), ''];
  for (const order of shown) {
    lines.push(
      `${t(lang, 'order_id_label')}: ${order.id} | ${t(lang, 'order_status_label')}: ${formatOrderStatus(lang, order.status)}`,
    );
  }
  if (orders.length > maxItems) {
    lines.push(t(lang, 'keys_more', { count: orders.length - maxItems }));
  }

  const rows = [];
  for (const order of shown) {
    if (!order.key) {
      continue;
    }
    rows.push([{
      text: `${t(lang, 'order_key_button')} #${order.id}`,
      callback_data: `order_key:${order.id}`,
    }]);
  }
  rows.push([{ text: t(lang, 'back_button'), callback_data: 'menu_profile' }]);

  return sendOrEditMessage(chatId, userId, lines.join('\n'), {
    reply_markup: { inline_keyboard: rows },
  });
}

async function sendProducts(chatId, userId, lang) {
  return sendMainMenu(chatId, userId, lang);
}

async function sendProductDetails(chatId, userId, lang, product) {
  const customDescription = getProductDescription(product, lang);
  const lines = [];

  if (customDescription) {
    lines.push(customDescription);
  } else {
    lines.push(getDisplayProductTitle(product), '', t(lang, 'choose_duration'));
    for (const duration of product.durations) {
      lines.push(formatPriceLine(lang, duration.days, duration.prices));
    }
  }

  const rows = [];
  for (let i = 0; i < product.durations.length; i += 2) {
    const row = [];
    const left = product.durations[i];
    const right = product.durations[i + 1];
    row.push({
      text: formatDaysLabel(lang, left.days),
      callback_data: `duration:${product.code}:${left.days}`,
    });
    if (right) {
      row.push({
        text: formatDaysLabel(lang, right.days),
        callback_data: `duration:${product.code}:${right.days}`,
      });
    }
    rows.push(row);
  }
  rows.push([{ text: t(lang, 'back_button'), callback_data: 'menu_main' }]);

  return sendOrEditMessage(chatId, userId, lines.join('\n'), {
    reply_markup: { inline_keyboard: rows },
  });
}

async function sendPaymentMethods(chatId, userId, lang, product, duration) {
  const displayTitle = getDisplayProductTitle(product);
  const header = `${displayTitle} -> ${formatDaysLabel(lang, duration.days)}`;
  const priceList = formatPriceList(duration.prices, lang);
  const text = [
    header,
    `${t(lang, 'price_label')}: ${priceList}`,
    '',
    t(lang, 'payment_method'),
  ].join('\n');

  const methodRow = [];
  if (hasCardlink) {
    methodRow.push({
      text: 'Cardlink',
      callback_data: `pay:cardlink:${product.code}:${duration.days}`,
    });
  }
  if (hasCryptocloud) {
    methodRow.push({
      text: 'CryptoCloud',
      callback_data: `pay:cryptocloud:${product.code}:${duration.days}`,
    });
  }
  if (hasWallet) {
    methodRow.push({
      text: 'Wallet',
      callback_data: `pay:wallet:${product.code}:${duration.days}`,
    });
  }

  if (!methodRow.length) {
    return sendOrEditMessage(chatId, userId, t(lang, 'payment_error'), {
      reply_markup: {
        inline_keyboard: [[{ text: t(lang, 'back_button'), callback_data: `product:${product.code}` }]],
      },
    });
  }

  const keyboard = {
    inline_keyboard: [
      methodRow,
      [{ text: t(lang, 'back_button'), callback_data: `product:${product.code}` }],
    ],
  };

  return sendOrEditMessage(chatId, userId, text, { reply_markup: keyboard });
}

async function hasAvailableKey(productCode, days) {
  const keys = await readKeys();
  return keys.available.some(
    (item) => item.product_code === productCode && Number(item.days) === Number(days),
  );
}

async function updateOrder(orderId, updates) {
  return withStore((store) => {
    const order = store.orders[orderId];
    if (!order) {
      return null;
    }
    Object.assign(order, updates, { updated_at: nowIso() });
    store.orders[orderId] = order;
    return order;
  });
}

async function createOrder(userId, product, duration, amount) {
  let createdOrder = null;
  await withStore((store) => {
    const orderId = getNextOrderId(store);
    const order = {
      id: orderId,
      user_id: String(userId),
      product_code: product.code,
      product_title: getDisplayProductTitle(product),
      days: duration.days,
      amount,
      currency: config.payment_currency,
      status: 'CREATED',
      created_at: nowIso(),
    };
    store.orders[orderId] = order;
    createdOrder = order;
  });
  return createdOrder;
}

async function notifyAdmins(message) {
  const admins = config.admin_telegram_ids || [];
  if (!admins.length) {
    return;
  }
  await Promise.all(
    admins.map((adminId) => bot.sendMessage(adminId, message).catch(() => null)),
  );
}

function getInvoiceScaleFactor(networkDecimals, invoiceDecimals) {
  const network = Number(networkDecimals);
  const invoice = Number(invoiceDecimals);
  if (!Number.isFinite(network) || !Number.isFinite(invoice)) {
    return 1n;
  }
  const diff = network - invoice;
  if (diff <= 0) {
    return 1n;
  }
  return 10n ** BigInt(diff);
}

function getPendingWalletAmounts(store, assetCode, networkCode, invoiceDecimals, networkDecimals) {
  const used = new Set();
  const now = Date.now();
  const scaleFactor = getInvoiceScaleFactor(networkDecimals, invoiceDecimals);
  const orders = Object.values(store.orders || {});
  for (const order of orders) {
    if (order.payment_provider !== 'wallet' || order.status !== 'AWAITING_PAYMENT') {
      continue;
    }
    const payment = order.payment || {};
    if (payment.asset !== assetCode || payment.network !== networkCode) {
      continue;
    }
    if (payment.expires_at && Date.parse(payment.expires_at) < now) {
      continue;
    }
    if (payment.invoice_amount_atomic) {
      used.add(String(payment.invoice_amount_atomic));
      continue;
    }
    if (payment.amount_atomic) {
      try {
        const amountAtomic = BigInt(payment.amount_atomic);
        if (scaleFactor > 1n) {
          if (amountAtomic % scaleFactor !== 0n) {
            continue;
          }
          used.add((amountAtomic / scaleFactor).toString());
        } else {
          used.add(amountAtomic.toString());
        }
      } catch (err) {
        continue;
      }
    }
  }
  return used;
}

async function sendWalletCoins(chatId, userId, lang, product, duration) {
  const assets = getWalletAssets(config);
  if (!assets.length) {
    await sendOrEditMessage(chatId, userId, t(lang, 'payment_error'));
    return;
  }

  const rows = [];
  for (let i = 0; i < assets.length; i += 2) {
    const row = [];
    const left = assets[i];
    const right = assets[i + 1];
    row.push({
      text: left.title || left.code,
      callback_data: `wallet:coin:${left.code}:${product.code}:${duration.days}`,
    });
    if (right) {
      row.push({
        text: right.title || right.code,
        callback_data: `wallet:coin:${right.code}:${product.code}:${duration.days}`,
      });
    }
    rows.push(row);
  }
  rows.push([{ text: t(lang, 'back_button'), callback_data: `duration:${product.code}:${duration.days}` }]);

  await sendOrEditMessage(chatId, userId, t(lang, 'wallet_choose_coin'), {
    reply_markup: { inline_keyboard: rows },
  });
}

async function sendWalletNetworks(chatId, userId, lang, product, duration, asset) {
  if (!asset || !asset.networks || !asset.networks.length) {
    await sendOrEditMessage(chatId, userId, t(lang, 'payment_error'));
    return;
  }
  const rows = [];
  for (let i = 0; i < asset.networks.length; i += 2) {
    const row = [];
    const left = asset.networks[i];
    const right = asset.networks[i + 1];
    row.push({
      text: left.code,
      callback_data: `wallet:net:${asset.code}:${left.code}:${product.code}:${duration.days}`,
    });
    if (right) {
      row.push({
        text: right.code,
        callback_data: `wallet:net:${asset.code}:${right.code}:${product.code}:${duration.days}`,
      });
    }
    rows.push(row);
  }
  rows.push([{ text: t(lang, 'back_button'), callback_data: `pay:wallet:${product.code}:${duration.days}` }]);

  await sendOrEditMessage(chatId, userId, t(lang, 'wallet_choose_network'), {
    reply_markup: { inline_keyboard: rows },
  });
}

async function handleWalletPayment(chatId, userId, lang, product, duration, assetCode, networkCode) {
  const amount = duration.prices[config.payment_currency];
  const backKeyboard = {
    reply_markup: {
      inline_keyboard: [[{ text: t(lang, 'back_button'), callback_data: `pay:wallet:${product.code}:${duration.days}` }]],
    },
  };
  if (typeof amount === 'undefined') {
    await sendOrEditMessage(chatId, userId, t(lang, 'payment_error'), backKeyboard);
    return;
  }

  const hasKey = await hasAvailableKey(product.code, duration.days);
  if (!hasKey) {
    await sendOrEditMessage(chatId, userId, t(lang, 'out_of_stock'), backKeyboard);
    return;
  }

  const asset = getWalletAsset(config, assetCode);
  const network = asset ? getWalletNetwork(asset, networkCode) : null;
  if (!asset || !network) {
    await sendOrEditMessage(chatId, userId, t(lang, 'payment_error'), backKeyboard);
    return;
  }
  const keyboard = {
    inline_keyboard: [
      [{ text: t(lang, 'back_button'), callback_data: `wallet:coin:${asset.code}:${product.code}:${duration.days}` }],
    ],
  };
  const store = await readStore();
  const now = Date.now();
  const existing = Object.values(store.orders || {})
    .filter((order) => (
      String(order.user_id) === String(userId)
      && order.product_code === product.code
      && Number(order.days) === Number(duration.days)
      && order.payment_provider === 'wallet'
      && order.status === 'AWAITING_PAYMENT'
      && order.payment
      && order.payment.asset === asset.code
      && order.payment.network === network.code
    ))
    .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))[0];

  if (existing && existing.payment && existing.payment.expires_at) {
    const expiresAt = Date.parse(existing.payment.expires_at);
    if (Number.isFinite(expiresAt) && expiresAt > now) {
      const messageInfo = buildWalletInvoiceMessage(lang, asset, network, existing.payment);
      const sent = await sendOrEditMessage(chatId, userId, messageInfo.text, {
        reply_markup: keyboard,
        disable_web_page_preview: true,
        parse_mode: 'Markdown',
      }, existing.payment.message_id || null);
      if (sent && sent.message_id) {
        await updateOrder(existing.id, {
          payment: { ...existing.payment, message_id: sent.message_id, last_expires_min: messageInfo.expiresInMinutes },
        });
      }
      return;
    }
    if (Number.isFinite(expiresAt) && expiresAt <= now) {
      await updateOrder(existing.id, { status: 'EXPIRED' });
    }
  }
  const networkDecimals = Number.isFinite(Number(network.decimals))
    ? Number(network.decimals)
    : asset.decimals;
  const invoiceDecimalsRaw = Number.isFinite(Number(network.invoice_decimals))
    ? Number(network.invoice_decimals)
    : networkDecimals;
  const invoiceDecimals = Math.min(invoiceDecimalsRaw, networkDecimals);

  await sendOrEditMessage(chatId, userId, t(lang, 'creating_payment'));

  const order = await createOrder(userId, product, duration, amount);

  try {
    const quote = await quoteFiatToAsset({
      fiatAmount: amount,
      fiatCurrency: config.payment_currency,
      asset,
      decimals: invoiceDecimals,
      priceCacheSec: config.crypto_wallet.price_cache_sec,
      fiatCacheSec: config.crypto_wallet.fiat_rate_cache_sec,
    });

    const storeData = await readStore();
    const usedAmounts = getPendingWalletAmounts(
      storeData,
      asset.code,
      network.code,
      invoiceDecimals,
      networkDecimals,
    );
    const unique = selectUniqueAmount({
      baseAtomic: quote.baseAtomic,
      usedAmounts,
      uniqueAmountMax: config.crypto_wallet.unique_amount_max,
    });

    const invoiceAmountAtomic = unique.amountAtomic;
    const scaleFactor = getInvoiceScaleFactor(networkDecimals, invoiceDecimals);
    const amountAtomic = invoiceAmountAtomic * scaleFactor;
    const amountText = formatAtomicAmount(invoiceAmountAtomic, invoiceDecimals);
    const expiresInMinutes = config.crypto_wallet.invoice_ttl_minutes;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
    let evmStartBlock = null;
    if (network.type === 'evm' && (network.rpc_url || (network.rpc_urls && network.rpc_urls.length))) {
      try {
        evmStartBlock = await getEvmBlockNumber(network);
      } catch (err) {
        evmStartBlock = null;
      }
    }

    const updatedOrder = await updateOrder(order.id, {
      status: 'AWAITING_PAYMENT',
      payment_provider: 'wallet',
      payment: {
        status: 'pending',
        asset: asset.code,
        network: network.code,
        address: network.address,
        amount_crypto: amountText,
        amount_atomic: amountAtomic.toString(),
        invoice_amount_atomic: invoiceAmountAtomic.toString(),
        invoice_decimals: invoiceDecimals,
        decimals: networkDecimals,
        fiat_amount: amount,
        fiat_currency: config.payment_currency,
        rate_usd: quote.priceUsd,
        amount_usd: quote.amountUsd,
        expires_at: expiresAt,
        evm_start_block: evmStartBlock,
      },
    });

    const messageInfo = buildWalletInvoiceMessage(
      lang,
      asset,
      network,
      (updatedOrder && updatedOrder.payment) ? updatedOrder.payment : {},
    );
    const sent = await sendOrEditMessage(chatId, userId, messageInfo.text, {
      reply_markup: keyboard,
      disable_web_page_preview: true,
      parse_mode: 'Markdown',
    });
    if (sent && sent.message_id) {
      const payment = (updatedOrder && updatedOrder.payment)
        ? { ...updatedOrder.payment }
        : {};
      payment.message_id = sent.message_id;
      payment.last_expires_min = messageInfo.expiresInMinutes;
      await updateOrder(order.id, { payment });
    }
  } catch (err) {
    console.warn('Wallet payment error:', err && err.message ? err.message : err);
    await updateOrder(order.id, { status: 'ERROR', error: err.message, payment_provider: 'wallet' });
    await sendOrEditMessage(chatId, userId, t(lang, 'payment_error'), backKeyboard);
  }
}

async function handleWalletCheckCommand(chatId, userId, lang, args) {
  if (!hasWallet) {
    await sendOrEditMessage(chatId, userId, t(lang, 'payment_error'));
    return;
  }
  const arg = args && args[0];
  if (!arg) {
    await sendOrEditMessage(chatId, userId, t(lang, 'wallet_check_usage'));
    return;
  }
  const txid = normalizeTxid(arg);
  if (!txid) {
    await sendOrEditMessage(chatId, userId, t(lang, 'wallet_check_invalid'));
    return;
  }

  await sendOrEditMessage(chatId, userId, t(lang, 'wallet_check_processing'));

  const store = await readStore();
  const orders = Object.values(store.orders || {}).filter(
    (order) => String(order.user_id) === String(userId) && order.payment_provider === 'wallet',
  );

  if (!orders.length) {
    await sendOrEditMessage(chatId, userId, t(lang, 'wallet_check_not_found'));
    return;
  }

  const existing = orders.find(
    (order) => order.payment
      && order.payment.txid
      && String(order.payment.txid).toLowerCase() === txid
      && order.key,
  );
  if (existing) {
    await sendWalletSuccessMessage(existing);
    return;
  }
  const alreadyNoKey = orders.find(
    (order) => order.payment
      && order.payment.txid
      && String(order.payment.txid).toLowerCase() === txid
      && order.status === 'PAID_NO_KEY',
  );
  if (alreadyNoKey) {
    await sendOrEditMessage(chatId, userId, t(lang, 'no_keys_after_payment'));
    return;
  }

  const candidates = orders.filter(
    (order) => order.status === 'AWAITING_PAYMENT' || order.status === 'EXPIRED',
  );
  let hasSupportedNetwork = false;

  for (const order of candidates) {
    const payment = order.payment || {};
    if (!payment.amount_atomic || !payment.address) {
      continue;
    }
    const asset = getWalletAsset(config, payment.asset);
    const network = asset ? getWalletNetwork(asset, payment.network) : null;
    if (!asset || !network || network.type !== 'evm') {
      continue;
    }
    const hasRpc = Boolean(
      network.rpc_url || (Array.isArray(network.rpc_urls) && network.rpc_urls.length),
    );
    if (!hasRpc) {
      continue;
    }
    hasSupportedNetwork = true;

    let paymentInfo;
    try {
      paymentInfo = await findEvmPaymentByTxid({
        network,
        address: payment.address,
        amountAtomic: payment.amount_atomic,
        minConfirmations: network.confirmations || 1,
        txid,
      });
    } catch (err) {
      continue;
    }

    if (!paymentInfo || !paymentInfo.found) {
      if (paymentInfo && (paymentInfo.last_checked_block !== undefined || paymentInfo.pending_tx)) {
        const updatedPayment = { ...payment };
        if (paymentInfo.last_checked_block !== undefined && paymentInfo.last_checked_block !== null) {
          updatedPayment.last_checked_block = paymentInfo.last_checked_block;
        }
        if (paymentInfo.pending_tx) {
          updatedPayment.pending_tx = paymentInfo.pending_tx;
        }
        await updateOrder(order.id, { payment: updatedPayment });
      }
      continue;
    }

    const result = await fulfillWalletOrder(order.id, paymentInfo);
    if (result.status === 'missing') {
      await notifyAdmins(`Wallet payment for unknown order: ${order.id}`);
      await sendOrEditMessage(chatId, userId, t(lang, 'wallet_check_error'));
      return;
    }
    if (result.status === 'no_key') {
      await sendOrEditMessage(chatId, userId, t(lang, 'no_keys_after_payment'));
      await notifyAdmins(`Keys out of stock for ${order.product_code} ${order.days} days. Order ${order.id}.`);
      return;
    }
    if (result.status === 'fulfilled' || result.status === 'already_fulfilled') {
      await sendWalletSuccessMessage(result.order);
      return;
    }
  }

  if (!hasSupportedNetwork) {
    await sendOrEditMessage(chatId, userId, t(lang, 'wallet_check_not_supported'));
    return;
  }

  await sendOrEditMessage(chatId, userId, t(lang, 'wallet_check_not_found'));
}

async function handleCardlinkPayment(chatId, userId, lang, product, duration) {
  const amount = duration.prices[config.payment_currency];
  const backKeyboard = {
    reply_markup: {
      inline_keyboard: [[{ text: t(lang, 'back_button'), callback_data: `product:${product.code}` }]],
    },
  };
  if (typeof amount === 'undefined') {
    await sendOrEditMessage(chatId, userId, t(lang, 'payment_error'), backKeyboard);
    return;
  }

  const hasKey = await hasAvailableKey(product.code, duration.days);
  if (!hasKey) {
    await sendOrEditMessage(chatId, userId, t(lang, 'out_of_stock'));
    return;
  }

  await sendOrEditMessage(chatId, userId, t(lang, 'creating_payment'));

  const order = await createOrder(userId, product, duration, amount);
  const successUrl = config.server.base_url
    ? `${config.server.base_url}/cardlink/success`
    : '';
  const failUrl = config.server.base_url
    ? `${config.server.base_url}/cardlink/fail`
    : '';

  try {
    const bill = await createBill({
      apiToken: config.cardlink.api_token,
      amount,
      orderId: order.id,
      description: `${getDisplayProductTitle(product)} ${duration.days} days`,
      custom: String(userId),
      shopId: config.cardlink.shop_id,
      currencyIn: config.cardlink.currency_in,
      payerPaysCommission: config.cardlink.payer_pays_commission,
      successUrl,
      failUrl,
      name: getDisplayProductTitle(product),
    });

    await updateOrder(order.id, {
      status: 'AWAITING_PAYMENT',
      bill_id: bill.bill_id,
      link_url: bill.link_url,
      link_page_url: bill.link_page_url,
    });

    const keyboard = {
      inline_keyboard: [
        [{ text: t(lang, 'pay_button'), url: bill.link_page_url }],
        [{ text: t(lang, 'back_button'), callback_data: 'menu_main' }],
      ],
    };

    await sendOrEditMessage(
      chatId,
      userId,
      `${t(lang, 'payment_link')}\n${bill.link_page_url}\n\n${t(lang, 'payment_note')}`,
      {
        reply_markup: keyboard,
        disable_web_page_preview: true,
      },
    );
  } catch (err) {
    await updateOrder(order.id, { status: 'ERROR', error: err.message });
    await sendOrEditMessage(chatId, userId, t(lang, 'payment_error'), backKeyboard);
  }
}

async function handleCryptocloudPayment(chatId, userId, lang, product, duration) {
  const currency = (config.cryptocloud.currency || config.payment_currency || '').toUpperCase();
  const amount = duration.prices[currency];
  const backKeyboard = {
    reply_markup: {
      inline_keyboard: [[{ text: t(lang, 'back_button'), callback_data: `product:${product.code}` }]],
    },
  };
  if (typeof amount === 'undefined') {
    await sendOrEditMessage(chatId, userId, t(lang, 'payment_error'), backKeyboard);
    return;
  }

  const hasKey = await hasAvailableKey(product.code, duration.days);
  if (!hasKey) {
    await sendOrEditMessage(chatId, userId, t(lang, 'out_of_stock'), backKeyboard);
    return;
  }

  await sendOrEditMessage(chatId, userId, t(lang, 'creating_payment'));

  const order = await createOrder(userId, product, duration, amount);
  await updateOrder(order.id, { currency });

  try {
    const invoice = await createCryptocloudInvoice({
      apiKey: config.cryptocloud.api_key,
      shopId: config.cryptocloud.shop_id,
      amount,
      currency,
      orderId: order.id,
      email: config.cryptocloud.email,
      addFields: config.cryptocloud.add_fields,
      locale: config.cryptocloud.locale,
    });

    const linkUrl = invoice.link || invoice.pay_url || invoice.url;
    if (!linkUrl) {
      throw new Error('CryptoCloud did not return a payment link.');
    }
    const invoiceId = invoice.uuid || invoice.invoice_id || invoice.id;

    await updateOrder(order.id, {
      status: 'AWAITING_PAYMENT',
      bill_id: invoiceId,
      link_url: linkUrl,
      link_page_url: linkUrl,
      payment_provider: 'cryptocloud',
    });

    const keyboard = {
      inline_keyboard: [
        [{ text: t(lang, 'pay_button'), url: linkUrl }],
        [{ text: t(lang, 'back_button'), callback_data: 'menu_main' }],
      ],
    };

    await sendOrEditMessage(
      chatId,
      userId,
      `${t(lang, 'payment_link')}\n${linkUrl}\n\n${t(lang, 'payment_note')}`,
      {
        reply_markup: keyboard,
        disable_web_page_preview: true,
      },
    );
  } catch (err) {
    await updateOrder(order.id, { status: 'ERROR', error: err.message });
    await sendOrEditMessage(chatId, userId, t(lang, 'payment_error'), backKeyboard);
  }
}

let walletPollInProgress = false;

async function sendWalletSuccessMessage(order) {
  if (!order || !order.key) {
    return;
  }
  const user = await getUser(order.user_id);
  const lang = (user && user.language) || config.language_default;
  const lines = [
    t(lang, 'payment_received'),
    order.key,
    '',
    t(lang, 'instruction_title'),
  ];
  if (config.support_links.support) {
    lines.push(`${t(lang, 'support_label')}: ${config.support_links.support}`);
  }
  if (config.support_links.chat) {
    lines.push(`${t(lang, 'chat_label')}: ${config.support_links.chat}`);
  }
  await sendOrEditMessage(order.user_id, order.user_id, lines.join('\n'), {
    disable_web_page_preview: true,
  });
}

async function sendOrderKeyMessage(order, lang, preferredMessageId = null) {
  if (!order || !order.key) {
    return;
  }
  const lines = [
    t(lang, 'order_key_title'),
    order.key,
    '',
    t(lang, 'instruction_title'),
  ];
  if (config.support_links.support) {
    lines.push(`${t(lang, 'support_label')}: ${config.support_links.support}`);
  }
  if (config.support_links.chat) {
    lines.push(`${t(lang, 'chat_label')}: ${config.support_links.chat}`);
  }
  await sendOrEditMessage(order.user_id, order.user_id, lines.join('\n'), {
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: t(lang, 'back_button'), callback_data: 'menu_keys' }]],
    },
  }, preferredMessageId);
}

async function fulfillWalletOrder(orderId, paymentInfo) {
  return withData((store, keys) => {
    const order = store.orders[orderId];
    if (!order) {
      return { status: 'missing' };
    }

    order.payment = {
      ...(order.payment || {}),
      status: 'success',
      txid: paymentInfo.txid,
      confirmations: paymentInfo.confirmations,
      pending_tx: null,
      received_at: nowIso(),
    };
    order.updated_at = nowIso();

    if (order.key) {
      return { status: 'already_fulfilled', order };
    }

    const keyIndex = keys.available.findIndex(
      (item) => item.product_code === order.product_code && Number(item.days) === Number(order.days),
    );

    if (keyIndex === -1) {
      order.status = 'PAID_NO_KEY';
      return { status: 'no_key', order };
    }

    const keyItem = keys.available.splice(keyIndex, 1)[0];
    keys.used.push({
      ...keyItem,
      order_id: order.id,
      used_at: nowIso(),
    });
    keys.updated_at = nowIso();

    order.key = keyItem.key;
    order.fulfilled_at = nowIso();
    order.status = 'FULFILLED';

    const user = store.users[order.user_id];
    if (user) {
      user.purchase_count = (user.purchase_count || 0) + 1;
      user.updated_at = nowIso();
    }

    return { status: 'fulfilled', order };
  });
}

async function pollWalletPayments() {
  if (!hasWallet || walletPollInProgress) {
    return;
  }
  walletPollInProgress = true;

  try {
    const store = await readStore();
    const now = Date.now();
    const pendingOrders = Object.values(store.orders || {}).filter(
      (order) => order.payment_provider === 'wallet' && order.status === 'AWAITING_PAYMENT',
    );

    for (const order of pendingOrders) {
      const payment = order.payment || {};
        if (payment.expires_at && Date.parse(payment.expires_at) < now) {
          await updateOrder(order.id, { status: 'EXPIRED' });
          const user = await getUser(order.user_id);
          const lang = (user && user.language) || config.language_default;
          if (payment.message_id) {
            await sendOrEditMessage(
              order.user_id,
              order.user_id,
              t(lang, 'wallet_invoice_expired'),
              {},
              payment.message_id,
            );
          } else {
            await sendMessageOnly(order.user_id, order.user_id, t(lang, 'wallet_invoice_expired'));
          }
          continue;
        }

      const asset = getWalletAsset(config, payment.asset);
      const network = asset ? getWalletNetwork(asset, payment.network) : null;
      if (!asset || !network) {
        continue;
      }

      if (payment.message_id) {
        const messageInfo = buildWalletInvoiceMessage(lang, asset, network, payment);
        if (messageInfo.expiresInMinutes !== null
          && messageInfo.expiresInMinutes !== payment.last_expires_min) {
          await sendOrEditMessage(
            order.user_id,
            order.user_id,
            messageInfo.text,
            { parse_mode: 'Markdown' },
            payment.message_id,
          );
          await updateOrder(order.id, {
            payment: { ...payment, last_expires_min: messageInfo.expiresInMinutes },
          });
        }
      }

      let paymentInfo;
      try {
        paymentInfo = await findWalletPayment({
          asset,
          network,
          address: payment.address,
          amountAtomic: payment.amount_atomic,
          minConfirmations: network.confirmations || 1,
          startBlock: payment.evm_start_block,
          lastCheckedBlock: payment.last_checked_block,
          pendingTx: payment.pending_tx,
        });
      } catch (err) {
        console.warn(`Wallet poll error for order ${order.id}: ${err.message}`);
        continue;
      }

      if (!paymentInfo || !paymentInfo.found) {
        if (paymentInfo && (paymentInfo.last_checked_block !== undefined || paymentInfo.pending_tx)) {
          const updatedPayment = { ...payment };
          if (paymentInfo.last_checked_block !== undefined && paymentInfo.last_checked_block !== null) {
            updatedPayment.last_checked_block = paymentInfo.last_checked_block;
          }
          if (paymentInfo.pending_tx) {
            updatedPayment.pending_tx = paymentInfo.pending_tx;
          }
          await updateOrder(order.id, { payment: updatedPayment });
        }
        continue;
      }

      const result = await fulfillWalletOrder(order.id, paymentInfo);
      if (result.status === 'missing') {
        await notifyAdmins(`Wallet payment for unknown order: ${order.id}`);
        continue;
      }

      if (result.status === 'no_key') {
        const user = await getUser(order.user_id);
        const lang = (user && user.language) || config.language_default;
        await sendOrEditMessage(order.user_id, order.user_id, t(lang, 'no_keys_after_payment'));
        await notifyAdmins(`Keys out of stock for ${order.product_code} ${order.days} days. Order ${order.id}.`);
        continue;
      }

        if (result.status === 'fulfilled') {
          await sendWalletSuccessMessage(result.order);
        }
    }
  } finally {
    walletPollInProgress = false;
  }
}

function startWalletWatcher() {
  if (!hasWallet) {
    return;
  }
  const intervalSec = Math.max(10, Number(config.crypto_wallet.poll_interval_sec || 20));
  setInterval(() => {
    pollWalletPayments().catch(() => null);
  }, intervalSec * 1000);
  pollWalletPayments().catch(() => null);
}

bot.on('message', async (msg) => {
  if (!msg.chat || msg.chat.type !== 'private') {
    return;
  }
  const user = await ensureUser(msg.from);
  const lang = user.language || config.language_default;

  if (!user.accepted) {
    await sendTerms(msg.chat.id, user.id, lang);
    return;
  }

  const parsed = parseCommand(msg.text);
  if (parsed) {
    if (parsed.command === 'start') {
      await sendMainMenu(msg.chat.id, user.id, lang);
      return;
    }
    if (parsed.command === 'check') {
      await handleWalletCheckCommand(msg.chat.id, user.id, lang, parsed.args);
      return;
    }
  }

  await sendMainMenu(msg.chat.id, user.id, lang);
});

bot.on('callback_query', async (query) => {
  const data = query.data || '';
  const chatId = query.message && query.message.chat && query.message.chat.id;
  if (!chatId) {
    return;
  }

  await bot.answerCallbackQuery(query.id).catch(() => null);

  const user = await ensureUser(query.from);
  const lang = user.language || config.language_default;
  if (query.message && query.message.message_id) {
    await updateUser(user.id, { last_message_id: query.message.message_id });
  }

  if (data === 'agree_terms') {
    const updated = await updateUser(user.id, { accepted: true });
    await sendOrEditMessage(chatId, user.id, t(updated.language, 'terms_accepted'));
    await sendMainMenu(chatId, user.id, updated.language);
    return;
  }

  if (data === 'menu_main') {
    await sendMainMenu(chatId, user.id, lang);
    return;
  }

  if (data === 'menu_profile') {
    const freshUser = await getUser(user.id);
    await sendProfile(chatId, freshUser || user);
    return;
  }


  if (data === 'menu_keys') {
    await sendKeysList(chatId, user.id, lang);
    return;
  }

    if (data.startsWith('order_key:')) {
      const orderId = data.split(':')[1];
      const store = await readStore();
      const order = store.orders && store.orders[orderId];
      if (!order || String(order.user_id) !== String(user.id)) {
        await sendOrEditMessage(chatId, user.id, t(lang, 'order_key_missing'));
        return;
      }
      if (!order.key) {
        await sendOrEditMessage(chatId, user.id, t(lang, 'order_key_missing'));
        return;
      }
      const messageId = query.message && query.message.message_id
        ? query.message.message_id
        : null;
      await sendOrderKeyMessage(order, lang, messageId);
      return;
    }

  if (data === 'menu_products') {
    await sendProducts(chatId, user.id, lang);
    return;
  }

  if (data.startsWith('lang:')) {
    const selected = data.split(':')[1] || config.language_default;
    const updated = await updateUser(user.id, { language: selected });
    await sendProfile(chatId, updated);
    return;
  }

  if (data.startsWith('product:')) {
    const code = data.split(':')[1];
    const product = findProduct(code);
    if (!product) {
      await sendOrEditMessage(chatId, user.id, t(lang, 'products_empty'));
      return;
    }
    await sendProductDetails(chatId, user.id, lang, product);
    return;
  }

  if (data.startsWith('duration:')) {
    const parts = data.split(':');
    const code = parts[1];
    const days = Number(parts[2]);
    const product = findProduct(code);
    if (!product) {
      await sendOrEditMessage(chatId, user.id, t(lang, 'products_empty'));
      return;
    }
    const duration = findDuration(product, days);
    if (!duration) {
      await sendOrEditMessage(chatId, user.id, t(lang, 'products_empty'));
      return;
    }
    await sendPaymentMethods(chatId, user.id, lang, product, duration);
    return;
  }

  if (data.startsWith('pay:cardlink:')) {
    const parts = data.split(':');
    const code = parts[2];
    const days = Number(parts[3]);
    const product = findProduct(code);
    if (!product) {
      await sendOrEditMessage(chatId, user.id, t(lang, 'products_empty'));
      return;
    }
    const duration = findDuration(product, days);
    if (!duration) {
      await sendOrEditMessage(chatId, user.id, t(lang, 'products_empty'));
      return;
    }
    await handleCardlinkPayment(chatId, user.id, lang, product, duration);
    return;
  }

  if (data.startsWith('pay:cryptocloud:')) {
    const parts = data.split(':');
    const code = parts[2];
    const days = Number(parts[3]);
    const product = findProduct(code);
    if (!product) {
      await sendOrEditMessage(chatId, user.id, t(lang, 'products_empty'));
      return;
    }
    const duration = findDuration(product, days);
    if (!duration) {
      await sendOrEditMessage(chatId, user.id, t(lang, 'products_empty'));
      return;
    }
    await handleCryptocloudPayment(chatId, user.id, lang, product, duration);
  }

  if (data.startsWith('pay:wallet:')) {
    const parts = data.split(':');
    const code = parts[2];
    const days = Number(parts[3]);
    const product = findProduct(code);
    if (!product) {
      await sendOrEditMessage(chatId, user.id, t(lang, 'products_empty'));
      return;
    }
    const duration = findDuration(product, days);
    if (!duration) {
      await sendOrEditMessage(chatId, user.id, t(lang, 'products_empty'));
      return;
    }
    await sendWalletCoins(chatId, user.id, lang, product, duration);
    return;
  }

  if (data.startsWith('wallet:coin:')) {
    const parts = data.split(':');
    const assetCode = parts[2];
    const productCode = parts[3];
    const days = Number(parts[4]);
    const product = findProduct(productCode);
    if (!product) {
      await sendOrEditMessage(chatId, user.id, t(lang, 'products_empty'));
      return;
    }
    const duration = findDuration(product, days);
    if (!duration) {
      await sendOrEditMessage(chatId, user.id, t(lang, 'products_empty'));
      return;
    }
    const asset = getWalletAsset(config, assetCode);
    await sendWalletNetworks(chatId, user.id, lang, product, duration, asset);
    return;
  }

  if (data.startsWith('wallet:net:')) {
    const parts = data.split(':');
    const assetCode = parts[2];
    const networkCode = parts[3];
    const productCode = parts[4];
    const days = Number(parts[5]);
    const product = findProduct(productCode);
    if (!product) {
      await sendOrEditMessage(chatId, user.id, t(lang, 'products_empty'));
      return;
    }
    const duration = findDuration(product, days);
    if (!duration) {
      await sendOrEditMessage(chatId, user.id, t(lang, 'products_empty'));
      return;
    }
    await handleWalletPayment(chatId, user.id, lang, product, duration, assetCode, networkCode);
  }
});

app.post('/cardlink/postback', async (req, res) => {
  const payload = req.body || {};
  if (!verifyPostbackSignature(payload, config.cardlink.api_token)) {
    res.status(400).send('Invalid signature');
    return;
  }

  const status = String(payload.Status || '').toUpperCase();
  const orderId = String(payload.InvId || '');
  const isSuccess = status === 'SUCCESS' || status === 'OVERPAID';

  const result = await withData((store, keys) => {
    const order = store.orders[orderId];
    if (!order) {
      return { status: 'missing' };
    }

    order.payment = {
      status,
      out_sum: payload.OutSum,
      commission: payload.Commission,
      currency: payload.CurrencyIn,
      trs_id: payload.TrsId,
      received_at: nowIso(),
    };
    order.updated_at = nowIso();

    if (!isSuccess) {
      if (order.status !== 'FAILED') {
        order.status = 'FAILED';
      }
      return { status: 'failed', order };
    }

    if (order.key) {
      return { status: 'already_fulfilled', order };
    }

    const keyIndex = keys.available.findIndex(
      (item) => item.product_code === order.product_code && Number(item.days) === Number(order.days),
    );

    if (keyIndex === -1) {
      order.status = 'PAID_NO_KEY';
      return { status: 'no_key', order };
    }

    const keyItem = keys.available.splice(keyIndex, 1)[0];
    keys.used.push({
      ...keyItem,
      order_id: order.id,
      used_at: nowIso(),
    });
    keys.updated_at = nowIso();

    order.key = keyItem.key;
    order.fulfilled_at = nowIso();
    order.status = 'FULFILLED';

    const user = store.users[order.user_id];
    if (user) {
      user.purchase_count = (user.purchase_count || 0) + 1;
      user.updated_at = nowIso();
    }

    return { status: 'fulfilled', order };
  });

  res.status(200).send('OK');

  if (result.status === 'missing') {
    await notifyAdmins(`Cardlink postback for unknown order: ${orderId}`);
    return;
  }

  const order = result.order;
  const user = order ? await getUser(order.user_id) : null;
  const lang = (user && user.language) || config.language_default;

  if (result.status === 'failed') {
    await sendOrEditMessage(order.user_id, order.user_id, t(lang, 'payment_failed'));
    return;
  }

  if (result.status === 'no_key') {
    await sendOrEditMessage(order.user_id, order.user_id, t(lang, 'no_keys_after_payment'));
    await notifyAdmins(`Keys out of stock for ${order.product_code} ${order.days} days. Order ${order.id}.`);
    return;
  }

  if (result.status === 'fulfilled') {
    const lines = [
      t(lang, 'payment_received'),
      order.key,
      '',
      t(lang, 'instruction_title'),
    ];
    if (config.support_links.support) {
      lines.push(`${t(lang, 'support_label')}: ${config.support_links.support}`);
    }
    if (config.support_links.chat) {
      lines.push(`${t(lang, 'chat_label')}: ${config.support_links.chat}`);
    }
    await sendOrEditMessage(order.user_id, order.user_id, lines.join('\n'), {
      disable_web_page_preview: true,
    });
  }
});

app.post('/cryptocloud/postback', async (req, res) => {
  if (!hasCryptocloud) {
    res.status(400).send('CryptoCloud not configured');
    return;
  }

  const payload = req.body || {};
  const tokenCheck = verifyCryptocloudPostbackToken(payload.token, config.cryptocloud.secret_key);
  if (!tokenCheck.valid) {
    res.status(400).send('Invalid token');
    return;
  }

  const status = String(payload.status || '').toLowerCase();
  const orderId = String(payload.order_id || '');
  const isSuccess = status === 'success';

  const result = await withData((store, keys) => {
    const order = store.orders[orderId];
    if (!order) {
      return { status: 'missing' };
    }

    order.payment = {
      status,
      invoice_id: payload.invoice_id,
      amount_crypto: payload.amount_crypto,
      currency: payload.currency,
      received_at: nowIso(),
    };
    if (payload.invoice_info) {
      order.payment.invoice_info = payload.invoice_info;
    }
    order.updated_at = nowIso();

    if (!isSuccess) {
      if (order.status !== 'FAILED') {
        order.status = 'FAILED';
      }
      return { status: 'failed', order };
    }

    if (order.key) {
      return { status: 'already_fulfilled', order };
    }

    const keyIndex = keys.available.findIndex(
      (item) => item.product_code === order.product_code && Number(item.days) === Number(order.days),
    );

    if (keyIndex === -1) {
      order.status = 'PAID_NO_KEY';
      return { status: 'no_key', order };
    }

    const keyItem = keys.available.splice(keyIndex, 1)[0];
    keys.used.push({
      ...keyItem,
      order_id: order.id,
      used_at: nowIso(),
    });
    keys.updated_at = nowIso();

    order.key = keyItem.key;
    order.fulfilled_at = nowIso();
    order.status = 'FULFILLED';

    const user = store.users[order.user_id];
    if (user) {
      user.purchase_count = (user.purchase_count || 0) + 1;
      user.updated_at = nowIso();
    }

    return { status: 'fulfilled', order };
  });

  res.status(200).send('OK');

  if (result.status === 'missing') {
    await notifyAdmins(`CryptoCloud postback for unknown order: ${orderId}`);
    return;
  }

  const order = result.order;
  const user = order ? await getUser(order.user_id) : null;
  const lang = (user && user.language) || config.language_default;

  if (result.status === 'failed') {
    await sendOrEditMessage(order.user_id, order.user_id, t(lang, 'payment_failed'));
    return;
  }

  if (result.status === 'no_key') {
    await sendOrEditMessage(order.user_id, order.user_id, t(lang, 'no_keys_after_payment'));
    await notifyAdmins(`Keys out of stock for ${order.product_code} ${order.days} days. Order ${order.id}.`);
    return;
  }

  if (result.status === 'fulfilled') {
    const lines = [
      t(lang, 'payment_received'),
      order.key,
      '',
      t(lang, 'instruction_title'),
    ];
    if (config.support_links.support) {
      lines.push(`${t(lang, 'support_label')}: ${config.support_links.support}`);
    }
    if (config.support_links.chat) {
      lines.push(`${t(lang, 'chat_label')}: ${config.support_links.chat}`);
    }
    await sendOrEditMessage(order.user_id, order.user_id, lines.join('\n'), {
      disable_web_page_preview: true,
    });
  }
});

function renderResultPage(message) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Payment status</title>
  </head>
  <body>
    <h2>${message}</h2>
    <p>You can return to the Telegram bot.</p>
  </body>
</html>`;
}

app.post('/cardlink/success', (req, res) => {
  res.send(renderResultPage('Payment successful.'));
});

app.post('/cardlink/fail', (req, res) => {
  res.send(renderResultPage('Payment failed.'));
});

app.get('/cardlink/success', (req, res) => {
  res.send(renderResultPage('Payment successful.'));
});

app.get('/cardlink/fail', (req, res) => {
  res.send(renderResultPage('Payment failed.'));
});

app.post('/cryptocloud/success', (req, res) => {
  res.send(renderResultPage('Payment successful.'));
});

app.post('/cryptocloud/fail', (req, res) => {
  res.send(renderResultPage('Payment failed.'));
});

app.get('/cryptocloud/success', (req, res) => {
  res.send(renderResultPage('Payment successful.'));
});

app.get('/cryptocloud/fail', (req, res) => {
  res.send(renderResultPage('Payment failed.'));
});

app.listen(config.server.port, () => {
  console.log(`Server listening on port ${config.server.port}`);
});

startWalletWatcher();
