const QRCode = require('qrcode');

function createWalletFlow({
  config,
  t,
  formatAtomicAmount,
  quoteFiatToAsset,
  selectUniqueAmount,
  getWalletAssets,
  getWalletAsset,
  getWalletNetwork,
  findWalletPayment,
  findEvmPaymentByTxid,
  getEvmBlockNumber,
  sendOrEditMessage,
  sendMessageOnly,
  sendOrEditPhoto,
  deleteMessage,
  updateOrder,
  createOrder,
  hasAvailableKey,
  readStore,
  notifyAdmins,
  fulfillOrderWithKey,
  sendWalletSuccessMessage,
  normalizeTxid,
  getUser,
  withData,
  nowIso,
  hasWallet,
}) {
  let walletPollInProgress = false;
  const walletDebug = Boolean(config.crypto_wallet && config.crypto_wallet.debug);
  const logWallet = (...args) => {
    if (walletDebug) {
      console.log('[wallet]', ...args);
    }
  };

  async function clearWalletInvoiceMessages(chatId, userId) {
    if (!deleteMessage) {
      return;
    }
    const store = await readStore();
    const orders = Object.values(store.orders || {});
    for (const order of orders) {
      if (String(order.user_id) !== String(userId)) {
        continue;
      }
      if (order.payment_provider !== 'wallet' || !order.payment) {
        continue;
      }
      const messageId = order.payment.message_id;
      if (!messageId) {
        continue;
      }
      await deleteMessage(chatId, messageId);
      const updatedPayment = {
        ...order.payment,
        message_id: null,
        message_is_photo: false,
        last_expires_min: null,
      };
      await updateOrder(order.id, { payment: updatedPayment });
    }
  }

  async function sendWalletInvoiceMessage({
    chatId,
    userId,
    lang,
    asset,
    network,
    payment,
    keyboard,
    preferredMessageId,
  }) {
    const messageInfo = buildWalletInvoiceMessage(lang, asset, network, payment);
    const captionOptions = {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    };
    if (sendOrEditPhoto && network && network.address) {
      try {
        const buffer = await QRCode.toBuffer(String(network.address), {
          type: 'png',
          width: 320,
          margin: 1,
        });
        const sent = await sendOrEditPhoto(
          chatId,
          userId,
          buffer,
          messageInfo.text,
          captionOptions,
          preferredMessageId,
        );
        if (sent && sent.message_id) {
          return { messageInfo, sent, messageIsPhoto: true };
        }
      } catch (err) {
        logWallet('qr inline error', err && err.message ? err.message : err);
      }
    }
    const sent = await sendOrEditMessage(chatId, userId, messageInfo.text, {
      ...captionOptions,
      disable_web_page_preview: true,
    }, preferredMessageId);
    return { messageInfo, sent, messageIsPhoto: false };
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

    const note = t(lang, 'payment_note');
    const lines = [
      `${t(lang, 'wallet_coin_label')}: *${asset.code}*`,
      `${t(lang, 'wallet_network_label')}: *${network.code}*`,
      '',
      `${t(lang, 'wallet_address_label')}: \`${network.address}\``,
      `${t(lang, 'wallet_amount_label')}: \`${amountText}\``,
      `${t(lang, 'wallet_expires_label')}: ${expiresText}`,
      '',
      `_${t(lang, 'wallet_exact_amount')}_`,
    ];
    if (note) {
      lines.push(note);
    }

    return { text: lines.join('\n'), expiresInMinutes };
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
    await clearWalletInvoiceMessages(chatId, userId);

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
    await clearWalletInvoiceMessages(chatId, userId);
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
    await clearWalletInvoiceMessages(chatId, userId);
    const currentUser = await getUser(userId);
    const preferredMessageId = currentUser && currentUser.last_message_id
      ? currentUser.last_message_id
      : null;
    const networkDecimals = Number.isFinite(Number(network.decimals))
      ? Number(network.decimals)
      : asset.decimals;
    const invoiceDecimalsRaw = Number.isFinite(Number(network.invoice_decimals))
      ? Number(network.invoice_decimals)
      : networkDecimals;
    const invoiceDecimals = Math.min(invoiceDecimalsRaw, networkDecimals);
    const limitedInvoiceDecimals = asset.code === 'USDT' || asset.code === 'USDC' ? 4 : null;
    const keyboard = {
      inline_keyboard: [
        [{ text: t(lang, 'back_button'), callback_data: `wallet:coin:${asset.code}:${product.code}:${duration.days}` }],
      ],
    };
    const store = await readStore();
    const now = Date.now();
    let existing = Object.values(store.orders || {})
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

    if (existing && limitedInvoiceDecimals) {
      const existingDecimals = Number.isFinite(Number(existing.payment.invoice_decimals))
        ? Number(existing.payment.invoice_decimals)
        : invoiceDecimals;
      if (existingDecimals > limitedInvoiceDecimals) {
        await updateOrder(existing.id, { status: 'EXPIRED' });
        existing = null;
      }
    }

    if (existing && existing.payment && existing.payment.expires_at) {
      const expiresAt = Date.parse(existing.payment.expires_at);
      if (Number.isFinite(expiresAt) && expiresAt > now) {
        logWallet('reuse invoice', existing.id, asset.code, network.code, 'expires', existing.payment.expires_at);
        const previousMessageId = existing.payment.message_id;
        const invoice = await sendWalletInvoiceMessage({
          chatId,
          userId,
          lang,
          asset,
          network,
          payment: existing.payment,
          keyboard,
          preferredMessageId: preferredMessageId || existing.payment.message_id || null,
        });
        let payment = existing.payment;
        if (invoice.sent && invoice.sent.message_id) {
          payment = {
            ...existing.payment,
            message_id: invoice.sent.message_id,
            last_expires_min: invoice.messageInfo.expiresInMinutes,
            message_is_photo: invoice.messageIsPhoto,
          };
          await updateOrder(existing.id, {
            payment,
          });
          if (deleteMessage && previousMessageId && previousMessageId !== invoice.sent.message_id) {
            await deleteMessage(chatId, previousMessageId);
          }
        }
        return;
      }
      if (Number.isFinite(expiresAt) && expiresAt <= now) {
        await updateOrder(existing.id, { status: 'EXPIRED' });
      }
    }
    await sendOrEditMessage(chatId, userId, t(lang, 'creating_payment'));

    const order = await createOrder(userId, product, duration, amount);
    logWallet('create invoice', order.id, asset.code, network.code, 'amount', amount);

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
      logWallet(
        'invoice created',
        order.id,
        asset.code,
        network.code,
        'crypto',
        amountText,
        'atomic',
        amountAtomic.toString(),
      );

      const paymentBase = (updatedOrder && updatedOrder.payment) ? updatedOrder.payment : {};
      const invoice = await sendWalletInvoiceMessage({
        chatId,
        userId,
        lang,
        asset,
        network,
        payment: paymentBase,
        keyboard,
        preferredMessageId,
      });
      const payment = { ...paymentBase };
      if (invoice.sent && invoice.sent.message_id) {
        payment.message_id = invoice.sent.message_id;
        payment.last_expires_min = invoice.messageInfo.expiresInMinutes;
        payment.message_is_photo = invoice.messageIsPhoto;
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
    logWallet('manual check', userId, txid);

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
      logWallet('manual check matched fulfilled order', existing.id, txid);
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
      logWallet('manual check matched paid-no-key', alreadyNoKey.id, txid);
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
        logWallet('manual check not found', order.id, txid);
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
        logWallet('manual check missing order', order.id, txid);
        await notifyAdmins(`Wallet payment for unknown order: ${order.id}`);
        await sendOrEditMessage(chatId, userId, t(lang, 'wallet_check_error'));
        return;
      }
      if (result.status === 'no_key') {
        logWallet('manual check no key', order.id, txid);
        await sendOrEditMessage(chatId, userId, t(lang, 'no_keys_after_payment'));
        await notifyAdmins(`Keys out of stock for ${order.product_code} ${order.days} days. Order ${order.id}.`);
        return;
      }
      if (result.status === 'fulfilled' || result.status === 'already_fulfilled') {
        logWallet('manual check fulfilled', order.id, txid);
        await sendWalletSuccessMessage(result.order);
        return;
      }
    }

    if (!hasSupportedNetwork) {
      logWallet('manual check not supported', userId, txid);
      await sendOrEditMessage(chatId, userId, t(lang, 'wallet_check_not_supported'));
      return;
    }

    logWallet('manual check not found', userId, txid);
    await sendOrEditMessage(chatId, userId, t(lang, 'wallet_check_not_found'));
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

      const result = fulfillOrderWithKey({ store, keys, order, nowIso });
      if (result.status === 'already_fulfilled') {
        return { status: 'already_fulfilled', order };
      }
      if (result.status === 'no_key') {
        return { status: 'no_key', order: result.order };
      }
      if (result.status === 'fulfilled') {
        return { status: 'fulfilled', order: result.order };
      }
      return result;
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
          logWallet('invoice expired', order.id);
          await updateOrder(order.id, { status: 'EXPIRED' });
          const user = await getUser(order.user_id);
          const lang = (user && user.language) || config.language_default;
          const backData = order.product_code && order.days
            ? `pay:wallet:${order.product_code}:${order.days}`
            : 'menu_main';
          const expiredOptions = {
            reply_markup: {
              inline_keyboard: [[{ text: t(lang, 'back_button'), callback_data: backData }]],
            },
          };
          if (payment.message_id) {
            if (payment.message_is_photo && sendOrEditPhoto) {
              const sent = await sendOrEditPhoto(
                order.user_id,
                order.user_id,
                null,
                t(lang, 'wallet_invoice_expired'),
                expiredOptions,
                payment.message_id,
              );
              if (!sent) {
                await sendOrEditMessage(
                  order.user_id,
                  order.user_id,
                  t(lang, 'wallet_invoice_expired'),
                  expiredOptions,
                  payment.message_id,
                );
              }
            } else {
              await sendOrEditMessage(
                order.user_id,
                order.user_id,
                t(lang, 'wallet_invoice_expired'),
                expiredOptions,
                payment.message_id,
              );
            }
          }
          continue;
        }

        const asset = getWalletAsset(config, payment.asset);
        const network = asset ? getWalletNetwork(asset, payment.network) : null;
        if (!asset || !network) {
          logWallet('missing asset or network', order.id);
          continue;
        }

        if (payment.message_id) {
          const user = await getUser(order.user_id);
          const lang = (user && user.language) || config.language_default;
          const messageInfo = buildWalletInvoiceMessage(lang, asset, network, payment);
          if (messageInfo.expiresInMinutes !== null
            && messageInfo.expiresInMinutes !== payment.last_expires_min) {
            const backData = order.product_code && order.days && payment.asset
              ? `wallet:coin:${payment.asset}:${order.product_code}:${order.days}`
              : 'menu_main';
            const options = {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[{ text: t(lang, 'back_button'), callback_data: backData }]],
              },
            };
            const updatedPayment = { ...payment, last_expires_min: messageInfo.expiresInMinutes };
            if (payment.message_is_photo && sendOrEditPhoto) {
              const buffer = await QRCode.toBuffer(String(network.address), {
                type: 'png',
                width: 320,
                margin: 1,
              });
              const sent = await sendOrEditPhoto(
                order.user_id,
                order.user_id,
                buffer,
                messageInfo.text,
                options,
                payment.message_id,
              );
              if (sent && sent.message_id) {
                updatedPayment.message_id = sent.message_id;
                updatedPayment.message_is_photo = true;
              }
            } else {
              const sent = await sendOrEditMessage(
                order.user_id,
                order.user_id,
                messageInfo.text,
                options,
                payment.message_id,
              );
              if (sent && sent.message_id) {
                updatedPayment.message_id = sent.message_id;
              }
            }
            await updateOrder(order.id, { payment: updatedPayment });
          }
        }

        let paymentInfo;
        try {
          logWallet(
            'poll',
            order.id,
            payment.asset,
            payment.network,
            'amount',
            payment.amount_atomic,
            'start',
            payment.evm_start_block,
            'last',
            payment.last_checked_block,
          );
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
          logWallet('poll error', order.id, err.message);
          continue;
        }

        if (!paymentInfo || !paymentInfo.found) {
          logWallet(
            'not found',
            order.id,
            payment.asset,
            payment.network,
            'last',
            paymentInfo && paymentInfo.last_checked_block !== undefined
              ? paymentInfo.last_checked_block
              : 'n/a',
          );
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
          logWallet('poll missing order', order.id);
          await notifyAdmins(`Wallet payment for unknown order: ${order.id}`);
          continue;
        }

        if (result.status === 'no_key') {
          logWallet('poll no key', order.id);
          const user = await getUser(order.user_id);
          const lang = (user && user.language) || config.language_default;
          await sendOrEditMessage(order.user_id, order.user_id, t(lang, 'no_keys_after_payment'));
          await notifyAdmins(`Keys out of stock for ${order.product_code} ${order.days} days. Order ${order.id}.`);
          continue;
        }

        if (result.status === 'fulfilled') {
          logWallet('poll fulfilled', order.id, paymentInfo.txid);
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

  return {
    sendWalletCoins,
    sendWalletNetworks,
    handleWalletPayment,
    handleWalletCheckCommand,
    fulfillWalletOrder,
    pollWalletPayments,
    startWalletWatcher,
    buildWalletInvoiceMessage,
  };
}

module.exports = {
  createWalletFlow,
};
