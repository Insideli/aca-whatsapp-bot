require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v26.0";
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://aca-whatsapp-bot.onrender.com";

const MENU_URL = `${PUBLIC_BASE_URL}/menu.pdf`;

const CAFE_ADDRESS = (process.env.CAFE_ADDRESS || "").trim();
const HUMAN_HANDOFF_MINUTES = Number(
  process.env.HUMAN_HANDOFF_MINUTES || "30"
);

// Данные из PDF Amina Cafe.
const CAFE = {
  name: "Amina Cafe",
  workHours: "10:00–00:00",
  musicHours: "19:00–23:00",
  deliveryHours: "10:00–22:30",
  bookingPhone: "8 705 286 57 88",
  deliveryPhone: "8 777 488 21 41",
  instagram: "@cafe_amina",
};

// ВАЖНО:
// Эти данные хранятся только в памяти процесса.
// При перезапуске/засыпании Render язык и режим сотрудника сбросятся.
// Для production позже перенесем state в PostgreSQL/Redis.
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

function isHumanMode(session) {
  return session.humanUntil > Date.now();
}

function clearHumanMode(session) {
  session.humanUntil = 0;
}

function activateHumanMode(session) {
  session.humanUntil =
    Date.now() + HUMAN_HANDOFF_MINUTES * 60 * 1000;
}

function normalizeText(text) {
  return (text || "").trim().toLowerCase();
}

function looksKazakh(text) {
  return /[әғқңөұүһі]/i.test(text || "");
}

app.get("/", (req, res) => {
  res.status(200).send("Aca WhatsApp bot is running ✅");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    bot: "Aca",
    menu: MENU_URL,
  });
});

app.get("/menu.pdf", (req, res) => {
  res.sendFile(path.join(__dirname, "Amina-Cafe-Menu.pdf"));
});

// Meta webhook verification.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified ✅");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

async function sendWhatsAppPayload(payload) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Meta API error:", JSON.stringify(data, null, 2));
    throw new Error(`Meta API returned ${response.status}`);
  }

  return data;
}

async function sendTextMessage(to, body) {
  return sendWhatsAppPayload({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: false,
      body,
    },
  });
}

async function sendMenuPdf(to, lang = "ru") {
  const caption =
    lang === "kk" ? "📋 Amina Cafe мәзірі" : "📋 Меню Amina Cafe";

  return sendWhatsAppPayload({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "document",
    document: {
      link: MENU_URL,
      filename: "Amina-Cafe-Menu.pdf",
      caption,
    },
  });
}

function mainMenu(lang) {
  if (lang === "kk") {
    return `Сәлеметсіз бе! 👋
${CAFE.name}-ге қош келдіңіз.

Таңдаңыз:
1 — 📋 Мәзір
2 — 🕐 Жұмыс уақыты және байланыс
3 — 👨‍💼 Қызметкермен сөйлесу
4 — 🌐 Русский

0 — 🏠 Басты мәзір`;
  }

  return `Здравствуйте! 👋
Добро пожаловать в ${CAFE.name}.

Выберите:
1 — 📋 Меню
2 — 🕐 Время работы и контакты
3 — 👨‍💼 Связаться с сотрудником
4 — 🌐 Қазақша

0 — 🏠 Главное меню`;
}

function infoText(lang) {
  const addressRu = CAFE_ADDRESS
    ? `📍 Адрес: ${CAFE_ADDRESS}\n`
    : "";
  const addressKk = CAFE_ADDRESS
    ? `📍 Мекенжай: ${CAFE_ADDRESS}\n`
    : "";

  if (lang === "kk") {
    return `🕐 ${CAFE.name}

Жұмыс уақыты: ${CAFE.workHours}
Музыкалық бағдарлама: ${CAFE.musicHours}
Жеткізу: ${CAFE.deliveryHours}

${addressKk}📞 Үстел броньдау: ${CAFE.bookingPhone}
🚚 Жеткізу: ${CAFE.deliveryPhone}
📱 Instagram: ${CAFE.instagram}

0 — Басты мәзір`;
  }

  return `🕐 ${CAFE.name}

Время работы: ${CAFE.workHours}
Музыкальное оформление: ${CAFE.musicHours}
Доставка: ${CAFE.deliveryHours}

${addressRu}📞 Бронь столов: ${CAFE.bookingPhone}
🚚 Доставка: ${CAFE.deliveryPhone}
📱 Instagram: ${CAFE.instagram}

0 — Главное меню`;
}

function humanModeText(lang) {
  if (lang === "kk") {
    return `👨‍💼 Қызметкер режимі қосылды.

Келесі ${HUMAN_HANDOFF_MINUTES} минут бот автоматты түрде жауап бермейді — осы нөмірде қызметкер жұмыс істесе, диалогты өзі жалғастыра алады.

Ботты қайта қосу үшін:
БОТ

0 — Басты мәзір`;
  }

  return `👨‍💼 Режим сотрудника включён.

Следующие ${HUMAN_HANDOFF_MINUTES} минут бот не будет автоматически отвечать — если на этом номере работает сотрудник, он сможет продолжить диалог вручную.

Чтобы вернуть бота, напишите:
БОТ

0 — Главное меню`;
}

function resumedText(lang) {
  if (lang === "kk") {
    return `🤖 Бот қайта қосылды.\n\n${mainMenu("kk")}`;
  }
  return `🤖 Бот снова включён.\n\n${mainMenu("ru")}`;
}

