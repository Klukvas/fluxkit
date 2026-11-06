import type { HelpArticle, HelpTopic } from "../help-model";

/** Topic "Catalog": product types, products, images, categories and brands, publishing, search. */
export const CATALOG_TOPIC: HelpTopic = {
  id: "catalog",
  title: { uk: "Каталог", en: "Catalog" },
};

export const CATALOG_ARTICLES: readonly HelpArticle[] = [
  {
    id: "product-types",
    topic: "catalog",
    title: { uk: "Типи товарів, атрибути та опції", en: "Product types, attributes and options" },
    summary: {
      uk: "Чим атрибут відрізняється від опції і як описати товари з розмірами та кольорами.",
      en: "How an attribute differs from an option, and how to describe products that come in sizes and colours.",
    },
    keywords: {
      uk: ["розмір", "колір", "характеристики", "властивості", "фільтри", "одяг"],
      // Whole phrases: a bare option name as a string is refused by the source guard (options are data, never code).
      en: [
        "sizes and colours",
        "colors of a product",
        "properties",
        "characteristics",
        "filters",
        "clothing",
      ],
    },
    blocks: [
      { kind: "heading", id: "product-types", text: { uk: "Тип товару", en: "Product type" } },
      {
        kind: "paragraph",
        text: {
          uk: "Тип товару — це шаблон: він визначає, які атрибути й опції мають товари цього типу. Тип вибирають один раз, коли створюють товар; змінити його потім не можна.",
          en: "A product type is a template: it decides which attributes and options the products of that type have. The type is chosen once, when a product is created; it cannot be changed later.",
        },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Позначка «Товари цього типу доставляються» вимкнена для цифрових товарів: варіанти таких товарів створюються без обліку залишків.",
          en: "“Products of this type are shipped” is off for digital goods: the variants of such products are created without stock counting.",
        },
      },
      { kind: "screen", route: "productTypes" },
      {
        kind: "heading",
        id: "attributes",
        text: { uk: "Атрибути описують товар", en: "Attributes describe the product" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Атрибут — це характеристика, яку покупець не вибирає: матеріал, довжина, країна виробництва. Види: текст, число з одиницею, так/ні, один вибір, кілька виборів, дата. Атрибут призначають типу на рівні товару (однаковий для всіх варіантів) або варіанта (свій у кожного варіанта) і можуть зробити обовʼязковим.",
          en: "An attribute is a characteristic the shopper does not choose: material, length, country of origin. Kinds: text, number with a unit, yes/no, one choice, several choices, date. An attribute is assigned to a type at product level (the same for all variants) or variant level (each variant has its own) and can be required.",
        },
      },
      {
        kind: "definitions",
        items: [
          {
            term: { uk: "Фільтр", en: "Filterable" },
            definition: {
              uk: "Атрибут стає фільтром у каталозі вітрини (працює, коли увімкнено пошук).",
              en: "The attribute becomes a filter in the storefront catalog (works when search is switched on).",
            },
          },
          {
            term: { uk: "Шукається", en: "Searchable" },
            definition: {
              uk: "Значення атрибута знаходить пошук вітрини.",
              en: "The storefront search finds the attribute's values.",
            },
          },
          {
            term: { uk: "Показувати у вітрині", en: "Visible on storefront" },
            definition: {
              uk: "Атрибут показується в картці товару.",
              en: "The attribute is shown on the product page.",
            },
          },
          {
            term: { uk: "Внутрішній", en: "Internal" },
            definition: {
              uk: "Лише для адмінки (наприклад, постачальник). Сервер ніколи не віддає його вітрині, тому внутрішній атрибут не може бути публічним.",
              en: "Admin only (for example the supplier). The server never sends it to the storefront, so an internal attribute cannot be public.",
            },
          },
          {
            term: { uk: "Порівнюється, сортується", en: "Comparable, sortable" },
            definition: {
              uk: "Зберігаються для майбутніх функцій; зараз вітрина їх не використовує.",
              en: "Stored for future features; the storefront does not use them today.",
            },
          },
        ],
      },
      { kind: "screen", route: "attributes" },
      {
        kind: "heading",
        id: "options",
        text: { uk: "Опції створюють варіанти", en: "Options create variants" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Опція — це те, що покупець вибирає перед покупкою: розмір, колір, обʼєм. Кожне поєднання значень опцій — окремий варіант зі своїм артикулом, ціною і залишком. Товар може мати до 3 опцій, по 1–30 значень, разом не більше 250 варіантів.",
          en: "An option is what the shopper chooses before buying: size, colour, volume. Each combination of option values is its own variant with its own SKU, price and stock. A product has at most 3 options with 1 to 30 values each, and at most 250 variants.",
        },
      },
      { kind: "screen", route: "options" },
      { kind: "heading", id: "example", text: { uk: "Приклад: одяг", en: "Example: clothing" } },
      {
        kind: "steps",
        items: [
          {
            uk: "Створіть опції «Розмір» (S, M, L) і «Колір» (білий, чорний).",
            en: "Create the options “Size” (S, M, L) and “Colour” (white, black).",
          },
          {
            uk: "Створіть атрибути «Матеріал» (один вибір) і «Догляд» (текст).",
            en: "Create the attributes “Material” (one choice) and “Care” (text).",
          },
          {
            uk: "Створіть тип «Футболка»: додайте обидві опції та обидва атрибути на рівні товару.",
            en: "Create the type “T-shirt”: add both options and both attributes at product level.",
          },
          {
            uk: "Створіть товар цього типу й виберіть розміри та кольори: вийде 6 варіантів (3 розміри × 2 кольори).",
            en: "Create a product of that type and choose the sizes and colours: you get 6 variants (3 sizes × 2 colours).",
          },
        ],
      },
      {
        kind: "warning",
        text: {
          uk: "Не робіть розмір атрибутом: покупець мусить його вибрати, і в кожного розміру свій залишок. Не робіть матеріал опцією, якщо він однаковий для всіх варіантів: це додасть зайві варіанти.",
          en: "Do not make the size an attribute: the shopper must choose it and each size has its own stock. Do not make the material an option when it is the same for every variant: that only adds useless variants.",
        },
      },
    ],
  },
  {
    id: "create-product",
    topic: "catalog",
    title: { uk: "Створення товару з варіантами", en: "Creating a product with variants" },
    summary: {
      uk: "Від нового товару до готових варіантів: вкладки редактора по черзі.",
      en: "From a new product to its variants: the editor's tabs in order.",
    },
    keywords: {
      uk: ["новий товар", "додати товар", "редактор", "артикул", "штрихкод"],
      en: ["new product", "add product", "editor", "sku", "barcode"],
    },
    blocks: [
      { kind: "heading", id: "create", text: { uk: "Новий товар", en: "A new product" } },
      {
        kind: "steps",
        items: [
          {
            uk: "Товари → «Новий товар».",
            en: "Products → “New product”.",
          },
          {
            uk: "Виберіть тип товару (потім його не змінити), введіть назву хоча б мовою за замовчуванням.",
            en: "Choose the product type (it cannot be changed later) and type the title, at least in the default language.",
          },
          {
            uk: "Адресу сторінки можна лишити порожньою: її створять із назви. Бренд і опис необовʼязкові.",
            en: "The page address may stay empty: it is made from the title. Brand and description are optional.",
          },
          {
            uk: "Після збереження відкрийте редактор за посиланням. Товар створено як чернетку з одним варіантом за замовчуванням.",
            en: "After saving, open the editor through the link. The product is created as a draft with one default variant.",
          },
        ],
      },
      { kind: "screen", route: "products" },
      { kind: "heading", id: "general", text: { uk: "Вкладка «Загальне»", en: "General tab" } },
      {
        kind: "paragraph",
        text: {
          uk: "Назва, опис (простий текст, без HTML), адреса сторінки і бренд. Зміна адреси сторінки міняє посилання на товар; старе посилання не перенаправляється. Окремих полів для SEO немає.",
          en: "Title, description (plain text, no HTML), page address and brand. Changing the page address changes the product's link; the old link does not redirect. There are no separate SEO fields.",
        },
      },
      {
        kind: "heading",
        id: "attributes",
        text: { uk: "Вкладка «Атрибути»", en: "Attributes tab" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Поля створюються з атрибутів типу рівня товару. Чернетку можна зберегти неповною; обовʼязкові атрибути потрібні для публікації.",
          en: "The fields come from the type's product-level attributes. A draft may be saved incomplete; required attributes are needed to publish.",
        },
      },
      {
        kind: "heading",
        id: "categories",
        text: { uk: "Вкладка «Категорії»", en: "Categories tab" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Додайте товар до однієї чи кількох категорій і позначте основну. Категорія для публікації не обовʼязкова.",
          en: "Add the product to one or more categories and mark the primary one. A category is not required to publish.",
        },
      },
      {
        kind: "heading",
        id: "options-variants",
        text: { uk: "Вкладка «Опції»", en: "Options tab" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "У чернетці позначте значення опцій і збережіть: магазин створить варіанти. Нові значення вже вибраних опцій лише додають варіанти.",
          en: "In a draft, tick the option values and save: the shop creates the variants. New values of options already chosen only add variants.",
        },
      },
      {
        kind: "warning",
        text: {
          uk: "Додавання чи видалення опції або видалення значення видаляє ВСІ варіанти і створює їх знову: артикули, штрихкоди, атрибути варіантів і ціни втрачаються. Якщо варіант уже мав рух складу чи замовлення, сервер таку зміну відхилить. В опублікованого товару опції заморожені: можна лише додати значення, і прибрати його потім не можна.",
          en: "Adding or removing an option, or removing a value, deletes ALL variants and creates them again: SKUs, barcodes, variant attributes and prices are lost. If a variant already has stock history or orders, the server refuses the change. A published product's options are frozen: you can only add a value, and it cannot be removed again.",
        },
      },
      { kind: "heading", id: "variants", text: { uk: "Вкладка «Варіанти»", en: "Variants tab" } },
      {
        kind: "steps",
        items: [
          {
            uk: "«Створити відсутні варіанти» створює поєднання, яких ще немає (повторне натискання нічого не дублює). Товар без опцій має лише один варіант, тому цих кнопок у нього немає: щоб продавати, наприклад, 50 г і 100 г, дозвольте опцію в типі товару й оберіть її значення на вкладці «Опції».",
            en: "“Generate missing variants” creates the combinations that do not exist yet (pressing it again duplicates nothing). A product without options has one variant only, so it has no such buttons: to sell, say, 50 g and 100 g, allow an option in the product type and choose its values on the Options tab.",
          },
          {
            uk: "Кнопка редагування в рядку: артикул, штрихкод, увімкнений, «Рахувати залишки», «Продавати понад наявний залишок», атрибути варіанта.",
            en: "The edit button of a row: SKU, barcode, active, “Count stock”, “Sell beyond the stock on hand”, the variant attributes.",
          },
          {
            uk: "Основний варіант («Зробити основним») показується першим; його не можна видалити, а в опублікованому товарі — і вимкнути.",
            en: "The default variant (“Make default”) is shown first; it cannot be deleted, and in a published product it cannot be switched off.",
          },
        ],
      },
      {
        kind: "note",
        text: {
          uk: "Видалити можна лише варіант чернетки, без руху складу і без замовлень. В інших випадках вимкніть його: вимкнений варіант не продається.",
          en: "Only a draft's variant without stock history and without orders can be deleted. Otherwise switch it off: a switched-off variant is not sold.",
        },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Ціни і залишки задаються на окремих вкладках: «Ціни» та «Залишки».",
          en: "Prices and stock have their own tabs: Prices and Stock.",
        },
      },
    ],
  },
  {
    id: "images",
    topic: "catalog",
    title: { uk: "Зображення товарів", en: "Product images" },
    summary: {
      uk: "Як завантажити зображення, впорядкувати їх і написати альтернативний текст.",
      en: "How to upload images, put them in order and write their alternative text.",
    },
    keywords: {
      uk: ["фото", "картинки", "медіа", "завантажити", "альт"],
      en: ["photos", "pictures", "media", "upload", "alt text"],
    },
    blocks: [
      { kind: "heading", id: "upload", text: { uk: "Додати зображення", en: "Adding images" } },
      {
        kind: "steps",
        items: [
          {
            uk: "Редактор товару → вкладка «Медіа».",
            en: "Product editor → Media tab.",
          },
          {
            uk: "«Завантажити зображення» (кілька файлів, до 20 за раз) або вставте адресу https зображення.",
            en: "“Upload images” (several files, up to 20 at a time) or paste the https address of an image.",
          },
          {
            uk: "Файли завантажуються по одному; дочекайтеся кінця черги.",
            en: "Files are uploaded one at a time; wait until the queue ends.",
          },
          {
            uk: "Натисніть «Зберегти зображення». Лише збереження додає зображення до товару.",
            en: "Press “Save the images”. Only saving attaches the images to the product.",
          },
        ],
      },
      {
        kind: "warning",
        text: {
          uk: "Завантажене, але не збережене зображення лишається на сервері невикористаним і видаляється через 24 години. Приймаються JPEG, PNG і WebP. Чи дозволене завантаження і який найбільший розмір — залежить від налаштувань сервера; коли завантаження вимкнене, додавайте зображення за адресою.",
          en: "An uploaded image that is not saved stays on the server unused and is deleted after 24 hours. Uploads accept JPEG, PNG and WebP. Whether uploads are allowed and the largest size depend on the server configuration; when uploads are off, add images by address.",
        },
      },
      {
        kind: "heading",
        id: "order-alt",
        text: { uk: "Порядок і опис", en: "Order and description" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Кнопки «Вище» і «Нижче» задають порядок. Альтернативний текст описує зображення для людей, які його не бачать; якщо він є хоч однією мовою, потрібен і мовою за замовчуванням. Зображення можна повʼязати зі значенням опції (наприклад, з чорним кольором).",
          en: "“Move up” and “Move down” set the order. The alternative text describes the image for people who cannot see it; once it is filled in one language, the default language is needed too. An image can be linked to an option value (for example the black colour).",
        },
      },
      { kind: "heading", id: "limits", text: { uk: "Обмеження", en: "Limits" } },
      {
        kind: "note",
        text: {
          uk: "До 100 зображень на товар. Адмінка показує попередній перегляд лише з дозволених серверів зображень; для інших показує текст замість картинки. Логотип бренду завантажують у формі бренду.",
          en: "Up to 100 images per product. The admin previews images only from the allowed image hosts; for others it shows a text instead. A brand logo is uploaded in the brand form.",
        },
      },
    ],
  },
  {
    id: "categories-brands",
    topic: "catalog",
    title: { uk: "Категорії та бренди", en: "Categories and brands" },
    summary: {
      uk: "Дерево категорій до пʼяти рівнів, переміщення, бренди з логотипами.",
      en: "The category tree up to five levels, moving categories, brands with logos.",
    },
    keywords: {
      uk: ["розділи", "дерево", "підкатегорія", "виробник", "логотип"],
      en: ["sections", "tree", "subcategory", "manufacturer", "logo"],
    },
    blocks: [
      { kind: "heading", id: "categories", text: { uk: "Категорії", en: "Categories" } },
      {
        kind: "steps",
        items: [
          {
            uk: "Каталог → Категорії. Розгорніть гілку кнопкою біля назви.",
            en: "Catalog → Categories. Expand a branch with the button next to its name.",
          },
          {
            uk: "«Додати підкатегорію» створює дочірню категорію; найбільша глибина — 5 рівнів.",
            en: "“Add subcategory” creates a child category; the deepest level is 5.",
          },
          {
            uk: "Щоб перенести категорію з підкатегоріями, відкрийте її та скористайтеся розділом «Переміщення».",
            en: "To move a category with its subcategories, open it and use the “Move” section.",
          },
        ],
      },
      {
        kind: "note",
        text: {
          uk: "Сторінка категорії у вітрині показує також товари її підкатегорій. Неактивна категорія прихована у вітрині разом із підкатегоріями. Категорію з підкатегоріями чи товарами, як і бренд, що ще використовується, видалити не можна: екран пояснить чому.",
          en: "A category page in the storefront also shows the products of its subcategories. An inactive category is hidden in the storefront together with its subcategories. A category with subcategories or products, like a brand still in use, cannot be deleted: the screen explains why.",
        },
      },
      { kind: "screen", route: "categories" },
      { kind: "heading", id: "brands", text: { uk: "Бренди", en: "Brands" } },
      {
        kind: "paragraph",
        text: {
          uk: "Бренд має назву, адресу й логотип (адреса https або «Завантажити логотип»). Бренд для публікації товару не обовʼязковий.",
          en: "A brand has a name, an address and a logo (an https address or “Upload logo”). A brand is not required to publish a product.",
        },
      },
      { kind: "screen", route: "brands" },
    ],
  },
  {
    id: "publishing",
    topic: "catalog",
    title: {
      uk: "Публікація: чому товар не публікується",
      en: "Publishing: why a product cannot be published",
    },
    summary: {
      uk: "Стани товару, умови публікації і як виправити кожну проблему.",
      en: "Product states, the publishing conditions and how to fix each problem.",
    },
    keywords: {
      uk: ["опублікувати", "зняти з публікації", "архів", "чернетка", "не видно у вітрині"],
      en: ["publish", "unpublish", "archive", "draft", "not visible in shop"],
    },
    blocks: [
      { kind: "heading", id: "statuses", text: { uk: "Стани товару", en: "Product states" } },
      {
        kind: "definitions",
        items: [
          {
            term: { uk: "Чернетка", en: "Draft" },
            definition: {
              uk: "Не видно у вітрині. Можна змінювати опції; товар, який ніколи не публікували, можна видалити.",
              en: "Not in the shop. Options can be changed; a product that was never published can be deleted.",
            },
          },
          {
            term: { uk: "Опубліковано", en: "Published" },
            definition: {
              uk: "Продається. «Зняти з публікації» повертає в чернетку.",
              en: "For sale. “Unpublish” turns it back into a draft.",
            },
          },
          {
            term: { uk: "Архів", en: "Archived" },
            definition: {
              uk: "Прихований, але збережений (адреса лишається за ним). «Відновити як чернетку» повертає його.",
              en: "Hidden but kept (its address stays reserved). “Restore as draft” brings it back.",
            },
          },
        ],
      },
      {
        kind: "heading",
        id: "rules",
        text: { uk: "Умови публікації", en: "Publishing conditions" },
      },
      {
        kind: "steps",
        items: [
          {
            uk: "Є назва мовою за замовчуванням і правильна адреса.",
            en: "A title in the default language and a valid address.",
          },
          {
            uk: "Рівно один варіант за замовчуванням, і він увімкнений; принаймні один увімкнений варіант.",
            en: "Exactly one default variant, and it is active; at least one active variant.",
          },
          {
            uk: "Кожен варіант має значення кожної опції та правильний унікальний артикул.",
            en: "Every variant has a value for every option and a valid, unique SKU.",
          },
          {
            uk: "Заповнені обовʼязкові атрибути товару і обовʼязкові атрибути кожного увімкненого варіанта.",
            en: "The required product attributes are filled in, and the required attributes of every active variant.",
          },
          {
            uk: "Кожен увімкнений варіант має ціну у валюті магазину.",
            en: "Every active variant has a price in the shop currency.",
          },
        ],
      },
      {
        kind: "note",
        text: {
          uk: "Не потрібні: категорія, бренд, зображення, залишок. Товар без залишку публікується і показується як «немає в наявності».",
          en: "Not needed: a category, a brand, images, stock. A product without stock is published and shown as “out of stock”.",
        },
      },
      { kind: "heading", id: "fix", text: { uk: "Як виправити", en: "How to fix it" } },
      {
        kind: "paragraph",
        text: {
          uk: "Коли публікацію відхилено, редактор перелічує всі проблеми одразу. Кнопка біля кожної відкриває потрібну вкладку й ставить курсор у поле. Виправте все і натисніть «Опублікувати» ще раз.",
          en: "When publishing is refused, the editor lists every problem at once. The button next to each opens the right tab and puts the cursor in the field. Fix them all and press “Publish” again.",
        },
      },
      {
        kind: "note",
        text: {
          uk: "Публікувати, знімати й архівувати може роль із правом публікації (власник, менеджер). У вітрині показуються лише ті варіанти, що увімкнені й мають ціну у валюті магазину.",
          en: "Publishing, unpublishing and archiving need the publish permission (owner, manager). The storefront shows only variants that are active and have a price in the shop currency.",
        },
      },
      { kind: "screen", route: "products" },
    ],
  },
  {
    id: "search",
    topic: "catalog",
    title: { uk: "Пошук у вітрині", en: "Storefront search" },
    summary: {
      uk: "Синоніми, перебудова індексу і що означає блок «Пропускна здатність пошуку в магазині».",
      en: "Synonyms, rebuilding the index and what the store search capacity block means.",
    },
    keywords: {
      uk: ["синоніми", "індекс", "перебудувати", "потужність", "знайти"],
      en: ["synonyms", "index", "reindex", "rebuild", "capacity", "find"],
    },
    blocks: [
      { kind: "heading", id: "how", text: { uk: "Як працює", en: "How it works" } },
      {
        kind: "paragraph",
        text: {
          uk: "Пошук вітрини працює через окремий пошуковий сервер. Він вмикається налаштуванням сервера; коли вимкнений, у вітрині немає поля пошуку, а екрани «Пошук» пишуть, що пошук вимкнено. Зміни товарів, цін і залишків потрапляють у пошук із найближчою синхронізацією, яку виконують фонові задачі (зазвичай протягом хвилини-двох, якщо їх увімкнено).",
          en: "The storefront search runs on a separate search server. It is switched on in the server configuration; when it is off, the storefront has no search box and the Search screens say so. Changes to products, prices and stock reach the search with the next sync, run by the background jobs (usually within a minute or two, when they are switched on).",
        },
      },
      { kind: "screen", route: "search" },
      { kind: "heading", id: "synonyms", text: { uk: "Синоніми", en: "Synonyms" } },
      {
        kind: "steps",
        items: [
          {
            uk: "Пошук → «Синоніми пошуку» → «Додати групу».",
            en: "Search → “Search synonyms” → “Add group”.",
          },
          {
            uk: "Виберіть мову і введіть слова через кому: 2–20 слів, кожне до 50 символів і до 3 слів.",
            en: "Choose the language and type the words separated by commas: 2 to 20 terms, each up to 50 characters and 3 words.",
          },
          {
            uk: "Збережіть. Група діє з наступною синхронізацією.",
            en: "Save. The group takes effect with the next sync.",
          },
        ],
      },
      { kind: "screen", route: "searchSynonyms" },
      {
        kind: "heading",
        id: "rebuild",
        text: { uk: "Перебудова індексу", en: "Rebuilding the index" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "«Перебудувати індекс» лише ставить запит. Фонова задача будує новий індекс і підміняє ним старий; до того вітрина шукає в старому. Перебудовуйте, коли екран стану радить це або на прохання розробника.",
          en: "“Rebuild index” only places a request. A background job builds a new index and swaps it in; until then the storefront searches the old one. Rebuild when the status screen advises it or your developer asks.",
        },
      },
      {
        kind: "heading",
        id: "capacity",
        text: { uk: "Навантаження на пошук", en: "Load on search" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Блок показує, скільки пошуків пошукова служба обробляє одночасно (ліміт одночасних запитів), найбільші значення і скільки пошуків відхилено та чому. Лічильники ведуться з останнього запуску сервера. Якщо пошуки часто відхиляються, а в сервера є вільна потужність процесора, розробник може збільшити ліміт у налаштуваннях.",
          en: "The block shows how many searches the search service handles at once (the concurrent request limit), the peaks, and how many searches were turned away and why. The counters run since the server last started. If searches are often turned away and the server has spare processor capacity, your developer can raise the limit in the configuration.",
        },
      },
      {
        kind: "note",
        text: {
          uk: "Бачать пошук усі ролі з правом читання каталогу; змінювати синоніми і перебудовувати може роль із правом змінювати каталог.",
          en: "Every role that reads the catalog sees Search; changing synonyms and rebuilding need the catalog write permission.",
        },
      },
    ],
  },
];
