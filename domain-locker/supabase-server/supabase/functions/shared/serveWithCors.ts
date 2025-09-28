// File: ./shared/serveWithCors.ts
import { serve as stdServe } from "https://deno.land/std@0.168.0/http/server.ts";
import { Logger } from "./logger.ts";

const logger = new Logger("http-serve");

const DEFAULT_CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

/* Merge CORS & custom headers */
function addCorsHeaders(init: ResponseInit = {}): ResponseInit {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(DEFAULT_CORS)) headers.set(k, v);
  return { ...init, headers };
}

/* Drop-in replacement for `serve` with built-in CORS & error handling */
export function serve(
  handler: (req: Request) => Promise<Response>,
  allowedMethods: string[] = ["POST", "OPTIONS"],
) {
  stdServe(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, addCorsHeaders({ status: 204 }));
    }

    // Handle not allowed HTTP methods
    if (!allowedMethods.includes(req.method)) {
      return new Response(
        JSON.stringify({
          error: `Sorry, ${req.method} method are not allowed here 🫷`,
        }),
        addCorsHeaders({ status: 405 }),
      );
    }

    try {
      const res = await handler(req);
      // Ensure headers are applied to using .clone()
      return new Response(
        res.body,
        addCorsHeaders({
          status: res.status,
          headers: res.headers,
        }),
      );
    } catch (err: any) {
      logger.error(
        `Uncaught error while serving: ${
          err?.message || err || "mystery error"
        }`,
      );
      return new Response(
        JSON.stringify({ error: "Internal Server Error 💀" }),
        addCorsHeaders({ status: 500 }),
      );
    }
  });
}
