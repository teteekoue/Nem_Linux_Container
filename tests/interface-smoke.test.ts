import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";

describe("Interface de test", () => {
  let server: ViteDevServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("sert la page et son point d’entrée sans erreur Vite", async () => {
    server = await createServer({
      configFile: "vite.config.ts",
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();

    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Le serveur Vite n’a pas démarré.");
    const origin = `http://127.0.0.1:${address.port}`;
    const [page, ...resources] = await Promise.all([
      fetch(origin),
      fetch(`${origin}/src/main.ts`),
      fetch(`${origin}/src/v86/engine.ts`),
      fetch(`${origin}/src/terminal/terminal.ts`),
      fetch(`${origin}/src/persistence/indexeddb.ts`),
      fetch(`${origin}/src/style.css`),
    ]);

    const mainSource = await resources[0].text();
    await Promise.all(resources.slice(1).map((resource) => resource.text()));
    expect(page.status).toBe(200);
    const markup = await page.text();
    expect(markup).toContain('src="/src/main.ts"');
    expect(markup).toContain("Reprendre la session");
    expect(markup).toContain("Redémarrer");
    expect(markup).toContain("Copier les logs");
    expect(markup).toContain("Télécharger les logs");
    expect(mainSource).toContain("reset-session");
    expect(resources.map((resource) => resource.status)).toEqual([200, 200, 200, 200, 200]);

    expect((await fetch(`${origin}/__nlc/diagnostics/reset`, { method: "POST" })).status).toBe(204);
    expect(
      (
        await fetch(`${origin}/__nlc/diagnostics`, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "logs de démarrage",
        })
      ).status,
    ).toBe(204);
    expect(await (await fetch(`${origin}/__nlc/diagnostics`)).text()).toBe("logs de démarrage");
  });
});
