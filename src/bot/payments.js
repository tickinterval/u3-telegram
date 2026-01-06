function createPaymentHandlers({
  config,
  t,
  getDisplayProductTitle,
  hasAvailableKey,
  createOrder,
  updateOrder,
  getUser,
  sendOrEditMessage,
  notifyAdmins,
  buildKeyMessage,
  createBill,
  verifyPostbackSignature,
  createCryptocloudInvoice,
  verifyCryptocloudPostbackToken,
  fulfillOrderWithKey,
  withData,
  nowIso,
  hasCryptocloud,
}) {
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
      await sendOrEditMessage(chatId, userId, t(lang, 'out_of_stock'), backKeyboard);
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

  function registerRoutes(app) {
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

        const fulfillment = fulfillOrderWithKey({ store, keys, order, nowIso });
        return { status: fulfillment.status, order: fulfillment.order || order };
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
        const text = buildKeyMessage(lang, order.key);
        await sendOrEditMessage(order.user_id, order.user_id, text, {
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

        const fulfillment = fulfillOrderWithKey({ store, keys, order, nowIso });
        return { status: fulfillment.status, order: fulfillment.order || order };
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
        const text = buildKeyMessage(lang, order.key);
        await sendOrEditMessage(order.user_id, order.user_id, text, {
          disable_web_page_preview: true,
        });
      }
    });

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
  }

  return {
    handleCardlinkPayment,
    handleCryptocloudPayment,
    registerRoutes,
  };
}

module.exports = {
  createPaymentHandlers,
};
