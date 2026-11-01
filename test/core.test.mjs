import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.mjs";
import { validateRecord, validDate, parseQuantity, supplyCSV } from "../public/domain.mjs";
import { emptyWorkspace, queueRecord, applyResults, mergeRemote, acceptRemote } from "../public/sync-core.mjs";

const credentials = (suffix) => ({ name: "Responsável", accountName: `Conta ${suffix}`, farmName: "Fazenda principal", email: `${suffix}@example.test`, password: "senha-de-teste-12345" });
const op = (kind, data, baseVersion = 0) => ({ operationId: randomUUID(), kind, data, baseVersion });
async function fixture(t) {
  const store = openStore(); t.after(() => store.close());
  const actor = await store.signup(credentials(randomUUID()));
  const farm = store.listRecords(actor.tenantId)[0];
  const lot = { id: randomUUID(), farmId: farm.id, name: "Lote 4", active: true };
  const food = { id: randomUUID(), farmId: farm.id, name: "Silagem", active: true };
  assert.ok(store.sync(actor, [op("lot", lot), op("food", food)]).every((r) => r.status === "ok"));
  const supply = { id: randomUUID(), farmId: farm.id, lotId: lot.id, foodId: food.id, date: "2026-10-30", quantity: 320, unit: "kg", status: "active", notes: "", cancelReason: "" };
  return { store, actor, farm, lot, food, supply };
}

test("regras de datas e quantidade são independentes da rede", () => {
  for (const d of ["2026-11-31", "2025-02-29", "0000-01-01", "30/10/2026", "hoje"]) assert.equal(validDate(d), false);
  for (const d of ["2026-10-30", "2024-02-29", "2000-02-29"]) assert.equal(validDate(d), true);
  assert.equal(parseQuantity("320,5"), 320.5);
  for (const q of ["4KG", "1e3", "0x10", "", "Infinity"]) assert.ok(Number.isNaN(parseQuantity(q)));
});

test("reenviar uma operação não duplica fornecimento nem auditoria", async (t) => {
  const { store, actor, supply } = await fixture(t);
  const operation = op("supply", supply);
  const first = store.sync(actor, [operation]);
  assert.deepEqual(store.sync(actor, [operation]), first);
  assert.equal(store.listRecords(actor.tenantId).filter((r) => r.kind === "supply").length, 1);
  assert.equal(store.listAudit(actor, supply.id).length, 1);
  assert.equal(first[0].record.data.lotName, "Lote 4");
});

test("identificadores de operações não podem ser reutilizados com dados diferentes", async (t) => {
  const { store, actor, supply } = await fixture(t);
  const operation = op("supply", supply);
  store.sync(actor, [operation]);
  const result = store.sync(actor, [{ ...operation, data: { ...supply, quantity: 999 } }]);
  assert.equal(result[0].status, "error");
  assert.equal(store.getRecord(actor.tenantId, supply.id).data.quantity, 320);
});

test("contas diferentes não conseguem referenciar ou consultar dados umas das outras", async (t) => {
  const { store, actor, farm, lot, food, supply } = await fixture(t);
  const other = await store.signup(credentials(randomUUID()));
  assert.equal(store.getRecord(other.tenantId, lot.id), null);
  assert.equal(store.sync(other, [op("supply", supply)])[0].status, "error");
  const collision = store.sync(other, [op("farm", farm.data)]);
  assert.equal(collision[0].status, "error");
  assert.equal(collision[0].record, null);
  assert.equal(store.listAudit(other, lot.id).length, 0);
  assert.equal(store.getRecord(actor.tenantId, food.id).data.name, "Silagem");
});

test("lotes de outra fazenda da mesma conta também são recusados", async (t) => {
  const { store, actor, supply } = await fixture(t);
  const id = randomUUID();
  store.sync(actor, [op("farm", { id, farmId: id, name: "Segunda fazenda", active: true })]);
  assert.equal(store.sync(actor, [op("supply", { ...supply, farmId: id })])[0].status, "error");
});

test("conflitos não sobrescrevem dados e bloqueiam operações seguintes do registro", async (t) => {
  const { store, actor, supply } = await fixture(t);
  store.sync(actor, [op("supply", supply)]);
  store.sync(actor, [op("supply", { ...supply, quantity: 500 }, 1)]);
  const result = store.sync(actor, [op("supply", { ...supply, quantity: 400 }, 1), op("supply", { ...supply, quantity: 450 }, 2)]);
  assert.equal(result[0].status, "conflict");
  assert.equal(result[0].record.data.quantity, 500);
  assert.equal(result[1].status, "blocked");
  assert.equal(store.getRecord(actor.tenantId, supply.id).data.quantity, 500);
});

test("referências arquivadas, datas impossíveis e duplicação de nomes são recusadas", async (t) => {
  const { store, actor, lot, supply } = await fixture(t);
  assert.equal(store.sync(actor, [op("lot", { ...lot, id: randomUUID(), name: "lote 4" })])[0].status, "error");
  assert.equal(store.sync(actor, [op("supply", { ...supply, date: "2026-11-31" })])[0].status, "error");
  store.sync(actor, [op("lot", { ...lot, active: false }, 1)]);
  assert.equal(store.sync(actor, [op("supply", supply)])[0].status, "error");
});

