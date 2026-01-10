import OpenAI from "openai";
import crypto from "crypto";

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

/* SIMPLE CACHE (text only) */

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

/* DOMAIN GUARD (PULIZIA 360) */

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

/* CHECKLIST ANTI FOLLOW UP (NO AI COST) */

/* Superfici materiali generiche */
const SURFACE_HINTS = [
  "vetro", "acciaio", "ceramica", "marmo", "granito", "parquet", "legno",
  "tessuto", "cotone", "lana", "seta", "pelle", "camoscio", "plastica",
  "piastrelle", "fughe", "tappeto", "divano", "scarpe", "jeans",
  "auto", "cerchi", "sedili", "vialetto", "pietra"
];

/* Oggetti/capi che implicano già il materiale “tessuto” */
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

/* Macchie specifiche: se mancano, chiediamo “che tipo di macchia” */
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
  const t = (text || "").trim();
  const lower = t.toLowerCase();

  const mentionsTextileObject = containsAny(lower, TEXTILE_OBJECT_HINTS);
  const hasSurface =
    containsAny(lower, SURFACE_HINTS) || mentionsTextileObject;

  const hasProblem = containsAny(lower, PROBLEM_HINTS);

  const mentionsStainWord = lower.includes("macchia") || lower.includes("macchie");
  const hasStainType = containsAny(lower, STAIN_TYPE_HINTS);

  if (!hasSurface && !hasProblem) {
    return "Cosa devi pulire e qual è il problema? (es: ‘maglione macchia di vino’, ‘box doccia calcare’, ‘vialetto olio’)";
  }

  /* Caso tessile: “maglione” è già tessuto, quindi NON chiediamo la superficie */
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

  /* Caso non tessile: se manca superficie chiediamo superficie */
  if (!hasSurface) {
    return "Su quale superficie o materiale si trova lo sporco o la macchia? (es vetro, legno, acciaio, pietra, plastica)";
  }

  /* Se manca il problema chiediamo il problema */
  if (!hasProblem) {
    return "Che tipo di sporco o problema è? (es calcare, grasso, muffa, macchia di cibo, resina, ruggine)";
  }

  /* Se è una macchia ma non è specificata, chiediamo tipo macchia */
  if (mentionsStainWord && !hasStainType) {
    return "Che tipo di macchia è e da quanto tempo? (es caffè, vino, olio, sangue)";
  }

  return null;
}

/* OUTPUT POLICY (ADATTIVO) */

function clampArray(arr, maxItems) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, Math.max(0, maxItems));
}

function normalizeString(s, fallback) {
  const out = typeof s === "string" ? s.trim() : "";
  return out.length ? out : (fallback || "");
}

function clampText(s, maxChars) {
  const t = normalizeString(s, "");
  if (!maxChars || t.length <= maxChars) return t;
  return t.slice(0, maxChars - 1).trimEnd() + "…";
}

function ensureNonEmptyList(list, fallbackItems) {
  if (Array.isArray(list) && list.length) return list;
  return Array.isArray(fallbackItems) ? fallbackItems : [];
}

