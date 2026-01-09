// app.js
const state = {
  entries: [],
  synonyms: {},
  loaded: false,
};

const els = {
  q: null,
  btnSearch: null,
  chips: null,
  viewHome: null,
  viewDoc: null,
  viewPage: null,
  resultsSection: null,
  resultsTitle: null,
  resultsMeta: null,
  resultsList: null,
  docContent: null,
  pageContent: null,
};

function $(id){ return document.getElementById(id); }

function normalizeText(s){
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandSynonyms(query){
  const q = normalizeText(query);
  if(!q) return { raw: "", expanded: "" };

  const tokens = q.split(" ");
  const expanded = [];

  for(const t of tokens){
    expanded.push(t);
    const syn = state.synonyms[t];
    if(Array.isArray(syn)){
      for(const s of syn){
        const n = normalizeText(s);
        if(n && !expanded.includes(n)) expanded.push(n);
      }
    }
  }

  return { raw: q, expanded: expanded.join(" ") };
}

function scoreEntry(entry, qRaw, qExpanded){
  const hay = entry._haystack;
  if(!hay) return 0;

  const rawTokens = qRaw.split(" ").filter(Boolean);
  const expTokens = qExpanded.split(" ").filter(Boolean);

  let score = 0;

  for(const t of rawTokens){
    if(hay.includes(` ${t} `)) score += 10;
    else if(hay.includes(t)) score += 6;
  }

  for(const t of expTokens){
    if(hay.includes(` ${t} `)) score += 4;
    else if(hay.includes(t)) score += 2;
  }

  if(rawTokens.length){
    const joined = rawTokens.join(" ");
    if(hay.includes(joined)) score += 12;
  }

  if(entry.boost) score += entry.boost;

  return score;
}

function buildHaystack(entry){
  const parts = [];
  parts.push(entry.title || "");
  parts.push(entry.surface || "");
  parts.push(entry.problem || "");
  parts.push(entry.summary || "");
  if(Array.isArray(entry.tags)) parts.push(entry.tags.join(" "));
  if(Array.isArray(entry.keywords)) parts.push(entry.keywords.join(" "));
  const s = normalizeText(parts.join(" "));
  return ` ${s} `;
}

function renderResults(items, q){
  els.resultsSection.hidden = false;
  els.resultsTitle.textContent = q ? `Risultati per “${q}”` : "Risultati";
  els.resultsMeta.textContent = `${items.length} trovati`;
  els.resultsList.innerHTML = "";

  if(items.length === 0){
    els.resultsList.innerHTML = `
      <div class="card">
        <p class="cardTitle">Nessun risultato preciso</p>
        <p class="cardDesc">Prova a scrivere superficie e problema. Esempio “tessuto macchia” oppure “doccia calcare”.</p>
        <p class="cardDesc">Oppure usa i suggerimenti rapidi.</p>
      </div>
    `;
    return;
  }

  for(const e of items){
    const badges = [
      e.surface ? `<span class="badge">${escapeHtml(e.surface)}</span>` : "",
      e.problem ? `<span class="badge">${escapeHtml(e.problem)}</span>` : "",
      e.difficulty ? `<span class="badge">Difficoltà: ${escapeHtml(e.difficulty)}</span>` : "",
      e.time ? `<span class="badge">Tempo: ${escapeHtml(e.time)}</span>` : "",
    ].filter(Boolean).join("");

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="cardTitle">${escapeHtml(e.title)}</div>
      <div class="cardBadges">${badges}</div>
      <p class="cardDesc">${escapeHtml(e.summary || "")}</p>
      <a class="cardLink" href="#/scheda/${encodeURIComponent(e.id)}">Apri procedura</a>
    `;
    els.resultsList.appendChild(card);
  }
}

function renderDoc(entry){
  const danger = entry.when_not_to_do && entry.when_not_to_do.length
    ? `<div class="callout"><strong>Quando NON farlo</strong><div style="margin-top:8px">${toList(entry.when_not_to_do, false)}</div></div>`
    : "";

  const kpis = [
    entry.difficulty ? `<span class="kpi">Difficoltà: ${escapeHtml(entry.difficulty)}</span>` : "",
    entry.time ? `<span class="kpi">Tempo stimato: ${escapeHtml(entry.time)}</span>` : "",
    entry.risk ? `<span class="kpi">Rischio: ${escapeHtml(entry.risk)}</span>` : "",
  ].filter(Boolean).join("");

  els.docContent.innerHTML = `
    <h1>${escapeHtml(entry.title)}</h1>
    <div class="kpis">${kpis}</div>

    <div class="section">
      <h2>Cosa serve</h2>
      ${toList(entry.what_you_need, false)}
    </div>

    <div class="section">
      <h2>Procedura passo passo</h2>
      ${toList(entry.steps, true)}
    </div>

    <div class="section">
      <h2>Errori da evitare</h2>
      ${toList(entry.mistakes, false)}
    </div>

    ${danger}

    <div class="section">
      <h2>Alternativa rapida</h2>
      ${entry.quick_alternative ? `<p>${escapeHtml(entry.quick_alternative)}</p>` : "<p>Non disponibile per questa scheda.</p>"}
    </div>

    <div class="section">
      <h2>Note</h2>
      ${entry.notes ? `<p>${escapeHtml(entry.notes)}</p>` : "<p>Nessuna nota aggiuntiva.</p>"}
    </div>
  `;
}

function renderCategories(){
  const bySurface = new Map();
  for(const e of state.entries){
    const k = e.surface || "Altro";
    if(!bySurface.has(k)) bySurface.set(k, []);
    bySurface.get(k).push(e);
  }

  const surfaces = Array.from(bySurface.keys()).sort((a,b) => a.localeCompare(b, "it"));

  const htmlLinks = surfaces.map(s => {
    const count = bySurface.get(s).length;
    const slug = encodeURIComponent(normalizeText(s).replace(/\s+/g, "_"));
    return `<a href="#/categoria/${slug}">${escapeHtml(s)} <span class="meta">(${count})</span></a>`;
  }).join("");

  els.pageContent.innerHTML = `
    <h1>Categorie</h1>
    <p>Scegli una superficie. Dentro trovi schede già pronte.</p>
    <div class="list">${htmlLinks}</div>
  `;
}

function renderCategory(slug){
  const key = (slug || "").toString();
  const target = key.replace(/_/g, " ");
  const items = state.entries.filter(e => normalizeText(e.surface || "") === target);

  const htmlLinks = items
    .sort((a,b) => (a.title || "").localeCompare(b.title || "", "it"))
    .map(e => `<a href="#/scheda/${encodeURIComponent(e.id)}">${escapeHtml(e.title)}</a>`)
    .join("");

  els.pageContent.innerHTML = `
    <h1>${escapeHtml(items[0]?.surface || "Categoria")}</h1>
    <p>Se non trovi il tuo caso specifico, torna alla ricerca e scrivi superficie e problema.</p>
    <div class="list">${htmlLinks || "<p>Nessuna scheda in questa categoria.</p>"}</div>
  `;
}

function renderStaticPage(key){
  if(key === "come-funziona"){
    els.pageContent.innerHTML = `
      <h1>Come funziona</h1>
      <p>Pulire Meglio è una raccolta di schede pratiche. Ogni scheda ha sempre lo stesso formato, così trovi subito quello che ti serve.</p>
      <p>Per ottenere risultati migliori, scrivi due elementi nella ricerca: la superficie e il problema.</p>
      <p>Esempi utili: “doccia calcare”, “forno incrostato”, “divano tessuto macchia”, “odore lavatrice”.</p>
    `;
    return;
  }

  if(key === "contribuisci"){
    els.pageContent.innerHTML = `
      <h1>Contribuisci</h1>
      <p>Vuoi aggiungere una nuova scheda o migliorare una procedura? Apri una pull request.</p>
      <p>Il contenuto vive nel file data/entries.json. Mantieni lo schema e usa frasi brevi.</p>
      <p>Regola principale: prima la sicurezza. Se una superficie è delicata, aggiungi sempre “Quando NON farlo”.</p>
    `;
    return;
  }

  els.pageContent.innerHTML = `
    <h1>Pagina non trovata</h1>
    <p>Torna alla ricerca e riprova.</p>
  `;
}

function toList(arr, ordered){
  if(!Array.isArray(arr) || arr.length === 0){
    return "<p>Non disponibile per questa scheda.</p>";
  }
  const tag = ordered ? "ol" : "ul";
  const items = arr.map(x => `<li>${escapeHtml(x)}</li>`).join("");
  return `<${tag}>${items}</${tag}>`;
}

function escapeHtml(s){
  return (s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function showView(name){
  els.viewHome.hidden = name !== "home";
  els.viewDoc.hidden = name !== "doc";
  els.viewPage.hidden = name !== "page";
}

function parseRoute(){
  const h = (location.hash || "#/").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  const root = parts[0] || "";
  const a = parts[1] || "";
  const b = parts[2] || "";
  return { root, a, b, raw: h };
}

function runSearch(fromRoute){
  const q = (els.q.value || "").trim();
  const { raw, expanded } = expandSynonyms(q);

  if(!raw){
    els.resultsSection.hidden = true;
    els.resultsList.innerHTML = "";
    els.resultsMeta.textContent = "";
    if(!fromRoute) location.hash = "#/";
    return;
  }

  const scored = state.entries
    .map(e => ({ e, s: scoreEntry(e, raw, expanded) }))
    .filter(x => x.s > 0)
    .sort((x,y) => y.s - x.s)
    .slice(0, 24)
    .map(x => x.e);

  renderResults(scored, q);
  if(!fromRoute) location.hash = `#/cerca/${encodeURIComponent(q)}`;
}

function handleRoute(){
  if(!state.loaded) return;

  const r = parseRoute();

  if(r.root === "" || r.root === "#"){
    showView("home");
    els.resultsSection.hidden = true;
    return;
  }

  if(r.root === "cerca"){
    const q = decodeURIComponent(r.a || "");
    showView("home");
    els.q.value = q;
    runSearch(true);
    return;
  }

  if(r.root === "scheda"){
    const id = decodeURIComponent(r.a || "");
    const entry = state.entries.find(x => x.id === id);
    if(!entry){
      showView("page");
      renderStaticPage("404");
      return;
    }
    showView("doc");
    renderDoc(entry);
    return;
  }

  if(r.root === "categorie"){
    showView("page");
    renderCategories();
    return;
  }

  if(r.root === "categoria"){
    showView("page");
    renderCategory(decodeURIComponent(r.a || ""));
    return;
  }

  if(r.root === "come-funziona" || r.root === "contribuisci"){
    showView("page");
    renderStaticPage(r.root);
    return;
  }

  showView("page");
  renderStaticPage("404");
}

async function loadData(){
  const [entriesRes, synRes] = await Promise.all([
    fetch("data/entries.json", { cache: "no-store" }),
    fetch("data/synonyms.json", { cache: "no-store" }),
  ]);

  const entries = await entriesRes.json();
  const synonyms = await synRes.json();

  state.entries = entries.map(e => {
    const copy = { ...e };
    copy._haystack = buildHaystack(copy);
    return copy;
  });
  state.synonyms = synonyms || {};
  state.loaded = true;
}

function bindUI(){
  els.q = $("q");
  els.btnSearch = $("btnSearch");
  els.chips = document.querySelectorAll(".chip");
  els.viewHome = $("viewHome");
  els.viewDoc = $("viewDoc");
  els.viewPage = $("viewPage");
  els.resultsSection = $("resultsSection");
  els.resultsTitle = $("resultsTitle");
  els.resultsMeta = $("resultsMeta");
  els.resultsList = $("resultsList");
  els.docContent = $("docContent");
  els.pageContent = $("pageContent");

  els.btnSearch.addEventListener("click", () => runSearch(false));
  els.q.addEventListener("keydown", (e) => {
    if(e.key === "Enter") runSearch(false);
  });

  for(const c of els.chips){
    c.addEventListener("click", () => {
      const s = c.getAttribute("data-suggest") || "";
      els.q.value = s;
      runSearch(false);
    });
  }

  window.addEventListener("hashchange", handleRoute);
}

(async function init(){
  bindUI();
  await loadData();
  handleRoute();
})();
