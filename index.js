require("dotenv").config();

const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const BOT_VERSION = "4.0.0";
const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const DATABASE_URL = process.env.DATABASE_URL;

const GRAPH_API_VERSION =
  process.env.GRAPH_API_VERSION || "v26.0";

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  "https://aca-whatsapp-bot.onrender.com";

const HUMAN_HANDOFF_MINUTES = Number(
  process.env.HUMAN_HANDOFF_MINUTES || "30"
);

const MENU_URL = `${PUBLIC_BASE_URL}/menu.pdf`;


// ======================================================
// AMINA CAFE
// ======================================================

const CAFE = {
  name: "Amina Cafe",

  workHours: "10:00–00:00",

  musicHours: "19:00–23:00",

  deliveryHours: "10:00–22:30",

  address:
    "ул. Суюнбая, 34, 40600/B34C6P0\n" +
    "с. Узынагаш, Алматинская область\n" +
    "1 этаж",

  mapUrl:
    "https://2gis.kz/almaty/geo/70000001086742095/76.327236,43.211271",

  bookingPhone:
    "8 705 286 57 88",

  deliveryPhone:
    "8 777 488 21 41",

  instagram:
    "@cafe_amina"
};


// ======================================================
// POSTGRESQL
// ======================================================

let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL
  });
}


