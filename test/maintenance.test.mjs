import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { openStore } from "../src/store.mjs";

const root = fileURLToPath(new URL("..",import.meta.url));
test("backup e restauração preservam registros e encerram sessões sem sobrescrever arquivos", async () => {
  const dir = mkdtempSync(join(tmpdir(),"pecuaria-backup-")), source = join(dir,"source.sqlite"), target = join(dir,"backup.sqlite"), restored = join(dir,"restored.sqlite");
  let store = openStore(source);
  const actor = await store.signup({name:"Teste",accountName:"Conta",farmName:"Fazenda",email:"backup@example.test",password:"senha-do-backup-12345"});
  store.createSession(actor); store.close();
  const result = spawnSync(process.execPath,[resolve(root,"scripts/backup.mjs"),target],{env:{...process.env,DATABASE_PATH:source},encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
  const again = spawnSync(process.execPath,[resolve(root,"scripts/backup.mjs"),target],{env:{...process.env,DATABASE_PATH:source},encoding:"utf8"});
  assert.notEqual(again.status,0);
  const recovery = spawnSync(process.execPath,[resolve(root,"scripts/restore.mjs"),target,restored],{encoding:"utf8"});
  assert.equal(recovery.status,0,recovery.stderr);
  store = openStore(restored);
  try {
    assert.equal(store.listRecords(actor.tenantId).length,1);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM sessions").get().n,0);
  } finally { store.close(); }
});

test("recuperação administrativa da senha invalida o segredo antigo e as sessões", async (t) => {
  const store = openStore(); t.after(() => store.close());
  const email = "recovery@example.test";
  const actor = await store.signup({name:"Teste",accountName:"Conta",farmName:"Fazenda",email,password:"senha-anterior-12345"});
  const session = store.createSession(actor);
  await store.recoverPassword(email,"nova-senha-protegida-12345");
  await assert.rejects(store.login(email,"senha-anterior-12345"),/incorretos/);
  assert.throws(() => store.authenticate(session.token),/sessão/);
  assert.equal((await store.login(email,"nova-senha-protegida-12345")).id,actor.id);
  assert.equal(store.listAudit(actor).some((event) => event.action === "password-recovered-local-admin"),true);
});
