export const config = {
  runtime: "nodejs"
};

import OpenAI from "openai";
import crypto from "crypto";

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

/* RATE LIMIT */
const RATE_LIMIT_MAX = 6;
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

/* CACHE */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();

function cacheKeyFor(text) {
  const normalized = (text || "").trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { ts: Date.now(), value });
}

/* DOMAIN GUARD */
function isCleaningRelated(text) {
  if (!text) return false;
  const t = text.toLowerCase();

  const intent = [
    "pulire", "pulizia", "lavare", "smacchiare", "sgrassare", "igienizzare",
    "disinfettare", "deodorare", "togliere", "rimuovere", "eliminare",
    "lucidare", "sbiancare", "trattare", "ripulire"
  ];

  const problems = [
    "macchia", "macchie", "sporco", "incrost", "calcare", "grasso", "unto",
    "odore", "puzza", "muffa", "ruggine", "aloni", "resina", "catrame",
    "vernice", "colla", "olio", "fango", "terra", "polvere", "erba", "foglie",
    "escrementi", "urina", "vomito", "sangue", "cera"
  ];

  const surfaces = [
    "forno", "doccia", "vasca", "lavandino", "wc", "piastrelle", "fughe",
    "frigo", "microonde", "cappa", "piano cottura", "tavolo", "muro",
    "vetro", "specchio", "acciaio", "ceramica", "marmo", "granito",
    "parquet", "pavimento", "tappeto", "moquette", "divano", "materasso",
    "tenda", "cuscino",
    "scarpe", "sneakers", "suola",
    "maglia", "maglione", "pantaloni", "giacca", "jeans", "camicia", "cappotto",
    "lavatrice", "asciugatrice", "lavastoviglie",
    "giardino", "terrazzo", "balcone", "vialetto", "patio", "pietra",
    "legno", "mobili da giardino", "griglia", "bbq",
    "auto", "cerchi", "tappezzeria", "sedili", "cruscotto", "parabrezza",
    "bici", "casco"
  ];

  const hasIntent = intent.some(k => t.includes(k));
  const hasProblemOrSurface = problems.some(k => t.includes(k)) || surfaces.some(k => t.includes(k));

  return hasIntent || hasProblemOrSurface;
}

/* CHECKLIST + FOLLOWUP */
const SURFACE_HINTS = [
  "vetro", "acciaio", "ceramica", "marmo", "granito", "parquet", "legno",
  "tessuto", "cotone", "lana", "seta", "pelle", "camoscio", "plastica",
  "piastrelle", "fughe", "tappeto", "divano", "scarpe", "jeans",
  "auto", "cerchi", "sedili", "vialetto", "pietra"
];

const TEXTILE_OBJECT_HINTS = [
  "maglia", "maglione", "felpa", "t-shirt", "tshirt", "camicia", "polo",
  "pantaloni", "jeans", "gonna", "abito", "vestito", "giacca", "cappotto",
  "sciarpa", "guanti", "calze", "intimo", "lenzuola", "coperta", "plaid",
  "tenda", "tovaglia", "asciugamano", "accappatoio", "divano", "cuscino",
  "materasso", "tappeto", "moquette"
];

const PROBLEM_HINTS = [
  "macchia", "calcare", "incrost", "muffa", "odore", "puzza", "grasso",
  "unto", "ruggine", "aloni", "resina", "vernice", "colla", "olio",
  "fango", "polvere"
];

const STAIN_TYPE_HINTS = [
  "caff", "vino", "olio", "grasso", "sugo", "pomodoro", "cioccol", "sangue",
  "inchiostro", "erba", "fango", "trucco", "fondotinta", "rossetto",
  "urina", "vomito", "ruggine", "candeggina"
];

function containsAny(text, arr) {
  const t = (text || "").toLowerCase();
  return arr.some(k => t.includes(k));
}

