import { emptyWorkspace } from "./sync-core.mjs";

export async function openWorkspace(user) {
  const name = `pecuaria-${user.tenantId}-${user.id}`;
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("workspace");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("Não foi possível abrir os dados deste aparelho. Verifique o armazenamento do navegador."));
    req.onblocked = () => reject(new Error("Feche outras abas deste aplicativo e tente novamente."));
  });
  function load() {
    return new Promise((resolve, reject) => {
      const req = db.transaction("workspace").objectStore("workspace").get("state");
      req.onsuccess = () => resolve(req.result ?? { ...emptyWorkspace(), localRevision: 0 });
      req.onerror = () => reject(new Error("Não foi possível ler os registros locais."));
    });
  }
  function save(next, expectedRevision) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite"), store = tx.objectStore("workspace");
      let reason = "Não foi possível salvar no aparelho. Libere espaço e tente novamente.";
      let saved;
      const req = store.get("state");
      req.onsuccess = () => {
        if ((req.result?.localRevision ?? 0) !== expectedRevision) {
          reason = "Outra aba atualizou os dados. Recarregue esta página antes de continuar.";
          tx.abort(); return;
        }
        saved = { ...structuredClone(next), localRevision: expectedRevision + 1 };
        store.put(saved, "state");
      };
      tx.oncomplete = () => resolve(saved);
      tx.onerror = tx.onabort = () => reject(new Error(reason));
    });
  }
  function clear() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite"); tx.objectStore("workspace").clear();
      tx.oncomplete = resolve; tx.onerror = () => reject(new Error("Não foi possível limpar os dados deste aparelho."));
    });
  }
  return { name, load, save, clear, close: () => db.close() };
}
