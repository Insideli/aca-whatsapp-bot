require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());

const BOT_VERSION = "3.0.0";
const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GRAPH_API_VERSION =
  process.env.GRAPH_API_VERSION || "v26.0";

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  "https://aca-whatsapp-bot.onrender.com";

const MENU_URL = `${PUBLIC_BASE_URL}/menu.pdf`;

const HUMAN_HANDOFF_MINUTES = Number(
  process.env.HUMAN_HANDOFF_MINUTES || "30"
);

const CAFE_ADDRESS =
  (process.env.CAFE_ADDRESS || "").trim();

const CAFE = {
  name: "Amina Cafe",
  workHours: "10:00–00:00",
  musicHours: "19:00–23:00",
  deliveryHours: "10:00–22:30",
  bookingPhone: "8 705 286 57 88",
  deliveryPhone: "8 777 488 21 41",
  instagram: "@cafe_amina",
};


// =========================================================
// ВРЕМЕННОЕ ХРАНЕНИЕ СОСТОЯНИЯ
// =========================================================

const sessions = new Map();
const processedMessageIds = new Set();


function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, {
      lang: "ru",
      humanUntil: 0,
    });
  }

  return sessions.get(phone);
}


function normalizeText(text) {
  return (text || "")
    .trim()
    .toLowerCase();
}


function looksKazakh(text) {
  return /[әғқңөұүһі]/i.test(text || "");
}


function isHumanMode(session) {
  return session.humanUntil > Date.now();
}


function enableHumanMode(session) {
  session.humanUntil =
    Date.now() +
    HUMAN_HANDOFF_MINUTES * 60 * 1000;
}


function disableHumanMode(session) {
  session.humanUntil = 0;
}


// =========================================================
// ЕДИНЫЙ КРАСИВЫЙ СТИЛЬ
// =========================================================
//
// ВАЖНО:
// И главное меню, и ответ на непонятную команду
// используют ОДНУ функцию menuOptions().
//
// Поэтому стиль больше не может отличаться.
// =========================================================


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


// =========================================================
// ГЛАВНОЕ МЕНЮ
// =========================================================

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


// =========================================================
// ЕСЛИ БОТ НЕ ПОНЯЛ СООБЩЕНИЕ
// =========================================================
//
// ВАЖНО:
// здесь тоже используется menuOptions().
// Поэтому никаких:
//
// 1 — Меню
// 2 — Контакты
// 3 — Сотрудник
//
// больше нет.
// =========================================================

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


// =========================================================
// ВРЕМЯ РАБОТЫ И КОНТАКТЫ
// =========================================================

function infoMessage(lang) {

  const addressRu = CAFE_ADDRESS
    ? `📍 Адрес: ${CAFE_ADDRESS}\n`
    : "";


  const addressKk = CAFE_ADDRESS
    ? `📍 Мекенжай: ${CAFE_ADDRESS}\n`
    : "";


  if (lang === "kk") {

    return `🕐 ${CAFE.name}

🕙 Жұмыс уақыты: ${CAFE.workHours}
🎶 Музыкалық бағдарлама: ${CAFE.musicHours}
🚚 Жеткізу уақыты: ${CAFE.deliveryHours}

${addressKk}📞 Үстел броньдау: ${CAFE.bookingPhone}
🛵 Жеткізу: ${CAFE.deliveryPhone}
📱 Instagram: ${CAFE.instagram}

0 — 🏠 Басты мәзір`;

  }


  return `🕐 ${CAFE.name}

🕙 Время работы: ${CAFE.workHours}
🎶 Музыкальное оформление: ${CAFE.musicHours}
🚚 Доставка: ${CAFE.deliveryHours}

${addressRu}📞 Бронь столов: ${CAFE.bookingPhone}
🛵 Доставка: ${CAFE.deliveryPhone}
📱 Instagram: ${CAFE.instagram}

0 — 🏠 Главное меню`;

}


// =========================================================
// РЕЖИМ СОТРУДНИКА
// =========================================================

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


// =========================================================
// БОТ СНОВА ВКЛЮЧЁН
// =========================================================

function botResumedMessage(lang) {

  if (lang === "kk") {

    return `🤖 Бот қайта қосылды.

${mainMenu("kk")}`;

  }


  return `🤖 Бот снова включён.

${mainMenu("ru")}`;

}


// =========================================================
// HTTP
// =========================================================


app.get("/", (req, res) => {

  res
    .status(200)
    .send(
      `Aca WhatsApp bot v${BOT_VERSION} is running ✅`
    );

});


app.get("/health", (req, res) => {

  res.status(200).json({
    ok: true,
    version: BOT_VERSION,
    bot: "Aca",
    menu: MENU_URL,
  });

});


