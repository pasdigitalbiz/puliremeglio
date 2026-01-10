const els = {
  q: document.getElementById("q"),
  img: document.getElementById("img"),
  imgMeta: document.getElementById("imgMeta"),
  btnSolve: document.getElementById("btnSolve"),
  status: document.getElementById("status"),
  answer: document.getElementById("answer"),
  ansTitle: document.getElementById("ansTitle"),
  ansMeta: document.getElementById("ansMeta"),
  ansBody: document.getElementById("ansBody")
};

let lastImageDataUrl = null;
let cooldownTimer = null;
let cooldownEndsAt = 0;

let lastUserText = "";
let lastAssistantData = null;

function setStatus(msg) {
  els.status.textContent = msg || "";
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toList(arr, ordered) {
  if (!Array.isArray(arr) || arr.length === 0) return "<div>Non disponibile.</div>";
  const tag = ordered ? "ol" : "ul";
  const items = arr.map(x => `<li>${escapeHtml(x)}</li>`).join("");
  return `<${tag}>${items}</${tag}>`;
}

function startCooldown(seconds) {
  const s = Math.max(1, Math.floor(seconds || 1));
  cooldownEndsAt = Date.now() + s * 1000;

  els.btnSolve.disabled = true;

  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    const leftMs = cooldownEndsAt - Date.now();
    const left = Math.max(0, Math.ceil(leftMs / 1000));

    if (left <= 0) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      els.btnSolve.disabled = false;
      setStatus("");
      return;
    }

    setStatus(`Riprova tra ${left}s.`);
  }, 300);
}

function isNotSupportedResponse(data) {
  if (!data || typeof data !== "object") return false;
  const t = (data.title || "").toLowerCase();
  if (t.includes("richiesta non supportata")) return true;
  const s = (data.summary || "").toLowerCase();
  if (s.includes("solo a richieste di pulizia") || s.includes("risponde solo")) return true;
  return false;
}

function renderNotSupportedBox(data) {
  els.answer.style.display = "block";
  els.ansTitle.textContent = "Questo tool serve per la pulizia";
  els.ansMeta.textContent = "";

  const summary = escapeHtml(
    data.summary ||
      "Questo strumento risponde solo a problemi di pulizia, macchie, odori e manutenzione."
  );

  const hint = escapeHtml(
    data.quick_alternative ||
      'Esempi: "forno incrostato", "calcare box doccia", "macchia sul tappeto".'
  );

  els.ansBody.innerHTML = `
    <div style="
      width:100%;
      max-width:100%;
      box-sizing:border-box;
      padding:16px;
      border-radius:14px;
      border:1px solid #e2e8f0;
      background:#f0fdf4;
      box-shadow:0 6px 14px rgba(15,23,42,0.06);
      overflow:hidden;
    ">
      <div style="font-weight:800; color:#065f46; margin-bottom:8px;">
        Posso aiutarti a pulire, non a rispondere a domande generiche.
      </div>

      <div style="color:#0f172a; margin-bottom:10px; line-height:1.5;">
        ${summary}
      </div>

      <div style="
        width:100%;
        max-width:100%;
        box-sizing:border-box;
        padding:12px;
        border-radius:12px;
        background:#ffffff;
        border:1px solid #e2e8f0;
        color:#0f172a;
      ">
        <div style="font-weight:700; margin-bottom:6px;">Prova così</div>
        <div style="color:#475569; line-height:1.5;">
          ${hint}
        </div>
      </div>
    </div>
  `;
}

async function readResponseBody(res) {
  try {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await res.json();
      return JSON.stringify(j, null, 2);
    }
    return await res.text();
  } catch {
    return "";
  }
}