async function initDatabase() {
  if (!pool) {
    console.warn(
      "⚠️ DATABASE_URL отсутствует. Работаем без постоянной памяти."
    );

    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_sessions (
      phone VARCHAR(32) PRIMARY KEY,
      language VARCHAR(5) NOT NULL DEFAULT 'ru',
      human_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log("🗄 PostgreSQL connected ✅");
}


// ======================================================
// FALLBACK-ПАМЯТЬ
// если база временно недоступна
// ======================================================

const memorySessions = new Map();


function defaultSession(phone) {
  return {
    phone,
    language: "ru",
    humanUntil: null
  };
}


// ======================================================
// СЕССИЯ КЛИЕНТА
// ======================================================

async function getSession(phone) {
  if (!pool) {
    if (!memorySessions.has(phone)) {
      memorySessions.set(
        phone,
        defaultSession(phone)
      );
    }

    return memorySessions.get(phone);
  }

  const result = await pool.query(
    `
    SELECT
      phone,
      language,
      human_until
    FROM bot_sessions
    WHERE phone = $1
    `,
    [phone]
  );

  if (result.rows.length > 0) {
    const row = result.rows[0];

    return {
      phone: row.phone,

      language:
        row.language || "ru",

      humanUntil:
        row.human_until
          ? new Date(row.human_until)
          : null
    };
  }

  await pool.query(
    `
    INSERT INTO bot_sessions
      (phone, language)
    VALUES
      ($1, 'ru')
    ON CONFLICT (phone)
    DO NOTHING
    `,
    [phone]
  );

  return defaultSession(phone);
}


// ======================================================
// СОХРАНЕНИЕ ЯЗЫКА
// ======================================================

async function saveLanguage(
  phone,
  language
) {
  if (!pool) {
    const session =
      await getSession(phone);

    session.language =
      language;

    memorySessions.set(
      phone,
      session
    );

    return;
  }

  await pool.query(
    `
    INSERT INTO bot_sessions
      (
        phone,
        language,
        updated_at
      )
    VALUES
      (
        $1,
        $2,
        NOW()
      )

    ON CONFLICT (phone)

    DO UPDATE SET
      language = EXCLUDED.language,
      updated_at = NOW()
    `,
    [
      phone,
      language
    ]
  );
}


// ======================================================
// РЕЖИМ СОТРУДНИКА
// ======================================================

async function enableHumanMode(
  phone
) {
  const humanUntil =
    new Date(
      Date.now() +
      HUMAN_HANDOFF_MINUTES *
      60 *
      1000
    );

  if (!pool) {
    const session =
      await getSession(phone);

    session.humanUntil =
      humanUntil;

    memorySessions.set(
      phone,
      session
    );

    return;
  }

  await pool.query(
    `
    INSERT INTO bot_sessions
      (
        phone,
        human_until,
        updated_at
      )

    VALUES
      (
        $1,
        $2,
        NOW()
      )

    ON CONFLICT (phone)

    DO UPDATE SET
      human_until =
        EXCLUDED.human_until,

      updated_at =
        NOW()
    `,
    [
      phone,
      humanUntil
    ]
  );
}


async function disableHumanMode(
  phone
) {
  if (!pool) {
    const session =
      await getSession(phone);

    session.humanUntil =
      null;

    memorySessions.set(
      phone,
      session
    );

    return;
  }

  await pool.query(
    `
    UPDATE bot_sessions
    SET
      human_until = NULL,
      updated_at = NOW()
    WHERE phone = $1
    `,
    [phone]
  );
}


function isHumanMode(
  session
) {
  if (!session.humanUntil) {
    return false;
  }

  return (
    new Date(
      session.humanUntil
    ).getTime()
    >
    Date.now()
  );
}


// ======================================================
// ТЕКСТ
// ======================================================

function normalizeText(text) {
  return (text || "")
    .trim()
    .toLowerCase();
}


function looksKazakh(text) {
  return /[әғқңөұүһі]/i
    .test(text || "");
}


// ======================================================
// ЕДИНЫЙ ДИЗАЙН
// ======================================================

function menuOptions(lang) {
  if (lang === "kk") {
    return `1 — 📋 Мәзір
2 — 🕐 Жұмыс уақыты және байланыс
3 — 👨‍💼 Қызметкермен сөйлесу
4 — 🇷🇺 Русский

0 — 🏠 Басты мәзір`;
  }

  return `1 — 📋 Меню
2 — 🕐 Время работы и контакты
3 — 👨‍💼 Связаться с сотрудником
4 — 🌐 Қазақша

0 — 🏠 Главное меню`;
}


// ======================================================
// ГЛАВНОЕ МЕНЮ
// ======================================================

function mainMenu(lang) {
  if (lang === "kk") {
    return `Сәлеметсіз бе! 👋
${CAFE.name}-ге қош келдіңіз.

Қажетті бөлімді таңдаңыз:

${menuOptions("kk")}`;
  }

  return `Здравствуйте! 👋
Добро пожаловать в ${CAFE.name}.

Выберите нужный раздел:

${menuOptions("ru")}`;
}


// ======================================================
// НЕПОНЯТНАЯ КОМАНДА
// ======================================================

function unknownMessage(lang) {
  if (lang === "kk") {
    return `Мен бұл хабарламаны түсінбедім 🙂

Төмендегі бөлімдердің бірін таңдаңыз:

${menuOptions("kk")}`;
  }

  return `Я не понял сообщение 🙂

Пожалуйста, выберите один из разделов:

${menuOptions("ru")}`;
}


// ======================================================
// КОНТАКТЫ + АДРЕС + 2GIS
// ======================================================

function infoMessage(lang) {
  if (lang === "kk") {
    return `🕐 ${CAFE.name}

🕙 Жұмыс уақыты:
${CAFE.workHours}

🎶 Музыкалық бағдарлама:
${CAFE.musicHours}

🚚 Жеткізу уақыты:
${CAFE.deliveryHours}

📍 Мекенжай:
${CAFE.address}

🗺 2GIS:
${CAFE.mapUrl}

📞 Үстел броньдау:
${CAFE.bookingPhone}

🛵 Жеткізу:
${CAFE.deliveryPhone}

📱 Instagram:
${CAFE.instagram}

0 — 🏠 Басты мәзір`;
  }

  return `🕐 ${CAFE.name}

🕙 Время работы:
${CAFE.workHours}

🎶 Музыкальное оформление:
${CAFE.musicHours}

🚚 Доставка:
${CAFE.deliveryHours}

📍 Адрес:
${CAFE.address}

🗺 Открыть в 2GIS:
${CAFE.mapUrl}

📞 Бронь столов:
${CAFE.bookingPhone}

🛵 Доставка:
${CAFE.deliveryPhone}

📱 Instagram:
${CAFE.instagram}

0 — 🏠 Главное меню`;
}


// ======================================================
// СОТРУДНИК
// ======================================================

function humanModeMessage(lang) {
  if (lang === "kk") {
    return `👨‍💼 Қызметкер режимі қосылды.

Келесі ${HUMAN_HANDOFF_MINUTES} минут бот автоматты түрде жауап бермейді.

Қызметкер диалогты қолмен жалғастыра алады.

🤖 Ботты қайта қосу үшін:
БОТ

0 — 🏠 Басты мәзір`;
  }

  return `👨‍💼 Режим сотрудника включён.

Следующие ${HUMAN_HANDOFF_MINUTES} минут бот не будет отвечать автоматически.

Сотрудник сможет продолжить диалог вручную.

🤖 Чтобы снова включить бота, напишите:

БОТ

0 — 🏠 Главное меню`;
}


function botResumedMessage(lang) {
  if (lang === "kk") {
    return `🤖 Бот қайта қосылды.

${mainMenu("kk")}`;
  }

  return `🤖 Бот снова включён.

${mainMenu("ru")}`;
}


// ======================================================
// HTTP
// ======================================================

app.get("/", (req, res) => {
  res
    .status(200)
    .send(
      `Aca WhatsApp bot v${BOT_VERSION} is running ✅`
    );
});


app.get(
  "/health",
  async (req, res) => {
    let database =
      false;

    if (pool) {
      try {
        await pool.query(
          "SELECT 1"
        );

        database =
          true;
      } catch (error) {
        console.error(
          "Database health error:",
          error.message
        );

        database =
          false;
      }
    }

    res.status(200).json({
      ok: true,
      version: BOT_VERSION,
      database,
      bot: "Aca",
      menu: MENU_URL
    });
  }
);


// ======================================================
// PDF MENU
// ======================================================

app.get(
  "/menu.pdf",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "Amina-Cafe-Menu.pdf"
      )
    );
  }
);