function enforceOutputPolicy(parsed) {
  const risk = normalizeString(parsed.risk, "Basso");
  const difficulty = normalizeString(parsed.difficulty, "Facile");

  const limitsByRisk = {
    Basso: { stepsMax: 6, mistakesMax: 5, needsMax: 6, whenNotMax: 2, summaryChars: 260 },
    Medio: { stepsMax: 9, mistakesMax: 6, needsMax: 7, whenNotMax: 3, summaryChars: 320 },
    Alto: { stepsMax: 12, mistakesMax: 7, needsMax: 8, whenNotMax: 5, summaryChars: 420 }
  };

  const cfg = limitsByRisk[risk] || limitsByRisk.Basso;

  parsed.title = normalizeString(parsed.title, "Soluzione di pulizia");
  parsed.summary = clampText(parsed.summary, cfg.summaryChars);

  parsed.time = normalizeString(parsed.time, "Variabile");
  parsed.quick_alternative = clampText(parsed.quick_alternative, 260);

  parsed.what_you_need = clampArray(parsed.what_you_need, cfg.needsMax);
  parsed.steps = clampArray(parsed.steps, cfg.stepsMax);
  parsed.mistakes = clampArray(parsed.mistakes, cfg.mistakesMax);
  parsed.when_not_to_do = clampArray(parsed.when_not_to_do, cfg.whenNotMax);

  const defaultNeeds = [
    "Panno in microfibra o spugna non abrasiva",
    "Acqua tiepida",
    "Guanti (se usi detergenti)",
    "Detergente delicato oppure sapone neutro"
  ];

  const defaultMistakes = [
    "Non usare abrasivi su superfici delicate",
    "Non mescolare prodotti chimici tra loro",
    "Fai sempre una prova in un punto nascosto"
  ];

  parsed.what_you_need = ensureNonEmptyList(parsed.what_you_need, defaultNeeds);
  parsed.mistakes = ensureNonEmptyList(parsed.mistakes, defaultMistakes);

  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    parsed.steps = [
      "Rimuovi lo sporco superficiale con un panno umido",
      "Applica un detergente delicato e lascia agire pochi minuti",
      "Strofina con una spugna non abrasiva",
      "Risciacqua e asciuga bene"
    ];
  }

  if (risk === "Alto") {
    parsed.when_not_to_do = ensureNonEmptyList(parsed.when_not_to_do, [
      "Se non sei sicuro del materiale o della finitura",
      "Se la superficie è delicata e rischi scolorimento o opacizzazione",
      "Se servono solventi forti senza adeguata ventilazione"
    ]);
  }

  if (risk === "Basso" && difficulty === "Facile") {
    parsed.when_not_to_do = clampArray(parsed.when_not_to_do, 1);
  }

  if (!Array.isArray(parsed.follow_up_questions)) parsed.follow_up_questions = [];
  if (parsed.follow_up_questions.length > 1) parsed.follow_up_questions = parsed.follow_up_questions.slice(0, 1);

  return parsed;
}

/* PAYLOAD HELPERS */

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
    follow_up_questions: []
  };
}

function buildAutoFollowUpPayload(question) {
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
    quick_alternative: "Rispondi con una frase breve e poi ti do la soluzione completa.",
    follow_up_questions: [question]
  };
}

/* HANDLER */

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
    const hasImage = Boolean(image_data_url);

    if (userText && !isCleaningRelated(userText) && !hasImage) {
      res.status(200).json(buildNotSupportedPayload());
      return;
    }

    if (!isFollowUp && userText && !hasImage) {
      const q = buildFollowUpQuestion(userText);
      if (q) {
        res.status(200).json(buildAutoFollowUpPayload(q));
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

    const outputRules = [
      "Regole di output adattivo",
      "Se risk è Basso usa massimo 6 steps e una summary breve",
      "Se risk è Medio usa massimo 9 steps",
      "Se risk è Alto usa massimo 12 steps e aggiungi quando_not_to_do più completo",
      "Non essere prolisso, vai operativo",
      "Evita ripetizioni"
    ].join("\n");

    const systemRules = [
      "Sei un assistente esperto di pulizia e manutenzione pratica.",
      "Ambiti: casa, esterni e giardinaggio, vestiti e tessuti, auto e attrezzi.",
      "Rispondi SOLO a richieste di pulizia, rimozione macchie o residui, odori, muffe, incrostazioni e manutenzione simile.",
      "",
      "Regola anti domande",
      "Non fare follow up in modo perfezionista",
      "Se puoi procedere con assunzioni prudenti, fai direttamente la soluzione completa e dichiara l'assunzione in una riga",
      "Massimo 1 follow up, e solo se indispensabile per evitare danni",
      "",
      "Regola di chiusura",
      "Se followup=true, non fare altre domande, follow_up_questions deve essere []",
      "",
      "Sicurezza",
      "Non suggerire miscele pericolose come candeggina con ammoniaca o acidi",
      "Consiglia test in un punto nascosto su tessuti e superfici delicate",
      "",
      outputRules
    ].join("\n");

    const inputParts = [{ type: "input_text", text: systemRules }];

    if (userText) inputParts.push({ type: "input_text", text: `Richiesta utente:\n${userText}` });

    if (hasImage) {
      inputParts.push({ type: "input_image", image_url: image_data_url, detail: "auto" });
      inputParts.push({
        type: "input_text",
        text: "Analizza la foto solo in ottica di pulizia. Se non è chiaro, scegli il metodo più prudente e dichiaralo."
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

      const shouldAllowFollowUp = hasImage;
      if (!shouldAllowFollowUp) parsed.follow_up_questions = [];
    }

    const finalOut = enforceOutputPolicy(parsed);

    if (!isFollowUp && userText && !hasImage) {
      const key = cacheKeyFor(userText);
      cacheSet(key, finalOut);
    }

    res.status(200).json(finalOut);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
}
