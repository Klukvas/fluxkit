import type { HelpArticle, HelpTopic } from "../help-model";

/** Topic "Storefront": what the shop shows besides the catalog (home page banners). */
export const STOREFRONT_TOPIC: HelpTopic = {
  id: "storefront",
  title: { uk: "Вітрина", en: "Storefront" },
};

export const STOREFRONT_ARTICLES: readonly HelpArticle[] = [
  {
    id: "home-banners",
    topic: "storefront",
    title: { uk: "Банери головної сторінки", en: "Home page banners" },
    summary: {
      uk: "Як створити рекламні картки головної сторінки, задати їх порядок і час показу.",
      en: "How to create the promotional cards of the home page, set their order and when they are shown.",
    },
    keywords: {
      uk: ["акція", "реклама", "промо", "розпродаж", "картка", "головна сторінка", "слайдер"],
      en: ["promotion", "advert", "promo", "sale", "card", "home page", "slider", "hero"],
    },
    blocks: [
      {
        kind: "paragraph",
        text: {
          uk: "Банери — це рекламні картки на головній сторінці магазину, кожна з одним посиланням. Магазин зберігає до 50 банерів, разом із вимкненими й завершеними, а показує одночасно лише перші три, які показуються зараз, у порядку списку.",
          en: "Banners are the promotional cards on the shop's home page, each with one link. The shop keeps up to 50 banners, switched off and ended ones included, and shows only the first three that are live now, in the order of the list.",
        },
      },
      { kind: "screen", route: "banners" },
      { kind: "heading", id: "create", text: { uk: "Новий банер", en: "A new banner" } },
      {
        kind: "steps",
        items: [
          {
            uk: "Відкрийте «Вітрина» → «Банери головної» і натисніть «Новий банер».",
            en: "Open Storefront → Home banners and choose New banner.",
          },
          {
            uk: "Виберіть вигляд: «Картка» (зображення, заголовок і текст у кольорах магазину) або «Лише зображення» (готове зображення, яке ви створили самі).",
            en: "Choose the layout: Card (picture, title and text in the shop's colours) or Picture only (a finished picture you designed yourself).",
          },
          {
            uk: "Завантажте основне зображення. За потреби завантажте окреме зображення для кожної мови; мова без власного зображення показує основне.",
            en: "Upload the main picture. If needed, upload a separate picture for each language; a language without its own picture shows the main one.",
          },
          {
            uk: "Заповніть тексти кожною мовою, вкажіть посилання і, якщо треба, дати початку й завершення показу.",
            en: "Fill in the texts in each language, enter the link and, if needed, the start and end of the showing.",
          },
          {
            uk: "Позначте «Показувати цей банер на головній сторінці» і збережіть. Праворуч від форми видно приблизний попередній перегляд кожною мовою, у світлій і темній темі, на телефоні й компʼютері.",
            en: "Tick Show this banner on the home page and save. Next to the form you see an approximate preview in each language, in the light and dark theme, on a phone and a computer.",
          },
        ],
      },
      {
        kind: "note",
        text: {
          uk: "Щоб увімкнути банер, кожна мова потребує заголовка (картка) або опису зображення (лише зображення): так жоден покупець не побачить банер іншою мовою.",
          en: "To switch a banner on, every language needs its title (card) or its picture description (picture only), so no shopper sees a banner named in another language.",
        },
      },
      { kind: "heading", id: "pictures", text: { uk: "Зображення", en: "Pictures" } },
      {
        kind: "paragraph",
        text: {
          uk: "Вітрина показує зображення в рамці з пропорціями 2:1, наприклад 1280 × 640 пікселів. Зображення інших пропорцій обрізається, тому тримайте головне посередині; форма показує справжній розмір і попереджає, якщо пропорції не 2:1.",
          en: "The storefront shows the picture in a frame of proportions 2:1, for example 1280 × 640 pixels. A picture of other proportions is cropped, so keep the important part in the middle; the form shows the real size and warns when the proportions are not 2:1.",
        },
      },
      {
        kind: "warning",
        text: {
          uk: "Текст на зображенні не читають програми зчитування з екрана й пошукові системи. Для вигляду «Лише зображення» напишіть ті самі слова в описі зображення кожною мовою: цей опис є назвою посилання.",
          en: "Screen readers and search engines do not read the text inside a picture. For the Picture only layout, write the same words in the picture description of each language: that description is the name of the link.",
        },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Власний HTML-код, вбудовані сторінки чи скрипти в банер вставити не можна — так задумано: це захищає покупців і тримає вітрину доступною. Свободу дизайну дає вигляд «Лише зображення».",
          en: "You cannot paste your own HTML code, embedded pages or scripts into a banner, by design: this protects shoppers and keeps the storefront accessible. The Picture only layout gives you freedom of design.",
        },
      },
      { kind: "heading", id: "links", text: { uk: "Посилання", en: "Links" } },
      {
        kind: "paragraph",
        text: {
          uk: "Посилання — це сторінка магазину без мови, наприклад /catalog (магазин сам додає мову покупця), або повна адреса, що починається з https://.",
          en: "The link is a page of the shop without the language, for example /catalog (the shop adds the shopper's language itself), or a full address that starts with https://.",
        },
      },
      {
        kind: "warning",
        text: {
          uk: "Адреса https:// іншого сайту виводить покупця з магазину. Перевіряйте такі посилання: магазин не керує тим, що показує інший сайт.",
          en: "An https:// address of another site takes the shopper out of the shop. Check such links: the shop has no control over what another site shows.",
        },
      },
      {
        kind: "heading",
        id: "order",
        text: { uk: "Порядок і час показу", en: "Order and showing time" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Змінюйте порядок кнопками «Вище» і «Нижче» (працюють і з клавіатури) або перетягніть рядок мишею. Позначка «Показується на вітрині» стоїть біля перших трьох банерів, які показуються зараз.",
          en: "Change the order with the Move up and Move down buttons (they work with the keyboard too) or drag a row with the mouse. The Shown on the storefront mark is next to the first three banners that are live now.",
        },
      },
      {
        kind: "definitions",
        items: [
          {
            term: { uk: "Показується зараз", en: "Live now" },
            definition: {
              uk: "Увімкнений, і зараз між датами початку й завершення (або дат немає).",
              en: "Switched on, and now is between its start and end (or it has none).",
            },
          },
          {
            term: { uk: "Заплановано", en: "Scheduled" },
            definition: {
              uk: "Увімкнений, але час початку ще не настав.",
              en: "Switched on, but its start has not come yet.",
            },
          },
          {
            term: { uk: "Завершено", en: "Ended" },
            definition: {
              uk: "Увімкнений, але час завершення минув.",
              en: "Switched on, but its end has passed.",
            },
          },
          {
            term: { uk: "Вимкнено", en: "Switched off" },
            definition: {
              uk: "Не показується, хоч би які були дати.",
              en: "Not shown, whatever its dates.",
            },
          },
        ],
      },
      {
        kind: "note",
        text: {
          uk: "Час вводиться в часовому поясі вашого компʼютера, форма його показує. Вітрина оновлює банери із затримкою до 60 секунд, тому новий банер, зміна чи кінець показу зʼявляються там до хвилини пізніше.",
          en: "Times are entered in your computer's time zone, which the form shows. The storefront refreshes the banners with a delay of up to 60 seconds, so a new banner, a change or the end of a showing appears there up to a minute later.",
        },
      },
      {
        kind: "note",
        text: {
          uk: "Тексти банерів публічні: не пишіть у них персональних даних.",
          en: "Banner texts are public: do not write personal data into them.",
        },
      },
    ],
  },
];
