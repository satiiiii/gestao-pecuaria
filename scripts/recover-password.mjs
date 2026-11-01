import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "../src/store.mjs";

const email = process.argv[2];
if (!email || process.stdin.isTTY) throw new Error("Informe o e-mail como argumento e envie a nova senha pela entrada padrão, sem colocá-la na linha de comando.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = resolve(process.env.DATABASE_PATH ?? resolve(root, "data/pecuaria.sqlite"));
if (!existsSync(path)) throw new Error("Banco não encontrado.");
const password = readFileSync(0,"utf8").replace(/\r?\n$/, "");
const store = openStore(path);
try { await store.recoverPassword(email,password); console.log("Senha redefinida e sessões do usuário encerradas. A operação foi registrada no histórico."); }
finally { store.close(); }