// ======================================================
// META WEBHOOK VERIFY
// ======================================================

app.get(
  "/webhook",
  (req, res) => {
    const mode =
      req.query["hub.mode"];

    const token =
      req.query[
        "hub.verify_token"
      ];

    const challenge =
      req.query[
        "hub.challenge"
      ];

    if (
      mode === "subscribe" &&
      token === VERIFY_TOKEN
    ) {
      console.log(
        "Webhook verified ✅"
      );

      return res
        .status(200)
        .send(challenge);
    }

    return res
      .sendStatus(403);
  }
);


// ======================================================
// WHATSAPP API
// ======================================================

async function sendWhatsAppPayload(
  payload
) {
  const url =
    `https://graph.facebook.com/` +
    `${GRAPH_API_VERSION}/` +
    `${PHONE_NUMBER_ID}/messages`;

  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${WHATSAPP_TOKEN}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            payload
          )
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    console.error(
      "Meta API error:",
      JSON.stringify(
        data,
        null,
        2
      )
    );

    throw new Error(
      `Meta API returned ${response.status}`
    );
  }

  return data;
}


// ======================================================
// ОТПРАВКА ТЕКСТА
// ======================================================

async function sendTextMessage(
  to,
  body
) {
  return sendWhatsAppPayload({
    messaging_product:
      "whatsapp",

    recipient_type:
      "individual",

    to,

    type:
      "text",

    text: {
      preview_url:
        true,

      body
    }
  });
}


// ======================================================
// ОТПРАВКА PDF
// ======================================================

