import { validateRecord, checkReferences, DomainError } from "./domain.mjs";

export const emptyWorkspace = () => ({ records: {}, outbox: [], lastSync: null });
const copy = (value) => structuredClone(value);
export const pendingFor = (workspace, id) => workspace.outbox.filter((op) => op.data.id === id);

export function queueRecord(workspace, kind, raw, actor, operationId, resolving = false) {
  const next = copy(workspace);
  const data = validateRecord(kind, raw);
  if (kind === "farm" && actor.role !== "owner") throw new DomainError("Somente administradores podem alterar fazendas.");
  const previous = next.records[data.id];
  const problem = pendingFor(next, data.id).find((op) => op.status !== "pending");
  if (problem && !resolving) throw new DomainError("Revise o conflito de sincronização deste registro antes de alterar.");
  const base = resolving ? problem?.remote ?? null : previous;
  checkReferences(kind, data, (id) => next.records[id], base?.data);
  if (kind !== "supply" && Object.values(next.records).some((r) => r.id !== data.id && r.kind === kind
      && (kind === "farm" || r.data.farmId === data.farmId)
      && r.data.name.toLocaleLowerCase("pt-BR") === data.name.toLocaleLowerCase("pt-BR"))) {
    throw new DomainError("Já existe um cadastro com esse nome. Edite ou reative o existente.", "name");
  }
  if (kind === "supply") {
    data.lotName = data.status === "cancelled" ? base.data.lotName : next.records[data.lotId]?.data.name;
    data.foodName = data.status === "cancelled" ? base.data.foodName : next.records[data.foodId]?.data.name;
  }
  if (resolving) {
    next.outbox = next.outbox.filter((op) => op.data.id !== data.id).map((op) => op.status === "blocked" ? { ...op, status: "pending" } : op);
  }
  const baseVersion = base?.version ?? 0;
  next.records[data.id] = { id: data.id, kind, data, version: baseVersion + 1, updatedAt: new Date().toISOString(), updatedBy: actor.id };
  next.outbox.push({ operationId, kind, baseVersion, data, status: "pending" });
  return next;
}

export function applyResults(workspace, results) {
  const next = copy(workspace);
  const resultById = new Map(results.map((r) => [r.operationId, r]));
  next.outbox = next.outbox.flatMap((op) => {
    const result = resultById.get(op.operationId);
    if (!result) return [op];
    if (result.status === "ok") return [];
    return [{ ...op, status: result.status, message: result.message, remote: result.record ?? null }];
  });
  for (const result of results) {
    if (result.status === "ok" && !pendingFor(next, result.record.id).length) next.records[result.record.id] = result.record;
  }
  return next;
}

export function mergeRemote(workspace, records) {
  const next = copy(workspace);
  const pendingIds = new Set(next.outbox.map((op) => op.data.id));
  const merged = Object.fromEntries(records.map((record) => [record.id, record]));
  for (const id of pendingIds) if (next.records[id]) merged[id] = next.records[id];
  next.records = merged;
  next.lastSync = new Date().toISOString();
  return next;
}

export function discardedIds(workspace, id) {
  const problem = pendingFor(workspace, id).find((op) => op.status !== "pending");
  if (problem?.remote) return [id];
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of Object.values(workspace.records)) {
      if (!ids.has(record.id) && [record.data.farmId, record.data.lotId, record.data.foodId].some((ref) => ids.has(ref))) {
        ids.add(record.id); changed = true;
      }
    }
  }
  return [...ids];
}

export function acceptRemote(workspace, id) {
  const next = copy(workspace);
  const problem = pendingFor(next, id).find((op) => op.status !== "pending");
  if (!problem) throw new DomainError("Não há pendência para resolver neste registro.");
  const ids = new Set(discardedIds(next, id));
  next.outbox = next.outbox.filter((op) => !ids.has(op.data.id)).map((op) => op.status === "blocked" ? { ...op, status: "pending" } : op);
  for (const item of ids) delete next.records[item];
  if (problem.remote) next.records[id] = problem.remote;
  return next;
}
