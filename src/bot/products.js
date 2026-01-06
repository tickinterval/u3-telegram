function createProductHelpers({ products }) {
  const productList = Array.isArray(products) ? products : [];

  function findProduct(code) {
    return productList.find((product) => product.code === code);
  }

  function findDuration(product, days) {
    if (!product || !Array.isArray(product.durations)) {
      return null;
    }
    return product.durations.find((item) => Number(item.days) === Number(days));
  }

  function getDisplayProductTitle(product) {
    if (!product) {
      return '';
    }
    if (product.code === 'blitz') {
      return '🐟 u3ware';
    }
    return product.title;
  }

  return {
    findProduct,
    findDuration,
    getDisplayProductTitle,
  };
}

module.exports = {
  createProductHelpers,
};
