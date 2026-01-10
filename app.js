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

function renderClarification(data) {
  els.answer.style.display = "block";
  els.ansTitle.textContent = "Mi serve un dettaglio in più";

  els.ansMeta.textContent =
    "Per darti una procedura corretta devo prima chiarire questo punto.";

  els.ansBody.innerHTML = `
    <div style="margin-bottom:14px">
      <b>Domande rapide</b>
      ${toList(data.follow_up_questions, false)}
    </div>

    <div style="
      padding:12px;
      border:1px solid #1e293b;
      border-radius:12px;
      background:#0b1220;
    ">
      <div style="font-size:14px; color:#94a3b8; margin-bottom:8px">
        Rispondi con una frase breve (esempio: “è vetro, calcare vecchio”)
      </div>

      <textarea id="clarifyText" rows="3" style="
        width:100%;
        padding:12px;
        border-radius:10px;
        border:1px solid #1e293b;
        background:#020617;
        color:#e5e7eb;
        outline:none;
      "></textarea>

      <button id="clarifyBtn" type="button" style="
        margin-top:10px;
        height:42px;
        padding:0 16px;
        border-radius:12px;
        border:none;
        font-weight:800;
        cursor:pointer;
        background: linear-gradient(90deg, #60a5fa, #22c55e);
        color:#052e16;
      ">
        Aggiorna soluzione
      </button>

      <div id="clarifyStatus" style="margin-top:8px; color:#94a3b8; font-size:14px"></div>
    </div>
  `;

  const btn = document.getElementById("clarifyBtn");
  const ta = document.getElementById("clarifyText");
  const st = document.getElementById("clarifyStatus");

  btn.addEventListener("click", async () => {
    const extra = (ta.value || "").trim();
    if (!extra) {
      st.textContent = "Scrivi una risposta breve.";
      return;
    }

    btn.disabled = true;
    st.textContent = "Aggiorno la soluzione...";

    const context = [
      "Richiesta iniziale:",
      lastUserText,
      "",
      "Risposta precedente (incompleta):",
      JSON.stringify(lastAssistantData || {}, null, 2),
      "",
      "Nuove informazioni:",
      extra,
      "",
      "Genera ora una soluzione completa e finale."
    ].join("\n");

    try {
      const res = await fetch("/api/solve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: context,
          image_data_url: lastImageDataUrl
        })
      });

      if (res.status === 429) {
        startCooldown(30);
        return;
      }

      if (!res.ok) throw new Error("Errore");

      const data = await res.json();
      lastAssistantData = data;
      renderAnswer(data);
      startCooldown(10);
    } catch (e) {
      console.error(e);
      st.textContent = "Errore durante l’aggiornamento. Riprova.";
    } finally {
      btn.disabled = false;
    }
  });
}

function renderAnswer(data) {
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
    <div><b>In breve</b><div style="margin-top:6px">${escapeHtml(data.summary)}</div></div>
    <div style="margin-top:14px"><b>Cosa serve</b>${toList(data.what_you_need, false)}</div>
    <div style="margin-top:14px"><b>Procedura passo passo</b>${toList(data.steps, true)}</div>
    <div style="margin-top:14px"><b>Errori da evitare</b>${toList(data.mistakes, false)}</div>
    ${
      data.when_not_to_do.length
        ? `<div style="margin-top:14px; padding:10px; border:1px solid #fca5a5; border-radius:10px; background:#fff1f2;">
             <b>Quando non farlo</b>${toList(data.when_not_to_do, false)}
           </div>`
        : ""
    }
    <div style="margin-top:14px"><b>Alternativa rapida</b><div style="margin-top:6px">${escapeHtml(data.quick_alternative)}</div></div>
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
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));

  const canvas = document.createElement("canvas");
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", 0.82);
}

els.img.addEventListener("change", async () => {
  const file = els.img.files[0];
  if (!file) return;

  setStatus("Preparo la foto...");
  lastImageDataUrl = await resizeToDataUrl(file);
  els.imgMeta.textContent = "Foto pronta";
  setStatus("");
});

els.btnSolve.addEventListener("click", async () => {
  const text = (els.q.value || "").trim();
  if (!text && !lastImageDataUrl) {
    setStatus("Scrivi una descrizione o carica una foto.");
    return;
  }

  lastUserText = text;

  els.btnSolve.disabled = true;
  setStatus("Genero la risposta...");

  try {
    const res = await fetch("/api/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, image_data_url: lastImageDataUrl })
    });

    if (res.status === 429) {
      startCooldown(60);
      return;
    }

    if (!res.ok) throw new Error("Errore");

    const data = await res.json();
    lastAssistantData = data;
    renderAnswer(data);
    startCooldown(8);
  } catch (e) {
    console.error(e);
    setStatus("Errore. Riprova tra poco.");
    els.btnSolve.disabled = false;
  }
});
