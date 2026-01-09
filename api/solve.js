import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const { text, image_data_url } = req.body || {};

    const inputParts = [
      {
        type: "input_text",
        text:
          "Sei un assistente esperto di pulizia domestica. " +
          "Genera una risposta pratica e sicura. " +
          "Evita combinazioni rischiose di prodotti. " +
          "Se la superficie è delicata, proponi sempre un test in un angolo nascosto. " +
          "Se mancano informazioni critiche, aggiungi domande finali."
      }
    ];

    const userText = (text || "").trim();
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
        text:
          "Analizza la foto per capire superficie e tipo di sporco. " +
          "Se non sei sicuro, dichiaralo e proponi la procedura più prudente."
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
        follow_up_questions: { type: "array", items: { type: "string" } }
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

    res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
}
