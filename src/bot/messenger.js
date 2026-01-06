function createMessenger({ bot, getUser, updateUser }) {
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

  return {
    sendOrEditMessage,
    sendMessageOnly,
  };
}

module.exports = {
  createMessenger,
};
