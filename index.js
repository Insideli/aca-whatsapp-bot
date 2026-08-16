require("dotenv").config();
const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v26.0";

// Небольшая защита от повторной обработки webhook'ов.
// Для настоящего production позже заменим это на базу/Redis.
const processedMessageIds = new Set();

app.get("/", (req, res) => {
  res.status(200).send("WhatsApp bot is running ✅");
});

// Проверка webhook со стороны Meta
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

async function sendTextMessage(to, body) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: false,
        body
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Meta API error:", data);
    throw new Error(`Meta API returned ${response.status}`);
  }

  return data;
}

function getBotReply(text) {
  const msg = (text || "").trim().toLowerCase();

  const mainMenu =
`Здравствуйте! 👋
Добро пожаловать.

Напишите:
1 — 📋 Меню
2 — 📍 Адрес
3 — 👨‍💼 Связаться с сотрудником`;

  if (
    ["привет", "здравствуйте", "салам", "сәлем", "салем", "start", "/start"].includes(msg)
  ) {
    return mainMenu;
  }

  if (msg === "1" || msg === "меню") {
    return `📋 Меню

Скоро здесь появится полное меню кафе.

Чтобы вернуться:
0 — Главное меню`;
  }

  if (msg === "2" || msg === "адрес") {
    return `📍 Адрес кафе

Здесь мы укажем точный адрес и время работы.

Чтобы вернуться:
0 — Главное меню`;
  }

  if (
    msg === "3" ||
    msg.includes("сотрудник") ||
    msg.includes("оператор") ||
    msg.includes("человек")
  ) {
    return `👨‍💼 Хорошо. Ваше сообщение можно передать сотруднику.

Пока это тестовая версия бота, поэтому подключение реального сотрудника добавим следующим этапом.`;
  }

  if (msg === "0" || msg === "назад") {
    return mainMenu;
  }

  return `Я пока простой бот 🙂\n\n${mainMenu}`;
}

// Получение входящих сообщений
app.post("/webhook", async (req, res) => {
  // Сразу отвечаем Meta 200, чтобы она не считала webhook зависшим.
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

      // Не даём Set бесконечно расти.
      if (processedMessageIds.size > 1000) {
        const first = processedMessageIds.values().next().value;
        processedMessageIds.delete(first);
      }
    }

    const from = message.from;

    if (message.type !== "text") {
      await sendTextMessage(
        from,
        "Пока я понимаю только текстовые сообщения 🙂\nНапишите «Привет»."
      );
      return;
    }

    const incomingText = message.text?.body || "";
    console.log(`Message from ${from}: ${incomingText}`);

    const reply = getBotReply(incomingText);
    await sendTextMessage(from, reply);
  } catch (error) {
    console.error("Webhook processing error:", error);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server started on port ${PORT}`);
});
