function createNotifier({ bot, config }) {
  async function notifyAdmins(message) {
    const admins = config.admin_telegram_ids || [];
    if (!admins.length) {
      return;
    }
    await Promise.all(
      admins.map((adminId) => bot.sendMessage(adminId, message).catch(() => null)),
    );
  }

  return {
    notifyAdmins,
  };
}

module.exports = {
  createNotifier,
};