// =========================================================
// PDF-МЕНЮ
// =========================================================

app.get("/menu.pdf", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "Amina-Cafe-Menu.pdf"
    )
  );

});


// =========================================================
// ПРОВЕРКА WEBHOOK META
// =========================================================

app.get("/webhook", (req, res) => {

  const mode =
    req.query["hub.mode"];

  const token =
    req.query["hub.verify_token"];

  const challenge =
    req.query["hub.challenge"];


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


  return res.sendStatus(403);

});


// =========================================================
// WHATSAPP CLOUD API
// =========================================================


async function sendWhatsAppPayload(payload) {

  const url =
    `https://graph.facebook.com/` +
    `${GRAPH_API_VERSION}/` +
    `${PHONE_NUMBER_ID}/messages`;


  const response = await fetch(
    url,
    {

      method: "POST",

      headers: {

        Authorization:
          `Bearer ${WHATSAPP_TOKEN}`,

        "Content-Type":
          "application/json",

      },

      body:
        JSON.stringify(payload),

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


// =========================================================
// ОТПРАВКА ТЕКСТА
// =========================================================

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
        false,

      body,

    },

  });

}


// =========================================================
// ОТПРАВКА PDF-МЕНЮ
// =========================================================

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
          : "📋 Меню Amina Cafe",

    },

  });

}


// =========================================================
// ОСНОВНАЯ ЛОГИКА БОТА
// =========================================================

async function handleTextMessage(
  from,
  rawText
) {

  const msg =
    normalizeText(rawText);


  const session =
    getSession(from);


  // =======================================================
  // ВЫХОД ИЗ РЕЖИМА СОТРУДНИКА ЧЕРЕЗ 0
  // =======================================================

  if (
    isHumanMode(session) &&
    [
      "0",
      "назад",
      "артқа",
      "артка",
    ].includes(msg)
  ) {

    disableHumanMode(session);


    await sendTextMessage(
      from,
      mainMenu(session.lang)
    );


    return;

  }


  // =======================================================
  // КОМАНДА БОТ
  // =======================================================

  if (
    [

      "бот",

      "bot",

      "/bot",

      "вернуть бота",

      "ботты қосу",

      "ботты косу",

    ].includes(msg)
  ) {

    disableHumanMode(session);


    await sendTextMessage(
      from,
      botResumedMessage(
        session.lang
      )
    );


    return;

  }


  // =======================================================
  // ЕСЛИ АКТИВЕН СОТРУДНИК — БОТ МОЛЧИТ
  // =======================================================

  if (
    isHumanMode(session)
  ) {

    console.log(
      `Human mode active for ${from}; ` +
      `no automatic reply.`
    );


    return;

  }


  // =======================================================
  // АВТООПРЕДЕЛЕНИЕ КАЗАХСКОГО
  // =======================================================

  if (
    looksKazakh(rawText)
  ) {

    session.lang =
      "kk";

  }


  // =======================================================
  // КАЗАХСКИЙ
  // =======================================================

  if (
    [

      "қазақша",

      "казакша",

      "қазақ тілі",

      "kk",

    ].includes(msg)
  ) {

    session.lang =
      "kk";


    await sendTextMessage(
      from,
      mainMenu("kk")
    );


    return;

  }


  // =======================================================
  // РУССКИЙ
  // =======================================================

  if (
    [

      "русский",

      "рус",

      "ru",

    ].includes(msg)
  ) {

    session.lang =
      "ru";


    await sendTextMessage(
      from,
      mainMenu("ru")
    );


    return;

  }


  // =======================================================
  // ПРИВЕТСТВИЯ
  // =======================================================

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

    "/start",

  ];


  if (
    greetings.includes(msg) ||
    [
      "0",
      "назад",
      "артқа",
      "артка",
    ].includes(msg)
  ) {

    await sendTextMessage(
      from,
      mainMenu(session.lang)
    );


    return;

  }


  // =======================================================
  // 4 — ПЕРЕКЛЮЧЕНИЕ ЯЗЫКА
  // =======================================================

  if (
    msg === "4"
  ) {

    session.lang =
      session.lang === "kk"
        ? "ru"
        : "kk";


    await sendTextMessage(
      from,
      mainMenu(session.lang)
    );


    return;

  }


  // =======================================================
  // 1 — МЕНЮ
  // =======================================================

  if (
    msg === "1" ||
    msg === "меню" ||
    msg === "мәзір" ||
    msg === "мазір"
  ) {

    await sendMenuPdf(
      from,
      session.lang
    );


    if (
      session.lang === "kk"
    ) {

      await sendTextMessage(
        from,
        `📋 Мәзір жоғарыда жіберілді 👆

0 — 🏠 Басты мәзір`
      );

    } else {

      await sendTextMessage(
        from,
        `📋 Меню отправлено выше 👆

0 — 🏠 Главное меню`
      );

    }


    return;

  }


  // =======================================================
  // 2 — ВРЕМЯ / КОНТАКТЫ
  // =======================================================

  if (
    msg === "2" ||

    msg.includes("время") ||

    msg.includes("контакт") ||

    msg.includes("адрес") ||

    msg.includes("байланыс") ||

    msg.includes("мекенжай") ||

    msg.includes(
      "жұмыс уақыты"
    ) ||

    msg.includes(
      "жумыс уакыты"
    )
  ) {

    await sendTextMessage(
      from,
      infoMessage(
        session.lang
      )
    );


    return;

  }


  // =======================================================
  // 3 — СОТРУДНИК
  // =======================================================

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

    enableHumanMode(
      session
    );


    await sendTextMessage(
      from,
      humanModeMessage(
        session.lang
      )
    );


    return;

  }


  // =======================================================
  // НЕИЗВЕСТНОЕ СООБЩЕНИЕ
  // =======================================================
  //
  // Здесь используется unknownMessage(),
  // а unknownMessage() использует menuOptions().
  //
  // Поэтому пункты здесь ТОЧНО такие же,
  // как в главном меню.
  // =======================================================

  await sendTextMessage(
    from,
    unknownMessage(
      session.lang
    )
  );

}


