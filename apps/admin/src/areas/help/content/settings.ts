import type { HelpArticle, HelpTopic } from "../help-model";

/** Topic "Settings": email, integrations, personal data requests, admin users and roles, the audit log. */
export const SETTINGS_TOPIC: HelpTopic = {
  id: "settings",
  title: { uk: "Налаштування", en: "Settings" },
};

export const SETTINGS_ARTICLES: readonly HelpArticle[] = [
  {
    id: "email",
    topic: "settings",
    title: { uk: "Електронна пошта і черга листів", en: "Email and the outbox" },
    summary: {
      uk: "Хто надсилає листи магазину, як перевірити доставку і що робити з листом, який не дійшов.",
      en: "Who sends the shop's mail, how to check delivery and what to do with a mail that did not arrive.",
    },
    keywords: {
      uk: ["лист", "пошта", "email", "розсилка", "не прийшов лист", "шаблон"],
      en: ["mail", "email", "message", "not received", "template", "resend"],
    },
    blocks: [
      { kind: "heading", id: "provider", text: { uk: "Постачальник пошти", en: "Mail provider" } },
      {
        kind: "paragraph",
        text: {
          uk: "Налаштування сервера задають основного постачальника та впорядкований резервний ланцюжок: наприклад, Resend, потім Brevo. Без постачальника магазин не надсилає листів, зокрема відновлення пароля. Резерв використовують лише після підтвердженої відмови без надсилання; відмова одержувачу або невідомий результат не дозволяють перейти до іншого сервісу.",
          en: "Server settings choose a primary provider and an ordered fallback chain, for example Resend followed by Brevo. Without a provider the shop sends no mail, including password resets. Fallback follows a proven refusal without submission; recipient rejection or an unknown outcome never permits switching services.",
        },
      },
      {
        kind: "warning",
        text: {
          uk: "«fake» лише для тестів і нічого не доставляє. Перед запуском власник домену з розробником перевіряють реальне надсилання та підтверджують домен відправника для кожного налаштованого сервісу (SPF, DKIM, DMARC). Brevo Free додає власне брендування та може прийняти лист у чергу з пізнішою доставкою; прибрати брендування можна на платному тарифі.",
          en: "“fake” is for tests only and delivers nothing. Before launch, the domain owner and developer check live sending and verify the sender domain for every configured service (SPF, DKIM, DMARC). Brevo Free adds its branding and may accept mail into a queue for later delivery; removing the branding requires a paid plan.",
        },
      },
      {
        kind: "heading",
        id: "status",
        text: { uk: "Стан і тестовий лист", en: "Status and test mail" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Екран «Електронна пошта» показує ланцюжок постачальників, їхні паузи та перевірку відновлення, відправника, зміни станів за 24 години, чергу й помилки. «Надіслати тестовий лист» перевіряє налаштований маршрут на вашу власну адресу (до 5 на годину). У черзі видно фактичного постачальника прийнятого листа та закріпленого або наступного постачальника.",
          en: "The Email screen shows the ordered provider chain, cooldowns and recovery probes, sender, status changes over 24 hours, queue and errors. “Send test email” tests the configured route to your own address (up to 5 an hour). The outbox shows the actual accepting provider and any pinned or next provider.",
        },
      },
      {
        kind: "heading",
        id: "usage",
        text: { uk: "Локальна статистика використання", en: "Local usage history" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Денні та місячні лічильники — збережені прийняті листи Fluxkit за календарними періодами UTC через цього постачальника, за всіма його обліковими записами. Очищення й стирання даних можуть зменшити число; невідомі результати та використання іншими програмами не враховані. Це нижня межа локальної історії, а не точний залишок поточного облікового запису. Зміни ключів і облікових записів поки не відстежуються.",
          en: "Daily and monthly counts are retained accepted Fluxkit sends in calendar UTC periods through that provider, across all accounts. Cleanup and erasure can lower them; unknown outcomes and other applications are outside these counts. This is a lower bound of local history, not the current account’s exact remaining balance. Key and account changes are not tracked yet.",
        },
      },
      {
        kind: "note",
        text: {
          uk: "Порівняння з установленим на сервері лімітом попереджає від 80% та від 100%; число може перевищувати ліміт. «Немає налаштованого ліміту» не означає необмежений тариф. Статистика не перемикає постачальників. Час скидання Brevo невідомий: його денний період UTC є правилом звіту Fluxkit.",
          en: "Comparison with the server-configured cap warns at 80% and 100%; counts can exceed the cap. “No configured limit” does not mean unlimited service. These counts never switch providers. Brevo’s reset time is unknown: its UTC day is Fluxkit’s reporting convention.",
        },
      },
      { kind: "screen", route: "email" },
      { kind: "heading", id: "messages", text: { uk: "Черга листів", en: "The outbox" } },
      {
        kind: "paragraph",
        text: {
          uk: "Кожен лист магазину спершу стає в чергу, а фонова задача надсилає його і за потреби повторює спробу. Стани: очікує відправлення, відправляється, відправлено, помилка, невідомо (могло бути відправлено), скасовано.",
          en: "Every mail of the shop first joins the queue, and a background job sends it and retries when needed. States: waiting to be sent, being sent, sent, failed, unknown (may have been sent), cancelled.",
        },
      },
      {
        kind: "steps",
        items: [
          {
            uk: "Покупець каже, що лист не прийшов: «Листи» → фільтр за адресою одержувача.",
            en: "A shopper says a mail did not arrive: Messages → filter by the recipient address.",
          },
          {
            uk: "«Відправлено» означає, що постачальник прийняв лист: попросіть перевірити спам.",
            en: "“Sent” means the provider accepted it: ask the shopper to check the spam folder.",
          },
          {
            uk: "«Помилка»: відкрийте лист, прочитайте причину і за потреби «Надіслати повторно» (створює новий лист).",
            en: "“Failed”: open the mail, read the reason and, if needed, “Resend” (it creates a new mail).",
          },
        ],
      },
      {
        kind: "note",
        text: {
          uk: "Листи облікового запису (відновлення пароля тощо) повторно не надсилаються: покупець просить новий. Закріплений лист або стан «Невідомо» означає, що попередня спроба могла бути прийнята. «Скасувати відправлення» зупиняє лише локальні повторні спроби: попередній лист ще може надійти. Повторне надсилання створює новий лист і може дати дублікат.",
          en: "Account mails (password reset and the like) cannot be resent: the shopper asks for a new one. Pinned mail or “Unknown” means an earlier attempt may have been accepted. “Cancel sending” stops local retries only: earlier mail may still arrive. Resending creates a new mail and can produce a duplicate.",
        },
      },
      { kind: "screen", route: "emailMessages" },
      { kind: "heading", id: "templates", text: { uk: "Шаблони", en: "Templates" } },
      {
        kind: "paragraph",
        text: {
          uk: "Листи: відновлення і зміна пароля, підтвердження email, оформлення, оплата, скасування і прострочення замовлення, створення відправлення, тестовий. «Шаблони» показують, як виглядає кожен лист на зразкових даних. Тексти листів змінює розробник; в адмінці їх не редагують.",
          en: "The mails: password reset and change, email confirmation, order placed, paid, cancelled and expired, shipment created, test. Templates shows how each mail looks with sample data. A developer changes the mail texts; they are not edited in the admin.",
        },
      },
      { kind: "screen", route: "emailTemplates" },
    ],
  },
  {
    id: "integrations",
    topic: "settings",
    title: { uk: "Інтеграції та ключі сервісів", en: "Integrations and service keys" },
    summary: {
      uk: "Де ввести ключі API сервісів пошти, оплати та доставки, як вони зберігаються і коли починають працювати.",
      en: "Where to enter the API keys of the email, payment and delivery services, how they are stored and when they start working.",
    },
    keywords: {
      uk: ["ключ", "токен", "інтеграція", "вебхук", "секрет", "api"],
      en: ["key", "token", "integration", "webhook", "secret", "api"],
    },
    blocks: [
      { kind: "heading", id: "keys", text: { uk: "Ключі сервісів", en: "Service keys" } },
      {
        kind: "paragraph",
        text: {
          uk: "Лише для власника. Екран «Інтеграції» показує встановлені сервіси пошти, оплати та доставки і для кожного ключа — чи його задано. Ключ можна ввести, замінити або вилучити. Сам ключ ніколи не показується знову: ні на екрані, ні у відповідях сервера.",
          en: "Owner only. The Integrations screen lists the installed email, payment and delivery services and, for each key, whether it is set. A key can be entered, replaced or removed. The key itself is never shown again: not on the screen and not in the server's answers.",
        },
      },
      {
        kind: "warning",
        text: {
          uk: "Для пошти збережений ключ вмикають з цього екрана. Коли Resend і Brevo обидва в ланцюжку відправки, екран ділить нові листи порівну або починає з Resend; це стосується і ланцюжка, заданого на сервері. Лист чекає, поки стартовий сервіс на паузі, і переходить до іншого лише після точної відмови прийняти. Таймаут і відхилення лишаються на тому сервісі. Вимкнення зупиняє нові листи; ті, що вже в дорозі, можуть дійти. Ключі оплати можна зберегти, перевірити й активувати з цього екрана. Заміна активного набору потребує окремої активації; вимкнення зупиняє нові платежі, але зберігає доступ для звірки та повернень попередніх платежів. Ключі доставки можна зберегти та перевірити; активація доставки з’явиться пізніше. Збереження або перевірка не вмикають сервіс.",
          en: "For email, turn a saved key on from this screen. When Resend and Brevo are both in the send chain, the screen shares new mail evenly or starts with Resend; a chain set on the server follows the same choice. A message waits while its starting provider is cooling down and moves to the other only after a definite non-acceptance. A timeout or a rejection stays on that provider. Turning a key off stops new mail; mail already on its way can finish. Payment keys can be saved, checked and activated here. Replacing an active bundle requires explicit activation; disabling stops new payments while retaining access for reconciliation and refunds of earlier payments. Delivery keys can be saved and checked; delivery activation arrives later. Saving or checking a key never enables a provider.",
        },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Версії показують збережені й відсутні поля. Для LiqPay публічний і приватний ключі одного магазину складають один набір; збереження одного поля переносить решту з поточної версії. «Перевірити» доступно лише для повного набору й не створює платежу чи відправлення. «Не перевірено» означає відсутність підтримуваної перевірки, а не неправильний ключ. Результат стосується лише зазначеної версії та часу й очищається після редагування.",
          en: "Versions show saved and missing fields. LiqPay's public and private keys from one shop form a single bundle; saving one field carries the others forward from the current version. Check is offered only for a complete bundle and creates no payment or shipment. Unverified means a supported check is unavailable, not that the key is invalid. A result applies only to that version and time and clears after editing.",
        },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Якщо сервіс пропонує середовища, виберіть його під час збереження ключа: зміна створює нову версію. Monobank не має такого перемикача. Для Nova Post потрібні також профіль і способи доставки; відстеження працює опитуванням без вебхуків. Попередні версії залишаються у списку: «Відкликати» зупиняє їх використання локально й може перервати пов’язані операції. Окремо відкличте ключ у кабінеті постачальника.",
          en: "If the service offers environments, select one while saving the key: a change creates a new version. Monobank has no such selector. Nova Post also needs a shipping profile and methods; tracking uses polling without webhooks. Retained versions remain listed: Revoke ends their local use and may interrupt bound work. Revoke the key in the provider's dashboard separately.",
        },
      },
      {
        kind: "warning",
        text: {
          uk: "Перше успішне збереження ключа Monobank назавжди закріплює продавця для цього магазину. Кожну заміну перевіряють без списання коштів: ключ іншого продавця не збережеться. Окремий секрет вебхука Monobank не потрібен. Вимкнення або відкликання ключа не скидає прив’язку продавця. LiqPay потребує публічного та приватного ключів одного магазину; безпечної онлайн-перевірки для нього поки немає, тому «Не перевірено» є очікуваним результатом.",
          en: "The first successful Monobank key save permanently enrolls the merchant for this shop. Every replacement is checked without charging: a key from another merchant is refused. Monobank needs no separate webhook secret. Disabling or revoking a key never resets the merchant lock. LiqPay needs the public and private keys of the same shop; it has no supported harmless online check yet, so Unverified is expected.",
        },
      },
      { kind: "screen", route: "integrations" },
      {
        kind: "heading",
        id: "storage",
        text: { uk: "Як зберігаються ключі", en: "How keys are stored" },
      },
      {
        kind: "definitions",
        items: [
          {
            term: { uk: "Не задано", en: "Not set" },
            definition: {
              uk: "Ключа немає ні на сервері, ні серед збережених.",
              en: "There is no key on the server and none saved.",
            },
          },
          {
            term: { uk: "Збережено, ще не активний", en: "Saved, not active yet" },
            definition: {
              uk: "Ключ збережено зашифрованим. Ключ шифрування зберігається на сервері, а не в базі даних; якщо його змінити, збережені значення доведеться ввести знову.",
              en: "The key is stored encrypted. The encryption key lives on the server, not in the database; if it is changed, the saved values have to be entered again.",
            },
          },
          {
            term: { uk: "Задано на сервері", en: "Set on the server" },
            definition: {
              uk: "Значення задано в налаштуваннях сервера. Тут воно лише для перегляду; змінює його розробник на сервері.",
              en: "The value is set in the server settings. It is read-only here; the developer changes it on the server.",
            },
          },
        ],
      },
      {
        kind: "note",
        text: {
          uk: "Якщо на сервері не налаштовано ключ шифрування, екран попереджає про це і зберегти нічого не можна.",
          en: "If the server has no encryption key configured, the screen says so and nothing can be saved.",
        },
      },
      {
        kind: "heading",
        id: "password",
        text: { uk: "Підтвердження паролем", en: "Password confirmation" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "Кожне збереження та вилучення ключа запитує ваш поточний пароль. Спроб небагато: до п’яти за 15 хвилин, разом із невдалими. Збереження, вилучення і неправильний пароль записуються в журнал дій — без самого ключа.",
          en: "Every save and every removal of a key asks for your current password. The attempts are few: up to five in 15 minutes, failed ones included. A save, a removal and a wrong password are written to the audit log, without the key itself.",
        },
      },
    ],
  },
  {
    id: "personal-data",
    topic: "settings",
    title: { uk: "Запити щодо персональних даних", en: "Personal data requests" },
    summary: {
      uk: "Як видати людині її дані або стерти їх, що стирається, а що залишається.",
      en: "How to give a person their data or erase it, what is erased and what stays.",
    },
    keywords: {
      uk: ["gdpr", "персональні дані", "видалити дані", "експорт", "стерти", "конфіденційність"],
      en: ["gdpr", "personal data", "delete data", "export", "erase", "privacy"],
    },
    blocks: [
      {
        kind: "warning",
        text: {
          uk: "Це не юридична консультація. Правила видалення, строки зберігання і тексти для покупців ще мають перевірити юрист і бухгалтер. Адмінка не гарантує відповідності закону: вона лише виконує дії.",
          en: "This is not legal advice. The erasure rules, the retention periods and the texts shoppers see still have to be checked by a lawyer and an accountant. The admin does not guarantee legal compliance: it only carries out the actions.",
        },
      },
      { kind: "heading", id: "who", text: { uk: "Хто що робить", en: "Who does what" } },
      {
        kind: "paragraph",
        text: {
          uk: "Покупець з обліковим записом робить усе сам у вітрині на сторінці «Конфіденційність і дані»: завантажує свої дані або видаляє обліковий запис. Запити гостей і листи від людей обробляє власник (лише роль «Власник»). Строк відповіді — 30 днів; екран показує дату і позначає прострочені запити.",
          en: "A shopper with an account does it all in the storefront on the “Privacy and data” page: downloads their data or deletes the account. Requests of guests and letters from people are handled by an owner (the Owner role only). The answer is due in 30 days; the screen shows the date and marks overdue requests.",
        },
      },
      {
        kind: "heading",
        id: "requests",
        text: { uk: "Записати запит", en: "Recording a request" },
      },
      {
        kind: "steps",
        items: [
          {
            uk: "Переконайтеся, що людина керує цією адресою (наприклад, відповівши на лист із неї). Не завантажуйте документи в систему.",
            en: "Check that the person controls the address (for example by replying to a mail from it). Do not upload documents into the system.",
          },
          {
            uk: "Персональні дані → «Пошук за email»: введіть адресу. Видно обліковий запис, гостьові замовлення, листи й відкриті запити; пошук записується в журнал дій.",
            en: "Personal data → “Look up by email”: type the address. You see the account, guest orders, mails and open requests; the lookup is written to the audit log.",
          },
          {
            uk: "«Записати запит» (експорт або стирання) і в примітці вкажіть, як перевірили особу, без персональних даних.",
            en: "“Record the request” (export or erasure) and note how you checked the identity, without personal data.",
          },
          {
            uk: "Відкрийте запит. Запит зберігає лише хеш адреси, тож введіть адресу ще раз.",
            en: "Open the request. It keeps only a hash of the address, so type the address again.",
          },
        ],
      },
      { kind: "screen", route: "privacyLookup" },
      { kind: "heading", id: "export", text: { uk: "Експорт", en: "Export" } },
      {
        kind: "paragraph",
        text: {
          uk: "«Завантажити персональні дані» зберігає файл JSON. У ньому персональні дані: передайте його лише цій людині надійним каналом і видаліть свою копію.",
          en: "“Download the personal data” saves a JSON file. It holds personal data: send it only to that person over a channel you trust, and delete your copy.",
        },
      },
      { kind: "heading", id: "erasure", text: { uk: "Стирання", en: "Erasure" } },
      {
        kind: "steps",
        items: [
          {
            uk: "«Переглянути, що буде стерто»: екран покаже, що заважає (неоплачене або оплачене й не виконане замовлення, платіж чи повернення в процесі, активне відправлення, лист, що надсилається). Завершіть це і перегляньте знову.",
            en: "“Preview the erasure”: the screen shows what is in the way (an order awaiting payment, or paid and not fulfilled, a payment or refund in progress, an active shipment, a mail being sent). Settle it and preview again.",
          },
          {
            uk: "«Стерти...» відкриває вікно з переліком, що буде видалено і що залишиться. Введіть показане слово і підтвердьте.",
            en: "“Erase...” opens a dialog listing what is deleted and what stays. Type the shown word and confirm.",
          },
        ],
      },
      {
        kind: "warning",
        text: {
          uk: "Стирання не можна скасувати. Видаляються обліковий запис із сесіями, кошиком і листами; у замовленнях стираються імена, email, телефон і адреси (крім країни). Залишаються номери, позиції, суми, дати, платежі й відправлення. Стирання не торкається резервних копій і даних, уже переданих перевізнику, платіжному сервісу чи поштовому постачальнику.",
          en: "Erasure cannot be undone. The account with its sessions, cart and mails is deleted; in orders the names, email, phone and addresses (except the country) are erased. Numbers, lines, totals, dates, payments and shipments stay. Erasure does not reach backups or data already sent to the carrier, the payment service or the mail provider.",
        },
      },
      {
        kind: "note",
        text: {
          uk: "Запит, на який не можна чи не слід відповідати (особу не підтверджено, дубль), «Відхилити запит» з причиною. Автоматичне стирання контактів старих замовлень вмикається налаштуванням сервера (строк зберігання); за замовчуванням вимкнене.",
          en: "A request you cannot or must not act on (identity not confirmed, a duplicate): “Reject the request” with a reason. Automatic erasure of old orders' contact data is switched on by a server setting (the retention period); it is off by default.",
        },
      },
      { kind: "screen", route: "privacy" },
    ],
  },
  {
    id: "users-roles",
    topic: "settings",
    title: { uk: "Адміністратори та ролі", en: "Admin users and roles" },
    summary: {
      uk: "Ролі «Власник», «Менеджер», «Переглядач»; як додати людину, змінити роль, скинути пароль.",
      en: "The roles Owner, Manager and Viewer; how to add a person, change a role, reset a password.",
    },
    keywords: {
      uk: ["користувачі", "доступ", "права", "пароль", "співробітник", "роль"],
      en: ["users", "access", "permissions", "password", "staff", "role"],
    },
    blocks: [
      { kind: "heading", id: "roles", text: { uk: "Ролі", en: "Roles" } },
      {
        kind: "definitions",
        items: [
          {
            term: { uk: "Власник", en: "Owner" },
            definition: {
              uk: "Усе, зокрема адміністратори, персональні дані і журнал дій.",
              en: "Everything, including admin users, personal data and the audit log.",
            },
          },
          {
            term: { uk: "Менеджер", en: "Manager" },
            definition: {
              uk: "Каталог із публікацією, замовлення, клієнти, доставка, пошта, повернення коштів. Без адміністраторів, персональних даних і журналу дій.",
              en: "Catalog including publishing, orders, customers, shipping, email, refunds. No admin users, personal data or audit log.",
            },
          },
          {
            term: { uk: "Переглядач", en: "Viewer" },
            definition: {
              uk: "Лише перегляд каталогу. Не бачить замовлень і клієнтів, бо там персональні дані.",
              en: "Reads the catalog only. Does not see orders or customers, because they hold personal data.",
            },
          },
        ],
      },
      { kind: "heading", id: "add", text: { uk: "Додати людину", en: "Adding a person" } },
      {
        kind: "steps",
        items: [
          {
            uk: "Адміністратори → «Створити адміністратора»: email, роль і початковий пароль (12–128 символів; кнопка генерує надійний).",
            en: "Admin users → “Create an admin user”: email, role and an initial password (12 to 128 characters; a button generates a strong one).",
          },
          {
            uk: "Передайте пароль особисто: магазин не надсилає запрошень, і пароль більше ніде не показується.",
            en: "Hand the password over in person: the shop sends no invitation and does not show the password again.",
          },
          {
            uk: "Людина входить і змінює пароль у «Мій обліковий запис».",
            en: "The person signs in and changes the password under “My account”.",
          },
        ],
      },
      { kind: "screen", route: "users" },
      { kind: "heading", id: "change", text: { uk: "Змінити доступ", en: "Changing access" } },
      {
        kind: "paragraph",
        text: {
          uk: "Нова роль діє з наступного запиту. Деактивація завершує всі сесії і забороняє вхід; видалення немає. Скидання пароля завершує всі сесії і знімає блокування входу. Принаймні один активний власник має лишатися: спершу зробіть власником когось іншого.",
          en: "A new role applies from the next request. Deactivating ends all sessions and refuses sign-in; there is no delete. A password reset ends all sessions and clears the sign-in lock. At least one active owner must remain: make someone else an owner first.",
        },
      },
      {
        kind: "heading",
        id: "own-account",
        text: { uk: "Ваш обліковий запис", en: "Your own account" },
      },
      {
        kind: "paragraph",
        text: {
          uk: "У «Мій обліковий запис» ви змінюєте свій пароль; інші ваші сесії завершуються. Після 5 невдалих спроб входу обліковий запис блокується на 15 хвилин.",
          en: "Under “My account” you change your own password; your other sessions end. After 5 failed sign-ins the account is locked for 15 minutes.",
        },
      },
      { kind: "screen", route: "account" },
      {
        kind: "warning",
        text: {
          uk: "Двофакторного входу і зміни email немає. Якщо жоден власник не може увійти, розробник на сервері створює нового власника або знімає блокування командою.",
          en: "There is no two-factor sign-in and no email change. If no owner can sign in, a developer creates a new owner or clears the lock with a command on the server.",
        },
      },
    ],
  },
  {
    id: "audit-log",
    topic: "settings",
    title: { uk: "Журнал дій", en: "Audit log" },
    summary: {
      uk: "Що записує журнал дій, що ні, і як шукати.",
      en: "What the audit log records, what it does not, and how to search it.",
    },
    keywords: {
      uk: ["історія", "хто змінив", "аудит", "журнал"],
      en: ["history", "who changed", "audit", "log"],
    },
    blocks: [
      { kind: "heading", id: "what", text: { uk: "Що записується", en: "What is recorded" } },
      {
        kind: "paragraph",
        text: {
          uk: "Лише для власника. Дії з клієнтами (деактивація, активація, розблокування), з адміністраторами (створення, зміна ролі, деактивація, активація, скидання пароля) і з персональними даними (пошук, експорт, стирання, зміни запитів), а також із ключами інтеграцій (збереження, вилучення, неправильний пароль під час такої дії). Журнал зберігає коди та ідентифікатори, без імен і адрес, і його не можна змінити.",
          en: "Owner only. Actions on customers (deactivate, activate, unlock), on admin users (create, role change, deactivate, activate, password reset) and on personal data (lookup, export, erasure, request changes), and on integration keys (save, remove, a wrong password on such an action). The log keeps codes and ids, no names or addresses, and cannot be changed.",
        },
      },
      { kind: "heading", id: "filters", text: { uk: "Пошук", en: "Searching" } },
      {
        kind: "paragraph",
        text: {
          uk: "Фільтри: дія, хто виконав, чого стосується, дати (за часовим поясом браузера). Новіші події вгорі; «Завантажити старіші події» додає наступну сторінку.",
          en: "Filters: action, who did it, what it concerns, dates (in the browser's time zone). Newest first; “Load older events” adds the next page.",
        },
      },
      { kind: "screen", route: "auditLog" },
      {
        kind: "heading",
        id: "limits",
        text: { uk: "Чого в журналі немає", en: "What is not in the log" },
      },
      {
        kind: "note",
        text: {
          uk: "Зміни каталогу і цін не журналюються. Залишки, замовлення, платежі й відправлення мають власну історію з тим, хто діяв: журнал залишків, історію замовлення, журнал оплати. Коли налаштовано строк зберігання, події старші за 365 днів видаляються.",
          en: "Catalog and price changes are not logged. Stock, orders, payments and shipments have their own history with who acted: the stock journal, the order history, the payment journal. When a retention period is set, events older than 365 days are deleted.",
        },
      },
    ],
  },
];
