import { DatabaseSync, backup } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const [sourceArg, destinationArg] = process.argv.slice(2);
if (!sourceArg || !destinationArg) throw new Error("Uso: node scripts/restore.mjs backup.sqlite novo-banco.sqlite");
const source = resolve(sourceArg), destination = resolve(destinationArg);
if (!existsSync(source) || existsSync(destination)) throw new Error("A origem deve existir e o destino deve ser um arquivo novo.");
const db = new DatabaseSync(source, { readOnly: true });
try {
  const integrity = db.prepare("PRAGMA integrity_check").get();
  if (Object.values(integrity)[0] !== "ok" || db.prepare("PRAGMA user_version").get().user_version !== 1) throw new Error("Backup inválido ou de uma versão incompatível.");
  for (const table of ["users", "tenants", "records", "operations", "sessions", "audit"]) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error("O arquivo não é um backup completo do aplicativo.");
  }
  mkdirSync(dirname(destination), { recursive: true });
  await backup(db, destination);
  const restored = new DatabaseSync(destination);
  try { restored.exec("DELETE FROM sessions"); } finally { restored.close(); }
  console.log(`Cópia restaurada em ${destination}. As sessões foram encerradas. Pare o servidor antes de apontar DATABASE_PATH para este arquivo.`);
} finally { db.close(); }