async function sendFollowUp(question, extra, ui) {
  const { btn, statusEl } = ui;

  btn.disabled = true;
  statusEl.textContent = "Aggiorno la soluzione...";

  const context = [
    "Richiesta iniziale:",
    lastUserText,
    "",
    "Domanda di chiarimento:",
    question,
    "",
    "Risposta utente:",
    extra
  ].join("\n");

  try {
    const res = await fetch("/api/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: context,
        image_data_url: lastImageDataUrl,
        followup: true
      })
    });

    if (res.status === 429) {
      let seconds = 30;
      try {
        const payload = await res.json();
        if (payload && typeof payload.retry_after_seconds === "number") seconds = payload.retry_after_seconds;
      } catch {}
      startCooldown(seconds);
      return;
    }

    if (!res.ok) {
      const body = await readResponseBody(res);
      statusEl.textContent = `Errore API (${res.status}). ${body ? "Dettaglio: " + body : ""}`;
      return;
    }

    const data = await res.json();
    lastAssistantData = data;
    renderAnswer(data);
    startCooldown(6);
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Errore di rete o deploy. Controlla Vercel Logs.";
  } finally {
    btn.disabled = false;
  }
}

function renderClarification(data) {
  els.answer.style.display = "block";
  els.ansTitle.textContent = "Mi serve un dettaglio in più";
  els.ansMeta.textContent = "Rispondi alla domanda per ottenere una soluzione completa.";

  const question =
    Array.isArray(data.follow_up_questions) && data.follow_up_questions.length
      ? data.follow_up_questions[0]
      : "Puoi aggiungere un dettaglio in più?";

  const options = Array.isArray(data.follow_up_options) ? data.follow_up_options.slice(0, 6) : [];

  const genericPlaceholder = "Scrivi qui la tua risposta (una frase breve).";
  const hintLine = `Rispondi alla domanda: “${escapeHtml(question)}”`;

  const pillsHtml = options.length
    ? `
      <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:10px;">
        ${options
          .map(
            opt => `
              <button type="button" data-opt="${escapeHtml(opt)}" class="pillBtn" style="
                border:1px solid #cbd5e1;
                background:#ffffff;
                color:#0f172a;
                border-radius:999px;
                padding:8px 12px;
                cursor:pointer;
                font-weight:700;
                font-size:14px;
              ">${escapeHtml(opt)}</button>
            `
          )
          .join("")}
      </div>
      <div style="margin-top:8px; font-size:13px; color:#64748b;">
        Puoi cliccare un’opzione: invio automatico.
      </div>
    `
    : "";

  els.ansBody.innerHTML = `
    <div style="margin-bottom:14px">
      <b>Domanda</b>
      ${toList([question], false)}
    </div>

    <div style="
      padding:12px;
      border:1px solid #e2e8f0;
      border-radius:12px;
      background:#f8fafc;
    ">
      <div style="font-size:14px; color:#64748b; margin-bottom:8px">
        ${hintLine}
      </div>

      ${pillsHtml}

      <textarea id="clarifyText" rows="3" style="
        margin-top:12px;
        width:100%;
        max-width:100%;
        box-sizing:border-box;
        padding:12px;
        border-radius:10px;
        border:1px solid #cbd5e1;
        background:#ffffff;
        color:#0f172a;
        outline:none;
      " placeholder="${escapeHtml(genericPlaceholder)}"></textarea>

      <button id="clarifyBtn" type="button" style="
        margin-top:10px;
        height:42px;
        padding:0 16px;
        border-radius:12px;
        border:none;
        font-weight:800;
        cursor:pointer;
        background:#0f766e;
        color:white;
        box-shadow:0 6px 14px rgba(15,118,110,0.20);
      ">
        Aggiorna soluzione
      </button>

      <div id="clarifyStatus" style="margin-top:8px; color:#64748b; font-size:14px"></div>
    </div>
  `;

  const btn = document.getElementById("clarifyBtn");
  const ta = document.getElementById("clarifyText");
  const st = document.getElementById("clarifyStatus");

  const ui = { btn, statusEl: st };

  btn.addEventListener("click", async () => {
    const extra = (ta.value || "").trim();
    if (!extra) {
      st.textContent = "Scrivi una risposta breve oppure clicca un’opzione.";
      return;
    }
    await sendFollowUp(question, extra, ui);
  });

  const pillButtons = Array.from(document.querySelectorAll(".pillBtn"));
  for (const pb of pillButtons) {
    pb.addEventListener("click", async () => {
      const opt = pb.getAttribute("data-opt") || "";
      const extra = opt.trim();
      if (!extra) return;
      ta.value = extra;
      await sendFollowUp(question, extra, ui);
    });
  }
}

