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

    setStatus(`Limite richieste raggiunto. Riprova tra ${left}s.`);
  }, 250);
}

function renderAnswer(data) {
  els.answer.style.display = "block";
  els.ansTitle.textContent = data.title || "Risposta";

  const metaBits = [];
  if (data.difficulty) metaBits.push(`Difficoltà: ${data.difficulty}`);
  if (data.time) metaBits.push(`Tempo: ${data.time}`);
  if (data.risk) metaBits.push(`Rischio: ${data.risk}`);
  els.ansMeta.textContent = metaBits.join(" | ");

  els.ansBody.innerHTML = `
    <div><b>In breve</b><div style="margin-top:6px">${escapeHtml(data.summary || "")}</div></div>

    <div style="margin-top:14px"><b>Cosa serve</b>${toList(data.what_you_need, false)}</div>

    <div style="margin-top:14px"><b>Procedura passo passo</b>${toList(data.steps, true)}</div>

    <div style="margin-top:14px"><b>Errori da evitare</b>${toList(data.mistakes, false)}</div>

    ${
      Array.isArray(data.when_not_to_do) && data.when_not_to_do.length
        ? `<div style="margin-top:14px; padding:10px; border:1px solid #fca5a5; border-radius:10px; background:#fff1f2;">
             <b>Quando non farlo</b>
             ${toList(data.when_not_to_do, false)}
           </div>`
        : ""
    }

    <div style="margin-top:14px"><b>Alternativa rapida</b><div style="margin-top:6px">${escapeHtml(data.quick_alternative || "Non disponibile.")}</div></div>

    <div style="margin-top:14px"><b>Domande utili</b>${toList(data.follow_up_questions, false)}</div>
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
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);

  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, tw, th);

  return canvas.toDataURL("image/jpeg", 0.82);
}

els.img.addEventListener("change", async () => {
  const file = els.img.files && els.img.files[0];
  lastImageDataUrl = null;
  els.imgMeta.textContent = "";

  if (!file) return;

  try {
    setStatus("Preparo la foto...");
    lastImageDataUrl = await resizeToDataUrl(file);
    els.imgMeta.textContent = "Foto pronta";
    setStatus("");
  } catch {
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

  els.btnSolve.disabled = true;
  setStatus("Genero la risposta...");

  try {
    const res = await fetch("/api/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, image_data_url: lastImageDataUrl })
    });

    if (res.status === 429) {
      let seconds = 60;
      try {
        const payload = await res.json();
        if (payload && typeof payload.retry_after_seconds === "number") {
          seconds = payload.retry_after_seconds;
        }
      } catch {
        const ra = res.headers.get("Retry-After");
        if (ra) seconds = Number(ra) || seconds;
      }

      startCooldown(seconds);
      return;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `HTTP ${res.status}`);
    }

    const data = await res.json();
    renderAnswer(data);
    setStatus("");

    // micro cooldown per evitare spam click anche sotto soglia
    startCooldown(8);
  } catch (e) {
    console.error(e);
    setStatus("Errore. Backend non raggiungibile o chiave API non configurata.");
    els.btnSolve.disabled = false;
  }
});
