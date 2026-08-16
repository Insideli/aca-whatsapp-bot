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
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://aca-whatsapp-bot.onrender.com";
const MENU_URL = `${PUBLIC_BASE_URL}/menu.pdf`;

const processedMessageIds = new Set();

app.get("/", (req, res) => {
  res.status(200).send("WhatsApp bot is running ✅");
});

// Публичная ссылка на PDF-меню для WhatsApp Cloud API.
app.get("/menu.pdf", (req, res) => {
  res.sendFile(path.join(__dirname, "Amina-Cafe-Menu.pdf"));
});

// Проверка webhook со стороны Meta.
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
    console.error("Meta API error:", data);
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

async function sendMenuPdf(to) {
  return sendWhatsAppPayload({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "document",
    document: {
      link: MENU_URL,
      filename: "Amina-Cafe-Menu.pdf",
      caption: "📋 Меню Amina Cafe",
    },
  });
}

const MAIN_MENU = `Здравствуйте! 👋\nДобро пожаловать в Amina Cafe.\n\nНапишите:\n1 — 📋 Меню\n2 — 🕐 Время работы и контакты\n3 — 👨‍💼 Связаться с сотрудником`;

async function handleTextMessage(from, text) {
  const msg = (text || "").trim().toLowerCase();

  if (["привет", "здравствуйте", "салам", "сәлем", "салем", "start", "/start", "0", "назад"].includes(msg)) {
    await sendTextMessage(from, MAIN_MENU);
    return;
  }

  if (msg === "1" || msg === "меню") {
    await sendMenuPdf(from);
    await sendTextMessage(
      from,
      "Меню отправлено выше 👆\n\nПо вопросам алкогольной продукции обратитесь к сотруднику кафе.\n\n0 — Главное меню"
    );
    return;
  }

  if (msg === "2" || msg === "время" || msg === "контакты" || msg === "адрес") {
    await sendTextMessage(
      from,
      `🕐 Amina Cafe\n\nВремя работы: 10:00–00:00\nМузыкальное оформление: 19:00–23:00\nДоставка: 10:00–22:30\n\n📞 Бронь столов: 8 705 286 57 88\n🚚 Доставка: 8 777 488 21 41\n\n📍 Точный адрес уточните у сотрудника кафе.\n\n0 — Главное меню`
    );
    return;
  }

  if (msg === "3" || msg.includes("сотрудник") || msg.includes("оператор") || msg.includes("человек")) {
    await sendTextMessage(
      from,
      `👨‍💼 Связаться с Amina Cafe\n\n📞 Бронь столов: 8 705 286 57 88\n🚚 Доставка: 8 777 488 21 41\n\n0 — Главное меню`
    );
    return;
  }

  await sendTextMessage(from, `Я пока простой бот 🙂\n\n${MAIN_MENU}`);
}

app.post("/webhook", async (req, res) => {
  // Сразу подтверждаем получение webhook, чтобы Meta не повторяла запрос.
  res.sendStatus(200);

  try {
    const change = req.body?.entry?.[0]?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const messageId = message.id;
    if (messageId && processedMessageIds.has(messageId)) return;

    if (messageId) {
      processedMessageIds.add(messageId);
      if (processedMessageIds.size > 1000) {
        const first = processedMessageIds.values().next().value;
        processedMessageIds.delete(first);
      }
    }

    const from = message.from;

    if (message.type !== "text") {
      await sendTextMessage(from, "Пока я понимаю текстовые сообщения 🙂\nНапишите «Привет».");
      return;
    }

    const incomingText = message.text?.body || "";
    console.log(`Message from ${from}: ${incomingText}`);

    await handleTextMessage(from, incomingText);
  } catch (error) {
    console.error("Webhook processing error:", error);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server started on port ${PORT}`);
});