function unknownText(lang) {
  if (lang === "kk") {
    return `Кешіріңіз, бұл команданы түсінбедім 🙂

1 — Мәзір
2 — Байланыс
3 — Қызметкер
4 — Русский
0 — Басты мәзір`;
  }

  return `Я не понял эту команду 🙂

1 — Меню
2 — Контакты
3 — Сотрудник
4 — Қазақша
0 — Главное меню`;
}

async function handleTextMessage(from, rawText) {
  const msg = normalizeText(rawText);
  const session = getSession(from);

  // Быстрое возвращение из режима сотрудника.
  if (
    ["бот", "/bot", "bot", "вернуть бота", "ботты қосу", "ботты косу"].includes(msg)
  ) {
    clearHumanMode(session);
    await sendTextMessage(from, resumedText(session.lang));
    return;
  }

  // Пока активен режим сотрудника, бот молчит.
  if (isHumanMode(session)) {
    console.log(`Human handoff active for ${from}. Bot skipped reply.`);
    return;
  }

  // Автоопределение языка по явным казахским символам.
  if (looksKazakh(rawText)) {
    session.lang = "kk";
  }

  // Явное переключение языка.
  if (["қазақша", "казакша", "қазақ тілі", "kk"].includes(msg)) {
    session.lang = "kk";
    await sendTextMessage(from, mainMenu("kk"));
    return;
  }

  if (["русский", "рус", "ru"].includes(msg)) {
    session.lang = "ru";
    await sendTextMessage(from, mainMenu("ru"));
    return;
  }

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

  if (greetings.includes(msg) || msg === "0" || msg === "назад" || msg === "артқа") {
    await sendTextMessage(from, mainMenu(session.lang));
    return;
  }

  // 4 — переключить язык.
  if (msg === "4") {
    session.lang = session.lang === "kk" ? "ru" : "kk";
    await sendTextMessage(from, mainMenu(session.lang));
    return;
  }

  // 1 — PDF меню.
  if (
    msg === "1" ||
    msg === "меню" ||
    msg === "мәзір" ||
    msg === "мазір"
  ) {
    await sendMenuPdf(from, session.lang);

    if (session.lang === "kk") {
      await sendTextMessage(
        from,
        "Мәзір жоғарыда жіберілді 👆\n\n0 — Басты мәзір"
      );
    } else {
      await sendTextMessage(
        from,
        "Меню отправлено выше 👆\n\n0 — Главное меню"
      );
    }
    return;
  }

  // 2 — контакты и время работы.
  if (
    msg === "2" ||
    msg.includes("время") ||
    msg.includes("контакт") ||
    msg.includes("адрес") ||
    msg.includes("байланыс") ||
    msg.includes("мекенжай") ||
    msg.includes("жұмыс уақыты") ||
    msg.includes("жумыс уакыты")
  ) {
    await sendTextMessage(from, infoText(session.lang));
    return;
  }

  // 3 — временно выключаем автоответы для этого клиента.
  if (
    msg === "3" ||
    msg.includes("сотрудник") ||
    msg.includes("оператор") ||
    msg.includes("человек") ||
    msg.includes("қызметкер") ||
    msg.includes("кызметкер")
  ) {
    activateHumanMode(session);
    await sendTextMessage(from, humanModeText(session.lang));
    return;
  }

  await sendTextMessage(from, unknownText(session.lang));
}

async function processIncomingMessage(message) {
  const messageId = message?.id;

  if (messageId && processedMessageIds.has(messageId)) {
    return;
  }

  if (messageId) {
    processedMessageIds.add(messageId);

    if (processedMessageIds.size > 2000) {
      const first = processedMessageIds.values().next().value;
      processedMessageIds.delete(first);
    }
  }

  const from = message?.from;
  if (!from) return;

  const session = getSession(from);

  // В режиме сотрудника любые медиа тоже оставляем человеку.
  if (isHumanMode(session)) {
    console.log(`Human handoff active for ${from}. Incoming ${message.type} ignored by bot.`);
    return;
  }

  if (message.type !== "text") {
    const text =
      session.lang === "kk"
        ? "Әзірге мәтіндік хабарламаларды түсінемін 🙂\n0 — Басты мәзір"
        : "Пока я понимаю текстовые сообщения 🙂\n0 — Главное меню";

    await sendTextMessage(from, text);
    return;
  }

  const incomingText = message.text?.body || "";
  console.log(`Message from ${from}: ${incomingText}`);

  await handleTextMessage(from, incomingText);
}

app.post("/webhook", async (req, res) => {
  // Meta должна быстро получить 200 OK.
  res.sendStatus(200);

  try {
    const entries = req.body?.entry || [];

    for (const entry of entries) {
      const changes = entry?.changes || [];

      for (const change of changes) {
        const messages = change?.value?.messages || [];

        for (const message of messages) {
          try {
            await processIncomingMessage(message);
          } catch (messageError) {
            console.error("Message processing error:", messageError);
          }
        }
      }
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  const missing = [];

  if (!VERIFY_TOKEN) missing.push("VERIFY_TOKEN");
  if (!WHATSAPP_TOKEN) missing.push("WHATSAPP_TOKEN");
  if (!PHONE_NUMBER_ID) missing.push("PHONE_NUMBER_ID");

  console.log(`Aca server started on port ${PORT}`);

  if (missing.length) {
    console.warn(`⚠️ Missing environment variables: ${missing.join(", ")}`);
  }
});
