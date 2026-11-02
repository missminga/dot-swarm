import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Runtime, type RuntimeOptions } from "./runtime.js";

async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Error("application/json required");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 32768) throw new Error("Request exceeds 32 KiB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}
export async function startServer(
  options: RuntimeOptions & { port?: number; assets?: string },
) {
  const port = options.port ?? 4317;
  const assets =
    options.assets ?? fileURLToPath(new URL("../dist/panel", import.meta.url));
  // Bind before opening state, so the default port enforces one local host.
  let runtime: Runtime;
  const clients = new Set<ServerResponse>();
  let actualPort = port;
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${actualPort}`;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    // Loopback Host validation prevents DNS rebinding. No CORS; JSON + exact
    // Origin on all browser mutations prevents cross-site form/fetch launches.
    if (req.headers.host !== `127.0.0.1:${actualPort}`) {
      json(res, 403, { error: `Open ${origin}` });
      return;
    }
    if (req.headers.origin && req.headers.origin !== origin) {
      json(res, 403, { error: "Cross-origin requests are not allowed" });
      return;
    }
    const path = new URL(req.url ?? "/", origin).pathname;
    try {
      if (req.method === "GET" && path === "/api/state") {
        json(res, 200, runtime.snapshot());
        return;
      }
      if (req.method === "GET" && path === "/api/events") {
        if (clients.size >= 20) {
          json(res, 429, { error: "Too many event connections" });
          return;
        }
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        res.write("data: changed\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (req.method === "POST") {
        const input = await body(req);
        if (path === "/api/personas") {
          json(res, 201, runtime.createPersona(input));
          return;
        }
        if (path === "/api/parent") {
          const d = z
            .object({ id: z.string(), parentId: z.string().nullable() })
            .strict()
            .parse(input);
          runtime.parent(d.id, d.parentId);
        } else if (path === "/api/squads") {
          json(res, 201, runtime.createSquad(input));
          return;
        } else if (path === "/api/missions") {
          json(res, 201, runtime.assign(input));
          return;
        } else if (path === "/api/cancel")
          runtime.cancel(z.object({ id: z.string() }).strict().parse(input).id);
        else if (path === "/api/permission") {
          const d = z
            .object({
              runId: z.string(),
              permissionId: z.string(),
              optionId: z.string().nullable(),
            })
            .strict()
            .parse(input);
          runtime.respond(d.runId, d.permissionId, d.optionId);
        } else {
          json(res, 404, { error: "Unknown route" });
          return;
        }
        json(res, 200, { ok: true });
        return;
      }
      if (req.method !== "GET") {
        json(res, 405, { error: "Method not allowed" });
        return;
      }
      const relative =
        path === "/" ? "index.html" : decodeURIComponent(path).slice(1);
      const file = resolve(assets, relative);
      if (!file.startsWith(resolve(assets) + "/")) {
        json(res, 404, { error: "Not found" });
        return;
      }
      const data = await readFile(file);
      const ext = file.split(".").pop();
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
      res.writeHead(200, {
        "content-type":
          ext === "js"
            ? "text/javascript"
            : ext === "css"
              ? "text/css"
              : "text/html",
      });
      res.end(data);
    } catch (e) {
      json(res, (e as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400, {
        error: (e as Error).message,
      });
    }
  });
  server.requestTimeout = 15000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  actualPort = (server.address() as { port: number }).port;
  try {
    runtime = new Runtime(options);
  } catch (e) {
    server.close();
    throw e;
  }
  let notifyTimer: NodeJS.Timeout | undefined;
  runtime.on("change", () => {
    notifyTimer ??= setTimeout(() => {
      notifyTimer = undefined;
      for (const res of clients)
        if (!res.write("data: changed\n\n")) {
          clients.delete(res);
          res.end();
        }
    }, 100);
  });
  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(": heartbeat\n\n");
  }, 15000);
  return {
    runtime,
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    async close() {
      clearInterval(heartbeat);
      clearTimeout(notifyTimer);
      for (const res of clients) res.end();
      clients.clear();
      const closed = new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await runtime.close();
      clearTimeout(notifyTimer);
      await closed;
    },
  };
}
