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
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.length > 0) {
    return realIp.trim();
  }
  return "unknown";
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const rateState = {
  byIp: new Map()
};

function checkRateLimit(ip) {
  const now = Date.now();

  const arr = rateState.byIp.get(ip) || [];
  const fresh = arr.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

  if (fresh.length >= RATE_LIMIT_MAX) {
    const oldest = fresh[0];
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - oldest);
    rateState.byIp.set(ip, fresh);
    return { ok: false, retryAfterMs };
  }

  fresh.push(now);
  rateState.byIp.set(ip, fresh);
  return { ok: true, retryAfterMs: 0 };
}

function isFinalizationRequest(userText) {
  const t = (userText || "").toLowerCase();
  return (
    t.includes("nuove informazioni") ||
    t.includes("soluzione completa e finale") ||
    t.includes("genera ora una soluzione completa") ||
    t.includes("aggiorna la soluzione")
  );
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
    const { text, image_data_url } = req.body || {};
    const userText = (text || "").trim();

    const finalizationMode = isFinalizationRequest(userText);

    const inputParts = [
      {
        type: "input_text",
        text: [
          "Sei un assistente esperto di pulizia domestica.",
          "Genera una risposta pratica e sicura.",
          "Evita combinazioni rischiose di prodotti.",
          "Se la superficie è delicata, proponi sempre un test in un angolo nascosto.",
          "",
          "Regola di chiarezza:",
          "Se mancano informazioni davvero critiche, fai al massimo UNA sola domanda di follow-up (una sola frase) e basta.",
          "Non fare liste di domande.",
          "",
          "Regola di chiusura:",
          "Se l'utente ha fornito nuove informazioni (follow-up), devi produrre una soluzione completa e finale.",
          "In quel caso follow_up_questions deve essere un array vuoto.",
          "Non chiedere altre domande nel secondo giro."
        ].join("\n")
      }
    ];

    if (userText) {
      inputParts.push({ type: "input_text", text: `Problema utente: ${userText}` });
    }

    if (image_data_url) {
      inputParts.push({
        type: "input_image",
        image_url: image_data_url,
        detail: "auto"
      });
      inputParts.push({
        type: "input_text",
        text: [
          "Analizza la foto per capire superficie e tipo di sporco.",
          "Se non sei sicuro, dichiaralo e proponi la procedura più prudente.",
          "Applica la regola: al massimo UNA domanda di follow-up, solo se strettamente necessaria."
        ].join("\n")
      });
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
        follow_up_questions: {
          type: "array",
          maxItems: 1,
          items: { type: "string" }
        }
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

    const outText = response.output_text || "";
    const parsed = safeJsonParse(outText);

    if (!parsed) {
      res.status(500).send("Model returned non JSON output");
      return;
    }

    if (finalizationMode) {
      if (!Array.isArray(parsed.follow_up_questions)) parsed.follow_up_questions = [];
      parsed.follow_up_questions = [];
    } else {
      if (!Array.isArray(parsed.follow_up_questions)) parsed.follow_up_questions = [];
      if (parsed.follow_up_questions.length > 1) {
        parsed.follow_up_questions = parsed.follow_up_questions.slice(0, 1);
      }
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
}
