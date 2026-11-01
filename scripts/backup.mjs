import { backup } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openStore } from "../src/store.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.env.DATABASE_PATH ?? resolve(root, "data/pecuaria.sqlite"));
const destination = resolve(process.argv[2] ?? resolve(root, `data/backups/pecuaria-${new Date().toISOString().replace(/[:.]/g,"-")}.sqlite`));
if (source === destination) throw new Error("O destino deve ser diferente do banco em uso.");
if (!existsSync(source)) throw new Error("O banco de origem não existe. Inicie o aplicativo antes de fazer o backup.");
if (existsSync(destination)) throw new Error("O destino já existe. Use outro nome para preservar o backup anterior.");
mkdirSync(dirname(destination), { recursive: true });
const store = openStore(source);
try { await backup(store.db, destination); console.log(`Backup consistente criado em: ${destination}`); }
finally { store.close(); }