function buildFollowUpQuestion(text) {
  const lower = (text || "").trim().toLowerCase();

  const mentionsTextileObject = containsAny(lower, TEXTILE_OBJECT_HINTS);
  const hasSurface = containsAny(lower, SURFACE_HINTS) || mentionsTextileObject;
  const hasProblem = containsAny(lower, PROBLEM_HINTS);

  const mentionsStainWord = lower.includes("macchia") || lower.includes("macchie");
  const hasStainType = containsAny(lower, STAIN_TYPE_HINTS);

  if (!hasSurface && !hasProblem) {
    return "Cosa devi pulire e qual è il problema? (es: ‘maglione macchia di vino’, ‘box doccia calcare’, ‘vialetto olio’)";
  }

  if (mentionsTextileObject) {
    if (!hasStainType && mentionsStainWord) {
      return "Che tipo di macchia è e da quanto tempo? (es: caffè, vino, olio, trucco)";
    }
    if (!mentionsStainWord && !hasProblem) {
      return "Che problema devi rimuovere dal capo? (es: macchia, odore, alone) e da quanto tempo?";
    }
    if (!hasStainType && hasProblem) {
      return "Che tipo di sporco o macchia è e da quanto tempo? (es: olio, vino, caffè, erba)";
    }
    return null;
  }

  if (!hasSurface) {
    return "Su quale superficie o materiale si trova lo sporco o la macchia? (es vetro, legno, acciaio, pietra, plastica)";
  }

  if (!hasProblem) {
    return "Che tipo di sporco o problema è? (es calcare, grasso, muffa, macchia di cibo, resina, ruggine)";
  }

  if (mentionsStainWord && !hasStainType) {
    return "Che tipo di macchia è e da quanto tempo? (es caffè, vino, olio, sangue)";
  }

  return null;
}

