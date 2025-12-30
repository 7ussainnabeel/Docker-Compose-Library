/**
 * Checks for, and sends any unsent notifications (via send-notification func),
 * and removes any notifications older than 30 days
 * Intended to be run as a daily cron
 */

import { serve } from "../shared/serveWithCors.ts";
import { getSupabaseClient } from "../shared/supabaseClient.ts";
import { Logger } from "../shared/logger.ts";
import { Monitor } from "../shared/monitor.ts";

const logger = new Logger("cleanup-notifications");
const monitor = new Monitor("cleanup-notifications");

const DB_URL = Deno.env.get("DB_URL");
const DB_KEY = Deno.env.get("DB_KEY");

serve(async (req) => {
  await monitor.start(req);
  const supabase = getSupabaseClient(req);

  if (!DB_URL || !DB_KEY) {
    const errMsg = "Database URL or key not configured";
    logger.error(errMsg);
    await monitor.fail(new Error(errMsg));
    return new Response(errMsg, { status: 500 });
  }

  try {
    // Fetch unsent notifications
    const { data: pending, error: fetchErr } = await supabase
      .from("notifications")
      .select("id, user_id, message, created_at")
      .eq("sent", false);

    if (fetchErr) {
      logger.error(`Failed to fetch unsent notifications: ${fetchErr.message}`);
      await monitor.fail(fetchErr);
      return new Response("Failed to fetch notifications", { status: 500 });
    }

    logger.info(`Found ${pending.length} unsent notification(s)`);

    // Send each via the send-notification function
    const endpoint = `${DB_URL}/functions/v1/send-notification`;

    for (const n of pending) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${DB_KEY}`,
          },
          body: JSON.stringify({ userId: n.user_id, message: n.message }),
        });
        if (!res.ok) {
          const errMsg = (await res.text()).slice(0, 200);
          logger.warn(`Failed to send notification ${n.id}: ${errMsg}`);
          continue;
        }
        // mark as sent
        await supabase
          .from("notifications")
          .update({ sent: true })
          .eq("id", n.id);
        logger.info(`Sent notification ${n.id}`);
      } catch (err: any) {
        logger.error(`Error sending notification ${n.id}: ${err.message}`);
      }
    }

    // Delete notifications older than 30 days
    const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)
      .toISOString();

    const { count: deletedCount, error: deleteErr } = await supabase
      .from("notifications")
      .delete({ count: "exact" })
      .lt("created_at", cutoff);

    logger.info(
      `Deleted ${
        deletedCount ?? 0
      } notifications older than 30 days (${cutoff})`,
    );

    if (deleteErr) {
      logger.error(`Failed to delete old notifications: ${deleteErr.message}`);
    } else {
      logger.info(`Deleted notifications older than 30 days (${cutoff})`);
    }

    const msg =
      `Cleanup completed: sent ${pending.length} pending notifications, and deleted ${
        deletedCount ?? 0
      } old notifications.`;
    await logger.flushToRemote();
    await monitor.success(msg);

    return new Response(msg, { status: 200 });
  } catch (err: any) {
    logger.error(`Unexpected error: ${err.message}`);
    await logger.flushToRemote();
    await monitor.fail(err);
    return new Response("Internal Server Error", { status: 500 });
  }
});
