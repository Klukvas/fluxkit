import type { HelpArticle, HelpTopic } from "../help-model";

/** Topic "Sales": orders, customers, online payments and refunds, shipping and shipments. */
export const SALES_TOPIC: HelpTopic = {
  id: "sales",
  title: { uk: "Продажі", en: "Sales" },
};

export const SALES_ARTICLES: readonly HelpArticle[] = [
  {
    id: "orders",
    topic: "sales",
    title: {
      uk: "Замовлення: від оформлення до виконання",
      en: "Orders: from placed to fulfilled",
    },
    summary: {
      uk: "Статуси замовлення, оплата вручну, виконання, скасування і контактні дані.",
      en: "Order statuses, marking paid by hand, fulfilling, cancelling and the contact details.",
    },
    keywords: {
      uk: ["замовлення", "статус", "оплачено", "скасувати", "виконати", "відправити", "покупка"],
      en: ["order", "status", "paid", "cancel", "fulfil", "fulfill", "ship", "purchase"],
    },
    blocks: [
      { kind: "heading", id: "statuses", text: { uk: "Статуси", en: "Statuses" } },
      {
        kind: "definitions",
        items: [
          {
            term: { uk: "Очікує оплати", en: "Awaiting payment" },
            definition: {
              uk: "Щойно оформлене. Товар зарезервовано на час оплати (налаштування сервера, за замовчуванням 30 хвилин).",
              en: "Just placed. The stock is reserved for the payment time (a server setting, 30 minutes by default).",
            },
          },
          {
            term: { uk: "Оплачено", en: "Paid" },
            definition: {
              uk: "Онлайн-оплата пройшла або адміністратор позначив оплату вручну. Зарезервований товар продано.",
              en: "The online payment succeeded or an admin marked it paid. The reserved stock is sold.",
            },
          },
          {
            term: { uk: "Виконано", en: "Fulfilled" },
            definition: {
              uk: "Ви передали товар покупцеві чи перевізнику і позначили це вручну.",
              en: "You handed the goods to the shopper or the carrier and marked it by hand.",
            },
          },
          {
            term: { uk: "Скасовано", en: "Cancelled" },
            definition: {
              uk: "Скасоване адміністратором або покупцем (покупець може скасувати лише неоплачене).",
              en: "Cancelled by an admin or by the shopper (a shopper can cancel an unpaid order only).",
            },
          },
          {
            term: { uk: "Прострочено", en: "Expired" },
            definition: {
              uk: "Не оплачене вчасно; фонова задача закриває його сама і знімає резерв.",
              en: "Not paid in time; a background job closes it and releases the reservation.",
            },
          },
        ],
      },
      { kind: "heading", id: "list", text: { uk: "Список і пошук", en: "List and search" } },
      {
        kind: "paragraph",
        text: {
          uk: "Фільтри: статус і дати (за часовим поясом вашого браузера). Пошук знаходить точний номер замовлення або точну адресу email, не частину.",
          en: "Filters: status and dates (in your browser's time zone). The search finds an exact order number or an exact email address, not a part of one.",
        },
      },
      { kind: "screen", route: "orders" },
      { kind: "heading", id: "mark-paid", text: { uk: "Позначити оплаченим", en: "Mark paid" } },
      {
        kind: "steps",
        items: [
          {
            uk: "Для оплати поза магазином (банківський переказ, готівка) відкрийте замовлення → «Позначити оплаченим».",
            en: "For a payment outside the shop (bank transfer, cash) open the order → “Mark paid”.",
          },
          {
            uk: "Сума — уся сума замовлення, змінити її не можна: часткова оплата не підтримується.",
            en: "The amount is the order total and cannot be changed: partial payment is not supported.",
          },
          {
            uk: "Введіть номер платежу (переказу чи чека), поставте позначку «Я отримав цю суму» і підтвердьте.",
            en: "Type the payment reference (transfer or receipt number), tick “I received this amount” and confirm.",
          },
        ],
      },
      {
        kind: "note",
        text: {
          uk: "Той самий номер платежу вдруге не запише другу оплату. Поки триває онлайн-оплата замовлення, позначити його оплаченим чи скасувати не можна.",
          en: "The same reference a second time never records a second payment. While an online payment of the order is in progress, it cannot be marked paid or cancelled.",
        },
      },
      { kind: "heading", id: "fulfil", text: { uk: "Позначити виконаним", en: "Mark fulfilled" } },
      {
        kind: "paragraph",
        text: {
          uk: "Коли товар відправлено чи видано, натисніть «Позначити виконаним». Якщо в замовленні є товар під замовлення, якого ще немає на складі, дію буде відхилено: спершу оприбуткуйте його. Створення накладної статус не змінює.",
          en: "When the goods are shipped or handed over, press “Mark fulfilled”. If the order has a backordered line that is not on hand yet, it is refused: receive the stock first. Creating a waybill does not change the status.",
        },
      },
      {
        kind: "heading",
        id: "cancel",
        text: { uk: "Скасувати замовлення", en: "Cancel an order" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "«Скасувати замовлення» потребує причини; вона зберігається в історії замовлення. Для неоплаченого замовлення резерв знімається.",
          en: "“Cancel the order” needs a reason; it is kept in the order history. For an unpaid order the reservation is released.",
        },
      },
      {
        kind: "warning",
        text: {
          uk: "Скасування ОПЛАЧЕНОГО замовлення не повертає гроші і не повертає проданий товар на склад (звільняються лише одиниці, що ще чекали надходження за позицією понад залишок). Гроші поверніть кнопкою «Повернути кошти» на панелі оплати (для онлайн-оплати) або поза магазином, а товар — видом «Повернення» на вкладці «Залишки».",
          en: "Cancelling a PAID order neither refunds the money nor puts the sold goods back in stock (only units still waiting for stock on a backordered line are released). Refund with “Refund” on the payment panel (for an online payment) or outside the shop, and book the goods back with the kind “Return” on the Stock tab.",
        },
      },
      { kind: "heading", id: "contact", text: { uk: "Контактні дані", en: "Contact details" } },
      {
        kind: "paragraph",
        text: {
          uk: "Імʼя, email, телефон і адреси зберігаються такими, якими їх ввели під час оформлення; разом із назвами, артикулами й цінами на момент покупки. Змінити замовлення в адмінці не можна. Якщо контактні дані видалено (запит на видалення або строк зберігання), замість них написано «Видалено».",
          en: "The name, email, phone and addresses are kept as typed at checkout, together with the titles, SKUs and prices at the time of purchase. An order cannot be edited in the admin. When the contact data was erased (an erasure request or the retention period), the fields say “Erased”.",
        },
      },
      {
        kind: "note",
        text: {
          uk: "Коли налаштовано пошту, покупець автоматично отримує листи про оформлення, оплату, скасування і прострочення замовлення. Повернень товару як окремого процесу немає.",
          en: "When email is set up, the shopper automatically receives mails when the order is placed, paid, cancelled or expired. There is no separate returns process.",
        },
      },
    ],
  },
  {
    id: "customers",
    topic: "sales",
    title: { uk: "Клієнти", en: "Customers" },
    summary: {
      uk: "Облікові записи покупців: пошук, блокування входу, деактивація.",
      en: "Shopper accounts: search, sign-in lock, deactivation.",
    },
    keywords: {
      uk: ["покупці", "клієнт", "акаунт", "заблоковано", "деактивувати", "пароль"],
      en: ["shoppers", "customer", "account", "locked", "deactivate", "password"],
    },
    blocks: [
      {
        kind: "heading",
        id: "list",
        text: { uk: "Хто такі клієнти", en: "Who the customers are" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Клієнт — покупець, який зареєструвався у вітрині. Гість замовляє без облікового запису, тож його немає в цьому списку; його замовлення є в «Замовленнях». Пошук знаходить клієнта за початком адреси email.",
          en: "A customer is a shopper who registered in the storefront. A guest orders without an account, so guests are not in this list; their orders are under Orders. The search finds a customer by the start of the email address.",
        },
      },
      { kind: "screen", route: "customers" },
      { kind: "heading", id: "actions", text: { uk: "Дії", en: "Actions" } },
      {
        kind: "definitions",
        items: [
          {
            term: { uk: "Деактивувати", en: "Deactivate" },
            definition: {
              uk: "Завершує всі сесії клієнта і забороняє вхід. Обліковий запис і замовлення зберігаються; можна активувати знову.",
              en: "Ends all the customer's sessions and refuses sign-in. The account and orders are kept; it can be activated again.",
            },
          },
          {
            term: { uk: "Розблокувати", en: "Unlock" },
            definition: {
              uk: "Після 5 невдалих спроб входу обліковий запис блокується на 15 хвилин. Розблокування знімає блокування раніше.",
              en: "After 5 failed sign-ins the account is locked for 15 minutes. Unlock ends the lock sooner.",
            },
          },
        ],
      },
      { kind: "heading", id: "limits", text: { uk: "Чого не можна", en: "What you cannot do" } },
      {
        kind: "paragraph",
        text: {
          uk: "В адмінці не можна створити чи видалити клієнта, змінити email або задати пароль. Пароль клієнт відновлює сам через «Забули пароль?» у вітрині (потрібна налаштована пошта). Видалити свій обліковий запис клієнт може сам у вітрині на сторінці «Конфіденційність і дані»; на прохання людини це робить власник у розділі «Персональні дані».",
          en: "The admin cannot create or delete a customer, change an email or set a password. The customer resets the password through “Forgot your password?” in the storefront (email must be set up). A customer can delete their own account in the storefront, on the “Privacy and data” page; on a person's request an owner does it in Personal data.",
        },
      },
    ],
  },
  {
    id: "payments",
    topic: "sales",
    title: { uk: "Онлайн-оплата і повернення коштів", en: "Online payments and refunds" },
    summary: {
      uk: "Платіжні провайдери, панель оплати в замовленні, повернення коштів і платежі на перевірку.",
      en: "Payment providers, the payment panel of an order, refunds and the payments to review.",
    },
    keywords: {
      uk: ["оплата", "платіж", "повернення коштів", "рефанд", "монобанк", "карта"],
      en: ["payment", "refund", "money back", "monobank", "card", "provider"],
    },
    blocks: [
      { kind: "heading", id: "providers", text: { uk: "Провайдери", en: "Providers" } },
      {
        kind: "paragraph",
        text: {
          uk: "Які провайдери увімкнені, визначають налаштування сервера; ключі ніколи не вводять в адмінці. Без провайдера покупці не платять онлайн, а ви позначаєте замовлення оплаченими вручну.",
          en: "The server configuration decides which providers are on; keys are never entered in the admin. Without a provider shoppers cannot pay online and you mark orders paid by hand.",
        },
      },
      {
        kind: "warning",
        text: {
          uk: "Шаблон містить провайдер Monobank і тестовий провайдер «fake». «fake» лише для тестів: справжні гроші він не приймає. Monobank поки перевірено лише на імітаторі, не на справжньому рахунку; перед запуском попросіть розробника перевірити його з вашим договором. Екрани налаштувань не показують, який саме провайдер увімкнено; кожна спроба оплати в замовленні називає свого провайдера.",
          en: "The template has the Monobank provider and the test provider “fake”. “fake” is for tests only: it takes no real money. Monobank has so far been checked only against a simulator, not a real account; before launch, ask your developer to verify it with your merchant contract. The settings screens do not show which provider is on; each payment attempt on an order names its provider.",
        },
      },
      { kind: "heading", id: "panel", text: { uk: "Панель оплати", en: "The payment panel" } },
      {
        kind: "paragraph",
        text: {
          uk: "У замовленні панель показує кожну спробу оплати: статус, суму, повернення, провайдера, картку (лише система і 4 останні цифри) і журнал. «Перевірити статус» питає провайдера зараз.",
          en: "On an order, the panel shows every payment attempt: status, amount, refunds, the provider, the card (only the scheme and the last 4 digits) and the journal. “Check status” asks the provider now.",
        },
      },
      { kind: "heading", id: "refund", text: { uk: "Повернути кошти", en: "Refund" } },
      {
        kind: "steps",
        items: [
          {
            uk: "Замовлення → панель оплати → «Повернути кошти» (власник або менеджер).",
            en: "Order → payment panel → “Refund” (owner or manager).",
          },
          {
            uk: "Сума — від залишку, який ще можна повернути (можна менше: часткове повернення, якщо провайдер його підтримує). Причина обовʼязкова.",
            en: "The amount starts at what is still refundable (less is allowed: a partial refund, if the provider supports it). A reason is required.",
          },
          {
            uk: "Перевірте суму на кроці підтвердження і підтвердіть. Скасувати повернення не можна.",
            en: "Check the amount on the confirmation step and confirm. A refund cannot be undone.",
          },
        ],
      },
      {
        kind: "warning",
        text: {
          uk: "Якщо результат «невідомий», НЕ повертайте ту саму суму вдруге: фонова задача зʼясує його в провайдера. Повернення коштів не скасовує замовлення і не повертає товар на склад.",
          en: "If the result is “unknown”, do NOT refund the same amount again: a background job settles it with the provider. A refund neither cancels the order nor puts the goods back in stock.",
        },
      },
      {
        kind: "heading",
        id: "attention",
        text: { uk: "Платежі на перевірку", en: "Payments to review" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Список платежів, які потребують людини, з поясненням, що робити. Наприклад, оплата, що прийшла після скасування чи прострочення замовлення: магазин сам ставить у чергу її повне повернення. «Закрити пункт уваги» лише прибирає пункт зі списку і нічого не змінює в провайдера.",
          en: "The payments that need a person, each with what to do. For example a payment that arrived after the order was cancelled or expired: the shop queues its full refund by itself. “Close attention item” only removes it from the list and changes nothing at the provider.",
        },
      },
      { kind: "screen", route: "payments" },
    ],
  },
  {
    id: "shipping",
    topic: "sales",
    title: { uk: "Доставка, Нова пошта і накладні", en: "Shipping, Nova Post and waybills" },
    summary: {
      uk: "Способи доставки та їхні ціни, перевізники, накладні й відстеження.",
      en: "Delivery methods and their prices, carriers, waybills and tracking.",
    },
    keywords: {
      uk: ["доставка", "нова пошта", "відділення", "поштомат", "ттн", "трекінг", "самовивіз"],
      en: ["delivery", "nova post", "branch", "locker", "tracking", "pickup", "carrier"],
    },
    blocks: [
      { kind: "heading", id: "methods", text: { uk: "Способи доставки", en: "Delivery methods" } },
      {
        kind: "paragraph",
        text: {
          uk: "Види: доставка за адресою, пункт видачі (відділення або поштомат перевізника) і самовивіз із магазину. Назва й опис — для кожної мови, країни — двобуквеними кодами (UA). Новий спосіб створюється вимкненим.",
          en: "Kinds: delivery to an address, pickup point (a carrier's branch or locker) and store pickup. Title and description per language, countries as two-letter codes (UA). A new method starts switched off.",
        },
      },
      {
        kind: "warning",
        text: {
          uk: "Поки магазин пропонує хоча б один спосіб (увімкнений, з ціною у валюті магазину, а для пункту видачі — з перевізником, увімкненим на сервері), кожне оформлення замовлення з фізичним товаром мусить вибрати спосіб доставки. Без жодного такого способу оформлення йде без вибору доставки.",
          en: "While the shop offers at least one method (switched on, priced in the shop currency and, for a pickup point, with its carrier enabled on the server), every checkout of physical goods must choose a delivery method. With no such method, checkout runs without a delivery choice.",
        },
      },
      { kind: "heading", id: "pricing", text: { uk: "Ціна доставки", en: "Delivery price" } },
      {
        kind: "definitions",
        items: [
          {
            term: { uk: "Фіксована", en: "Flat" },
            definition: { uk: "Одна ціна.", en: "One price." },
          },
          {
            term: { uk: "Безкоштовно від суми", en: "Free above an amount" },
            definition: {
              uk: "Ціна, яка стає 0, коли сума кошика досягає порогу.",
              en: "A price that becomes 0 when the cart total reaches the threshold.",
            },
          },
          {
            term: { uk: "За сумою кошика", en: "Tiers" },
            definition: {
              uk: "До 20 рівнів: перший від 0, кожен наступний вищий.",
              en: "Up to 20 tiers: the first from 0, each next one higher.",
            },
          },
          {
            term: { uk: "Оплата перевізнику", en: "Paid to the carrier" },
            definition: {
              uk: "Магазин бере 0, одержувач платить перевізнику при отриманні.",
              en: "The shop charges 0, the recipient pays the carrier on delivery.",
            },
          },
        ],
      },
      { kind: "screen", route: "shipping" },
      { kind: "heading", id: "carriers", text: { uk: "Перевізники", en: "Carriers" } },
      {
        kind: "paragraph",
        text: {
          uk: "Ключі API перевізників задаються лише в налаштуваннях сервера, ніколи в адмінці. На екрані перевізника зберігається профіль без секретів (дані відправника, типова посилка) і є кнопка перевірки зʼєднання.",
          en: "Carrier API keys are set only in the server configuration, never in the admin. A carrier's screen keeps the profile without secrets (sender details, a default parcel) and has a connection test.",
        },
      },
      { kind: "screen", route: "shippingProviders" },
      { kind: "heading", id: "nova-post", text: { uk: "Нова пошта", en: "Nova Post" } },
      {
        kind: "warning",
        text: {
          uk: "Нова пошта підтримує лише пункти видачі (відділення й поштомати): немає доставки за адресою, накладеного платежу і кількох посилок. Підключення перевірено лише на імітаторі; створення накладної у справжньому сервісі ще не підтверджено. Справжній сервіс відповів на запит етикетки помилкою 422, тож «Друкувати етикетку» може не спрацювати (екран скаже, що сервіс недоступний). Тестовий перевізник «fake» — лише для тестів. Перед запуском перевірте все на реальному замовленні.",
          en: "Nova Post supports pickup points only (branches and lockers): no delivery to an address, no cash on delivery, no several parcels. The connection was checked only against a simulator; creating a waybill in the real service is not confirmed yet. The real service answered the label request with error 422, so “Print label” may fail (the screen says the service is unavailable). The test carrier “fake” is for tests only. Check everything with a real order before launch.",
        },
      },
      {
        kind: "heading",
        id: "shipments",
        text: { uk: "Накладні та відстеження", en: "Waybills and tracking" },
      },
      {
        kind: "steps",
        items: [
          {
            uk: "Замовлення (лише оплачене) → «Доставка і відправлення» → «Створити накладну»: вага, розміри, оголошена цінність.",
            en: "Order (paid only) → “Delivery and shipments” → “Create a waybill”: weight, dimensions, declared value.",
          },
          {
            uk: "Результат: створено (номер для відстеження), не вдалося (причина) або «результат невідомий» — тоді НЕ створюйте ще одну, а натисніть «Перевірити в перевізника».",
            en: "The result: created (a tracking number), failed (the reason) or “result unknown”: then do NOT create another, press “Check with the carrier”.",
          },
          {
            uk: "«Друкувати етикетку» завантажує PDF. «Оновити відстеження» питає перевізника зараз; фонова задача оновлює статуси й сама.",
            en: "“Print label” downloads a PDF. “Refresh tracking” asks the carrier now; a background job also updates the statuses by itself.",
          },
          {
            uk: "Створіть накладну до того, як позначите замовлення виконаним: для виконаного замовлення накладну створити не можна. Коли відправили, позначте його виконаним: накладна статус замовлення не змінює.",
            en: "Create the waybill before you mark the order fulfilled: a fulfilled order cannot get one. Once shipped, mark it fulfilled: a waybill does not change the order status.",
          },
        ],
      },
      {
        kind: "note",
        text: {
          uk: "«Скасувати накладну» можна, лише поки накладна в стані «Створено» (ще не в дорозі). Коли налаштовано пошту, покупець отримує лист із номером для відстеження.",
          en: "“Cancel the waybill” works only while the waybill is in the state “Created” (not yet in transit). When email is set up, the shopper receives a mail with the tracking number.",
        },
      },
    ],
  },
];
