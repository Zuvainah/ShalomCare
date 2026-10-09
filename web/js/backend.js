let csrfToken = "";
const get = (selector) => document.querySelector(selector);
const clear = (node) => { while (node && node.firstChild) node.removeChild(node.firstChild); };
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["content-type"] = "application/json";
  if (csrfToken && options.method && options.method !== "GET") headers["x-csrf-token"] = csrfToken;
  const response = await fetch(path, { credentials: "same-origin", ...options, headers });
  const value = await response.json().catch(() => ({ error: { message: "The server returned an unreadable response." } }));
  if (!response.ok) throw new Error(value.error?.message || "The request failed.");
  return value.data;
}
function cardList(parent, items, emptyMessage, renderItem) {
  clear(parent);
  if (!items.length) { parent.append(el("div", emptyMessage, "empty")); return; }
  for (const item of items) parent.append(renderItem(item));
}
async function loadArticles() {
  const target = get("#article-list");
  if (!target) return;
  try {
    const response = await fetch("/api/articles?offline=approved", { credentials: "same-origin", cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error?.message || "Approved articles could not be loaded.");
    const data = result.data || [];
    const cacheNotice = get("#article-cache-notice");
    if (cacheNotice) {
      clear(cacheNotice);
      const stale = result.stale || data.some(article => article.stale);
      if (stale) cacheNotice.append(el("p", "Offline copy: these approved articles may be out of date. They could not be refreshed. Last saved: " + (data[0]?.offlineCachedAt ? new Date(data[0].offlineCachedAt).toLocaleString() : "time unavailable") + ".", "notice"));
      else if (data[0]?.offlineCachedAt) cacheNotice.append(el("p", "Saved for offline reading: " + new Date(data[0].offlineCachedAt).toLocaleString() + ".", "muted"));
      else cacheNotice.append(el("p", "Could not refresh offline article copies. No approved articles are available offline yet.", "notice"));
    }
    const query = (get("#article-search")?.value || "").trim().toLowerCase();
    const rows = data.filter(x => (x.title + " " + x.category + " " + x.summary).toLowerCase().includes(query));
    cardList(target, rows, "No approved articles are available yet.", item => {
      const article = el("article", undefined, "card");
      article.append(el("span", item.stale ? "CACHED · MAY BE OUT OF DATE" : "APPROVED HEALTH INFORMATION", "tag"), el("h3", item.title));
      article.append(el("p", item.summary), el("p", item.body), el("small", item.category + " · Reviewed by " + item.reviewed_by, "muted"));
      return article;
    });
  } catch (error) {
    cardList(target, [], error.message + " Reconnect to refresh approved content.", () => null);
    const cacheNotice = get("#article-cache-notice");
    if (cacheNotice) { clear(cacheNotice); cacheNotice.append(el("p", "Content could not be refreshed and no saved copy is available. Reconnect to load approved articles.", "notice")); }
  }
}
async function updateConnectivity() {
  const node = get("#connectivity"); if (!node) return;
  const online = navigator.onLine;
  node.textContent = online ? "Online · articles can refresh. AI, symptom checking and clinic information require connectivity." : "Offline · only the app shell and saved approved articles may be available. AI, symptom checking and live clinic details are unavailable.";
  node.className = "connectivity " + (online ? "online" : "offline");
  const target = get("#offline-cache-status");
  if (target && "caches" in window) {
    const cache = await caches.open("shalomcare-pwa-v1-articles"), keys = await cache.keys();
    target.textContent = keys.length ? `Offline articles saved: ${keys.length}.` : "No approved articles are saved for offline reading.";
  }
}
function initializePwa() {
  updateConnectivity(); window.addEventListener("online", updateConnectivity); window.addEventListener("offline", updateConnectivity);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").then(registration => {
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          const toast = get("#offline-update");
          if (toast) { clear(toast); const message = el("span", "An offline app update is ready. Reload to use it."); const button = el("button", "Reload"); button.onclick = () => window.location.reload(); toast.append(message, button); }
        }
      });
    });
  }).catch(() => { const node = get("#connectivity"); if (node) node.textContent = "Offline support could not start. Reconnect and reload."; });
}
function clearOfflineContent() {
  get("#clear-offline-cache")?.addEventListener("click", async () => {
    if (navigator.serviceWorker.controller) {
      const channel = new MessageChannel();
      await new Promise(resolve => { channel.port1.onmessage = () => resolve(); navigator.serviceWorker.controller.postMessage({ type: "CLEAR_APPROVED_CONTENT" }, [channel.port2]); });
    } else if ("caches" in window) await caches.delete("shalomcare-pwa-v1-articles");
    updateConnectivity();
    const node = get("#offline-cache-status"); if (node) node.textContent = "Saved approved articles removed from this device.";
    if (location.hash.startsWith("#health")) loadArticles();
  });
}
async function loadFacilities() {
  const target = get("#clinic-results");
  if (!target) return;
  try {
    const q = get("#clinic-search")?.value || "";
    const region = get("#region")?.value || "";
    const data = await api("/api/facilities?q=" + encodeURIComponent(q) + "&region=" + encodeURIComponent(region) + "&limit=50");
    cardList(target, data, "No verified facilities match that search.", item => {
      const card = el("article", undefined, "result");
      card.append(el("strong", item.name), el("p", [item.locality, item.region].filter(Boolean).join(", ")));
      if (item.address) card.append(el("p", item.address));
      if (item.services) card.append(el("p", "Verified services: " + item.services));
      return card;
    });
  } catch (error) { cardList(target, [], error.message, () => null); }
}
async function loadSymptomChecker() {
  const host = get("#questionnaire");
  if (!host) return;
  clear(host);
  const banner = el("section", undefined, "notice danger");
  banner.append(el("strong", "Need emergency help?"), el("p", "This website is not an emergency service. For emergencies in Lae and Morobe, Lae City Authority lists 112 for police, fire, and ambulance. Do not wait for this questionnaire. Elsewhere, seek urgent local emergency help."));
  const contacts = el("p");
  const emergency = el("a", "Call 112 (Lae and Morobe)"); emergency.href = "tel:112";
  contacts.append(emergency);
  banner.append(contacts);
  const source = el("p", undefined, "muted");
  const lca = el("a", "PNG LCA emergency information"); lca.href = "https://lca.gov.pg/"; lca.target = "_blank"; lca.rel = "noopener noreferrer";
  source.append(document.createTextNode("Source: "), lca); banner.append(source);
  host.append(banner);
  const disclaimer = el("p", "This tool is not a diagnosis and does not replace assessment by a qualified healthcare professional.", "muted");
  host.append(disclaimer);
  const categories = ["pain", "breathing", "fever", "injury", "other"];
  let selected = "", questions = [], answers = [], current = 0;
  const status = el("div", undefined, "stack"); status.setAttribute("aria-live", "assertive"); host.append(status);
  const selection = el("div", undefined, "field"), label = el("label", "Choose a general concern category"); label.htmlFor = "symptom-category";
  const select = document.createElement("select"); select.id = "symptom-category";
  const initial = el("option", "Select a category"); initial.value = ""; select.append(initial);
  for (const [value, name] of [["pain","Pain or discomfort"],["breathing","Breathing concern"],["fever","Fever or feeling unwell"],["injury","Injury"],["other","Other concern"]]) { const option = el("option", name); option.value = value; select.append(option); }
  selection.append(label, select); host.append(selection);
  const flow = el("div"); host.append(flow);
  const showDisabled = (messageText) => { clear(flow); const card = el("div", undefined, "result"); card.append(el("strong", "Questionnaire unavailable"), el("p", messageText), el("p", "For personal health concerns, seek assessment from a qualified healthcare professional.")); const link = el("a", "Browse verified clinics"); link.href = "#clinics"; card.append(link); flow.append(card); };
  async function advance() {
    const result = await api("/api/symptoms/check", { method: "POST", body: JSON.stringify({ category: selected, answers }) });
    clear(flow);
    if (result.status === "emergency") { const alert = el("div", undefined, "notice danger"); alert.setAttribute("role", "alert"); alert.append(el("h2", "Seek emergency help now"), el("p", result.message), el("p", result.guidance)); flow.append(alert); return; }
    if (result.status === "incomplete" && result.nextQuestion) { questions = [...questions.filter(q => q.id !== result.nextQuestion.id), result.nextQuestion].sort((a,b) => a.position-b.position); current = questions.findIndex(q => q.id === result.nextQuestion.id); renderQuestion(); return; }
    const card = el("div", undefined, result.status === "complete" ? "result" : "notice");
    card.append(el("strong", result.status === "complete" ? (result.urgency || "Guidance").toUpperCase() : "Professional assessment recommended"), el("p", result.message));
    if (result.guidance) card.append(el("p", result.guidance));
    if (result.referralAvailable) { const referral = el("a", "Find a verified clinic"); referral.href = "#clinics"; card.append(referral); }
    flow.append(card);
  }
  function renderQuestion() {
    clear(flow);
    const q = questions[current]; if (!q) return;
    flow.append(el("p", `Question ${current + 1} · reviewed questionnaire`, "muted"));
    const title = el("h2", q.prompt); flow.append(title);
    const form = document.createElement("form"); form.id = "symptom-step";
    for (const option of q.options || []) { const choice = el("label", undefined, "choice"); const input = document.createElement("input"); input.type = "radio"; input.name = "answer"; input.value = option.value; input.required = true; input.checked = answers.some(a => a.questionId === q.id && a.value === option.value); choice.append(input, document.createTextNode(" " + option.label)); form.append(choice); }
    const actions = el("div", undefined, "actions");
    if (current > 0) { const back = el("button", "Back", "secondary"); back.type = "button"; back.onclick = () => { current--; renderQuestion(); }; actions.append(back); }
    const next = el("button", "Continue"); actions.append(next); form.append(actions);
    form.onsubmit = async event => { event.preventDefault(); const picked = form.querySelector("input[name=answer]:checked"); if (!picked) return; answers = answers.filter(a => a.questionId !== q.id); answers.push({ questionId: q.id, value: picked.value }); try { await advance(); } catch (error) { showDisabled(error.message); } };
    flow.append(form);
  }
  select.addEventListener("change", async () => {
    selected = select.value; answers = []; questions = []; current = 0; clear(flow);
    if (!selected) return;
    try {
      const data = await api("/api/symptoms/questions?category=" + encodeURIComponent(selected));
      if (!data.available) { showDisabled(data.message); return; }
      questions = data.questions; renderQuestion();
    } catch (error) { showDisabled(error.message); }
  });
}
function appendChatMessage(container, text, who) {
  const bubble = el("div", undefined, "bubble" + (who === "user" ? " user" : ""));
  bubble.textContent = text;
  container.append(bubble);
  return bubble;
}
function activateAssistant() {
  const chat = get("#chat"), form = get("#chat-form");
  if (!chat || !form) return;
  const input = get("#chat-question");
  const status = get("#assistant-status");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const messageText = (input.value || "").trim();
    if (!messageText) { status.textContent = "Enter a general health-information question."; return; }
    if (messageText.length > 1200) { status.textContent = "Keep your question under 1,200 characters."; return; }
    if (/\b(name is|phone number|my address|email is|patient id|date of birth)\b/i.test(messageText)) { status.textContent = "Please remove names, contact details, exact addresses, or other identifying information before sending."; return; }
    input.value = "";
    appendChatMessage(chat, messageText, "user");
    const waiting = appendChatMessage(chat, "Checking approved health information…", "assistant");
    const submit = form.querySelector("button[type=submit]"); submit.disabled = true; status.textContent = "";
    try {
      const result = await api("/api/assistant", { method: "POST", body: JSON.stringify({ message: messageText }) });
      waiting.textContent = result.answer;
      if (result.sources?.length) {
        const sources = el("p", undefined, "muted"); sources.append(document.createTextNode("Approved sources: "));
        result.sources.forEach((source, index) => { const link = el("a", source.title); link.href = "#health"; sources.append(link); if (index < result.sources.length - 1) sources.append(document.createTextNode(" · ")); });
        waiting.append(sources);
      }
      if (result.emergency) waiting.setAttribute("role", "alert");
    } catch (error) { waiting.textContent = error.message.includes("limit") ? error.message : "The AI assistant is unavailable right now. Please use approved health articles or seek help from a qualified healthcare professional."; }
    finally { submit.disabled = false; chat.scrollTop = chat.scrollHeight; }
  });
}
function message(node, text, kind = "result") { const target = get(node); if (target) { clear(target); target.append(el("p", text, kind)); } }
function adminShell() {
  const host = get("#app");
  host.innerHTML = "<section class=\"pagehead\"><span class=\"eyebrow\">ShalomCare AI · Private administration</span><h1>Admin workspace</h1><p class=\"lead\">Manage educational articles and facility directory records.</p></section><section id=\"admin-content\" class=\"panel\" aria-live=\"polite\">Checking administrator access…</section>";
  setupAdmin();
}
async function setupAdmin() {
  const panel = get("#admin-content");
  try {
    const status = await api("/api/admin/bootstrap-status");
    if (!status.configured && status.canBootstrap) return showBootstrap(panel);
    if (!status.configured) { panel.textContent = "Administrator setup is available only to the Site owner. The Site owner must configure the bootstrap identity first."; return; }
    showLogin(panel);
  } catch (error) { panel.textContent = error.message; }
}
function showBootstrap(panel) {
  panel.innerHTML = "<h2>Set up the first administrator</h2><p>This one-time step is limited to the Site owner. Choose a strong password of at least 12 characters.</p><form id=\"bootstrap-form\"><div class=\"field\"><label for=\"setup-email\">Administrator email</label><input id=\"setup-email\" type=\"email\" required autocomplete=\"email\"></div><div class=\"field\" style=\"margin-top:14px\"><label for=\"setup-password\">Password</label><input id=\"setup-password\" type=\"password\" required minlength=\"12\" autocomplete=\"new-password\"></div><button style=\"margin-top:18px\">Create administrator</button></form><div id=\"admin-message\" aria-live=\"polite\"></div>";
  get("#bootstrap-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await api("/api/admin/bootstrap", { method: "POST", body: JSON.stringify({ email: get("#setup-email").value, password: get("#setup-password").value }) });
      message("#admin-message", "Administrator created. Sign in below.");
      showLogin(panel);
    } catch (error) { message("#admin-message", error.message, "notice"); }
  });
}
function showLogin(panel) {
  panel.innerHTML = "<h2>Administrator sign in</h2><p>Only administrator accounts can edit or publish records.</p><form id=\"login-form\"><div class=\"field\"><label for=\"admin-email\">Email</label><input id=\"admin-email\" type=\"email\" required autocomplete=\"username\"></div><div class=\"field\" style=\"margin-top:14px\"><label for=\"admin-password\">Password</label><input id=\"admin-password\" type=\"password\" required autocomplete=\"current-password\"></div><button style=\"margin-top:18px\">Sign in</button></form><div id=\"admin-message\" aria-live=\"polite\"></div>";
  get("#login-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const result = await api("/api/admin/session", { method: "POST", body: JSON.stringify({ email: get("#admin-email").value, password: get("#admin-password").value }) });
      csrfToken = result.csrfToken;
      showWorkspace(panel, result.email);
    } catch (error) { message("#admin-message", error.message, "notice"); }
  });
}
function showWorkspace(panel, email) {
  panel.innerHTML = "<div class=\"actions\"><h2>Administrator workspace</h2><span class=\"muted\" id=\"admin-identity\"></span><button id=\"admin-signout\" class=\"secondary\">Sign out</button></div><div class=\"two\"><section><h3>Create an article</h3><form id=\"article-form\"><div class=\"field\"><label for=\"a-title\">Title</label><input id=\"a-title\" required minlength=\"3\"></div><div class=\"field\"><label for=\"a-slug\">Slug</label><input id=\"a-slug\" required pattern=\"[a-z0-9]+(-[a-z0-9]+)*\"></div><div class=\"field\"><label for=\"a-category\">Category</label><input id=\"a-category\" required></div><div class=\"field\"><label for=\"a-summary\">Summary</label><textarea id=\"a-summary\" required minlength=\"10\"></textarea></div><div class=\"field\"><label for=\"a-body\">Article text</label><textarea id=\"a-body\" required minlength=\"20\"></textarea></div><label><input id=\"a-approved\" type=\"checkbox\"> Mark as clinically reviewed and approved</label><div class=\"field\"><label for=\"a-reviewer\">Reviewer</label><input id=\"a-reviewer\"></div><div class=\"field\"><label for=\"a-evidence\">Review source or evidence</label><input id=\"a-evidence\"></div><button style=\"margin-top:12px\">Save article</button></form></section><section><h3>Add facility record</h3><p>Only mark a facility verified after independent confirmation.</p><form id=\"facility-form\"><div class=\"field\"><label for=\"f-name\">Facility name</label><input id=\"f-name\" required></div><div class=\"field\"><label for=\"f-region\">Region</label><input id=\"f-region\" required></div><div class=\"field\"><label for=\"f-locality\">Locality</label><input id=\"f-locality\"></div><div class=\"field\"><label for=\"f-address\">Address</label><input id=\"f-address\"></div><label><input id=\"f-verified\" type=\"checkbox\"> Mark verified</label><div class=\"field\"><label for=\"f-verifier\">Verifier</label><input id=\"f-verifier\"></div><div class=\"field\"><label for=\"f-source\">Verification source</label><input id=\"f-source\"></div><button style=\"margin-top:12px\">Save facility</button></form></section></div><div id=\"admin-message\" aria-live=\"polite\"></div><div class=\"two\"><section><h3>Articles</h3><div id=\"admin-articles\" class=\"stack\"></div></section><section><h3>Facilities</h3><div id=\"admin-facilities\" class=\"stack\"></div></section></div>";
  for (const [id, label, hint] of [
    ["f-services", "Services (one per line: name | details | source)", "Verified services are shown publicly only for verified facilities."],
    ["f-contacts", "Contacts (one per line: phone, email or website | value | source)", "Only verified contact details are shown publicly."],
  ]) {
    const wrap = el("div", undefined, "field"), lab = el("label", label), area = document.createElement("textarea");
    area.id = id; area.rows = 3; lab.htmlFor = id; wrap.append(lab, area);
    const button = get("#facility-form button"); button.before(wrap);
    if (hint) wrap.append(el("small", hint, "muted"));
  }
  get("#admin-identity").textContent = email;
  get("#admin-signout").addEventListener("click", async () => { try { await api("/api/admin/session", { method: "DELETE" }); } finally { csrfToken = ""; showLogin(panel); } });
  get("#article-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await api("/api/admin/articles", { method: "POST", body: JSON.stringify({ title: get("#a-title").value, slug: get("#a-slug").value, category: get("#a-category").value, summary: get("#a-summary").value, body: get("#a-body").value, status: get("#a-approved").checked ? "approved" : "draft", reviewedBy: get("#a-reviewer").value, reviewEvidence: get("#a-evidence").value }) });
      message("#admin-message", "Article saved.");
      get("#article-form").reset(); await loadAdminLists();
    } catch (error) { message("#admin-message", error.message, "notice"); }
  });
  get("#facility-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const splitLines = value => value.split("\n").map(line => line.trim()).filter(Boolean).map(line => line.split("|").map(part => part.trim()));
      const services = splitLines(get("#f-services").value).map(([name, details, source]) => ({ name, details, source }));
      const contacts = splitLines(get("#f-contacts").value).map(([type, value, source]) => ({ type, value, source }));
      if (services.some(x => !x.name || !x.details || !x.source) || contacts.some(x => !x.type || !x.value || !x.source)) throw new Error("Complete each service and contact as three values separated by |.");
      await api("/api/admin/facilities", { method: "POST", body: JSON.stringify({ name: get("#f-name").value, region: get("#f-region").value, locality: get("#f-locality").value, address: get("#f-address").value, isVerified: get("#f-verified").checked, verifiedBy: get("#f-verifier").value, verificationSource: get("#f-source").value, services, contacts }) });
      message("#admin-message", "Facility record saved.");
      get("#facility-form").reset(); await loadAdminLists();
    } catch (error) { message("#admin-message", error.message, "notice"); }
  });
  loadAdminLists();
}
async function loadAdminLists() {
  try {
    const [articles, facilities] = await Promise.all([api("/api/admin/articles?limit=50"), api("/api/admin/facilities?limit=50")]);
    cardList(get("#admin-articles"), articles, "No article records yet.", item => el("div", item.title + " · " + item.status + (item.is_demo ? " · demo" : ""), "result"));
    cardList(get("#admin-facilities"), facilities, "No facility records yet.", item => el("div", item.name + " · " + (item.is_verified ? "verified" : "unverified"), "result"));
  } catch (error) { message("#admin-message", error.message, "notice"); }
}
function activate() {
  const page = location.hash.slice(1).split("?")[0] || "home";
  if (page === "admin" && !navigator.onLine) { const host = get("#app"); if (host) host.textContent = "Administrator access requires a secure online connection. No administrator content is available offline."; updateConnectivity(); return; }
  if (page === "symptoms") loadSymptomChecker();
  if (page === "assistant") activateAssistant();
  if (page === "health") { loadArticles(); get("#article-search")?.addEventListener("input", loadArticles); }
  if (page === "clinics") { loadFacilities(); get("#clinic-search")?.addEventListener("input", loadFacilities); get("#region")?.addEventListener("change", loadFacilities); }
  if (page === "admin") adminShell();
  clearOfflineContent();
}
window.addEventListener("hashchange", activate);
initializePwa();
activate();
