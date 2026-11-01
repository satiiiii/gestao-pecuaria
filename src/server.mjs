import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openStore, AppError } from "./store.mjs";
import { DomainError } from "../public/domain.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

export function makeApplication({ database = resolve(root, "data/pecuaria.sqlite"), origin = null, production = false } = {}) {
  if (production && (!origin || new URL(origin).protocol !== "https:")) throw new Error("Em produção, configure APP_ORIGIN com HTTPS.");
  if (origin) origin = new URL(origin).origin;
  const store = openStore(database);
  const cookieName = production ? "__Host-pecuaria_session" : "pecuaria_session";
  const limits = new Map();
  function limit(key, max, windowMs) {
    const now = Date.now();
    if (limits.size > 5000) for (const [id, v] of limits) if (v.until < now) limits.delete(id);
    if (limits.size > 10000 && !limits.has(key)) throw new AppError("Muitas tentativas. Aguarde alguns minutos.", 429);
    const entry = limits.get(key);
    if (!entry || entry.until < now) limits.set(key, { count: 1, until: now + windowMs });
    else { entry.count++; if (entry.count > max) throw new AppError("Muitas tentativas. Aguarde alguns minutos.", 429); }
  }
  const cookie = (token, clear = false) => `${cookieName}=${clear ? "" : token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 604800}${production ? "; Secure" : ""}`;
  function send(res, status, data, extra = {}) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
    res.end(JSON.stringify(data));
  }
  async function body(req) {
    const chunks = []; let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 512 * 1024) throw new AppError("A requisição excedeu o limite de tamanho.", 413);
      chunks.push(chunk);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new AppError("O corpo da requisição não é JSON válido."); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError("Envie um objeto JSON.");
    return input;
  }
  async function handler(req, res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (production) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    try {
      const expectedOrigin = origin ?? `http://${req.headers.host}`;
      if (origin && req.headers.host !== new URL(origin).host) throw new AppError("Host não autorizado.", 403);
      if (!origin && !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host ?? "")) throw new AppError("Configure APP_ORIGIN para usar este endereço.", 403);
      const url = new URL(req.url, expectedOrigin);
      if (url.pathname.startsWith("/api/")) {
        if (!["GET", "POST"].includes(req.method)) throw new AppError("Método não permitido.", 405);
        if (req.method === "POST") {
          if (req.headers.origin !== expectedOrigin || !req.headers["content-type"]?.startsWith("application/json")) throw new AppError("Origem da requisição inválida.", 403);
        }
        if (url.pathname === "/api/health" && req.method === "GET") return send(res, 200, { ok: true, version: "0.1.0" });
        const ip = req.socket.remoteAddress;
        if (["/api/login", "/api/signup"].includes(url.pathname) && req.method === "POST") {
          limit(`auth:${ip}`, 30, 15 * 60 * 1000);
          if (url.pathname === "/api/signup") limit(`signup:${ip}`, 5, 60 * 60 * 1000);
          const input = await body(req);
          const actor = url.pathname === "/api/signup" ? await store.signup(input) : await store.login(input.email, input.password);
          const session = store.createSession(actor);
          return send(res, 200, { user: store.authenticate(session.token) }, { "Set-Cookie": cookie(session.token) });
        }
        const cookies = Object.fromEntries((req.headers.cookie ?? "").split(";").map((s) => s.trim().split("=")).filter((p) => p.length === 2));
        const token = cookies[cookieName];
        const actor = store.authenticate(token);
        if (req.method === "POST" && req.headers["x-csrf-token"] !== actor.csrf) throw new AppError("Sua sessão precisa ser atualizada. Entre novamente.", 403);
        if (url.pathname === "/api/me" && req.method === "GET") return send(res, 200, { user: actor });
        if (url.pathname === "/api/state" && req.method === "GET") return send(res, 200, { records: store.listRecords(actor.tenantId), serverTime: new Date().toISOString() });
        if (url.pathname === "/api/sync" && req.method === "POST") {
          limit(`sync:${actor.id}`, 120, 60_000);
          const input = await body(req);
          return send(res, 200, { results: store.sync(actor, input.operations) });
        }
        if (url.pathname === "/api/logout" && req.method === "POST") {
          store.logout(token); return send(res, 200, { ok: true }, { "Set-Cookie": cookie("", true) });
        }
        if (url.pathname === "/api/users" && req.method === "GET") return send(res, 200, { users: store.users(actor) });
        if (url.pathname === "/api/users" && req.method === "POST") return send(res, 201, { user: await store.createUser(actor, await body(req)) });
        const userRoute = /^\/api\/users\/([a-f0-9-]+)(\/password)?$/.exec(url.pathname);
        if (userRoute && req.method === "POST") {
          const input = await body(req);
          if (userRoute[2]) { await store.changePassword(actor, userRoute[1], input.password, input.currentPassword); return send(res, 200, { ok: true }); }
          return send(res, 200, { user: store.updateUser(actor, userRoute[1], input) });
        }
        if (url.pathname === "/api/audit" && req.method === "GET") return send(res, 200, { events: store.listAudit(actor, url.searchParams.get("recordId")) });
        throw new AppError("Recurso não encontrado.", 404);
      }
      if (!["GET", "HEAD"].includes(req.method)) throw new AppError("Método não permitido.", 405);
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new AppError("Endereço inválido.", 400); }
      const publicRoot = resolve(root, "public");
      const path = resolve(publicRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!path.startsWith(publicRoot + sep) || !mime[extname(path)]) throw new AppError("Arquivo não encontrado.", 404);
      let content;
      try { content = await readFile(path); } catch { throw new AppError("Arquivo não encontrado.", 404); }
      res.writeHead(200, { "Content-Type": mime[extname(path)], "Cache-Control": "no-cache", ...(pathname === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}) });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      const expected = error instanceof AppError || error instanceof DomainError;
      if (!expected) console.error("Falha interna:", error.code ?? error.name);
      if (!res.headersSent) send(res, expected ? error.status ?? 400 : 500, { error: expected ? error.message : "Não foi possível concluir a operação. Tente novamente." });
      else res.end();
    }
  }
  const server = createServer(handler);
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return { server, handler, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000), host = process.env.HOST ?? "127.0.0.1";
  const app = makeApplication({ database: process.env.DATABASE_PATH ?? resolve(root, "data/pecuaria.sqlite"),
    origin: process.env.APP_ORIGIN || null, production: process.env.NODE_ENV === "production" });
  app.server.listen(port, host, () => console.log(`Gestão Pecuária: http://${host}:${port}`));
  app.server.on("error", (error) => { console.error("Não foi possível iniciar:", error.message); app.store.close(); process.exitCode = 1; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => app.server.close(() => { app.store.close(); process.exit(); }));
}