// =========================================================
// ОБРАБОТКА ВХОДЯЩЕГО WHATSAPP-СООБЩЕНИЯ
// =========================================================

async function processIncomingMessage(
  message
) {

  const messageId =
    message?.id;


  // =======================================================
  // ЗАЩИТА ОТ ПОВТОРНЫХ WEBHOOK
  // =======================================================

  if (
    messageId &&
    processedMessageIds.has(
      messageId
    )
  ) {

    return;

  }


  if (
    messageId
  ) {

    processedMessageIds.add(
      messageId
    );


    if (
      processedMessageIds.size >
      2000
    ) {

      const first =
        processedMessageIds
          .values()
          .next()
          .value;


      processedMessageIds.delete(
        first
      );

    }

  }


  const from =
    message?.from;


  if (!from) {

    return;

  }


  const session =
    getSession(from);


  // =======================================================
  // ТЕКСТ
  // =======================================================

  if (
    message.type ===
    "text"
  ) {

    const text =
      message.text?.body ||
      "";


    console.log(
      `Message from ${from}: ${text}`
    );


    await handleTextMessage(
      from,
      text
    );


    return;

  }


  // =======================================================
  // МЕДИА В РЕЖИМЕ СОТРУДНИКА
  // =======================================================

  if (
    isHumanMode(session)
  ) {

    console.log(

      `Human mode active for ${from}; ` +

      `${message.type} ignored by bot.`

    );


    return;

  }


  // =======================================================
  // ПОКА НЕ ПОДДЕРЖИВАЕМ МЕДИА
  // =======================================================

  if (
    session.lang ===
    "kk"
  ) {

    await sendTextMessage(

      from,

      `Әзірге тек мәтіндік хабарламаларды түсінемін 🙂

0 — 🏠 Басты мәзір`

    );

  } else {

    await sendTextMessage(

      from,

      `Пока я понимаю только текстовые сообщения 🙂

0 — 🏠 Главное меню`

    );

  }

}


// =========================================================
// POST WEBHOOK
// =========================================================

app.post(
  "/webhook",
  async (req, res) => {

    // Meta должна получить 200 максимально быстро.
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

                "Message processing error:",

                error

              );

            }

          }

        }

      }

    } catch (error) {

      console.error(

        "Webhook processing error:",

        error

      );

    }

  }
);


// =========================================================
// ЗАПУСК СЕРВЕРА
// =========================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `🚀 Aca Bot v${BOT_VERSION} started on port ${PORT}`
    );


    const missing =
      [];


    if (
      !VERIFY_TOKEN
    ) {

      missing.push(
        "VERIFY_TOKEN"
      );

    }


    if (
      !WHATSAPP_TOKEN
    ) {

      missing.push(
        "WHATSAPP_TOKEN"
      );

    }


    if (
      !PHONE_NUMBER_ID
    ) {

      missing.push(
        "PHONE_NUMBER_ID"
      );

    }


    if (
      missing.length
    ) {

      console.warn(

        `⚠️ Missing environment variables: ` +

        missing.join(", ")

      );

    }

  }
);
