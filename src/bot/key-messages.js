function createKeyMessages({
  config,
  t,
  getUser,
  sendOrEditMessage,
}) {
  function buildKeyMessage(lang, key) {
    const lines = [
      t(lang, 'payment_received'),
      key,
      '',
      t(lang, 'instruction_title'),
    ];
    if (config.support_links.support) {
      lines.push(`${t(lang, 'support_label')}: ${config.support_links.support}`);
    }
    if (config.support_links.chat) {
      lines.push(`${t(lang, 'chat_label')}: ${config.support_links.chat}`);
    }
    return lines.join('\n');
  }

  async function sendWalletSuccessMessage(order) {
    if (!order || !order.key) {
      return;
    }
    const user = await getUser(order.user_id);
    const lang = (user && user.language) || config.language_default;
    const text = buildKeyMessage(lang, order.key);
    await sendOrEditMessage(order.user_id, order.user_id, text, {
      disable_web_page_preview: true,
    });
  }

  async function sendOrderKeyMessage(order, lang, preferredMessageId = null) {
    if (!order || !order.key) {
      return;
    }
    const text = buildKeyMessage(lang, order.key);
    await sendOrEditMessage(order.user_id, order.user_id, text, {
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: t(lang, 'back_button'), callback_data: 'menu_keys' }]],
      },
    }, preferredMessageId);
  }

  return {
    buildKeyMessage,
    sendWalletSuccessMessage,
    sendOrderKeyMessage,
  };
}

module.exports = {
  createKeyMessages,
};