async function sendMenuPdf(
  to,
  lang
) {
  return sendWhatsAppPayload({
    messaging_product:
      "whatsapp",

    recipient_type:
      "individual",

    to,

    type:
      "document",

    document: {
      link:
        MENU_URL,

      filename:
        "Amina-Cafe-Menu.pdf",

      caption:
        lang === "kk"
          ? "📋 Amina Cafe мәзірі"
          : "📋 Меню Amina Cafe"
    }
  });
}


// ======================================================
// ОСНОВНАЯ ЛОГИКА
// ======================================================

async function handleTextMessage(
  from,
  rawText
) {
  const msg =
    normalizeText(
      rawText
    );

  let session =
    await getSession(
      from
    );

  let lang =
    session.language ||
    "ru";


  // ====================================================
  // 0 В РЕЖИМЕ СОТРУДНИКА
  // ====================================================

  if (
    isHumanMode(session) &&
    [
      "0",
      "назад",
      "артқа",
      "артка"
    ].includes(msg)
  ) {
    await disableHumanMode(
      from
    );

    await sendTextMessage(
      from,
      mainMenu(lang)
    );

    return;
  }


  // ====================================================
  // БОТ
  // ====================================================

  if (
    [
      "бот",
      "bot",
      "/bot",
      "вернуть бота",
      "ботты қосу",
      "ботты косу"
    ].includes(msg)
  ) {
    await disableHumanMode(
      from
    );

    await sendTextMessage(
      from,
      botResumedMessage(
        lang
      )
    );

    return;
  }


  // ====================================================
  // HUMAN MODE
  // ====================================================

  if (
    isHumanMode(
      session
    )
  ) {
    console.log(
      `👨‍💼 Human mode: ${from}`
    );

    return;
  }


  // ====================================================
  // АВТО KAZAKH
  // ====================================================

  if (
    looksKazakh(
      rawText
    )
  ) {
    lang =
      "kk";

    await saveLanguage(
      from,
      lang
    );
  }


  // ====================================================
  // KAZAKH
  // ====================================================

  if (
    [
      "қазақша",
      "казакша",
      "қазақ тілі",
      "kk"
    ].includes(msg)
  ) {
    lang =
      "kk";

    await saveLanguage(
      from,
      lang
    );

    await sendTextMessage(
      from,
      mainMenu(lang)
    );

    return;
  }


  // ====================================================
  // RUSSIAN
  // ====================================================

  if (
    [
      "русский",
      "рус",
      "ru"
    ].includes(msg)
  ) {
    lang =
      "ru";

    await saveLanguage(
      from,
      lang
    );

    await sendTextMessage(
      from,
      mainMenu(lang)
    );

    return;
  }


  // ====================================================
  // ПРИВЕТ
  // ====================================================

  const greetings = [
    "привет",
    "здравствуйте",
    "добрый день",
    "добрый вечер",
    "салам",
    "сәлем",
    "салем",
    "сәлеметсіз бе",
    "start",
    "/start"
  ];

  if (
    greetings.includes(msg) ||
    [
      "0",
      "назад",
      "артқа",
      "артка"
    ].includes(msg)
  ) {
    await sendTextMessage(
      from,
      mainMenu(lang)
    );

    return;
  }


  // ====================================================
  // 4 — ЯЗЫК
  // ====================================================

  if (
    msg === "4"
  ) {
    lang =
      lang === "kk"
        ? "ru"
        : "kk";

    await saveLanguage(
      from,
      lang
    );

    await sendTextMessage(
      from,
      mainMenu(lang)
    );

    return;
  }


  // ====================================================
  // 1 — МЕНЮ
  // ====================================================

  if (
    msg === "1" ||
    msg === "меню" ||
    msg === "мәзір" ||
    msg === "мазір"
  ) {
    await sendMenuPdf(
      from,
      lang
    );

    await sendTextMessage(
      from,

      lang === "kk"
        ? `📋 Мәзір жоғарыда жіберілді 👆

0 — 🏠 Басты мәзір`
        : `📋 Меню отправлено выше 👆

0 — 🏠 Главное меню`
    );

    return;
  }


  // ====================================================
  // 2 — КОНТАКТЫ
  // ====================================================

  if (
    msg === "2" ||

    msg.includes(
      "время"
    ) ||

    msg.includes(
      "контакт"
    ) ||

    msg.includes(
      "адрес"
    ) ||

    msg.includes(
      "байланыс"
    ) ||

    msg.includes(
      "мекенжай"
    )
  ) {
    await sendTextMessage(
      from,
      infoMessage(lang)
    );

    return;
  }


  // ====================================================
  // 3 — СОТРУДНИК
  // ====================================================

  if (
    msg === "3" ||

    msg.includes(
      "сотрудник"
    ) ||

    msg.includes(
      "оператор"
    ) ||

    msg.includes(
      "человек"
    ) ||

    msg.includes(
      "қызметкер"
    ) ||

    msg.includes(
      "кызметкер"
    )
  ) {
    await enableHumanMode(
      from
    );

    await sendTextMessage(
      from,
      humanModeMessage(
        lang
      )
    );

    return;
  }


  // ====================================================
  // UNKNOWN
  // ====================================================

  await sendTextMessage(
    from,
    unknownMessage(
      lang
    )
  );
}


