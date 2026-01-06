function createState({
  config,
  readKeys,
  readStore,
  withStore,
  nowIso,
  getDisplayProductTitle,
}) {
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

  return {
    ensureUser,
    updateUser,
    getUser,
    hasAvailableKey,
    updateOrder,
    createOrder,
  };
}

module.exports = {
  createState,
};
