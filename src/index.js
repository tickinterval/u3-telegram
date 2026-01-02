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

const config = loadConfig();
const hasCardlink = Boolean(config.cardlink && config.cardlink.api_token && config.cardlink.shop_id);
const hasCryptocloud = Boolean(config.cryptocloud && config.cryptocloud.api_key && config.cryptocloud.shop_id);
const bot = new TelegramBot(config.telegram_bot_token, { polling: true });

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const MAIN_MENU_TEXTS = {
  ru: [
    'u3ware - все дороги ведут к нам',
    '',
    '├ мгновенная выдача',
    '├ поддержка которая во всём поможет',
    '├ работаем больше двух лет (тык) (https://t.me/u3ware)',
    '├ больше тысячи отзывов (тык) (http://t.me/u3ware)',
    '',
    'правила: @u3ware',
    'поддержка: @u3ware',
    '',
    '® @u3ware',
  ].join('\n'),
  en: [
    'u3ware - all roads lead to us',
    '',
    '├ instant delivery',
    '├ support that will help with anything',
    '├ working for over two years (tap) (https://t.me/u3ware)',
    '├ over a thousand reviews (tap) (http://t.me/u3ware)',
    '',
    'rules: @u3ware',
    'support: @u3ware',
    '',
    '® @u3ware',
  ].join('\n'),
  uk: [
    'u3ware - всі дороги ведуть до нас',
    '',
    '├ миттєва видача',
    '├ підтримка, яка допоможе з будь-чим',
    '├ працюємо понад два роки (тик) (https://t.me/u3ware)',
    '├ понад тисячу відгуків (тик) (http://t.me/u3ware)',
    '',
    'правила: @u3ware',
    'підтримка: @u3ware',
    '',
    '® @u3ware',
  ].join('\n'),
  zh: [
    'u3ware - 所有道路都通向我们',
    '',
    '├ 即时发放',
    '├ 支持团队随时帮助',
    '├ 工作超过两年（点击）(https://t.me/u3ware)',
    '├ 超过一千条评价（点击）(http://t.me/u3ware)',
    '',
    '规则: @u3ware',
    '支持: @u3ware',
    '',
    '® @u3ware',
  ].join('\n'),
};
const TEXT = {
  ru: {
    agree_button: 'Я согласен',
    back_button: '← назад',
    chat_label: 'Общий чат',
    choose_duration: 'Выберите длительность:',
    choose_language: 'Выберите язык:',
    creating_payment: 'Создаю ссылку на оплату...',
    instruction_title: 'Инструкция',
    main_menu: MAIN_MENU_TEXTS.ru,
    no_keys_after_payment: 'Оплата получена, но ключи закончились. Поддержка уже уведомлена.',
    out_of_stock: 'Ключи для этого тарифа закончились. Попробуйте позже или напишите в поддержку.',
    pay_button: 'Оплатить',
    payment_error: 'Не удалось создать ссылку на оплату. Попробуйте позже.',
    payment_failed: 'Оплата не прошла. Если средства списались, напишите в поддержку.',
    payment_link: 'Ссылка на оплату:',
    payment_note: 'После оплаты ключ будет выдан автоматически.',
    payment_method: 'Выберите платежную систему:',
    payment_received: 'Оплата получена. Ваш ключ доступа:',
    price_label: 'цена',
    product_blitz_subtitle: 'DLC для пк.',
    prices_title: 'цены:',
    profile_title: 'Профиль',
    products_empty: 'Товары пока недоступны.',
    products_title: 'Товары',
    purchases: 'Куплено ключей: {count}',
    support_label: 'Поддержка',
    terms_accepted: 'Спасибо! Теперь можно выбрать раздел.',
    terms_intro: 'Чтобы продолжить, примите условия использования и политику конфиденциальности.',
  },
  en: {
    agree_button: 'I agree',
    back_button: '← назад',
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
    payment_received: 'Payment received. Your access key:',
    price_label: 'price',
    product_blitz_subtitle: 'DLC for PC.',
    prices_title: 'prices:',
    profile_title: 'Profile',
    products_empty: 'No products available yet.',
    products_title: 'Products',
    purchases: 'Purchased keys: {count}',
    support_label: 'Support',
    terms_accepted: 'Thanks! You can now choose a section.',
    terms_intro: 'To continue, accept the terms of use and privacy policy.',
  },
  uk: {
    agree_button: 'Погоджуюсь',
    back_button: '← назад',
    chat_label: 'Загальний чат',
    choose_duration: 'Оберіть тривалість:',
    choose_language: 'Оберіть мову:',
    creating_payment: 'Створюю посилання для оплати...',
    instruction_title: 'Інструкція',
    main_menu: MAIN_MENU_TEXTS.uk,
    no_keys_after_payment: 'Оплату отримано, але ключі закінчились. Підтримку вже повідомлено.',
    out_of_stock: 'Ключі для цього тарифу закінчились. Спробуйте пізніше або напишіть у підтримку.',
    pay_button: 'Оплатити',
    payment_error: 'Не вдалося створити посилання для оплати. Спробуйте пізніше.',
    payment_failed: 'Оплата не пройшла. Якщо кошти списалися, напишіть у підтримку.',
    payment_link: 'Посилання на оплату:',
    payment_note: 'Після оплати ключ буде видано автоматично.',
    payment_method: 'Оберіть платіжну систему:',
    payment_received: 'Оплату отримано. Ваш ключ доступу:',
    price_label: 'ціна',
    product_blitz_subtitle: 'DLC для ПК.',
    prices_title: 'ціни:',
    profile_title: 'Профіль',
    products_empty: 'Товарів поки немає.',
    products_title: 'Товари',
    purchases: 'Куплено ключів: {count}',
    support_label: 'Підтримка',
    terms_accepted: 'Дякуємо! Тепер можна вибрати розділ.',
    terms_intro: 'Щоб продовжити, прийміть умови користування та політику конфіденційності.',
  },
  zh: {
    agree_button: '同意',
    back_button: '← назад',
    chat_label: '交流群',
    choose_duration: '选择时长：',
    choose_language: '选择语言：',
    creating_payment: '正在生成支付链接...',
    instruction_title: '使用说明',
    main_menu: MAIN_MENU_TEXTS.zh,
    no_keys_after_payment: '已收到付款，但密钥已用完。已通知客服。',
    out_of_stock: '该套餐密钥已用完。请稍后再试或联系支持。',
    pay_button: '支付',
    payment_error: '创建支付链接失败，请稍后再试。',
    payment_failed: '支付失败。如已扣款，请联系支持。',
    payment_link: '支付链接：',
    payment_note: '付款后将自动发放密钥。',
    payment_method: '选择支付方式：',
    payment_received: '已收到付款。你的密钥：',
    price_label: '价格',
    product_blitz_subtitle: 'PC 版 DLC.',
    prices_title: '价格:',
    profile_title: '个人资料',
    products_empty: '暂无可用商品。',
    products_title: '商品',
    purchases: '已购买密钥：{count}',
    support_label: '支持',
    terms_accepted: '感谢！现在可以选择菜单。',
    terms_intro: '继续前请同意使用条款和隐私政策。',
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

function generateOrderId(userId) {
  const random = crypto.randomBytes(3).toString('hex');
  return `tg-${userId}-${Date.now()}-${random}`;
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
  const keyboard = {
    inline_keyboard: [
      [{ text: t(lang, 'profile_title'), callback_data: 'menu_profile' }],
      [{ text: t(lang, 'products_title'), callback_data: 'menu_products' }],
    ],
  };
  return sendOrEditMessage(chatId, userId, t(lang, 'main_menu'), {
    reply_markup: keyboard,
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
      [{ text: t(lang, 'back_button'), callback_data: 'menu_main' }],
    ],
  };

  return sendOrEditMessage(chatId, user.id, text, { reply_markup: keyboard });
}

async function sendProducts(chatId, userId, lang) {
  if (!config.products.length) {
    return sendOrEditMessage(chatId, userId, t(lang, 'products_empty'), {
      reply_markup: {
        inline_keyboard: [[{ text: t(lang, 'back_button'), callback_data: 'menu_main' }]],
      },
    });
  }

  const buttons = config.products.map((product) => [
    { text: product.title, callback_data: `product:${product.code}` },
  ]);
  buttons.push([{ text: t(lang, 'back_button'), callback_data: 'menu_main' }]);

  return sendOrEditMessage(chatId, userId, t(lang, 'products_title'), {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

async function sendProductDetails(chatId, userId, lang, product) {
  const customDescription = getProductDescription(product, lang);
  const lines = [];

  if (customDescription) {
    lines.push(customDescription);
  } else {
    lines.push(product.title, '', t(lang, 'choose_duration'));
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
  rows.push([{ text: t(lang, 'back_button'), callback_data: 'menu_products' }]);

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
  const orderId = generateOrderId(userId);
  const order = {
    id: orderId,
    user_id: String(userId),
    product_code: product.code,
    product_title: product.title,
    days: duration.days,
    amount,
    currency: config.payment_currency,
    status: 'CREATED',
    created_at: nowIso(),
  };
  await withStore((store) => {
    store.orders[orderId] = order;
  });
  return order;
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
      description: `${product.title} ${duration.days} days`,
      custom: String(userId),
      shopId: config.cardlink.shop_id,
      currencyIn: config.cardlink.currency_in,
      payerPaysCommission: config.cardlink.payer_pays_commission,
      successUrl,
      failUrl,
      name: product.title,
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

  if (msg.text && msg.text.startsWith('/start')) {
    await sendMainMenu(msg.chat.id, user.id, lang);
    return;
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
