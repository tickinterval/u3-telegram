# U3ware Telegram Bot

Telegram-бот для продажи цифровых ключей с оплатой через Cardlink и автоматической выдачей после успешной оплаты.

## Быстрый старт

1. Скопируйте `config.example.json` в `config.json` и заполните значения.
2. Установите зависимости:
   ```bash
   npm install
   ```
3. Запустите бота:
   ```bash
   npm start
   ```

## Важно для Cardlink

- В настройках магазина Cardlink укажите Result URL:
  `https://ваш-домен.com/cardlink/postback`
- В `config.json` задайте `server.base_url`, чтобы бот передавал Success/Fail URL при создании счета.
- `cardlink.currency_in` должен быть одним из `USD`, `EUR`, `RUB`.  
  `payment_currency` должен совпадать с ключом цен в продукте (`UAH`, `USD`, `CNY`).

## Ключи доступа

Ключи хранятся в `data/keys.json`. Заказы и пользователи — в `data/store.json`.

### Генерация ключей

```bash
node scripts/generate-keys.js --count 50 --output data/keys-blitz-7.txt
```

### Импорт ключей

```bash
node scripts/import-keys.js --file data/keys-blitz-7.txt --product blitz --days 7
```

Файл может быть:
- `txt` — один ключ на строку.
- `json` — массив строк или массив объектов `{ "key": "...", "product_code": "blitz", "days": 7 }`.

## Добавление новых товаров

Редактируйте массив `products` в `config.json`. Для каждого товара задайте:
- `code` — уникальный код,
- `title` — название,
- `durations` — список сроков и цен.

Пример уже настроен для товара **Blitz** на 7/14/30/90 дней.
