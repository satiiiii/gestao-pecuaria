// Regras compartilhadas pelo formulário, pelo modo offline e pelo servidor.
// Uma futura IA entregará dados a estas mesmas regras, sem acesso ao banco.
export class DomainError extends Error {
  constructor(message, field = "") { super(message); this.field = field; }
}

export const kinds = ["farm", "lot", "food", "supply"];
export const isId = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function text(value, label, field, max = 100, optional = false) {
  if (typeof value !== "string") throw new DomainError(`Informe ${label}.`, field);
  const result = value.trim();
  if ((!optional && !result) || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) {
    throw new DomainError(`${label}: ${optional ? "use até" : "use de 1 a"} ${max} caracteres.`, field);
  }
  return result;
}

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day > 0 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function parseQuantity(value) {
  const textValue = String(value).trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(textValue)) return NaN;
  return Number(textValue.replace(",", "."));
}

export function validateRecord(kind, raw) {
  if (!kinds.includes(kind) || !raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DomainError("Tipo de registro inválido.");
  }
  if (!isId(raw.id)) throw new DomainError("Identificador inválido.", "id");
  if (!isId(raw.farmId) || (kind === "farm" && raw.farmId !== raw.id)) {
    throw new DomainError("Escolha a fazenda.", "farmId");
  }
  const base = { id: raw.id, farmId: raw.farmId };
  if (kind !== "supply") {
    if (typeof raw.active !== "boolean") throw new DomainError("Informe se o cadastro está ativo.", "active");
    return { ...base, name: text(raw.name, kind === "lot" ? "a identificação do lote" : "o nome", "name"), active: raw.active };
  }
  if (!validDate(raw.date)) throw new DomainError("Informe uma data completa e possível no calendário.", "date");
  if (!isId(raw.lotId)) throw new DomainError("Escolha o lote.", "lotId");
  if (!isId(raw.foodId)) throw new DomainError("Escolha o alimento.", "foodId");
  if (typeof raw.quantity !== "number" || !Number.isFinite(raw.quantity) || raw.quantity <= 0) {
    throw new DomainError("Informe uma quantidade em kg maior que zero, sem a unidade no campo.", "quantity");
  }
  if (raw.unit !== "kg") throw new DomainError("Nesta versão, a unidade é kg.", "unit");
  if (!["active", "cancelled"].includes(raw.status)) throw new DomainError("Situação do fornecimento inválida.", "status");
  const notes = text(raw.notes ?? "", "a observação", "notes", 1000, true);
  const cancelReason = text(raw.cancelReason ?? "", "o motivo do cancelamento", "cancelReason", 500, raw.status !== "cancelled");
  return { ...base, date: raw.date, lotId: raw.lotId, foodId: raw.foodId, quantity: raw.quantity,
    unit: "kg", notes, status: raw.status, cancelReason: raw.status === "cancelled" ? cancelReason : "" };
}

export function checkReferences(kind, data, lookup, previous = null) {
  if (previous && previous.farmId !== data.farmId) throw new DomainError("Um registro não pode mudar de fazenda.");
  if (kind === "farm") return;
  const farm = lookup(data.farmId);
  if (!farm || farm.kind !== "farm" || !farm.data.active) throw new DomainError("A fazenda não existe ou está arquivada.", "farmId");
  if (kind !== "supply") return;
  if (previous?.status === "cancelled") throw new DomainError("Fornecimentos cancelados são mantidos para consulta e não podem ser alterados.");
  if (!previous && data.status !== "active") throw new DomainError("Um novo fornecimento deve estar ativo.");
  // Cancelar um lançamento continua possível mesmo se o lote/alimento foi arquivado.
  if (data.status === "cancelled" && previous) {
    for (const field of ["date", "lotId", "foodId", "quantity", "unit", "notes"]) {
      if (data[field] !== previous[field]) throw new DomainError("Cancele sem alterar os outros dados do fornecimento.");
    }
    return;
  }
  for (const [field, expected, label] of [["lotId", "lot", "lote"], ["foodId", "food", "alimento"]]) {
    const record = lookup(data[field]);
    if (!record || record.kind !== expected || record.data.farmId !== data.farmId || !record.data.active) {
      throw new DomainError(`Escolha um ${label} ativo desta fazenda.`, field);
    }
  }
}

export function supplyCSV(records, lookup) {
  const cell = (value) => {
    let result = String(value ?? "");
    if (/^[\s]*[=+@\-]/.test(result) || /^[\t\r\n]/.test(result)) result = `'${result}`;
    return `"${result.replaceAll('"', '""')}"`;
  };
  const rows = [["Data", "Fazenda", "Lote", "Alimento", "Quantidade (kg)", "Situação", "Observação", "Motivo do cancelamento"]];
  for (const record of records) {
    const d = record.data;
    rows.push([d.date, lookup(d.farmId)?.data.name, d.lotName ?? lookup(d.lotId)?.data.name,
      d.foodName ?? lookup(d.foodId)?.data.name, String(d.quantity).replace(".", ","),
      d.status === "cancelled" ? "Cancelado" : "Ativo", d.notes, d.cancelReason]);
  }
  return "\ufeff" + rows.map((row) => row.map(cell).join(";")).join("\r\n");
}
