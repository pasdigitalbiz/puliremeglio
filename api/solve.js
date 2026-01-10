import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.length > 0) return realIp.trim();
  return "unknown";
}

/* ---------------- RATE LIMIT ---------------- */

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const rateState = { byIp: new Map() };

function checkRateLimit(ip) {
  const now = Date.now();
  const arr = rateState.byIp.get(ip) || [];
  const fresh = arr.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

  if (fresh.length >= RATE_LIMIT_MAX) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - fresh[0]);
    rateState.byIp.set(ip, fresh);
    return { ok: false, retryAfterMs };
  }

  fresh.push(now);
  rateState.byIp.set(ip, fresh);
  return { ok: true, retryAfterMs: 0 };
}

/* ---------------- DOMAIN GUARD ---------------- */

function isCleaningRelated(text) {
  if (!text) return false;
  const t = text.toLowerCase();

  const keywords = [
    "pulire", "pulizia", "sporco", "macchia", "macchie",
    "incrost", "calcare", "grasso", "unto", "odore", "puzza",
    "muffa", "ruggine", "aloni",
    "forno", "doccia", "lavandino", "lavatrice", "frigo",
    "tappeto", "divano", "tessuto", "vetro", "specchio",
    "parquet", "pavimento", "acciaio", "ceramica", "piastrelle"
  ];

  return keywords.some(k => t.includes(k));
}

function buildNotSupportedPayload() {
  return {
    title: "Richiesta non supportata",
    summary: "Questo strumento risponde solo a problemi di pulizia domestica, superfici e macchie.",
    difficulty: "Facile",
    time: "Immediato",
    risk: "Basso",
    what_you_need: [],
    steps: [],
    mistakes: [],
    when_not_to_do: [],
    quick_alternative: 'Esempi: "forno incrostato", "calcare box doccia", "macchia sul tappeto".',
    follow_up_questions: []
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const ip = getClientIp(req);
  const rl = checkRateLimit(ip);

  if (!rl.ok) {
    const retryAfterSeconds = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({
      error: "rate_limited",
      message: "Hai raggiunto il limite temporaneo di richieste. Riprova tra qualche minuto.",
      retry_after_seconds: retryAfterSeconds
    });
    return;
  }

  try {
    const { text, image_data_url, followup } = req.body || {};
    const userText = (text || "").trim();
    const isFollowUp = followup === true;

    if (userText && !isCleaningRelated(userText) && !image_data_url) {
      res.status(200).json(buildNotSupportedPayload());
      return;
    }

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        difficulty: { type: "string", enum: ["Facile", "Media", "Difficile"] },
        time: { type: "string" },
        risk: { type: "string", enum: ["Basso", "Medio", "Alto"] },
        what_you_need: { type: "array", items: { type: "string" } },
        steps: { type: "array", items: { type: "string" } },
        mistakes: { type: "array", items: { type: "string" } },
        when_not_to_do: { type: "array", items: { type: "string" } },
        quick_alternative: { type: "string" },
        follow_up_questions: { type: "array", maxItems: 1, items: { type: "string" } }
      },
      required: [
        "title",
        "summary",
        "difficulty",
        "time",
        "risk",
        "what_you_need",
        "steps",
        "mistakes",
        "when_not_to_do",
        "quick_alternative",
        "follow_up_questions"
      ]
    };

    const systemRules = [
      "Sei un assistente esperto di pulizia domestica.",
      "Rispondi SOLO a pulizia, superfici, sporco, odori e macchie.",
      "",
      "Regola fondamentale anti-domande:",
      "Fai una domanda di follow-up SOLO se è strettamente necessaria per sicurezza o per evitare danni (es: superficie delicata, rischio di scolorimento, prodotto incompatibile).",
      "Se puoi procedere con assunzioni ragionevoli, NON chiedere: scegli l'approccio più prudente e dichiaralo in una riga.",
      "Massimo 1 follow-up question in totale.",
      "",
      "Regola di chiusura:",
      "Se questa è una richiesta di follow-up (followup=true), NON fare altre domande: follow_up_questions deve essere [].",
      "In follow-up devi dare una soluzione completa e finale."
    ].join("\n");

    const inputParts = [{ type: "input_text", text: systemRules }];

    if (userText) inputParts.push({ type: "input_text", text: `Problema utente:\n${userText}` });

    if (image_data_url) {
      inputParts.push({ type: "input_image", image_url: image_data_url, detail: "auto" });
      inputParts.push({
        type: "input_text",
        text: "Analizza la foto solo in ottica di pulizia. Se non è chiaro, scegli il metodo più prudente e dillo esplicitamente."
      });
    }

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [{ role: "user", content: inputParts }],
      text: {
        format: {
          type: "json_schema",
          name: "pulire_meglio_answer",
          schema,
          strict: true
        }
      }
    });

    const parsed = safeJsonParse(response.output_text || "");
    if (!parsed) {
      res.status(500).send("Invalid AI output");
      return;
    }

    if (isFollowUp) {
      parsed.follow_up_questions = [];
    } else {
      if (!Array.isArray(parsed.follow_up_questions)) parsed.follow_up_questions = [];
      if (parsed.follow_up_questions.length > 1) parsed.follow_up_questions = parsed.follow_up_questions.slice(0, 1);
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
}