test("cancelamento exige motivo, preserva dados e cria histórico sem excluir", async (t) => {
  const { store, actor, supply } = await fixture(t);
  store.sync(actor, [op("supply", supply)]);
  assert.equal(store.sync(actor, [op("supply", { ...supply, status: "cancelled" }, 1)])[0].status, "error");
  const cancelled = { ...supply, status: "cancelled", cancelReason: "Lançamento em duplicidade" };
  assert.equal(store.sync(actor, [op("supply", { ...cancelled, quantity: 100 }, 1)])[0].status, "error");
  assert.equal(store.sync(actor, [op("supply", cancelled, 1)])[0].status, "ok");
  assert.equal(store.sync(actor, [op("supply", supply, 2)])[0].status, "error");
  assert.equal(store.getRecord(actor.tenantId, supply.id).data.status, "cancelled");
  assert.equal(store.listAudit(actor, supply.id)[0].action, "cancelled");
});

test("operador registra fornecimentos mas não administra fazendas ou equipe", async (t) => {
  const { store, actor, supply, farm } = await fixture(t);
  const user = await store.createUser(actor, { name: "Operador", email: `${randomUUID()}@example.test`, password: "senha-do-operador-123", role: "operator" });
  assert.equal(store.sync(user, [op("supply", supply)])[0].status, "ok");
  assert.equal(store.sync(user, [op("farm", { ...farm.data, name: "Alterada" }, 1)])[0].status, "error");
  assert.throws(() => store.users(user), /administrador/);
  assert.equal(store.listAudit(user).some((event) => event.action.startsWith("user-")),false);
  assert.throws(() => store.updateUser(actor, actor.id, { role: "operator", active: true }), /Outro administrador/);
});

test("senha incorreta falha e desativar usuário revoga a sessão", async (t) => {
  const { store, actor } = await fixture(t);
  const email = `${randomUUID()}@example.test`;
  const user = await store.createUser(actor, { name: "Operador", email, password: "senha-do-operador-123", role: "operator" });
  await assert.rejects(store.login(email, "incorreta"), /incorretos/);
  const session = store.createSession(await store.login(email, "senha-do-operador-123"));
  assert.equal(store.authenticate(session.token).id, user.id);
  assert.equal("hash" in store.authenticate(session.token), false);
  store.updateUser(actor, user.id, { role: "operator", active: false });
  assert.throws(() => store.authenticate(session.token), /sessão/);
});

test("SQLite mantém registros após reabrir o banco", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "pecuaria-test-")), "test.sqlite");
  let store = openStore(path);
  const actor = await store.signup(credentials(randomUUID()));
  store.close(); store = openStore(path);
  try { assert.equal(store.listRecords(actor.tenantId).length, 1); } finally { store.close(); }
});

test("fila offline suporta criação, edição e resposta perdida sem duplicar", async (t) => {
  const { store, actor, supply } = await fixture(t);
  let workspace = mergeRemote(emptyWorkspace(), store.listRecords(actor.tenantId));
  workspace = queueRecord(workspace, "supply", supply, actor, randomUUID());
  store.sync(actor, workspace.outbox); // O servidor gravou, mas a resposta se perdeu.
  workspace = queueRecord(workspace, "supply", { ...supply, quantity: 400 }, actor, randomUUID());
  workspace = applyResults(workspace, store.sync(actor, workspace.outbox));
  assert.equal(workspace.outbox.length, 0);
  assert.equal(workspace.records[supply.id].version, 2);
  assert.equal(store.getRecord(actor.tenantId, supply.id).data.quantity, 400);
  assert.equal(store.listAudit(actor, supply.id).length, 2);
});

test("receber dados remotos preserva alterações locais ainda pendentes", async (t) => {
  const { store, actor, supply } = await fixture(t);
  let workspace = mergeRemote(emptyWorkspace(), store.listRecords(actor.tenantId));
  workspace = queueRecord(workspace, "supply", supply, actor, randomUUID());
  const merged = mergeRemote(workspace, store.listRecords(actor.tenantId));
  assert.equal(merged.records[supply.id].data.quantity, 320);
  assert.equal(merged.outbox.length, 1);
});

test("conflito pode ser resolvido mantendo o servidor ou reenviando versão local", async (t) => {
  const { store, actor, supply } = await fixture(t);
  store.sync(actor, [op("supply", supply)]);
  let workspace = mergeRemote(emptyWorkspace(), store.listRecords(actor.tenantId));
  workspace = queueRecord(workspace, "supply", { ...supply, quantity: 400 }, actor, randomUUID());
  store.sync(actor, [op("supply", { ...supply, quantity: 500 }, 1)]);
  workspace = applyResults(workspace, store.sync(actor, workspace.outbox));
  assert.equal(workspace.outbox[0].status, "conflict");
  const remote = acceptRemote(workspace, supply.id);
  assert.equal(remote.outbox.length, 0);
  assert.equal(remote.records[supply.id].data.quantity, 500);
  workspace = queueRecord(workspace, "supply", workspace.records[supply.id].data, actor, randomUUID(), true);
  workspace = applyResults(workspace, store.sync(actor, workspace.outbox));
  assert.equal(workspace.records[supply.id].data.quantity, 400);
  assert.equal(workspace.records[supply.id].version, 3);
});

test("exportação escapa fórmulas e preserva vírgulas, aspas e quebras de linha", () => {
  const id = randomUUID(), farmId = randomUUID(), lotId = randomUUID(), foodId = randomUUID();
  const data = validateRecord("supply", { id, farmId, lotId, foodId, date: "2026-10-30", quantity: 2.5, unit: "kg", status: "active", notes: '=HYPERLINK("x")\ntexto' });
  const csv = supplyCSV([{ data }], () => ({ data: { name: "Nome" } }));
  assert.ok(csv.startsWith("\ufeff"));
  assert.ok(csv.includes("'="));
  assert.ok(csv.includes('"2,5"'));
  assert.ok(csv.includes('""x""'));
});
