function fulfillOrderWithKey({ store, keys, order, nowIso }) {
  if (order.key) {
    return { status: 'already_fulfilled', order };
  }

  const keyIndex = keys.available.findIndex(
    (item) => item.product_code === order.product_code && Number(item.days) === Number(order.days),
  );

  if (keyIndex === -1) {
    order.status = 'PAID_NO_KEY';
    order.updated_at = nowIso();
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
  order.updated_at = nowIso();

  const user = store.users[order.user_id];
  if (user) {
    user.purchase_count = (user.purchase_count || 0) + 1;
    user.updated_at = nowIso();
  }

  return { status: 'fulfilled', order };
}

module.exports = {
  fulfillOrderWithKey,
};
