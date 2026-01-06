function createViews({
  config,
  products,
  t,
  formatPriceList,
  formatPriceLine,
  formatDaysLabel,
  formatOrderStatus,
  getDisplayProductTitle,
  readStore,
  sendOrEditMessage,
  hasCardlink,
  hasWallet,
}) {
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
    const buttons = products.map((product) => [
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

  async function sendKeysList(chatId, userId, lang, page = 1) {
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

    const invoices = orders.slice(0, 5);
    const paidOrders = orders.filter((order) => order.key);
    const pageSize = 5;
    const totalPages = Math.max(1, Math.ceil(paidOrders.length / pageSize));
    const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
    const startIndex = (currentPage - 1) * pageSize;
    const shownKeys = paidOrders.slice(startIndex, startIndex + pageSize);

    const lines = [t(lang, 'keys_title'), '', t(lang, 'keys_invoices_title')];
    for (const order of invoices) {
      lines.push(
        `${t(lang, 'order_id_label')}: ${order.id} | ${t(lang, 'order_status_label')}: ${formatOrderStatus(lang, order.status)}`,
      );
    }
    lines.push('', t(lang, 'keys_keys_title'));
    if (!paidOrders.length) {
      lines.push(t(lang, 'keys_keys_empty'));
    } else {
      lines.push(`${t(lang, 'keys_page_label')}: ${currentPage}/${totalPages}`);
    }

    const rows = [];
    for (const order of shownKeys) {
      rows.push([{
        text: `${t(lang, 'order_key_button')} #${order.id}`,
        callback_data: `order_key:${order.id}`,
      }]);
    }

    if (totalPages > 1) {
      const navRow = [];
      if (currentPage > 1) {
        navRow.push({ text: t(lang, 'keys_prev_button'), callback_data: `keys_page:${currentPage - 1}` });
      }
      if (currentPage < totalPages) {
        navRow.push({ text: t(lang, 'keys_next_button'), callback_data: `keys_page:${currentPage + 1}` });
      }
      if (navRow.length) {
        rows.push(navRow);
      }
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
        text: '🇷🇺 (cc + сбп))',
        callback_data: `pay:cardlink:${product.code}:${duration.days}`,
      });
    }
    // CryptoCloud disabled for now.
    if (hasWallet) {
      methodRow.push({
        text: '₿ Crypto',
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

  return {
    sendTerms,
    sendMainMenu,
    sendProfile,
    sendKeysList,
    sendProducts,
    sendProductDetails,
    sendPaymentMethods,
  };
}

module.exports = {
  createViews,
};