// ======================================================
// ЗАЩИТА ОТ ПОВТОРНЫХ WEBHOOK
// ======================================================

const processedMessages =
  new Set();


// ======================================================
// INCOMING MESSAGE
// ======================================================

async function processIncomingMessage(
  message
) {
  const messageId =
    message?.id;

  if (
    messageId &&
    processedMessages.has(
      messageId
    )
  ) {
    return;
  }

  if (
    messageId
  ) {
    processedMessages.add(
      messageId
    );

    if (
      processedMessages.size >
      2000
    ) {
      const first =
        processedMessages
          .values()
          .next()
          .value;

      processedMessages.delete(
        first
      );
    }
  }

  const from =
    message?.from;

  if (!from) {
    return;
  }


  // ====================================================
  // TEXT
  // ====================================================

  if (
    message.type ===
    "text"
  ) {
    const text =
      message.text?.body ||
      "";

    console.log(
      `💬 ${from}: ${text}`
    );

    await handleTextMessage(
      from,
      text
    );

    return;
  }


  // ====================================================
  // MEDIA
  // ====================================================

  const session =
    await getSession(
      from
    );

  if (
    isHumanMode(
      session
    )
  ) {
    return;
  }

  const lang =
    session.language ||
    "ru";

  await sendTextMessage(
    from,

    lang === "kk"
      ? `Әзірге тек мәтіндік хабарламаларды түсінемін 🙂

0 — 🏠 Басты мәзір`
      : `Пока я понимаю только текстовые сообщения 🙂

0 — 🏠 Главное меню`
  );
}


// ======================================================
// WEBHOOK POST
// ======================================================

app.post(
  "/webhook",
  async (req, res) => {
    res.sendStatus(200);

    try {
      const entries =
        req.body?.entry ||
        [];

      for (
        const entry
        of entries
      ) {
        const changes =
          entry?.changes ||
          [];

        for (
          const change
          of changes
        ) {
          const messages =
            change
              ?.value
              ?.messages ||
            [];

          for (
            const message
            of messages
          ) {
            try {
              await processIncomingMessage(
                message
              );
            } catch (error) {
              console.error(
                "Message error:",
                error
              );
            }
          }
        }
      }
    } catch (error) {
      console.error(
        "Webhook error:",
        error
      );
    }
  }
);


// ======================================================
// START
// ======================================================

async function start() {
  try {
    await initDatabase();
  } catch (error) {
    console.error(
      "❌ Database init error:",
      error
    );
  }

  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        `🚀 Aca Bot v${BOT_VERSION}`
      );

      console.log(
        `🌐 Port: ${PORT}`
      );

      console.log(
        pool
          ? "🗄 Database mode: PostgreSQL"
          : "🧠 Database mode: Memory"
      );
    }
  );
}


start();
