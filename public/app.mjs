import { validateRecord, parseQuantity, supplyCSV } from "./domain.mjs";
import { emptyWorkspace, queueRecord, pendingFor, applyResults, mergeRemote, acceptRemote, discardedIds } from "./sync-core.mjs";
import { openWorkspace } from "./db.mjs";

const icons = {
  animal:'<path d="M3 4c0 5 4 6 7 5m11-5c0 5-4 6-7 5M7 9l2 12h6l2-12-5-3zM10 16h.1M14 16h.1"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
  leaf:'<path d="M20 3C9 2 2 7 5 15s17 5 15-12zM4 21 16 9"/>',
  layers:'<path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  home:'<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
  sync:'<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',
  users:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5"/>',
  settings:'<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',
  plus:'<path d="M12 4v16M4 12h16"/>', download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  moon:'<path d="M20 14A9 9 0 0 1 10 4a9 9 0 1 0 10 10z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.1"/>', check:'<path d="m5 12 4 4L19 6"/>'
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] ?? icons.info}</svg>`;
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const labelKind = { farm: "fazenda", lot: "lote", food: "alimento", supply: "fornecimento" };
const dateLabel = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split("-").reverse().join("/") : date;
const quantityLabel = (q) => String(q).replace(".", ",");
const when = (value) => value ? new Date(value).toLocaleString("pt-BR") : "Ainda não sincronizado";
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
function getPref(key) { try { return localStorage.getItem(key); } catch { return null; } }
function setPref(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* Falhas do banco local são mostradas ao salvar. */ } }

let user = null, local = null, workspace = emptyWorkspace(), team = [];
let saving = false, syncing = false, reachable = false, lastError = "", authMode = "login", toastTimer, installPrompt;
let selectedFarm = getPref("pecuaria-farm") ?? "";
let paused = getPref("pecuaria-sync-paused") === "true";
const filters = { search: "", from: "", to: "", status: "active" };
const navItems = [["supplies","Fornecimentos","leaf"], ["lots","Lotes","animal"], ["foods","Alimentos","layers"], ["farms","Fazendas","home"], ["sync","Sincronização","sync"], ["team","Equipe","users"], ["settings","Preferências","settings"]];
const records = (kind, farmId = null) => Object.values(workspace.records).filter((r) => r.kind === kind && (!farmId || r.data.farmId === farmId));
const currentFarm = () => workspace.records[selectedFarm];
const page = () => navItems.some(([id]) => id === location.hash.slice(1)) ? location.hash.slice(1) : "supplies";
const problemFor = (id) => pendingFor(workspace, id).find((op) => op.status !== "pending");

function toast(message) {
  clearTimeout(toastTimer); $("#toast").textContent = message; $("#toast").hidden = false;
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 6000);
}
function fail(error) {
  const box = $("#modal[open] .form-error") ?? (!$("#auth").hidden ? $("#auth .form-error") : null);
  if (box) { box.textContent = error.message; box.hidden = false; box.focus(); }
  else { lastError = error.message; render(); toast(error.message); }
}
async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(path, { method, credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", ...(user?.csrf ? { "X-CSRF-Token": user.csrf } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12_000) });
  } catch { const error = new Error("Sem conexão com o servidor. Seus registros já salvos continuam neste aparelho."); error.network = true; throw error; }
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error ?? "Não foi possível concluir."); error.status = response.status; throw error; }
  return data;
}
function rememberUser() { const { csrf, ...profile } = user; setPref("pecuaria-profile", JSON.stringify(profile)); }
async function saveWorkspace(next) { workspace = await local.save(next, workspace.localRevision ?? 0); }
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme; setPref("pecuaria-theme", theme);
  $("#theme").innerHTML = svg(theme === "dark" ? "sun" : "moon");
  $("#theme").setAttribute("aria-label", theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro");
}
function menu(open = false) {
  document.body.classList.toggle("menu-open", open);
  const mobile = innerWidth <= 800;
  $("#sidebar").inert = mobile && !open;
  $("#sidebar").setAttribute("aria-hidden", String(mobile && !open));
  $("#toggleNav").setAttribute("aria-expanded", String(mobile ? open : !document.body.classList.contains("collapsed")));
}
function formError() { return '<div class="form-error" role="alert" tabindex="-1" hidden></div>'; }
function field(name, label, content, help = "", wide = false) {
  return `<label class="field${wide ? " span2" : ""}">${label}${content}${help ? `<small>${help}</small>` : ""}</label>`;
}
const input = (name, value = "", attrs = "") => `<input name="${name}" value="${esc(value)}" ${attrs}>`;
const button = (action, label, icon = "", primary = false, extra = "") => `<button type="button" class="button${primary ? " primary" : ""}" data-action="${action}" ${extra}>${icon ? svg(icon) : ""}${label}</button>`;
function head(eyebrow, title, description, actions = "") {
  return `<div class="pagehead"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="lead">${description}</p></div>${actions ? `<div class="actions">${actions}</div>` : ""}</div>`;
}
function empty(title, description, action = "", icon = "leaf") {
  return `<div class="empty">${svg(icon)}<h2>${title}</h2><p>${description}</p>${action}</div>`;
}
function syncBadge(id) {
  const pending = pendingFor(workspace, id);
  if (pending.some((op) => op.status !== "pending")) return '<span class="badge error">Revisar envio</span>';
  return pending.length ? '<span class="badge pending">Salvo no aparelho</span>' : '<span class="badge">Sincronizado</span>';
}
function recordSummary(record) {
  if (!record) return "Este registro ainda não existe no servidor.";
  const d = record.data;
  if (record.kind !== "supply") return `Nome: ${d.name}\nSituação: ${d.active ? "Ativo" : "Arquivado"}`;
  return `Data: ${dateLabel(d.date)}\nLote: ${d.lotName ?? workspace.records[d.lotId]?.data.name ?? "—"}\nAlimento: ${d.foodName ?? workspace.records[d.foodId]?.data.name ?? "—"}\nQuantidade: ${quantityLabel(d.quantity)} kg\nSituação: ${d.status === "cancelled" ? "Cancelado" : "Ativo"}${d.notes ? `\nObservação: ${d.notes}` : ""}${d.cancelReason ? `\nMotivo: ${d.cancelReason}` : ""}`;
}

function renderChrome() {
  const farms = records("farm").sort((a,b) => a.data.name.localeCompare(b.data.name,"pt-BR"));
  if (!farms.some((r) => r.id === selectedFarm)) selectedFarm = farms.find((r) => r.data.active)?.id ?? farms[0]?.id ?? "";
  $("#farmSelect").innerHTML = farms.length ? farms.map((r) => `<option value="${r.id}" ${r.id === selectedFarm ? "selected" : ""}>${esc(r.data.name)}${r.data.active ? "" : " (arquivada)"}</option>`).join("") : '<option value="">Cadastre uma fazenda</option>';
  $("#accountLabel").textContent = user.accountName;
  $("#userLabel").textContent = `${user.name} · ${user.role === "owner" ? "Administrador" : "Operador"}`;
  $("#navigation").innerHTML = navItems.filter(([id]) => id !== "team" || user.role === "owner").map(([id,label,icon]) => `<a href="#${id}" title="${label}" ${page() === id ? 'aria-current="page"' : ""}>${svg(icon)}<span class="navlabel">${label}</span>${id === "sync" && workspace.outbox.length ? `<span class="navcount">${workspace.outbox.length}</span>` : ""}</a>`).join("");
  const connection = $("#connection");
  connection.textContent = syncing ? "Sincronizando…" : paused ? "Sincronização pausada" : !reachable ? "Trabalhando offline" : workspace.outbox.length ? `${workspace.outbox.length} envio(s) pendente(s)` : "Tudo sincronizado";
  connection.classList.toggle("offline", !reachable || paused || workspace.outbox.length > 0);
  $("#footerSync").textContent = workspace.lastSync ? `Última sincronização: ${when(workspace.lastSync)}` : "Registros protegidos neste aparelho.";
  menu(document.body.classList.contains("menu-open"));
}
function filteredSupplies() {
  return records("supply", selectedFarm).filter((r) => {
    const d = r.data;
    const search = [d.lotName, d.foodName, workspace.records[d.lotId]?.data.name, workspace.records[d.foodId]?.data.name, d.notes].join(" ").toLocaleLowerCase("pt-BR");
    return (!filters.search || search.includes(filters.search.toLocaleLowerCase("pt-BR"))) && (!filters.from || d.date >= filters.from)
      && (!filters.to || d.date <= filters.to) && (!filters.status || d.status === filters.status);
  }).sort((a,b) => b.data.date.localeCompare(a.data.date) || b.updatedAt.localeCompare(a.updatedAt));
}
function historyContent() {
  const list = filteredSupplies();
  if (!list.length) return empty("Nenhum fornecimento encontrado", "Os registros desta fazenda aparecerão aqui. Você também pode ajustar os filtros.");
  const total = list.filter((r) => r.data.status === "active").reduce((sum,r) => sum + r.data.quantity, 0);
  const rows = list.map((r) => `<tr><td>${dateLabel(r.data.date)}</td><td><strong>${esc(r.data.lotName ?? workspace.records[r.data.lotId]?.data.name)}</strong><span class="subline">${esc(r.data.foodName ?? workspace.records[r.data.foodId]?.data.name)}</span></td><td class="right">${quantityLabel(r.data.quantity)} kg</td><td><span class="badge ${r.data.status === "cancelled" ? "neutral" : ""}">${r.data.status === "cancelled" ? "Cancelado" : "Ativo"}</span></td><td>${syncBadge(r.id)}</td><td><div class="rowactions"><button data-action="audit" data-id="${r.id}">Detalhes</button>${r.data.status === "active" ? `<button data-action="edit" data-id="${r.id}">Editar</button><button class="danger" data-action="cancel-supply" data-id="${r.id}">Cancelar</button>` : ""}</div></td></tr>`).join("");
  return `<div class="tablewrap"><table><thead><tr><th>Data</th><th>Lote / alimento</th><th class="right">Quantidade</th><th>Situação</th><th>Armazenamento</th><th class="right">Ações</th></tr></thead><tbody>${rows}</tbody></table></div><div class="summaryline"><span>${list.length} fornecimento(s) no filtro</span><span>Total ativo no filtro: <strong>${quantityLabel(Number(total.toPrecision(12)))} kg</strong></span></div>`;
}
function supplyPage() {
  let warning = "";
  const lots = records("lot", selectedFarm).filter((r) => r.data.active), foods = records("food", selectedFarm).filter((r) => r.data.active);
  if (currentFarm() && (!lots.length || !foods.length)) warning = `<div class="notice">${svg("info")}<p>Antes do primeiro fornecimento, cadastre <a href="#lots">um lote</a> e <a href="#foods">um alimento</a> nesta fazenda.</p></div>`;
  const filterHTML = field("search","Buscar",input("search",filters.search,'type="search" placeholder="Lote, alimento ou observação" data-filter="search"'))
    + field("from","De",input("from",filters.from,'type="date" data-filter="from"'))
    + field("to","Até",input("to",filters.to,'type="date" data-filter="to"'))
    + field("status","Situação",`<select name="status" data-filter="status"><option value="active" ${filters.status === "active" ? "selected" : ""}>Ativos</option><option value="cancelled" ${filters.status === "cancelled" ? "selected" : ""}>Cancelados</option><option value="" ${!filters.status ? "selected" : ""}>Todos</option></select>`);
  return head("ALIMENTAÇÃO POR LOTE", "Fornecimentos", "Registre o que foi fornecido e acompanhe o histórico da fazenda.", button("export-csv","Exportar CSV","download") + button("new-supply","Novo fornecimento","plus",true)) + warning + `<section class="panel"><div class="filters">${filterHTML}</div><div id="historyContent">${historyContent()}</div></section>`;
}
function catalogPage(kind) {
  const titles = { lot: ["Lotes","Identifique os grupos de animais que recebem os fornecimentos."], food: ["Alimentos","Organize os alimentos utilizados nesta fazenda."], farm: ["Fazendas","Mantenha os registros de cada propriedade separados."] };
  const [title, description] = titles[kind];
  const list = records(kind, kind === "farm" ? null : selectedFarm).sort((a,b) => Number(b.data.active)-Number(a.data.active) || a.data.name.localeCompare(b.data.name,"pt-BR"));
  const canWrite = kind !== "farm" || user.role === "owner";
  const rows = list.map((r) => `<div class="listrow"><div><h3>${esc(r.data.name)}</h3><div class="actions">${syncBadge(r.id)}${!r.data.active ? '<span class="badge neutral">Arquivado</span>' : ""}</div></div>${canWrite ? `<div class="rowactions"><button data-action="edit" data-id="${r.id}">Editar</button><button data-action="toggle-record" data-id="${r.id}">${r.data.active ? "Arquivar" : "Reativar"}</button></div>` : ""}</div>`).join("");
  const noRecords = empty(`Nenhum${kind === "farm" ? "a fazenda cadastrada" : ` ${labelKind[kind]} cadastrado`}`, "Cadastre somente informações reais da propriedade.", canWrite ? button(`new-${kind}`,`Cadastrar ${labelKind[kind]}`,"plus") : "", kind === "lot" ? "animal" : kind === "farm" ? "home" : "leaf");
  return head("CADASTROS", title, description, canWrite ? button(`new-${kind}`,`Nov${kind === "farm" ? "a fazenda" : kind === "lot" ? "o lote" : "o alimento"}`,"plus",true) : "") + `<section class="panel">${list.length ? rows : noRecords}</section>`;
}

function syncPage() {
  const problems = workspace.outbox.filter((op,i,all) => op.status !== "pending" && all.findIndex((v) => v.data.id === op.data.id && v.status !== "pending") === i);
  const pending = workspace.outbox.filter((op) => op.status === "pending");
  const cards = problems.map((op) => `<section class="panel problem"><span class="badge error">${op.status === "conflict" ? "Alteração em outro aparelho" : "Revisar registro"}</span><h2>${esc(workspace.records[op.data.id]?.data.name ?? "Fornecimento")}</h2><p class="lead">${esc(op.message)}</p><div class="comparison"><div><strong>Neste aparelho</strong><pre>${esc(recordSummary(workspace.records[op.data.id]))}</pre></div><div><strong>No servidor</strong><pre>${esc(recordSummary(op.remote))}</pre></div></div><div class="actions">${button("resolve-edit","Revisar meus dados","",true,`data-id="${op.data.id}"`)}${button("accept-remote",op.remote ? "Manter versão do servidor" : "Descartar cadastro local","",false,`data-id="${op.data.id}"`)}</div></section>`).join("");
  const queue = pending.length ? `<section class="panel"><div class="panelhead"><h2>Na fila de envio</h2><span class="small">${pending.length} operação(ões)</span></div>${pending.map((op) => `<div class="listrow"><div><h3>${esc(op.data.name ?? `${dateLabel(op.data.date)} · ${quantityLabel(op.data.quantity)} kg`)}</h3><p>${labelKind[op.kind]} · ${esc(workspace.records[op.data.farmId]?.data.name)}</p></div><span class="badge pending">Salvo no aparelho</span></div>`).join("")}</section>` : !problems.length ? `<section class="panel">${empty("Tudo em dia neste aparelho", "As próximas alterações serão salvas localmente e enviadas quando houver conexão.", "", "check")}</section>` : "";
  return head("DADOS DO APARELHO", "Sincronização", "Acompanhe o envio e revise alterações que precisam da sua decisão.", button("sync-now",syncing ? "Sincronizando…" : "Sincronizar agora","sync",true,syncing ? "disabled" : ""))
    + `<div class="notice">${svg("info")}<p>${workspace.lastSync ? `Última sincronização concluída em ${esc(when(workspace.lastSync))}.` : "Este aparelho ainda não concluiu uma sincronização."} ${workspace.outbox.length ? `${workspace.outbox.length} operação(ões) aguardam confirmação do servidor.` : "Não há alterações locais aguardando envio."}</p></div>`
    + (cards ? `<div class="problems">${cards}</div>` : "") + queue;
}
function teamPage() {
  if (user.role !== "owner") return head("ACESSO", "Equipe", "A administração da equipe é exclusiva dos administradores.");
  const rows = team.map((member) => `<div class="listrow"><div><h3>${esc(member.name)}${member.id === user.id ? " (você)" : ""}</h3><p>${esc(member.email)} · ${member.role === "owner" ? "Administrador" : "Operador"}</p><span class="badge ${member.active ? "" : "neutral"}">${member.active ? "Ativo" : "Desativado"}</span></div>${member.id !== user.id ? `<div class="rowactions"><button data-action="edit-user" data-id="${member.id}">Permissões</button><button data-action="reset-password" data-id="${member.id}">Redefinir senha</button></div>` : ""}</div>`).join("");
  return head("PESSOAS E ACESSO", "Equipe", "Administradores gerenciam fazendas e equipe. Operadores registram e consultam os dados da conta.", button("refresh-team","Atualizar","sync") + button("new-user","Novo usuário","plus",true))
    + `<section class="panel">${rows || empty("Conecte-se para consultar a equipe", "A criação de usuários e as alterações de acesso são feitas com conexão ao servidor.", button("refresh-team","Consultar equipe","sync"), "users")}</section>`;
}
function settingsPage() {
  return head("SEU AMBIENTE", "Preferências", "Configurações deste aparelho e da sua conta.") + `<section class="panel">
    <div class="setting"><div><h3>Aparência</h3><p>Alterne entre os temas claro e escuro.</p></div>${button("theme","Alternar tema","moon")}</div>
    <div class="setting"><div><h3>Sincronização automática</h3><p>${paused ? "Pausada neste aparelho. Você pode continuar registrando localmente e enviar depois." : "Os registros são enviados ao abrir o app, ao salvar e quando a conexão volta."}</p></div>${button("pause-sync",paused ? "Ativar sincronização" : "Pausar sincronização")}</div>
    <div class="setting"><div><h3>Armazenamento offline</h3><p>Solicite ao navegador a proteção dos dados locais contra limpeza automática. Antes de limpar os dados do navegador, sincronize os registros.</p></div>${button("persist-storage","Proteger dados offline")}</div>
    <div class="setting"><div><h3>Cópia dos dados deste aparelho</h3><p>Exporte registros e envios pendentes em um arquivo JSON. Guarde a cópia em um local protegido.</p></div>${button("local-backup","Exportar cópia","download")}</div>
    <div class="setting"><div><h3>Sua senha</h3><p>Ao alterar a senha, as sessões abertas são encerradas. Requer conexão e todos os registros sincronizados.</p></div>${button("own-password","Alterar senha")}</div>
    <div class="setting"><div><h3>Instalar no aparelho</h3><p>Use a opção de instalar do navegador ou adicionar à tela inicial. O primeiro acesso e a preparação offline precisam de conexão.</p></div>${button("install","Instalar aplicativo")}</div>
    </section><section class="panel panelbody help-panel"><h2>Como trabalhar sem internet</h2><ol class="helpsteps"><li><strong>Entre e sincronize antes de sair.</strong>O app prepara os cadastros e as telas para uso offline.</li><li><strong>Registre os fornecimentos normalmente.</strong>O selo “Salvo no aparelho” mostra o que ainda precisa ser enviado.</li><li><strong>Conecte-se e confira a sincronização.</strong>Se houver conflito entre aparelhos, você escolhe qual versão manter.</li></ol></section>`;
}
function render() {
  if (!user) return;
  renderChrome();
  if ($("#modal").open) return;
  const id = page();
  document.title = `${navItems.find(([value]) => value === id)[1]} · Gestão Pecuária`;
  let notices = lastError ? `<div class="notice warning" role="alert">${svg("info")}<p>${esc(lastError)}</p><button class="textbutton" data-action="dismiss-error">Fechar</button></div>` : "";
  if (!reachable || paused) notices += `<div class="notice warning">${svg("info")}<p>${paused ? "Sincronização pausada." : "Você está trabalhando sem conexão com o servidor."} Os novos registros ficam neste aparelho até o envio.</p><a href="#sync">Ver envios</a></div>`;
  if (currentFarm() && !currentFarm().data.active) notices += `<div class="notice warning">${svg("info")}<p>Esta fazenda está arquivada. O histórico continua disponível; reative-a para novos registros.</p></div>`;
  const content = id === "supplies" ? supplyPage() : id === "lots" ? catalogPage("lot") : id === "foods" ? catalogPage("food") : id === "farms" ? catalogPage("farm") : id === "sync" ? syncPage() : id === "team" ? teamPage() : settingsPage();
  $("#main").innerHTML = notices + content;
}
function renderAuth(mode = "login", message = "") {
  authMode = mode; $("#application").hidden = true; $("#auth").hidden = false;
  const signupFields = mode === "signup" ? field("name","Seu nome",input("name","",'required autocomplete="name" maxlength="100"'),"",true)
    + field("accountName","Nome da conta",input("accountName","",'required maxlength="100"'),"Ex.: nome da empresa ou do produtor.",true)
    + field("farmName","Primeira fazenda",input("farmName","",'required maxlength="100"'),"",true) : "";
  const emailField = field("email","E-mail",input("email","",'type="email" required autocomplete="username" maxlength="254"'),"",true);
  const passwordField = field("password","Senha",input("password","",`type="password" required minlength="12" maxlength="128" autocomplete="${mode === "signup" ? "new-password" : "current-password"}"`),"Use pelo menos 12 caracteres.",true);
  $("#auth").innerHTML = `<div class="auth-layout"><section class="auth-intro"><a class="brand" href="#"><span class="brandmark">${svg("animal")}</span><span class="brandtext">Gestão<span>Pecuária</span></span></a><div><p class="eyebrow">ROTINA DE CAMPO</p><h1>O cuidado com o lote começa no registro.</h1><p>Organize os fornecimentos da fazenda, mesmo sem internet. Sincronize quando a conexão voltar.</p></div><p class="introfoot">Seus registros. Sua propriedade. Uma rotina mais clara.</p></section><section class="auth-content"><div class="auth-box"><p class="eyebrow">${mode === "signup" ? "PRIMEIRO ACESSO" : "BEM-VINDO DE VOLTA"}</p><h2>${mode === "signup" ? "Crie sua conta" : "Entre na sua fazenda"}</h2><p class="lead">${mode === "signup" ? "Comece com a primeira fazenda. Você poderá adicionar outras depois." : "Use seu e-mail e senha. O primeiro acesso precisa de conexão."}</p>${message ? `<div class="offline-intro">${esc(message)}</div>` : ""}<form id="authForm">${formError()}<div class="formgrid">${signupFields}${emailField}${passwordField}</div><button class="button primary" type="submit">${mode === "signup" ? "Criar conta e entrar" : "Entrar"}</button></form><p class="auth-switch">${mode === "signup" ? "Já tem uma conta?" : "Primeiro acesso?"} <button class="textbutton" data-action="auth-switch">${mode === "signup" ? "Entrar" : "Criar conta"}</button></p></div></section></div>`;
}

let modalContext = null, modalTrigger = null;
function openModal(title, content, context = null) {
  modalTrigger = document.activeElement; modalContext = context;
  const modal = $("#modal");
  modal.innerHTML = `<div class="modalhead"><h2 id="modalTitle">${title}</h2><button type="button" class="iconbutton" data-action="close-modal" aria-label="Fechar">${svg("close")}</button></div><div class="modalbody">${content}</div>`;
  if (!modal.open) modal.showModal();
}
function closeModal() {
  if (saving) return;
  $("#modal").close(); modalContext = null; render();
  if (modalTrigger?.isConnected) modalTrigger.focus();
}
function requireWritable() {
  if (!user) throw new Error("Entre na sua conta.");
  if (saving || syncing) throw new Error("Aguarde a operação em andamento terminar e tente novamente.");
  if (Date.now() > user.offlineUntil) throw new Error("Conecte-se e entre novamente para continuar registrando neste aparelho.");
}
function options(kind, selected, farmId) {
  return '<option value="">Selecione</option>' + records(kind, farmId).filter((r) => r.data.active || r.id === selected).sort((a,b) => a.data.name.localeCompare(b.data.name,"pt-BR")).map((r) => `<option value="${r.id}" ${r.id === selected ? "selected" : ""}>${esc(r.data.name)}${r.data.active ? "" : " (arquivado)"}</option>`).join("");
}
function openRecord(kind, id = null, resolving = false, preserved = null) {
  requireWritable();
  const record = id ? workspace.records[id] : null;
  if (id && !record) throw new Error("Registro não encontrado neste aparelho.");
  if (kind !== "farm" && !currentFarm()) throw new Error("Cadastre e selecione uma fazenda primeiro.");
  if (kind === "farm" && user.role !== "owner") throw new Error("Somente administradores podem alterar fazendas.");
  if (problemFor(id) && !resolving) { location.hash = "sync"; throw new Error("Revise a pendência deste registro na tela de sincronização."); }
  const data = preserved ?? record?.data ?? { id: crypto.randomUUID(), farmId: kind === "farm" ? null : selectedFarm, name: "", active: true,
    date: today(), lotId: "", foodId: "", quantity: "", unit: "kg", notes: "", status: "active", cancelReason: "" };
  if (kind === "farm") data.farmId = data.id;
  let fields;
  if (kind === "supply") {
    if (!record && (!records("lot", selectedFarm).some((r) => r.data.active) || !records("food", selectedFarm).some((r) => r.data.active))) {
      throw new Error("Cadastre um lote e um alimento ativos nesta fazenda antes do fornecimento.");
    }
    fields = field("date","Data do fornecimento",input("date",data.date,'type="date" required min="0001-01-01"'),"Data completa do fato, mesmo ao registrar offline.")
      + field("quantity","Quantidade (kg)",input("quantity",data.quantity === "" ? "" : quantityLabel(data.quantity),'required inputmode="decimal" placeholder="Ex.: 320 ou 320,5"'),"Informe só o número, sem separador de milhar.")
      + field("lotId","Lote",`<select name="lotId" required>${options("lot",data.lotId,data.farmId)}</select>`)
      + field("foodId","Alimento",`<select name="foodId" required>${options("food",data.foodId,data.farmId)}</select>`)
      + field("notes","Observação (opcional)",`<textarea name="notes" maxlength="1000">${esc(data.notes)}</textarea>`,"Até 1.000 caracteres.",true);
  } else {
    fields = field("name",kind === "lot" ? "Identificação do lote" : `Nome d${kind === "farm" ? "a fazenda" : "o alimento"}`,input("name",data.name,'required maxlength="100" autocomplete="off"'),"Até 100 caracteres.",true);
  }
  const context = { kind, data: structuredClone(data), resolving, editing: Boolean(record) };
  openModal(`${record ? "Editar" : "Cadastrar"} ${labelKind[kind]}`, `<p>${kind === "farm" ? "A equipe da conta terá acesso aos dados desta fazenda." : `Fazenda: ${esc(workspace.records[data.farmId]?.data.name)}`} O registro será salvo neste aparelho e enviado quando houver conexão.</p><form id="recordForm">${formError()}<div class="formgrid">${fields}</div><div class="formactions">${button("close-modal","Voltar")}<button class="button primary" type="submit">${kind === "supply" ? "Revisar fornecimento" : "Salvar cadastro"}</button></div></form>`, context);
}
function recordFromForm(form, context) {
  const inputData = Object.fromEntries(new FormData(form));
  return validateRecord(context.kind, { ...context.data, ...inputData,
    ...(context.kind === "supply" ? { quantity: parseQuantity(inputData.quantity), unit: "kg" } : {}) });
}
function reviewSupply(data, context) {
  // Verifica as referências também antes de abrir a revisão.
  queueRecord(workspace, "supply", data, user, crypto.randomUUID(), context.resolving);
  const record = { kind: "supply", data: { ...data, lotName: workspace.records[data.lotId]?.data.name, foodName: workspace.records[data.foodId]?.data.name } };
  openModal("Revise o fornecimento", `<p>Confira os dados antes de salvar. O registro ficará neste aparelho até a confirmação da sincronização.</p>${formError()}<div class="review-data"><pre>${esc(recordSummary(record))}</pre></div><div class="formactions">${button("back-to-supply","Voltar e editar")}${button("confirm-supply","Salvar no aparelho","check",true)}</div>`, { ...context, data });
}
async function commitRecord(kind, data, resolving = false) {
  requireWritable(); saving = true;
  try {
    const next = queueRecord(workspace, kind, data, user, crypto.randomUUID(), resolving);
    await saveWorkspace(next);
    if (kind === "farm" && !selectedFarm) selectedFarm = data.id;
    saving = false; closeModal(); lastError = ""; render(); toast("Registro salvo neste aparelho.");
    if (!paused) setTimeout(() => synchronize(), 300);
  } finally { saving = false; }
}
function confirmDialog(title, message, action, context) {
  requireWritable();
  openModal(title, `<p>${esc(message)}</p>${formError()}<div class="formactions">${button("close-modal","Voltar")}${button(action,"Confirmar","",true)}</div>`, context);
}
function cancelSupply(id) {
  requireWritable();
  if (problemFor(id)) { location.hash = "sync"; throw new Error("Resolva a pendência deste fornecimento antes do cancelamento."); }
  const record = workspace.records[id];
  openModal("Cancelar fornecimento", `<p>O fornecimento de ${esc(dateLabel(record.data.date))}, com ${quantityLabel(record.data.quantity)} kg, continuará no histórico com o motivo informado.</p><form id="cancelForm">${formError()}${field("cancelReason","Motivo do cancelamento",'<textarea name="cancelReason" required maxlength="500"></textarea>')}<div class="formactions">${button("close-modal","Voltar")}<button class="button danger" type="submit">Cancelar fornecimento</button></div></form>`, { record });
}
async function showAudit(id) {
  const record = workspace.records[id];
  openModal("Detalhes do fornecimento", `<div class="review-data"><pre>${esc(recordSummary(record))}</pre></div><p class="backupnote">${pendingFor(workspace,id).length ? "Há alterações neste aparelho aguardando confirmação do servidor." : "O registro está sincronizado."}</p><h3>Histórico de alterações</h3><div id="auditEvents"><p class="muted">Consultando o histórico…</p></div>`);
  try {
    const { events } = await api(`/api/audit?recordId=${encodeURIComponent(id)}`);
    const titles = { created: "Registro criado", updated: "Registro alterado", cancelled: "Fornecimento cancelado" };
    if ($("#auditEvents")) $("#auditEvents").innerHTML = events.length ? events.map((event) => `<div class="audit"><strong>${titles[event.action] ?? esc(event.action)}</strong><p class="small">${esc(event.userName)} · ${esc(when(event.at))}</p>${event.before ? `<details><summary>Ver dados anteriores</summary><pre class="auditdetails">${esc(recordSummary(event.before))}</pre></details>` : ""}</div>`).join("") : '<p class="muted">O histórico aparecerá após o primeiro envio.</p>';
  } catch { if ($("#auditEvents")) $("#auditEvents").innerHTML = '<p class="muted">O histórico detalhado fica disponível com conexão. Os dados do registro continuam neste aparelho.</p>'; }
}
function openUserForm(member = null) {
  if (!reachable) throw new Error("Conecte-se para administrar a equipe.");
  const fields = member
    ? field("role","Papel",`<select name="role"><option value="operator" ${member.role === "operator" ? "selected" : ""}>Operador</option><option value="owner" ${member.role === "owner" ? "selected" : ""}>Administrador</option></select>`,"",true) + `<label class="checkline span2"><input type="checkbox" name="active" ${member.active ? "checked" : ""}> Usuário ativo</label>`
    : field("name","Nome",input("name","",'required maxlength="100"'),"",true) + field("email","E-mail",input("email","",'type="email" required maxlength="254" autocomplete="off"'),"",true)
      + field("password","Senha inicial",input("password","",'type="password" required minlength="12" maxlength="128" autocomplete="new-password"'),"Entregue a senha por um canal protegido. O usuário poderá alterá-la.",true)
      + field("role","Papel",'<select name="role"><option value="operator">Operador</option><option value="owner">Administrador</option></select>',"",true);
  openModal(member ? "Permissões de acesso" : "Novo usuário", `<p>${member ? esc(member.name) : "O usuário terá acesso às fazendas desta conta. Nenhum e-mail será enviado automaticamente."}</p><form id="userForm">${formError()}<div class="formgrid">${fields}</div><div class="formactions">${button("close-modal","Voltar")}<button class="button primary" type="submit">Salvar usuário</button></div></form>`, { member });
}
function passwordForm(id) {
  if (!reachable) throw new Error("Conecte-se para alterar senhas.");
  if (id === user.id && workspace.outbox.length) throw new Error("Sincronize todos os registros pendentes antes de alterar sua senha.");
  openModal(id === user.id ? "Alterar sua senha" : "Redefinir senha do usuário", `<p>As sessões abertas deste usuário serão encerradas.</p><form id="passwordForm">${formError()}<div class="formgrid">${id === user.id ? field("currentPassword","Senha atual",input("currentPassword","",'type="password" required autocomplete="current-password"'),"",true) : ""}${field("password","Nova senha",input("password","",'type="password" required minlength="12" maxlength="128" autocomplete="new-password"'),"De 12 a 128 caracteres.",true)}${field("confirmation","Repita a nova senha",input("confirmation","",'type="password" required minlength="12" maxlength="128" autocomplete="new-password"'),"",true)}</div><div class="formactions">${button("close-modal","Voltar")}<button class="button primary" type="submit">Alterar senha</button></div></form>`, { id });
}

async function synchronize({ force = false, pullOnly = false } = {}) {
  if (!user || syncing || saving || $("#modal").open || (paused && !force) || !navigator.onLine) return;
  syncing = true; renderChrome();
  try {
    const fresh = (await api("/api/me")).user;
    if (fresh.id !== user.id || fresh.tenantId !== user.tenantId) {
      const error = new Error("A conta aberta em outra aba mudou. Entre novamente nesta aba."); error.status = 401; throw error;
    }
    user = fresh; rememberUser(); reachable = true;
    if (!pullOnly) {
      let batch = workspace.outbox.filter((op) => op.status === "pending").slice(0,100);
      while (batch.length) {
        const before = workspace.outbox.filter((op) => op.status === "pending").length;
        const { results } = await api("/api/sync", { method: "POST", body: { operations: batch } });
        await saveWorkspace(applyResults(workspace, results));
        if (workspace.outbox.filter((op) => op.status === "pending").length >= before) throw new Error("O servidor não confirmou os envios. Os registros foram preservados; tente sincronizar novamente.");
        batch = workspace.outbox.filter((op) => op.status === "pending").slice(0,100);
      }
    }
    const { records: remote } = await api("/api/state");
    await saveWorkspace(mergeRemote(workspace, remote));
    lastError = "";
    if (page() === "team" && user.role === "owner") team = (await api("/api/users")).users;
  } catch (error) {
    reachable = false;
    if (error.status === 401) {
      setPref("pecuaria-reauth", "true"); local?.close(); local = null; user = null; workspace = emptyWorkspace(); team = [];
      renderAuth("login", error.message);
    } else if (!error.network || force) lastError = error.message;
  } finally { syncing = false; if (user) render(); }
}
async function loadUser(profile, online = false) {
  local?.close();
  local = await openWorkspace(profile); workspace = await local.load(); user = profile; team = [];
  reachable = online; lastError = ""; rememberUser(); setPref("pecuaria-reauth", null);
  $("#auth").hidden = true; $("#application").hidden = false;
  render();
  if (online) await synchronize({ force: true, pullOnly: paused });
}
async function refreshTeam() {
  team = (await api("/api/users")).users; reachable = true; render();
}
async function logout() {
  requireWritable();
  if (workspace.outbox.length) throw new Error("Sincronize ou resolva os envios pendentes antes de sair, para preservar seus registros.");
  await api("/api/logout", { method: "POST", body: {} });
  try { await local.clear(); } finally {
    local.close(); local = null; user = null; team = []; workspace = emptyWorkspace();
    setPref("pecuaria-profile", null); setPref("pecuaria-reauth", null); setPref("pecuaria-farm", null);
    renderAuth("login", "Você saiu da conta. Os registros sincronizados continuam no servidor.");
    sessionChannel?.postMessage("logout");
  }
}
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
async function handleAction(action, element) {
  const id = element.dataset.id;
  if (action === "auth-switch") return renderAuth(authMode === "login" ? "signup" : "login");
  if (action === "close-modal") return closeModal();
  if (action === "dismiss-error") { lastError = ""; return render(); }
  if (action === "theme") return applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  if (action === "sync-now") { await synchronize({ force: true }); return; }
  if (action === "new-supply") return openRecord("supply");
  if (["new-farm","new-lot","new-food"].includes(action)) return openRecord(action.slice(4));
  if (action === "edit" || action === "resolve-edit") return openRecord(workspace.records[id].kind, id, action === "resolve-edit");
  if (action === "toggle-record") {
    const record = workspace.records[id];
    return confirmDialog(`${record.data.active ? "Arquivar" : "Reativar"} ${labelKind[record.kind]}`, record.data.active
      ? `Arquivar “${record.data.name}”? O histórico será preservado e o cadastro deixará de aceitar novos fornecimentos.`
      : `Reativar “${record.data.name}”?`, "confirm-toggle", { record });
  }
  if (action === "confirm-toggle") {
    const r = modalContext.record; return commitRecord(r.kind, { ...r.data, active: !r.data.active });
  }
  if (action === "confirm-supply") return commitRecord("supply", modalContext.data, modalContext.resolving);
  if (action === "back-to-supply") {
    const context = modalContext; return openRecord("supply", context.editing ? context.data.id : null, context.resolving, context.data);
  }
  if (action === "cancel-supply") return cancelSupply(id);
  if (action === "audit") return showAudit(id);
  if (action === "accept-remote") {
    const problem = problemFor(id), count = discardedIds(workspace,id).length;
    return confirmDialog(problem.remote ? "Manter versão do servidor" : "Descartar dados locais", problem.remote
      ? "As alterações ainda não sincronizadas deste registro serão descartadas neste aparelho. A versão do servidor será mantida."
      : `Esta ação descartará ${count} registro(s) local(is), incluindo cadastros ou fornecimentos que dependem dele. Exporte uma cópia antes se precisar preservá-los.`, "confirm-remote", { id });
  }
  if (action === "confirm-remote") {
    requireWritable(); saving = true;
    try { await saveWorkspace(acceptRemote(workspace,modalContext.id)); saving = false; closeModal(); toast("Pendência resolvida."); if (!paused) setTimeout(() => synchronize(),300); }
    finally { saving = false; } return;
  }
  if (action === "pause-sync") { paused = !paused; setPref("pecuaria-sync-paused",String(paused)); render(); if (!paused) await synchronize(); return; }
  if (action === "export-csv") return download(supplyCSV(filteredSupplies(),(ref) => workspace.records[ref]),`fornecimentos-${today()}.csv`,"text/csv;charset=utf-8");
  if (action === "local-backup") return download(JSON.stringify({ format: "pecuaria-device-backup-v1", accountId: user.tenantId, userId: user.id, exportedAt: new Date().toISOString(), workspace },null,2),`pecuaria-aparelho-${today()}.json`,"application/json");
  if (action === "persist-storage") {
    const protectedStorage = await navigator.storage?.persist?.();
    return toast(protectedStorage ? "O navegador concedeu proteção ao armazenamento local." : "O navegador não concedeu proteção. Mantenha a sincronização e suas cópias em dia.");
  }
  if (action === "refresh-team") return refreshTeam();
  if (action === "new-user") return openUserForm();
  if (action === "edit-user") return openUserForm(team.find((member) => member.id === id));
  if (action === "reset-password") return passwordForm(id);
  if (action === "own-password") return passwordForm(user.id);
  if (action === "install") {
    if (!installPrompt) return toast("No menu do navegador, procure “Instalar aplicativo” ou “Adicionar à tela inicial”.");
    await installPrompt.prompt(); installPrompt = null;
  }
}

document.addEventListener("click", (event) => {
  const element = event.target.closest("[data-action]");
  if (!element) return;
  handleAction(element.dataset.action,element).catch(fail);
});
document.addEventListener("input", (event) => {
  const key = event.target.dataset.filter;
  if (key) { filters[key] = event.target.value; $("#historyContent").innerHTML = historyContent(); }
});
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!["authForm","recordForm","cancelForm","userForm","passwordForm"].includes(form.id)) return;
  event.preventDefault(); const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
  try {
    if (form.id === "authForm") {
      const inputData = Object.fromEntries(new FormData(form));
      const response = await api(authMode === "signup" ? "/api/signup" : "/api/login", { method: "POST", body: inputData });
      await loadUser(response.user,true);
    } else if (form.id === "recordForm") {
      const context = modalContext, data = recordFromForm(form,context);
      if (context.kind === "supply") reviewSupply(data,context);
      else await commitRecord(context.kind,data,context.resolving);
    } else if (form.id === "cancelForm") {
      await commitRecord("supply",{ ...modalContext.record.data, status: "cancelled", cancelReason: new FormData(form).get("cancelReason") });
    } else if (form.id === "userForm") {
      const inputData = Object.fromEntries(new FormData(form)), member = modalContext.member;
      await api(member ? `/api/users/${member.id}` : "/api/users", { method: "POST", body: member ? { role: inputData.role, active: inputData.active === "on" } : inputData });
      closeModal(); await refreshTeam(); toast("Usuário salvo.");
    } else if (form.id === "passwordForm") {
      const inputData = Object.fromEntries(new FormData(form));
      if (inputData.password !== inputData.confirmation) throw new Error("A confirmação da senha não confere.");
      const self = modalContext.id === user.id;
      await api(`/api/users/${modalContext.id}/password`, { method: "POST", body: inputData });
      closeModal();
      if (self) { local.close(); local = null; user = null; setPref("pecuaria-reauth","true"); renderAuth("login","Senha alterada. Entre novamente."); }
      else toast("Senha redefinida. Entregue a nova senha ao usuário por um canal protegido.");
    }
  } catch (error) {
    if (error.field) form.elements.namedItem(error.field)?.setAttribute("aria-invalid","true");
    fail(error);
  } finally { submit.disabled = false; }
});

$("#farmSelect").addEventListener("change", (event) => { selectedFarm = event.target.value; setPref("pecuaria-farm",selectedFarm); render(); });
$("#theme").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$("#logout").addEventListener("click", () => logout().catch(fail));
$("#toggleNav").addEventListener("click", () => {
  if (innerWidth <= 800) { menu(!document.body.classList.contains("menu-open")); if (document.body.classList.contains("menu-open")) $("#navigation a")?.focus(); }
  else { document.body.classList.toggle("collapsed"); setPref("pecuaria-collapsed",String(document.body.classList.contains("collapsed"))); menu(false); }
});
$("#veil").addEventListener("click", () => menu(false));
$("#modal").addEventListener("cancel", (event) => { event.preventDefault(); closeModal(); });
window.addEventListener("hashchange", () => { if (!user) return; menu(false); render(); $("#main").focus(); if (page() === "team" && user.role === "owner") refreshTeam().catch(fail); });
window.addEventListener("resize", () => menu(innerWidth <= 800 && document.body.classList.contains("menu-open")));
window.addEventListener("online", () => synchronize());
window.addEventListener("offline", () => { reachable = false; if (user) render(); });
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event; });
document.addEventListener("keydown", (event) => {
  if (!document.body.classList.contains("menu-open") || $("#modal").open) return;
  if (event.key === "Escape") { menu(false); $("#toggleNav").focus(); }
  if (event.key === "Tab") {
    const links = [...document.querySelectorAll("#sidebar a")], first = links[0], last = links.at(-1);
    if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
    else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
  }
});
const sessionChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel("pecuaria-session") : null;
sessionChannel?.addEventListener("message", (event) => {
  if (event.data === "logout" && user) { $("#modal").close(); local?.close(); local = null; user = null; renderAuth("login","A sessão foi encerrada em outra aba."); }
});

async function boot() {
  document.querySelectorAll("[data-icon]").forEach((element) => { element.innerHTML = svg(element.dataset.icon); });
  applyTheme(getPref("pecuaria-theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  document.body.classList.toggle("collapsed",getPref("pecuaria-collapsed") === "true");
  $("#auth").innerHTML = '<div class="loading">Abrindo sua área de trabalho…</div>';
  if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js").catch(() => toast("Não foi possível preparar as telas offline. Mantenha a conexão e tente abrir o app novamente."));
  let profile = null;
  try { profile = JSON.parse(getPref("pecuaria-profile")); } catch { /* Um perfil inválido exige novo acesso. */ }
  if (getPref("pecuaria-reauth")) return renderAuth("login","Entre novamente para acessar seus dados e envios pendentes.");
  try {
    const response = await api("/api/me");
    await loadUser(response.user,true);
  } catch (error) {
    if (!error.status && profile && profile.offlineUntil > Date.now()) {
      try { await loadUser(profile,false); } catch (storageError) { user = null; renderAuth("login",storageError.message); }
    } else renderAuth("login",error.status === 401 ? "" : "Conecte-se para o primeiro acesso ou para renovar a sessão offline.");
  }
}
setInterval(() => { if (user && !$("#modal").open && document.visibilityState === "visible") synchronize(); },30_000);
boot().catch((error) => { user = null; renderAuth("login",error.message); });
