import { serve } from "../shared/serveWithCors.ts";
import { getSupabaseClient } from "../shared/supabaseClient.ts";
import { Logger } from "../shared/logger.ts";
import { Monitor } from "../shared/monitor.ts";

const logger = new Logger("cleanup-monitor-data");
const monitor = new Monitor("cleanup-monitor-data");

function nextDayOf(date: Date): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

serve(async (req) => {
  await monitor.start(req);
  const supabase = getSupabaseClient(req);

  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString();

    logger.info(`⏳ Aggregating uptime data before ${oneWeekAgo}`);

    // Step 1: Select distinct domain_ids with data older than 1 week
    const { data: domains, error: domainErr } = await supabase
      .from("uptime")
      .select("domain_id")
      .lt("checked_at", oneWeekAgo)
      .order("domain_id", { ascending: true });

    if (domainErr || !domains?.length) {
      logger.warn("No uptime data to process or failed to fetch domains");
      await monitor.success("No historical data to clean up");
      return new Response("No historical uptime data found", { status: 200 });
    }

    let totalArchived = 0;
    const seen = new Set<string>();

    for (const { domain_id } of domains) {
      if (seen.has(domain_id)) continue;

      // Step 2: Fetch raw data grouped by day for this domain
      const { data: dailyStats, error: statErr } = await supabase.rpc(
        "uptime_daily_averages",
        {
          target_domain: domain_id,
          cutoff_time: oneWeekAgo,
        },
      );

      if (statErr) {
        logger.error(
          `Failed to fetch averages for domain ${domain_id}: ${statErr.message}`,
        );
        continue;
      }

      for (const row of dailyStats) {
        const insertRes = await supabase.from("uptime").insert({
          domain_id,
          checked_at: new Date(row.day),
          is_up: row.avg_is_up > 0.5,
          response_code: 200,
          response_time_ms: row.avg_response_time_ms,
          dns_lookup_time_ms: row.avg_dns_time_ms,
          ssl_handshake_time_ms: row.avg_ssl_time_ms,
        });

        if (insertRes.error) {
          logger.error(
            `Insert failed for domain ${domain_id} on ${row.day}: ${insertRes.error.message}`,
          );
          continue;
        }
        seen.add(domain_id);

        // Define start and end of the day for deletion range
        const startOfDay = new Date(row.day);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(row.day);
        endOfDay.setUTCHours(23, 59, 59, 999);

        const { error: deleteErr, count } = await supabase
          .from("uptime")
          .delete({ count: "exact" })
          .match({ domain_id: domain_id })
          .filter("checked_at", "gte", startOfDay.toISOString())
          .filter("checked_at", "lt", nextDayOf(endOfDay).toISOString());

        if (deleteErr) {
          logger.error(
            `Failed to delete old records for ${domain_id} on ${row.day}`,
          );
        } else {
          totalArchived += count ?? 0;
        }
      }
    }

    const msg =
      `✅ Aggregated and removed ${totalArchived} detailed records for ${seen.size} domains`;
    logger.info(msg);
    await logger.flushToRemote();
    await monitor.success(msg);
    return new Response(msg, { status: 200 });
  } catch (err: any) {
    logger.error(`❌ Unexpected error: ${err.message}`);
    await logger.flushToRemote();
    await monitor.fail(err);
    return new Response("Internal Server Error", { status: 500 });
  }
});
