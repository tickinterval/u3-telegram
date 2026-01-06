function createMessenger({ bot, getUser, updateUser }) {
  async function deleteMessageIfPossible(chatId, messageId) {
    try {
      await bot.deleteMessage(chatId, messageId);
    } catch (err) {
      // Ignore deletion errors to avoid blocking UI updates.
    }
  }

  async function deleteMessage(chatId, messageId) {
    if (!messageId) {
      return;
    }
    await deleteMessageIfPossible(chatId, messageId);
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
        await updateUser(userId, { last_message_id: messageId, last_message_is_photo: false });
        return { message_id: messageId };
      } catch (err) {
        const description = err && err.response && err.response.body && err.response.body.description;
        if (description && description.includes('message is not modified')) {
          await updateUser(userId, { last_message_id: messageId, last_message_is_photo: false });
          return { message_id: messageId };
        }
        await deleteMessageIfPossible(chatId, messageId);
      }
    }

    const sent = await bot.sendMessage(chatId, text, safeOptions);
    await updateUser(userId, { last_message_id: sent.message_id, last_message_is_photo: false });
    return sent;
  }

  async function sendMessageOnly(chatId, userId, text, options = {}) {
    const safeOptions = { ...options };
    if (!Object.prototype.hasOwnProperty.call(safeOptions, 'reply_markup')) {
      safeOptions.reply_markup = { inline_keyboard: [] };
    }
    const sent = await bot.sendMessage(chatId, text, safeOptions);
    await updateUser(userId, { last_message_id: sent.message_id, last_message_is_photo: false });
    return sent;
  }

  async function sendOrEditPhoto(chatId, userId, photo, caption, options = {}, preferredMessageId = null) {
    const safeOptions = { ...options };
    if (!Object.prototype.hasOwnProperty.call(safeOptions, 'reply_markup')) {
      safeOptions.reply_markup = { inline_keyboard: [] };
    }

    const user = await getUser(userId);
    const messageId = preferredMessageId || (user && user.last_message_id);

    if (messageId) {
      try {
        await bot.editMessageCaption(caption, {
          chat_id: chatId,
          message_id: messageId,
          ...safeOptions,
        });
        await updateUser(userId, { last_message_id: messageId, last_message_is_photo: true });
        return { message_id: messageId };
      } catch (err) {
        const description = err && err.response && err.response.body && err.response.body.description;
        if (description && description.includes('message is not modified')) {
          await updateUser(userId, { last_message_id: messageId, last_message_is_photo: true });
          return { message_id: messageId };
        }
        await deleteMessageIfPossible(chatId, messageId);
      }
    }

    if (!photo) {
      return null;
    }

    const fileOptions = Buffer.isBuffer(photo) ? { filename: 'image.png' } : undefined;
    const sent = await bot.sendPhoto(chatId, photo, { caption, ...safeOptions }, fileOptions);
    await updateUser(userId, { last_message_id: sent.message_id, last_message_is_photo: true });
    return sent;
  }

  async function sendPhotoOnly(chatId, photo, options = {}) {
    const fileOptions = Buffer.isBuffer(photo) ? { filename: 'image.png' } : undefined;
    const sent = await bot.sendPhoto(chatId, photo, options, fileOptions);
    return sent;
  }

  return {
    deleteMessage,
    sendOrEditMessage,
    sendMessageOnly,
    sendOrEditPhoto,
    sendPhotoOnly,
  };
}

module.exports = {
  createMessenger,
};
