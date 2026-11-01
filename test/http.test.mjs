import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { makeApplication } from "../src/server.mjs";

async function request(app, path, { method = "GET", body, cookie, csrf, origin = "http://localhost:3000", oneByteChunks = false } = {}) {
  const encoded = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
  const req = Readable.from(oneByteChunks ? Array.from(encoded,(byte) => Buffer.from([byte])) : [encoded]);
  req.method = method; req.url = path; req.socket = { remoteAddress: "127.0.0.1" };
  req.headers = { host: "localhost:3000", origin, "content-type": "application/json", cookie: cookie ?? "", "x-csrf-token": csrf };
  const res = { headers: {}, headersSent: false, status: 0, content: Buffer.alloc(0),
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(status, headers) { this.status = status; this.headersSent = true; for (const [k, v] of Object.entries(headers)) this.setHeader(k, v); },
    end(data) { this.content = Buffer.from(data ?? ""); } };
  await app.handler(req, res);
  return { status: res.status, headers: res.headers, body: res.headers["content-type"]?.includes("json") ? JSON.parse(res.content.toString()) : res.content.toString() };
}

test("HTTP: autenticação, cookies, origem, CSRF e isolamento de contas", async (t) => {
  const app = makeApplication({ database: ":memory:" }); t.after(() => app.store.close());
  assert.equal((await request(app, "/api/state")).status, 401);
  const input = { name: "Teste", accountName: "Conta", farmName: "Fazenda", email: "http@example.test", password: "senha-http-teste-1234" };
  assert.equal((await request(app, "/api/signup", { method: "POST", body: input, origin: "https://outro.test" })).status, 403);
  const signup = await request(app, "/api/signup", { method: "POST", body: input });
  assert.equal(signup.status, 200);
  assert.match(signup.headers["set-cookie"], /HttpOnly; SameSite=Strict/);
  const cookie = signup.headers["set-cookie"].split(";")[0], csrf = signup.body.user.csrf;
  assert.equal((await request(app, "/api/sync", { method: "POST", cookie, body: { operations: [] } })).status, 403);
  assert.equal((await request(app, "/api/sync", { method: "POST", cookie, csrf, body: { operations: [] } })).status, 200);
  const state = await request(app, "/api/state", { cookie });
  assert.equal(state.body.records.length, 1);
  assert.equal(state.headers["cache-control"], "no-store");
  const second = await request(app, "/api/signup", { method: "POST", body: { ...input, email: "other@example.test", farmName: "Outra" } });
  const otherState = await request(app, "/api/state", { cookie: second.headers["set-cookie"].split(";")[0] });
  assert.equal(otherState.body.records[0].data.name, "Outra");
  assert.notEqual(otherState.body.records[0].id, state.body.records[0].id);
  await request(app, "/api/logout", { method: "POST", cookie, csrf, body: {} });
  assert.equal((await request(app, "/api/me", { cookie })).status, 401);
});

test("servidor não expõe banco ou código privado e exige HTTPS configurado em produção", async (t) => {
  const app = makeApplication({ database: ":memory:" }); t.after(() => app.store.close());
  for (const path of ["/data/pecuaria.sqlite", "/src/store.mjs", "/%2e%2e%2fpackage.json"]) assert.equal((await request(app, path)).status, 404);
  assert.throws(() => makeApplication({ database: ":memory:", production: true }), /HTTPS/);
  assert.throws(() => makeApplication({ database: ":memory:", production: true, origin: "http://example.test" }), /HTTPS/);
});

test("rotas de equipe aplicam papéis e alteração de senha encerra sessões", async (t) => {
  const app = makeApplication({ database: ":memory:" }); t.after(() => app.store.close());
  const signup = await request(app,"/api/signup",{method:"POST",body:{name:"Admin",accountName:"Conta",farmName:"Fazenda",email:"admin@example.test",password:"senha-do-admin-12345"}});
  const cookie = signup.headers["set-cookie"].split(";")[0], csrf = signup.body.user.csrf;
  const created = await request(app,"/api/users",{method:"POST",cookie,csrf,body:{name:"Operador",email:"op@example.test",password:"senha-do-operador-12345",role:"operator"}});
  assert.equal(created.status,201);
  const login = await request(app,"/api/login",{method:"POST",body:{email:"op@example.test",password:"senha-do-operador-12345"}});
  const operatorCookie = login.headers["set-cookie"].split(";")[0];
  assert.equal((await request(app,"/api/users",{cookie:operatorCookie})).status,403);
  const changed = await request(app,`/api/users/${created.body.user.id}/password`,{method:"POST",cookie,csrf,body:{password:"nova-senha-operador-12345"}});
  assert.equal(changed.status,200);
  assert.equal((await request(app,"/api/me",{cookie:operatorCookie})).status,401);
  const after = await request(app,"/api/login",{method:"POST",body:{email:"op@example.test",password:"nova-senha-operador-12345"}});
  assert.equal(after.status,200);
  const disabled = await request(app,`/api/users/${created.body.user.id}`,{method:"POST",cookie,csrf,body:{role:"operator",active:false}});
  assert.equal(disabled.status,200);
  assert.equal((await request(app,"/api/login",{method:"POST",body:{email:"op@example.test",password:"nova-senha-operador-12345"}})).status,401);
});

test("produção emite cookie Secure e rejeita host diferente do configurado", async (t) => {
  const app = makeApplication({database:":memory:",production:true,origin:"https://localhost:3000/"}); t.after(() => app.store.close());
  const result = await request(app,"/api/signup",{method:"POST",origin:"https://localhost:3000",body:{name:"Admin",accountName:"Conta",farmName:"Fazenda",email:"prod@example.test",password:"senha-do-admin-12345"}});
  assert.equal(result.status,200);
  assert.match(result.headers["set-cookie"],/^__Host-pecuaria_session=/);
  assert.match(result.headers["set-cookie"],/; Secure$/);
  const other = makeApplication({database:":memory:",origin:"https://app.example.test"}); t.after(() => other.store.close());
  assert.equal((await request(other,"/api/health")).status,403);
});

test("texto acentuado é preservado quando o HTTP divide os caracteres entre pacotes", async (t) => {
  const app = makeApplication({database:":memory:"}); t.after(() => app.store.close());
  const result = await request(app,"/api/signup",{method:"POST",oneByteChunks:true,body:{name:"João",accountName:"Produção",farmName:"Fazenda São José",email:"acentos@example.test",password:"senha-do-admin-12345"}});
  assert.equal(result.status,200);
  assert.equal(result.body.user.name,"João");
  const state = await request(app,"/api/state",{cookie:result.headers["set-cookie"].split(";")[0]});
  assert.equal(state.body.records[0].data.name,"Fazenda São José");
});
