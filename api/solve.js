export const config = {
  runtime: "nodejs"
};

import OpenAI from "openai";
import crypto from "crypto";

/* =========================
   UTIL
========================= */

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
  return "unknown";
}

/* =========================
   RATE LIMIT (semplice)
========================= */

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const rateState = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const hits = rateState.get(ip) || [];
  const recent = hits.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX) {
    return { ok: false };
  }

  recent.push(now);
  rateState.set(ip, recent);
  return { ok: true };
}

/* =========================
   CACHE
========================= */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();

function cacheKey(text) {
  return crypto
    .createHash("sha256")
    .update(text.toLowerCase().trim())
    .digest("hex");
}

/* =========================
   DOMAIN GUARD
========================= */

function isCleaningRelated(text) {
  if (!text) return false;
  const t = text.toLowerCase();

  const actions = [
    "pulire","pulizia","lavare","smacchiare","rimuovere","togliere",
    "eliminare","igienizzare","spolverare","sgrassare","disinfettare"
  ];

  const dirt = [
    "polvere","sporco","macchia","grasso","unto","odore","puzza",
    "muffa","calcare","incrost","ruggine","aloni","olio","sabbia",
    "fango","erba","peli","residui"
  ];

  const surfaces = [
    "parquet","pavimento","legno","piastrelle","vetro","acciaio",
    "divano","tappeto","moquette","materasso","letto","tavolo",
    "forno","doccia","lavandino","wc",
    "scarpe","maglia","maglione","camicia","jeans",
    "auto","cerchi","sedili","giardino","terrazzo","balcone"
  ];

  const hasAction = actions.some(a => t.includes(a));
  const hasDirt = dirt.some(d => t.includes(d));
  const hasSurface = surfaces.some(s => t.includes(s));

  return (hasAction && hasSurface) || (hasDirt && hasSurface);
}


/* =========================
   FOLLOW UP LOGIC
========================= */

function needsFollowUp(text) {
  const t = text.toLowerCase();
  const mentionsMacchia = t.includes("macchia");
  const mentionsType =
    t.includes("vino") ||
    t.includes("caff") ||
    t.includes("olio") ||
    t.includes("trucco") ||
    t.includes("fango") ||
    t.includes("erba");

  if (mentionsMacchia && !mentionsType) return true;
  return false;
}

function followUpQuestion() {
  return "Che tipo di macchia è e da quanto tempo? (es: vino, caffè, olio, trucco)";
}

function followUpOptions() {
  return ["Caffè", "Vino", "Olio o grasso", "Trucco", "Erba o fango", "Non lo so"];
}

/* =========================
   SCHEMA OPENAI
========================= */

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
    follow_up_questions: { type: "array", maxItems: 1, items: { type: "string" } },
    follow_up_options: { type: "array", maxItems: 6, items: { type: "string" } }
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
    "follow_up_questions",
    "follow_up_options"
  ]
};

/* =========================
   HANDLER
========================= */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip).ok) {
    res.status(429).json({ error: "rate_limited" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "missing_api_key" });
    return;
  }

  const { text = "", followup = false } = req.body || {};
  const userText = text.trim();

  if (!userText) {
    res.status(400).json({ error: "empty_input" });
    return;
  }

  if (!isCleaningRelated(userText)) {
    res.status(200).json({
      title: "Richiesta non supportata",
      summary: "Questo strumento risponde solo a richieste di pulizia e manutenzione.",
      difficulty: "Facile",
      time: "Immediato",
      risk: "Basso",
      what_you_need: [],
      steps: [],
      mistakes: [],
      when_not_to_do: [],
      quick_alternative:
        'Esempi: "macchia di vino sul maglione", "calcare nel box doccia", "olio sul vialetto".',
      follow_up_questions: [],
      follow_up_options: []
    });
    return;
  }

  if (!followup && needsFollowUp(userText)) {
    res.status(200).json({
      title: "Mi serve un dettaglio in più",
      summary: "Mi basta una sola informazione per darti la soluzione completa.",
      difficulty: "Facile",
      time: "Immediato",
      risk: "Basso",
      what_you_need: [],
      steps: [],
      mistakes: [],
      when_not_to_do: [],
      quick_alternative: "Scegli un'opzione o scrivi una risposta breve.",
      follow_up_questions: [followUpQuestion()],
      follow_up_options: followUpOptions()
    });
    return;
  }

  const cacheK = cacheKey(userText);
  if (cache.has(cacheK)) {
    res.status(200).json(cache.get(cacheK));
    return;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Sei un esperto di pulizia domestica, vestiti, esterni e auto. " +
                "Non fare più di UNA domanda di follow up. " +
                "Se followup=true non fare domande.\n\nRichiesta:\n" +
                userText
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "pulire_meglio_answer",
          schema,
          strict: true
        }
      }
    });

    const parsed = safeJsonParse(response.output_text);
    if (!parsed) {
      throw new Error("Invalid AI output");
    }

    parsed.follow_up_questions = [];
    parsed.follow_up_options = [];

    cache.set(cacheK, parsed);
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({
      error: "function_failed",
      message: err.message
    });
  }
}
