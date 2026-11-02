import type { HelpArticle, HelpTopic } from "../help-model";

/** Topic "Getting started": how the admin works, the setup order, the legal placeholders, the glossary. */
export const START_TOPIC: HelpTopic = {
  id: "start",
  title: { uk: "Початок роботи", en: "Getting started" },
};

export const START_ARTICLES: readonly HelpArticle[] = [
  {
    id: "first-steps",
    topic: "start",
    title: { uk: "Перші кроки в адмінці", en: "First steps in the admin" },
    summary: {
      uk: "Як влаштована адмінка, хто що бачить, у якому порядку налаштувати магазин і чого магазин не вміє.",
      en: "How the admin is organised, who sees what, the order in which to set up the shop, and what the shop does not do.",
    },
    keywords: {
      uk: ["старт", "початок", "налаштування", "меню", "мова", "онбординг"],
      en: ["start", "setup", "menu", "language", "onboarding"],
    },
    blocks: [
      {
        kind: "heading",
        id: "admin",
        text: { uk: "Як влаштована адмінка", en: "How the admin is organised" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Меню розділів: Каталог, Продажі, Налаштування і Довідка. Ви бачите лише розділи, які дозволяє ваша роль; інші сервер однаково не відкриє. Мову інтерфейсу (українська або англійська) перемикають угорі сторінки, вибір запамʼятовується в цьому браузері.",
          en: "The menu has the sections Catalog, Sales, Settings and Help. You see only the sections your role allows; the server refuses the others anyway. Switch the interface language (Ukrainian or English) at the top of the page; the choice is remembered in this browser.",
        },
      },
      {
        kind: "note",
        text: {
          uk: "Мова інтерфейсу і мови вмісту — різні речі. Тексти товарів, категорій і способів доставки ви заповнюєте для кожної мови магазину окремо; обовʼязкова лише мова за замовчуванням.",
          en: "The interface language and the content languages are different things. You fill in the texts of products, categories and delivery methods for each shop language; only the default language is required.",
        },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Кожна зміна зберігається одним запитом. Якщо звʼязок обірвався, екран каже «результат невідомий», перечитує дані з сервера і нічого не надсилає вдруге сам: перевірте, що збережено, і лише тоді повторіть.",
          en: 'Every change is saved with one request. If the connection drops, the screen says "result unknown", reads the data from the server again and never sends anything a second time by itself: check what was stored before you repeat.',
        },
      },
      {
        kind: "heading",
        id: "setup-order",
        text: { uk: "Порядок налаштування", en: "Setting up, in order" },
      },
      {
        kind: "steps",
        items: [
          {
            uk: "Створіть типи товарів з атрибутами та опціями (наприклад, «Футболка» з опціями «Розмір» і «Колір»).",
            en: 'Create product types with their attributes and options (for example "T-shirt" with the options "Size" and "Colour").',
          },
          {
            uk: "Створіть категорії, а за потреби — бренди.",
            en: "Create categories and, if you need them, brands.",
          },
          {
            uk: "Створіть перший товар, виберіть значення опцій і згенеруйте варіанти.",
            en: "Create the first product, choose its option values and generate the variants.",
          },
          {
            uk: "Задайте ціни у валюті магазину й опублікуйте товар.",
            en: "Set prices in the shop currency and publish the product.",
          },
          {
            uk: "Оприбуткуйте залишки на вкладці «Залишки» товару.",
            en: "Receive stock on the product's Stock tab.",
          },
          {
            uk: "Перевірте способи доставки, онлайн-оплату й пошту.",
            en: "Check the delivery methods, online payment and email.",
          },
        ],
      },
      {
        kind: "paragraph",
        text: {
          uk: "Картка «Перші кроки» на стартовій сторінці сама позначає кроки, які видно з даних магазину. Її можна сховати; вона завжди є в Довідці.",
          en: 'The "Getting started" card on the start page marks the steps the shop\'s data shows as done. You can hide it; it is always available under Help.',
        },
      },
      { kind: "screen", route: "help" },
      { kind: "heading", id: "legal", text: { uk: "Юридичні тексти", en: "Legal texts" } },
      {
        kind: "warning",
        text: {
          uk: "Сторінки вітрини «Політика конфіденційності», «Умови» та «Файли cookie» постачаються як заглушки разом із даними про продавця. Їх замінює розробник у коді вітрини, не в адмінці. Перед запуском замініть їх текстами, які перевірив ваш юрист. Адмінка не може це перевірити, тому цей крок у картці «Перші кроки» ви позначаєте самі.",
          en: 'The storefront pages "Privacy policy", "Terms" and "Cookies" ship as placeholders, together with the seller details. A developer replaces them in the storefront code, not in the admin. Before launch, replace them with texts your lawyer has checked. The admin cannot check this, so you tick this step of the "Getting started" card yourself.',
        },
      },
      {
        kind: "heading",
        id: "limits",
        text: { uk: "Чого магазин не вміє", en: "What the shop does not do" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Зараз немає: оформлення повернень товару, знижок і купонів, двофакторного входу, редагування текстів листів в адмінці, імпорту товарів із файлу, редагування замовлення після оформлення, звітів і графіків. Якщо щось із цього потрібно, це окрема доробка.",
          en: "Not available today: a returns process, discounts and coupons, two-factor sign-in, editing mail texts in the admin, importing products from a file, editing an order after it was placed, reports and charts. If you need one of these, it is a separate piece of work.",
        },
      },
    ],
  },
  {
    id: "glossary",
    topic: "start",
    title: { uk: "Словник", en: "Glossary" },
    summary: {
      uk: "Короткі пояснення слів, які трапляються в адмінці.",
      en: "Short explanations of the words you meet in the admin.",
    },
    keywords: {
      uk: ["терміни", "що означає", "визначення"],
      en: ["terms", "meaning", "definitions", "words"],
    },
    blocks: [
      { kind: "heading", id: "catalog", text: { uk: "Каталог", en: "Catalog" } },
      {
        kind: "definitions",
        items: [
          {
            term: { uk: "Товар", en: "Product" },
            definition: {
              uk: "Картка в каталозі: назва, опис, зображення, категорії. Сам товар не купують — купують його варіант.",
              en: "The catalog card: title, description, images, categories. A shopper never buys the product itself, only one of its variants.",
            },
          },
          {
            term: { uk: "Варіант", en: "Variant" },
            definition: {
              uk: "Те, що кладуть у кошик: своя ціна, свій залишок, свій артикул (SKU). Простий товар має один варіант за замовчуванням.",
              en: "What goes into the cart: its own price, its own stock, its own SKU. A simple product has one default variant.",
            },
          },
          {
            term: { uk: "Артикул (SKU)", en: "SKU" },
            definition: {
              uk: "Унікальний код варіанта у всьому магазині: великі латинські літери, цифри, крапка, дефіс, підкреслення.",
              en: "The variant's code, unique in the whole shop: capital Latin letters, digits, dot, hyphen and underscore.",
            },
          },
          {
            term: { uk: "Опція", en: "Option" },
            definition: {
              uk: "Те, що покупець вибирає і що створює варіанти (розмір, колір).",
              en: "What the shopper chooses and what creates variants (size, colour).",
            },
          },
          {
            term: { uk: "Атрибут", en: "Attribute" },
            definition: {
              uk: "Опис товару, який не треба вибирати (матеріал, довжина). Може бути фільтром у каталозі.",
              en: "A description the shopper does not choose (material, length). It can be a catalog filter.",
            },
          },
          {
            term: { uk: "Тип товару", en: "Product type" },
            definition: {
              uk: "Шаблон, який визначає, які атрибути й опції є в товарів цього типу.",
              en: "The template that decides which attributes and options the products of this type have.",
            },
          },
          {
            term: { uk: "Чернетка, опубліковано, архів", en: "Draft, published, archived" },
            definition: {
              uk: "Стани товару: чернетки не видно у вітрині, опублікований товар продається, архівний прихований, але збережений.",
              en: "Product states: a draft is not in the shop, a published product is for sale, an archived one is hidden but kept.",
            },
          },
        ],
      },
      { kind: "heading", id: "money-stock", text: { uk: "Гроші та склад", en: "Money and stock" } },
      {
        kind: "definitions",
        items: [
          {
            term: { uk: "Валюта магазину", en: "Shop currency" },
            definition: {
              uk: "Єдина валюта, у якій магазин продає. Задається в налаштуваннях сервера.",
              en: "The one currency the shop sells in. It is set in the server configuration.",
            },
          },
          {
            term: { uk: "Стара ціна", en: "Compare-at price" },
            definition: {
              uk: "Необовʼязкова «ціна до знижки»; має бути більшою за ціну.",
              en: 'An optional "was" price; it must be higher than the price.',
            },
          },
          {
            term: { uk: "На складі, зарезервовано, доступно", en: "On hand, reserved, available" },
            definition: {
              uk: "На складі — фізично є; зарезервовано — тримається для неоплачених замовлень; доступно — на складі мінус зарезервовано.",
              en: "On hand is what is physically there; reserved is held for unpaid orders; available is on hand minus reserved.",
            },
          },
          {
            term: { uk: "Резерв", en: "Reservation" },
            definition: {
              uk: "Утримання товару для замовлення до оплати. Знімається, коли замовлення скасоване або прострочене.",
              en: "Stock held for an order until it is paid. Released when the order is cancelled or expires.",
            },
          },
          {
            term: { uk: "Продаж понад залишок", en: "Sell beyond stock (backorder)" },
            definition: {
              uk: "Дозвіл замовляти більше, ніж є на складі; відправити можна, коли товар надійде.",
              en: "Allows orders for more than is on hand; the order ships once the stock arrives.",
            },
          },
        ],
      },
      {
        kind: "heading",
        id: "orders",
        text: { uk: "Замовлення та сервіси", en: "Orders and services" },
      },
      {
        kind: "definitions",
        items: [
          {
            term: { uk: "Номер замовлення", en: "Order number" },
            definition: {
              uk: "Код із восьми символів, наприклад 7K3M-9QX2. Покупець бачить його в листі та на сторінці замовлення.",
              en: "An eight-character code such as 7K3M-9QX2. The shopper sees it in the mail and on the order page.",
            },
          },
          {
            term: { uk: "Спроба оплати", en: "Payment attempt" },
            definition: {
              uk: "Одна онлайн-оплата замовлення через платіжного провайдера. У замовлення їх може бути кілька.",
              en: "One online payment of an order through a payment provider. An order may have several.",
            },
          },
          {
            term: { uk: "ТТН (накладна)", en: "Waybill" },
            definition: {
              uk: "Відправлення, створене у перевізника, з номером для відстеження.",
              en: "A shipment created at the carrier, with a tracking number.",
            },
          },
          {
            term: { uk: "Черга листів", en: "Outbox" },
            definition: {
              uk: "Список усіх листів магазину з їхнім станом: чекає, надсилається, надіслано, помилка.",
              en: "The list of every mail of the shop with its state: waiting, sending, sent, failed.",
            },
          },
          {
            term: { uk: "Синонім", en: "Synonym" },
            definition: {
              uk: "Слова, які пошук вважає рівнозначними (наприклад, «футболка» і «тішка»).",
              en: 'Words the search treats as the same (for example "t-shirt" and "tee").',
            },
          },
          {
            term: { uk: "Запит щодо персональних даних", en: "Privacy request" },
            definition: {
              uk: "Прохання людини видати або видалити її дані. Обробляє лише власник.",
              en: "A person's request to receive or erase their data. Only an owner handles it.",
            },
          },
          {
            term: { uk: "Журнал дій", en: "Audit log" },
            definition: {
              uk: "Список дій адміністраторів із клієнтами, користувачами адмінки та запитами щодо даних.",
              en: "The list of what admins did to customers, admin users and privacy requests.",
            },
          },
        ],
      },
    ],
  },
];