function renderAnswer(data) {
  if (isNotSupportedResponse(data)) {
    renderNotSupportedBox(data);
    return;
  }

  const hasQuestions =
    Array.isArray(data.follow_up_questions) &&
    data.follow_up_questions.length > 0;

  if (hasQuestions) {
    renderClarification(data);
    return;
  }

  els.answer.style.display = "block";
  els.ansTitle.textContent = data.title || "Risposta";

  const metaBits = [];
  if (data.difficulty) metaBits.push(`Difficoltà: ${data.difficulty}`);
  if (data.time) metaBits.push(`Tempo: ${data.time}`);
  if (data.risk) metaBits.push(`Rischio: ${data.risk}`);
  els.ansMeta.textContent = metaBits.join(" | ");

  els.ansBody.innerHTML = `
    <div style="margin-bottom:12px;">
      <b>In breve</b>
      <div style="margin-top:6px;">${escapeHtml(data.summary || "")}</div>
    </div>

    <div style="margin-top:16px;"><b>Cosa serve</b>${toList(data.what_you_need, false)}</div>
    <div style="margin-top:16px;"><b>Procedura passo passo</b>${toList(data.steps, true)}</div>
    <div style="margin-top:16px;"><b>Errori da evitare</b>${toList(data.mistakes, false)}</div>

    ${
      Array.isArray(data.when_not_to_do) && data.when_not_to_do.length
        ? `<div style="
            margin-top:16px;
            padding:12px;
            border:1px solid #fecaca;
            border-radius:12px;
            background:#fff1f2;
            max-width:100%;
            box-sizing:border-box;
            overflow:hidden;
          ">
            <b>Quando non farlo</b>
            ${toList(data.when_not_to_do, false)}
          </div>`
        : ""
    }

    <div style="margin-top:16px;">
      <b>Alternativa rapida</b>
      <div style="margin-top:6px;">${escapeHtml(data.quick_alternative || "Non disponibile.")}</div>
    </div>
  `;
}

async function resizeToDataUrl(file) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });

  const maxSide = 1280;
  const w = img.width;
  const h = img.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", 0.82);
}

els.img.addEventListener("change", async () => {
  const file = els.img && els.img.files ? els.img.files[0] : null;
  if (!file) return;

  try {
    setStatus("Preparo la foto...");
    lastImageDataUrl = await resizeToDataUrl(file);
    els.imgMeta.textContent = "Foto pronta";
    setStatus("");
  } catch (e) {
    console.error(e);
    els.imgMeta.textContent = "Non riesco a leggere la foto. Prova un altro file.";
    setStatus("");
  }
});

els.btnSolve.addEventListener("click", async () => {
  const text = (els.q.value || "").trim();
  if (!text && !lastImageDataUrl) {
    setStatus("Scrivi una descrizione o carica una foto.");
    return;
  }

  if (cooldownEndsAt > Date.now()) {
    const left = Math.max(1, Math.ceil((cooldownEndsAt - Date.now()) / 1000));
    setStatus(`Riprova tra ${left}s.`);
    return;
  }

  lastUserText = text;

  els.btnSolve.disabled = true;
  setStatus("Genero la risposta...");

  try {
    const res = await fetch("/api/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        image_data_url: lastImageDataUrl,
        followup: false
      })
    });

    if (res.status === 429) {
      let seconds = 60;
      try {
        const payload = await res.json();
        if (payload && typeof payload.retry_after_seconds === "number") seconds = payload.retry_after_seconds;
      } catch {
        const ra = res.headers.get("Retry-After");
        if (ra) seconds = Number(ra) || seconds;
      }
      startCooldown(seconds);
      return;
    }

    if (!res.ok) {
      const body = await readResponseBody(res);
      setStatus(`Errore API (${res.status}). ${body ? "Dettaglio: " + body : ""}`);
      els.btnSolve.disabled = false;
      return;
    }

    const data = await res.json();
    lastAssistantData = data;
    renderAnswer(data);
    setStatus("");
    startCooldown(6);
  } catch (e) {
    console.error(e);
    setStatus("Errore di rete o deploy. Controlla Vercel Logs.");
    els.btnSolve.disabled = false;
  }
});
