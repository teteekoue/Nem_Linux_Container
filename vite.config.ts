import { defineConfig } from "vite";

interface DiagnosticRequest {
  method?: string;
  url?: string;
  on(event: "data", listener: (chunk: string | Uint8Array) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
}

export default defineConfig({
  publicDir: "public",
  plugins: [
    {
      name: "nlc-local-diagnostics",
      configureServer(server) {
        let serialOutput = "";
        server.middlewares.use("/__nlc/diagnostics", (request, response, next) => {
          const diagnosticRequest = request as typeof request & DiagnosticRequest;
          if (diagnosticRequest.method === "GET") {
            response.statusCode = 200;
            response.setHeader("Content-Type", "text/plain; charset=utf-8");
            response.setHeader("Cache-Control", "no-store");
            response.end(serialOutput);
            return;
          }
          if (diagnosticRequest.method !== "POST") {
            next();
            return;
          }

          if (diagnosticRequest.url === "/reset") {
            serialOutput = "";
            response.statusCode = 204;
            response.end();
            return;
          }

          const decoder = new TextDecoder();
          let body = "";
          diagnosticRequest.on("data", (chunk) => {
            body += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
          });
          diagnosticRequest.on("end", () => {
            serialOutput += body + decoder.decode();
            response.statusCode = 204;
            response.end();
          });
          diagnosticRequest.on("error", (error: Error) => {
            server.config.logger.error(`Collecte des logs NLC impossible : ${error.message}`);
            response.statusCode = 500;
            response.end();
          });
        });
      },
    },
  ],
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
  },
  server: {
    host: "0.0.0.0",
  },
});
