const pino = require("pino");
const fs = require("fs-extra");
const path = require("path");
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const logger = pino({ level: "silent" });
const axios = require("axios");

// Data

const users = JSON.parse(fs.readFileSync("./users.json"));

const logMessage = async (sender, from, text, conn) => {
  const botId = conn.user.id;
  if (sender === botId) return;
  const name = sender;
  const chatInfo = from?.endsWith("@g.us")
    ? (await conn.groupMetadata(from))?.subject
    : from;
  if (name && chatInfo && text) {
    // Log Kirim Pesan Ke Console.log pake tanggal dan lain lain
    const date = new Date();
    const dateString = `${date.getDate()}/${
      date.getMonth() + 1
    }/${date.getFullYear()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
    const log = `${dateString} | ${chatInfo} | ${text}`;
    console.log(
      `Pesan baru dari ${name} di ${chatInfo} pada ${dateString}: ${text}`
    );
    await fs.ensureFile(path.join(__dirname, "log.txt"));
    await fs.appendFile(path.join(__dirname, "log.txt"), log + "\n");
  }
};

const vcard =
  "BEGIN:VCARD\n" + // metadata of the contact card
  "VERSION:3.0\n" +
  "FN:Piyo Ganteng\n" + // full name
  "ORG:Piyo Store;\n" + // the organization of the contact
  "TEL;type=CELL;type=VOICE;waid=6283878761652:+6283878761652\n" + // WhatsApp ID + phone number
  "END:VCARD";

async function connect() {
  const { version, isLatest } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const conn = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: "silent" }),
    browser: Browsers.ubuntu("Chrome"),
    downloadHistory: true,
    syncFullHistory: true,
    qrTimeout: 30_000,
    markOnlineOnConnect: true,
  });

  conn.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut
        ? connect()
        : console.log("Koneksi Terputus...");
    } else if (connection === "connecting") {
      console.log("Menghubungkan...");
    } else if (connection === "open") {
      console.log("Terhubung...");
    }
  });

  conn.ev.on("creds.update", saveCreds);

  conn.ev.on("messages.upsert", async (message) => {
    m = message;
    m = m.messages[0];
    const content = JSON.stringify(m.message);
    if (m.key && m.key.remoteJid == "status@broadcast") return;
    if (m.key.fromMe) return;
    m.message =
      Object.keys(m.message)[0] === "ephemeralMessage"
        ? m.message.ephemeralMessage.message
        : m.message;
    let type = Object.keys(m.message);
    type =
      (!["senderKeyDistributionMessage", "messageContextInfo"].includes(
        type[0]
      ) &&
        type[0]) ||
      (type.length >= 3 && type[1] !== "messageContextInfo" && type[1]) ||
      type[type.length - 1] ||
      type[0];
    const from = m.key.remoteJid;
    const isGroup = from.endsWith("@g.us");
    const botNumber = conn.user.id
      ? conn.user.id.split(":")[0] + "@s.whatsapp.net"
      : conn.user.id;
    const sender = isGroup ? m.key.participant : m.key.remoteJid;
    const body =
      type === "conversation"
        ? m.message.conversation
        : type == "imageMessage"
        ? m.message.imageMessage.caption
        : type == "videoMessage"
        ? m.message.videoMessage.caption
        : type == "extendedTextMessage"
        ? m.message.extendedTextMessage.text
        : type == "buttonsResponseMessage"
        ? m.message.buttonsResponseMessage.selectedButtonId
        : type == "listResponseMessage"
        ? m.message.listResponseMessage.singleSelectReply.selectedRowId
        : type == "templateButtonReplyMessage"
        ? m.message.templateButtonReplyMessage.selectedId
        : type === "messageContextInfo"
        ? m.message.buttonsResponseMessage?.selectedButtonId ||
          m.message.listResponseMessage?.title ||
          m.text
        : "";
    if (!isGroup) {
      await logMessage(sender, from, body, conn);
    }

    const downloadDelay = 10000;

    if (!isGroup) {
      if (type === "conversation" || type === "extendedTextMessage") {
        if (body.includes("instagram.com")) {
          const userIndex = users.findIndex((user) => user.id === from);
          const now = Date.now();

          if (userIndex !== -1) {
            if (users[userIndex].downloadCount > 5) {
              await conn.sendMessage(from, {
                text: "Anda telah mencapai batas maksimal unduhan. Silakan bayar untuk melanjutkan dengan harga 10k 3 bulan.",
              });
              await conn.sendMessage(from, {
                contacts: {
                  displayName: "Piyo Ganteng",
                  contacts: [{ vcard }],
                },
              });
              return;
            }

            if (now - users[userIndex].lastDownload < downloadDelay) {
              await conn.sendMessage(from, {
                text: "Silakan tunggu beberapa saat sebelum mengunduh lagi.",
              });
              return;
            }

            users[userIndex].lastDownload = now;
            users[userIndex].downloadCount++;
          } else {
            users.push({ id: from, downloadCount: 1, lastDownload: now });
          }

          fs.writeFileSync("./users.json", JSON.stringify(users));
          try {
            const { data } = await axios.get(
              `https://api.guruapi.tech/insta/v1/igdl?url=${encodeURIComponent(
                body
              )}`
            );

            if (data.success) {
              for (const media of data.media) {
                await conn.sendMessage(from, {
                  video: {
                    url: media.url,
                  },
                });
              }
              await conn.sendMessage(from, {
                text: `✅ Selesai mengunduh media dari ${body}`,
              });
            } else {
              await conn.sendMessage(from, {
                text: `❌ Gagal mengunduh media dari ${body}`,
              });
            }
          } catch (err) {
            console.error(err);
          }
        }
      }
    }
  });
}

connect();
