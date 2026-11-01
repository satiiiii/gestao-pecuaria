import { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes, createHash, scrypt as rawScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { validateRecord, checkReferences, isId, kinds, DomainError } from "../public/domain.mjs";

const scrypt = promisify(rawScrypt);
const digest = (value) => createHash("sha256").update(value).digest("hex");
export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function passwordValid(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw new AppError("Use uma senha de 12 a 128 caracteres.");
  }
}
function cleanName(value, label = "nome") {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) throw new AppError(`Informe ${label}, com até 100 caracteres.`);
  return value.trim();
}
function cleanEmail(value) {
  if (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new AppError("Informe um e-mail válido.");
  return value.trim().toLowerCase();
}
async function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  const hash = await scrypt(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return { salt, hash: hash.toString("hex") };
}

export function openStore(path = ":memory:") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('owner','operator')),
      active INTEGER NOT NULL DEFAULT 1, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
      kind TEXT NOT NULL, farm_id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL,
      updated_at TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id));
    CREATE INDEX IF NOT EXISTS records_tenant ON records(tenant_id,kind,farm_id);
    CREATE TABLE IF NOT EXISTS operations(tenant_id TEXT NOT NULL, id TEXT NOT NULL, user_id TEXT NOT NULL,
      request_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(tenant_id,id));
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT NOT NULL, farm_id TEXT,
      before_data TEXT, after_data TEXT, at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS audit_tenant ON audit(tenant_id,id);
    PRAGMA user_version=1;`);

  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function audit(actor, action, entityId, farmId, before, after) {
    db.prepare("INSERT INTO audit(tenant_id,user_id,action,entity_id,farm_id,before_data,after_data,at) VALUES(?,?,?,?,?,?,?,?)")
      .run(actor.tenantId, actor.id, action, entityId, farmId ?? null,
        before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, new Date().toISOString());
  }
  function publicUser(row) {
    return { id: row.id, tenantId: row.tenant_id, name: row.name, email: row.email, role: row.role, active: Boolean(row.active) };
  }
  function requireOwner(actor) {
    if (actor.role !== "owner") throw new AppError("Esta ação é exclusiva do administrador da conta.", 403);
  }
  function recordFromRow(row) {
    return row ? { id: row.id, kind: row.kind, data: JSON.parse(row.data), version: row.version,
      updatedAt: row.updated_at, updatedBy: row.updated_by } : null;
  }
  function getRecord(tenantId, id) {
    return recordFromRow(db.prepare("SELECT * FROM records WHERE tenant_id=? AND id=?").get(tenantId, id));
  }
  function listRecords(tenantId) {
    return db.prepare("SELECT * FROM records WHERE tenant_id=? ORDER BY updated_at,id").all(tenantId).map(recordFromRow);
  }
  function writeRecord(tenantId, actorId, kind, data, version) {
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO records(id,tenant_id,kind,farm_id,data,version,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
      .run(data.id, tenantId, kind, data.farmId, JSON.stringify(data), version, at, actorId);
    return getRecord(tenantId, data.id);
  }

  async function signup(input) {
    const name = cleanName(input.name);
    const accountName = cleanName(input.accountName, "o nome da conta");
    const farmName = cleanName(input.farmName, "o nome da primeira fazenda");
    const email = cleanEmail(input.email);
    passwordValid(input.password);
    const credentials = await passwordHash(input.password);
    if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email)) throw new AppError("Não foi possível criar a conta com esse e-mail.", 409);
    return transaction(() => {
      const tenantId = randomUUID(), id = randomUUID(), farmId = randomUUID(), at = new Date().toISOString();
      db.prepare("INSERT INTO tenants VALUES(?,?,?)").run(tenantId, accountName, at);
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1,?,?,?)").run(id, tenantId, name, email, "owner", credentials.salt, credentials.hash, at);
      const actor = { id, tenantId, name, email, role: "owner", active: true };
      const farm = writeRecord(tenantId, id, "farm", { id: farmId, farmId, name: farmName, active: true }, 1);
      audit(actor, "created", farmId, farmId, null, farm);
      return actor;
    });
  }
  async function login(emailInput, password) {
    const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";
    const user = db.prepare("SELECT * FROM users WHERE email=? AND active=1").get(email);
    const safePassword = typeof password === "string" && password.length <= 128 ? password : "";
    const credentials = await passwordHash(safePassword, user?.salt ?? "00000000000000000000000000000000");
    const expected = Buffer.from(user?.hash ?? "00".repeat(64), "hex");
    if (!timingSafeEqual(Buffer.from(credentials.hash, "hex"), expected) || !user) throw new AppError("E-mail ou senha incorretos.", 401);
    return publicUser(user);
  }
  function createSession(actor) {
    const token = randomBytes(32).toString("hex"), csrf = randomBytes(24).toString("hex");
    const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(digest(token), actor.id, csrf, expires);
    return { token, csrf, expires };
  }
  function authenticate(token) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new AppError("Entre na sua conta para continuar.", 401);
    const row = db.prepare(`SELECT u.*,s.csrf,s.expires,t.name AS account_name FROM sessions s
      JOIN users u ON u.id=s.user_id JOIN tenants t ON t.id=u.tenant_id WHERE s.hash=? AND s.expires>? AND u.active=1`).get(digest(token), Date.now());
    if (!row) throw new AppError("Sua sessão terminou. Entre novamente; os registros pendentes serão preservados.", 401);
    return { ...publicUser(row), accountName: row.account_name, csrf: row.csrf, offlineUntil: row.expires };
  }
  function logout(token) { db.prepare("DELETE FROM sessions WHERE hash=?").run(digest(token)); }

  function applyOperation(actor, op) {
    if (!op || !isId(op.operationId) || !kinds.includes(op.kind) || !Number.isSafeInteger(op.baseVersion) || op.baseVersion < 0) {
      throw new AppError("Operação de sincronização inválida.");
    }
    if (op.kind === "farm") requireOwner(actor);
    const data = validateRecord(op.kind, op.data);
    const requestHash = digest(JSON.stringify({ kind: op.kind, baseVersion: op.baseVersion, data }));
    return transaction(() => {
      const receipt = db.prepare("SELECT * FROM operations WHERE tenant_id=? AND id=?").get(actor.tenantId, op.operationId);
      if (receipt) {
        if (receipt.request_hash !== requestHash || receipt.user_id !== actor.id) throw new AppError("O identificador da operação já foi usado. Revise o registro.", 409);
        return JSON.parse(receipt.result);
      }
      const previous = getRecord(actor.tenantId, data.id);
      if ((previous && (previous.kind !== op.kind || previous.version !== op.baseVersion)) || (!previous && op.baseVersion !== 0)) {
        return { operationId: op.operationId, status: "conflict", record: previous, message: "O registro mudou em outro aparelho. Escolha qual versão manter." };
      }
      if (!previous && db.prepare("SELECT 1 FROM records WHERE id=?").get(data.id)) throw new AppError("Identificador indisponível. Crie o cadastro novamente.", 409);
      checkReferences(op.kind, data, (id) => getRecord(actor.tenantId, id), previous?.data);
      if (op.kind !== "supply") {
        const duplicate = listRecords(actor.tenantId).some((r) => r.id !== data.id && r.kind === op.kind && r.data.farmId === data.farmId
          && r.data.name.toLocaleLowerCase("pt-BR") === data.name.toLocaleLowerCase("pt-BR"));
        // Fazendas têm farmId próprio, então a comparação de nomes é por conta.
        const duplicateFarm = op.kind === "farm" && listRecords(actor.tenantId).some((r) => r.kind === "farm" && r.id !== data.id
          && r.data.name.toLocaleLowerCase("pt-BR") === data.name.toLocaleLowerCase("pt-BR"));
        if (duplicate || duplicateFarm) throw new DomainError("Já existe um cadastro com esse nome. Edite ou reative o existente.", "name");
      } else {
        data.lotName = data.status === "cancelled" ? previous.data.lotName : getRecord(actor.tenantId, data.lotId).data.name;
        data.foodName = data.status === "cancelled" ? previous.data.foodName : getRecord(actor.tenantId, data.foodId).data.name;
      }
      const record = writeRecord(actor.tenantId, actor.id, op.kind, data, op.baseVersion + 1);
      audit(actor, !previous ? "created" : op.kind === "supply" && data.status === "cancelled" ? "cancelled" : "updated", data.id, data.farmId, previous, record);
      const result = { operationId: op.operationId, status: "ok", record };
      db.prepare("INSERT INTO operations VALUES(?,?,?,?,?)").run(actor.tenantId, op.operationId, actor.id, requestHash, JSON.stringify(result));
      return result;
    });
  }

  function sync(actor, operations) {
    if (!Array.isArray(operations) || operations.length > 100) throw new AppError("Envie até 100 operações por sincronização.");
    const blocked = new Set();
    return operations.map((op) => {
      const id = op?.data?.id;
      if (blocked.has(id)) return { operationId: op?.operationId, status: "blocked", message: "Resolva a operação anterior deste registro." };
      try {
        const result = applyOperation(actor, op);
        if (result.status !== "ok") blocked.add(id);
        return result;
      } catch (error) {
        if (!(error instanceof AppError || error instanceof DomainError)) throw error;
        blocked.add(id);
        return { operationId: op?.operationId, status: "error", message: error.message,
          record: isId(id) ? getRecord(actor.tenantId, id) : null };
      }
    });
  }
  function users(actor) {
    requireOwner(actor);
    return db.prepare("SELECT * FROM users WHERE tenant_id=? ORDER BY name").all(actor.tenantId).map(publicUser);
  }
  async function createUser(actor, input) {
    requireOwner(actor);
    const name = cleanName(input.name), email = cleanEmail(input.email);
    if (!["owner", "operator"].includes(input.role)) throw new AppError("Escolha administrador ou operador.");
    passwordValid(input.password);
    const credentials = await passwordHash(input.password);
    if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email)) throw new AppError("Esse e-mail não está disponível.", 409);
    return transaction(() => {
      const id = randomUUID();
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?,1,?,?,?)")
        .run(id, actor.tenantId, name, email, input.role, credentials.salt, credentials.hash, new Date().toISOString());
      const user = publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id));
      audit(actor, "user-created", id, null, null, user);
      return user;
    });
  }
  function updateUser(actor, id, input) {
    requireOwner(actor);
    if (typeof input.active !== "boolean" || !["owner", "operator"].includes(input.role)) throw new AppError("Permissões inválidas.");
    return transaction(() => {
      const row = db.prepare("SELECT * FROM users WHERE tenant_id=? AND id=?").get(actor.tenantId, id);
      if (!row) throw new AppError("Usuário não encontrado.", 404);
      if (id === actor.id && (!input.active || input.role !== "owner")) throw new AppError("Outro administrador deve alterar o seu acesso.");
      db.prepare("UPDATE users SET role=?,active=? WHERE id=? AND tenant_id=?").run(input.role, Number(input.active), id, actor.tenantId);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      const user = publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id));
      audit(actor, "user-updated", id, null, publicUser(row), user);
      return user;
    });
  }
  async function changePassword(actor, id, password, currentPassword) {
    const row = db.prepare("SELECT * FROM users WHERE tenant_id=? AND id=?").get(actor.tenantId, id);
    if (!row) throw new AppError("Usuário não encontrado.", 404);
    if (id === actor.id) await login(actor.email, currentPassword);
    else requireOwner(actor);
    passwordValid(password);
    const credentials = await passwordHash(password);
    transaction(() => {
      db.prepare("UPDATE users SET salt=?,hash=? WHERE id=? AND tenant_id=?").run(credentials.salt, credentials.hash, id, actor.tenantId);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      audit(actor, "password-changed", id, null, null, null);
    });
  }
  // Somente a ferramenta de manutenção local usa este método. Não há rota HTTP.
  async function recoverPassword(emailInput, password) {
    const email = cleanEmail(emailInput);
    const row = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!row) throw new AppError("Usuário não encontrado.", 404);
    passwordValid(password);
    const credentials = await passwordHash(password);
    transaction(() => {
      db.prepare("UPDATE users SET salt=?,hash=? WHERE id=?").run(credentials.salt, credentials.hash, row.id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(row.id);
      audit(publicUser(row), "password-recovered-local-admin", row.id, null, null, null);
    });
  }
  function listAudit(actor, recordId = null) {
    if (recordId && !isId(recordId)) throw new AppError("Identificador inválido.");
    return db.prepare(`SELECT a.*,u.name AS user_name FROM audit a JOIN users u ON u.id=a.user_id
      WHERE a.tenant_id=? AND (? IS NULL OR a.entity_id=?) AND (?='owner' OR a.farm_id IS NOT NULL) ORDER BY a.id DESC LIMIT 100`)
      .all(actor.tenantId, recordId, recordId, actor.role).map((r) => ({ id: r.id, action: r.action, entityId: r.entity_id, farmId: r.farm_id,
        userName: r.user_name, at: r.at, before: r.before_data ? JSON.parse(r.before_data) : null, after: r.after_data ? JSON.parse(r.after_data) : null }));
  }
  return { db, signup, login, createSession, authenticate, logout, getRecord, listRecords, sync, users, createUser, updateUser, changePassword, recoverPassword, listAudit, close: () => db.close() };
}
