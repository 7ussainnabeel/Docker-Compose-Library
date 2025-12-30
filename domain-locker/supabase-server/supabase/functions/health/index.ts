import { serve } from "../shared/serveWithCors.ts";

import { getSupabaseClient, getUserOrNull } from "../shared/supabaseClient.ts";
import { Logger } from "../shared/logger.ts";

const logger = new Logger("health");

serve(async (req) => {
  const start = Date.now();

  let authenticated = false;
  let db = false;
  let envOk = false;

  try {
    // Check auth
    const user = await getUserOrNull(req, true);
    authenticated = !!user;

    // Check DB
    try {
      const supabase = getSupabaseClient(req, true);
      const { error } = await supabase.rpc("pg_version");
      db = !error;
    } catch (dbError) {
      logger.warn(`Database check failed: ${dbError}`);
      db = false;
    }

    // Check required env
    const required = ["DB_URL", "DB_ANON_KEY"];
    envOk = required.every((key) => !!Deno.env.get(key));
  } catch (err: any) {
    logger.warn(`Health check error: ${err.message}`);
  }

  const result = {
    up: true,
    authenticated,
    db,
    env: envOk,
    timestamp: new Date().toISOString(),
    responseTimeMs: Date.now() - start,
  };

  logger.debug(`Health check: ${JSON.stringify(result)}`);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}, ["GET"]);
