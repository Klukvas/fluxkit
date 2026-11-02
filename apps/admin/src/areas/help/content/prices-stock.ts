import type { HelpArticle, HelpTopic } from "../help-model";

/** Topic "Prices and stock": the Prices and Stock tabs of the product editor. */
export const PRICES_STOCK_TOPIC: HelpTopic = {
  id: "prices-stock",
  title: { uk: "Ціни та залишки", en: "Prices and stock" },
};

export const PRICES_STOCK_ARTICLES: readonly HelpArticle[] = [
  {
    id: "prices",
    topic: "prices-stock",
    title: { uk: "Ціни, стара ціна і валюти", en: "Prices, compare-at prices and currencies" },
    summary: {
      uk: "Як ввести ціни варіантів, показати стару ціну і що відбувається з іншими валютами.",
      en: "How to enter variant prices, show a compare-at price, and what happens to other currencies.",
    },
    keywords: {
      uk: ["ціна", "вартість", "знижка", "стара ціна", "валюта", "гривня"],
      en: ["price", "cost", "sale price", "old price", "currency", "hryvnia"],
    },
    blocks: [
      { kind: "heading", id: "grid", text: { uk: "Таблиця цін", en: "The price table" } },
      {
        kind: "steps",
        items: [
          {
            uk: "Редактор товару → вкладка «Ціни». Рядки — варіанти, стовпці — валюти; валюта магазину перша.",
            en: "Product editor → Prices tab. Rows are variants, columns are currencies; the shop currency comes first.",
          },
          {
            uk: "Введіть ціну з крапкою як роздільником, наприклад 1299.50. Кома і пробіли всередині числа не приймаються, щоб не вгадувати.",
            en: "Type the price with a dot as the separator, for example 1299.50. A comma or spaces inside the number are refused rather than guessed.",
          },
          {
            uk: "Під полем видно, як ціну буде збережено. Натисніть «Зберегти ціни»: усі змінені ціни зберігаються разом.",
            en: "Under the field you see how the price will be stored. Press “Save the prices”: all changed prices are saved together.",
          },
        ],
      },
      { kind: "heading", id: "compare-at", text: { uk: "Стара ціна", en: "Compare-at price" } },
      {
        kind: "paragraph",
        text: {
          uk: "«Стара ціна» необовʼязкова. Вітрина показує її поруч із ціною як ціну до знижки. Вона має бути строго більшою за ціну; щоб прибрати знижку, очистіть поле і збережіть.",
          en: "The compare-at price is optional. The storefront shows it next to the price as the price before the discount. It must be strictly higher than the price; to end the discount, clear the field and save.",
        },
      },
      { kind: "heading", id: "currencies", text: { uk: "Валюти", en: "Currencies" } },
      {
        kind: "paragraph",
        text: {
          uk: "Магазин продає в одній валюті — валюті магазину з налаштувань сервера. «Показати іншу валюту» дозволяє зберегти ціни в інших валютах, але вони не продаються і не конвертуються.",
          en: "The shop sells in one currency, the shop currency of the server configuration. “Show another currency” lets you store prices in other currencies, but they are neither sold nor converted.",
        },
      },
      { kind: "heading", id: "remove", text: { uk: "Видалити ціну", en: "Removing a price" } },
      {
        kind: "warning",
        text: {
          uk: "«Видалити ціну» не можна скасувати. Без ціни у валюті магазину варіант не продається; ціну увімкненого варіанта опублікованого товару сервер видалити не дасть — спершу зніміть товар із публікації або вимкніть варіант.",
          en: "“Remove the price” cannot be undone. Without a price in the shop currency the variant is not sold; the server refuses to remove it from an active variant of a published product: unpublish the product or switch the variant off first.",
        },
      },
      { kind: "heading", id: "rules", text: { uk: "Що варто знати", en: "Good to know" } },
      {
        kind: "note",
        text: {
          uk: "Підсумки замовлення завжди рахує сервер; покупець не може змінити ціну. Замовлення зберігає ціну на момент покупки, тож нова ціна не змінює вже оформлених замовлень. Податків і знижок в адмінці немає; чи включають ціни податок — налаштування сервера.",
          en: "The server always computes order totals; a shopper cannot change a price. An order keeps the price at the time of purchase, so a new price does not change orders already placed. The admin has no tax or discount settings; whether prices include tax is a server setting.",
        },
      },
      { kind: "screen", route: "products" },
    ],
  },
  {
    id: "stock",
    topic: "prices-stock",
    title: {
      uk: "Залишки, резерви і продаж понад залишок",
      en: "Stock, reservations and backorders",
    },
    summary: {
      uk: "Як оприбуткувати товар, що таке резерв, коли товар «закінчується» і як продавати під замовлення.",
      en: "How to receive stock, what a reservation is, when a product is low in stock and how to sell on backorder.",
    },
    keywords: {
      uk: ["склад", "кількість", "наявність", "інвентаризація", "надходження", "списання"],
      en: ["inventory", "quantity", "availability", "stock count", "receipt", "write off"],
    },
    blocks: [
      {
        kind: "heading",
        id: "levels",
        text: { uk: "Що показує вкладка", en: "What the tab shows" },
      },
      {
        kind: "definitions",
        items: [
          {
            term: { uk: "На складі", en: "On hand" },
            definition: { uk: "Скільки фізично є.", en: "What is physically there." },
          },
          {
            term: { uk: "Зарезервовано", en: "Reserved" },
            definition: {
              uk: "Утримується для замовлень, які ще не оплачені.",
              en: "Held for orders that are not paid yet.",
            },
          },
          {
            term: { uk: "Доступно", en: "Available" },
            definition: {
              uk: "На складі мінус зарезервовано. Саме це можуть купити.",
              en: "On hand minus reserved. This is what shoppers can buy.",
            },
          },
        ],
      },
      { kind: "heading", id: "adjust", text: { uk: "Змінити залишок", en: "Changing the stock" } },
      {
        kind: "steps",
        items: [
          {
            uk: "Редактор товару → вкладка «Залишки» → відкрийте варіант.",
            en: "Product editor → Stock tab → open the variant.",
          },
          {
            uk: "Виберіть вид: «Надходження» (товар прийшов, кількість додається), «Виправлення» (після підрахунку, пошкодження чи втрати: додати, відняти або ввести порахувану кількість) чи «Повернення» (покупець повернув, кількість додається).",
            en: "Choose the kind: “Receipt” (goods arrived, the quantity is added), “Correction” (after a count, damage or loss: add, remove or enter the counted quantity) or “Return” (a customer returned units, the quantity is added).",
          },
          {
            uk: "За бажанням вкажіть причину і номер документа. Зменшення і введення порахованої кількості потрібно підтвердити.",
            en: "Optionally add a reason and a document number. Lowering the stock or entering a counted quantity asks for confirmation.",
          },
        ],
      },
      {
        kind: "note",
        text: {
          uk: "Кожна зміна записується в журнал із тим, хто її зробив; журнал не редагується. Залишок не може стати меншим за нуль або за зарезервовану кількість. Склад зараз один (основний); керувати складами в адмінці не можна.",
          en: "Every change is written to the journal with who made it; the journal cannot be edited. Stock cannot go below zero or below what is reserved. There is one location (the main one) today; locations cannot be managed in the admin.",
        },
      },
      { kind: "heading", id: "reservations", text: { uk: "Резерви", en: "Reservations" } },
      {
        kind: "paragraph",
        text: {
          uk: "Кошик нічого не резервує. Оформлене замовлення резервує товар на час оплати (за замовчуванням 30 хвилин, налаштування сервера) і ще 10 хвилин. Після оплати резерв стає продажем і зменшує залишок на складі. Якщо замовлення скасоване або прострочене, резерв знімається. Резерви варіанта видно ролям, які бачать замовлення.",
          en: "A cart reserves nothing. A placed order reserves the stock for the payment time (30 minutes by default, a server setting) plus 10 minutes. Once paid, the reservation becomes a sale and lowers the stock on hand. If the order is cancelled or expires, the reservation is released. A variant's reservations are visible to roles that see orders.",
        },
      },
      { kind: "heading", id: "low-stock", text: { uk: "Мало в наявності", en: "Low stock" } },
      {
        kind: "paragraph",
        text: {
          uk: "Коли доступно від 1 одиниці до порога включно (налаштування сервера, за замовчуванням 5), варіант позначається «мало в наявності» в адмінці та у вітрині; 0 — «немає в наявності». Вітрина ніколи не показує точну кількість, лише стан: є, мало, немає.",
          en: "When 1 unit up to the threshold is available (a server setting, 5 by default), the variant is marked “low stock” in the admin and the storefront; 0 is “out of stock”. The storefront never shows the exact quantity, only the state: in stock, low, out of stock.",
        },
      },
      {
        kind: "heading",
        id: "backorder",
        text: { uk: "Продаж понад залишок", en: "Selling beyond stock" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Позначка варіанта «Продавати понад наявний залишок» дозволяє замовляти більше, ніж є. Коли замовлення оплачене, продається те, що є, а решта чекає. «Позначити виконаним» буде відхилено, доки ви не оприбуткуєте товар, якого бракує.",
          en: "The variant flag “Sell beyond the stock on hand” lets shoppers order more than there is. When the order is paid, what is on hand is sold and the rest waits. “Mark fulfilled” is refused until you receive the missing units.",
        },
      },
      {
        kind: "heading",
        id: "untracked",
        text: { uk: "Без обліку залишків", en: "Without stock counting" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Якщо вимкнути «Рахувати залишки» (наприклад, для цифрових товарів), варіант завжди доступний і нічого не резервується.",
          en: "With “Count stock” off (for example for digital goods), the variant is always available and nothing is reserved.",
        },
      },
      { kind: "screen", route: "products" },
    ],
  },
];
