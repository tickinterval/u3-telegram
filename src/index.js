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
const { createI18n } = require('./bot/i18n');
const { createProductHelpers } = require('./bot/products');
const { createState } = require('./bot/state');
const { createMessenger } = require('./bot/messenger');
const { createViews } = require('./bot/views');
const { createKeyMessages } = require('./bot/key-messages');
const { createNotifier } = require('./bot/notifier');
const { fulfillOrderWithKey } = require('./bot/fulfillment');
const { createWalletFlow } = require('./bot/wallet-flow');
const { createPaymentHandlers } = require('./bot/payments');
const { nowIso, parseCommand, normalizeTxid } = require('./bot/utils');
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
const i18n = createI18n({ languageDefault: config.language_default });
const {
  t,
  formatPriceList,
  formatPriceLine,
  formatDaysLabel,
  formatOrderStatus,
} = i18n;
const products = createProductHelpers({ products: config.products });
const { findProduct, findDuration, getDisplayProductTitle } = products;
const state = createState({
  config,
  readKeys,
  readStore,
  withStore,
  nowIso,
  getDisplayProductTitle,
});
const {
  ensureUser,
  updateUser,
  getUser,
  hasAvailableKey,
  updateOrder,
  createOrder,
} = state;
const messenger = createMessenger({ bot, getUser, updateUser });
const { sendOrEditMessage, sendMessageOnly } = messenger;
const views = createViews({
  config,
  products: config.products,
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
});
const {
  sendTerms,
  sendMainMenu,
  sendProfile,
  sendKeysList,
  sendProducts,
  sendProductDetails,
  sendPaymentMethods,
} = views;
const keyMessages = createKeyMessages({
  config,
  t,
  getUser,
  sendOrEditMessage,
});
const { buildKeyMessage, sendWalletSuccessMessage, sendOrderKeyMessage } = keyMessages;
const notifier = createNotifier({ bot, config });
const { notifyAdmins } = notifier;
const walletFlow = createWalletFlow({
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
});
const {
  sendWalletCoins,
  sendWalletNetworks,
  handleWalletPayment,
  handleWalletCheckCommand,
  startWalletWatcher,
} = walletFlow;
const paymentHandlers = createPaymentHandlers({
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
});
const { handleCardlinkPayment, handleCryptocloudPayment, registerRoutes } = paymentHandlers;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
registerRoutes(app);

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
    await sendKeysList(chatId, user.id, lang, 1);
    return;
  }

  if (data.startsWith('keys_page:')) {
    const page = Number(data.split(':')[1]) || 1;
    await sendKeysList(chatId, user.id, lang, page);
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

app.listen(config.server.port, () => {
  console.log(`Server listening on port ${config.server.port}`);
});

startWalletWatcher();