function uniqMax(arr, max = 6) {
  const out = [];
  const seen = new Set();
  for (const x of arr || []) {
    const v = (x || "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function suggestOptionsFromContext(question, userText) {
  const q = (question || "").toLowerCase();
  const u = (userText || "").toLowerCase();

  const isSurfaceQ = q.includes("superficie") || q.includes("materiale");
  const isStainTypeQ = q.includes("tipo di macchia") || q.includes("che tipo di macchia") || q.includes("che tipo di sporco");
  const isProblemQ = q.includes("che tipo di sporco") || q.includes("che problema");

  const mentionsTextile =
    containsAny(u, TEXTILE_OBJECT_HINTS) || u.includes("tessuto") || u.includes("cotone") || u.includes("lana") || u.includes("seta");

  if (isSurfaceQ) return uniqMax(["Vetro", "Tessuto", "Legno", "Acciaio", "Pietra", "Plastica"], 6);
  if (isStainTypeQ && mentionsTextile) return uniqMax(["Caffè", "Vino", "Olio o grasso", "Trucco", "Erba o fango", "Non lo so"], 6);
  if (isStainTypeQ) return uniqMax(["Caffè", "Vino", "Olio o grasso", "Inchiostro", "Erba o fango", "Non lo so"], 6);
  if (isProblemQ) return uniqMax(["Calcare", "Grasso", "Muffa", "Odore", "Macchia", "Non lo so"], 6);

  return uniqMax(["Leggero", "Medio", "Forte", "Vecchio", "Recente", "Non lo so"], 6);
}

function buildNotSupportedPayload() {
  return {
    title: "Richiesta non supportata",
    summary: "Questo strumento risponde solo a richieste di pulizia e manutenzione (casa, esterni, vestiti, auto).",
    difficulty: "Facile",
    time: "Immediato",
    risk: "Basso",
    what_you_need: [],
    steps: [],
    mistakes: [],
    when_not_to_do: [],
    quick_alternative:
      'Esempi: "resina sui pantaloni", "muffa sulle fughe", "fango sulle scarpe", "calcare nel box doccia", "olio sul vialetto".',
    follow_up_questions: [],
    follow_up_options: []
  };
}

function buildAutoFollowUpPayload(question, userText) {
  return {
    title: "Mi serve un dettaglio",
    summary: "Mi basta una sola informazione per darti la procedura completa.",
    difficulty: "Facile",
    time: "Immediato",
    risk: "Basso",
    what_you_need: [],
    steps: [],
    mistakes: [],
    when_not_to_do: [],
    quick_alternative: "Scegli un’opzione oppure scrivi una frase breve.",
    follow_up_questions: [question],
    follow_up_options: suggestOptionsFromContext(question, userText)
  };
}

function openAiErrorToJson(err) {
  const out = {
    name: err?.name,
    message: err?.message,
  };

  const status = err?.status || err?.response?.status;
  if (status) out.status = status;

  const code = err?.code;
  if (code) out.code = code;

  const type = err?.type;
  if (type) out.type = type;

  const reqId = err?.request_id || err?.requestId;
  if (reqId) out.openai_request_id = reqId;

  const data = err?.response?.data;
  if (data) out.response_data = data;

  return out;
}

export default async function handler(req, res) {
  const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;

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
    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({
        error: "missing_openai_api_key",
        message: "OPENAI_API_KEY non è configurata su Vercel.",
        request_id: requestId
      });
      return;
    }

    const { text, image_data_url, followup } = req.body || {};
    const userText = (text || "").trim();
    const isFollowUp = followup === true;
    const hasImage = Boolean(image_data_url);

    if (userText && !isCleaningRelated(userText) && !hasImage) {
      res.status(200).json(buildNotSupportedPayload());
      return;
    }

    if (!isFollowUp && userText && !hasImage) {
      const q = buildFollowUpQuestion(userText);
      if (q) {
        res.status(200).json(buildAutoFollowUpPayload(q, userText));
        return;
      }
    }

    if (!isFollowUp && userText && !hasImage) {
      const key = cacheKeyFor(userText);
      const hit = cacheGet(key);
      if (hit) {
        res.status(200).json(hit);
        return;
      }
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
        "follow_up_questions"
      ]
    };

    const systemRules = [
      "Sei un assistente esperto di pulizia e manutenzione pratica.",
      "Ambiti: casa, esterni e giardinaggio, vestiti e tessuti, auto e attrezzi.",
      "Rispondi SOLO a richieste di pulizia, rimozione macchie o residui, odori, muffe, incrostazioni e manutenzione simile.",
      "",
      "Regola anti domande",
      "Massimo 1 follow up e solo se indispensabile",
      "Se followup=true non fare altre domande, follow_up_questions deve essere []",
      "",
      "Sicurezza",
      "Non suggerire miscele pericolose come candeggina con ammoniaca o acidi",
      "Consiglia test in un punto nascosto su tessuti e superfici delicate"
    ].join("\n");

    const inputParts = [{ type: "input_text", text: systemRules }];

    if (userText) inputParts.push({ type: "input_text", text: `Richiesta utente:\n${userText}` });

    if (hasImage) {
      inputParts.push({ type: "input_image", image_url: image_data_url, detail: "auto" });
      inputParts.push({ type: "input_text", text: "Analizza la foto solo in ottica di pulizia. Se non è chiaro, scegli il metodo più prudente." });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
      res.status(500).json({
        error: "invalid_ai_output",
        message: "Output AI non valido.",
        request_id: requestId
      });
      return;
    }

    if (isFollowUp) {
      parsed.follow_up_questions = [];
      parsed.follow_up_options = [];
    }

    if (!isFollowUp && userText && !hasImage) {
      const key = cacheKeyFor(userText);
      cacheSet(key, parsed);
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error("solve_error", requestId, err);

    const openaiErr = openAiErrorToJson(err);
    const safeDetail = JSON.stringify(openaiErr).slice(0, 2000);

    res.status(500).json({
      error: "function_failed",
      message: "Errore interno della funzione.",
      request_id: requestId,
      detail: safeDetail
    });
  }
}
