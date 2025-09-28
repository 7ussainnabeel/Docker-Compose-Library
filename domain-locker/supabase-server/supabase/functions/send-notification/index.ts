// Step 1: Read the userId and message from the input body
// Step 2: Fetch and parse user's notification preferences from the notification_channels field user_info table
// Step 3: If no notification preferences, fetch user's email from `Email` col of `users` table, and set preferences to email only
// Step 4: For each enabled channel, send the specified message using the corresponding channel config
// Step 5: Mark the notification as sent, in `sent` field of `notifications` table
// Step 6: Return a success response

// Sample input body
// '{"userId":"42","message":"Hello, this is a test notification"}'

// Sample notification preferences object
// '{"email":{"enabled":true,"address":"dl-test-42@d0h.co"},"pushNotification":{"enabled":true},"webHook":{"enabled":true,"url":"https://example.com","provider":"pushbits","topic":"","token":"xxx","userId":"yyy","accessToken":"","headers":""},"signal":{"enabled":true,"number":"07700000000","apiKey":"xxx"},"telegram":{"enabled":true,"botToken":"xxx","chatId":"yyy"},"slack":{"enabled":true,"webhookUrl":"https://example.com/zzz"},"matrix":{"enabled":true,"homeserverUrl":"https://example.com/yyy","accessToken":"xxx"}}'

import { serve } from "../shared/serveWithCors.ts";
import { getSupabaseClient } from "../shared/supabaseClient.ts";
import { Logger } from "../shared/logger.ts";
import { Monitor } from "../shared/monitor.ts";

import { NotificationPreferences } from "./types.ts";
import { sendWebHookNotification } from "./senders/webhook.ts";
import { sendEmailNotification } from "./senders/email.ts";
import { sendSlackNotification } from "./senders/slack.ts";
import { sendSmsNotification } from "./senders/sms.ts";
import { sendWhatsAppNotification } from "./senders/whatsapp.ts";

const logger = new Logger("send-notification");
const monitor = new Monitor("send-notification");

// Function entry point
serve(async (req) => {
  await monitor.start();
  const supabase = getSupabaseClient(req);

  try {
    // Read the userId and notification message from the request body
    const body = await req.json();
    let userId: string;
    let message: string;

    if (body.type === "INSERT" && body.record?.new) {
      // This is a database webhook trigger from notifications table
      userId = body.record.new.user_id;
      message = body.record.new.message;
    } else {
      // This is a manual trigger with direct payload
      userId = body.userId;
      message = body.message;
    }

    if (!userId || !message) {
      logger.warn("Missing userId or message");
      return new Response(
        JSON.stringify({ error: "userId and message are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Get notification preferences
    const { data: userInfo, error: userError } = await supabase
      .from("user_info")
      .select("notification_channels")
      .eq("user_id", userId)
      .maybeSingle();

    if (userError || !userInfo) {
      logger.error(
        `User not found or error fetching preferences for ${userId}`,
      );
      return new Response(
        JSON.stringify({
          error: "User not found or error fetching preferences",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    // Fetch billing plan to determine notification channels
    const { data: billingData } = await supabase
      .from("billing")
      .select("current_plan")
      .eq("user_id", userId)
      .maybeSingle();

    // Get notification channels from user info
    const rawChannels = userInfo.notification_channels || {};

    // If user is on a free plan, restrict notification channels to just email
    if (billingData?.current_plan === "free") {
      Object.keys(rawChannels).forEach((k) => {
        if (k !== "email") delete rawChannels[k];
      });
    }

    const prefs = rawChannels as NotificationPreferences;

    // Dispatch each enabled notification channel
    const sendOps: Promise<void>[] = [];

    if (prefs.email?.enabled) {
      sendOps.push(sendEmailNotification(prefs.email, message));
    }
    if (prefs.pushNotification?.enabled) {
      sendOps.push(sendPushNotification(prefs.pushNotification, message));
    }
    if (prefs.webHook?.enabled) {
      sendOps.push(sendWebHookNotification(prefs.webHook, message));
    }
    if (prefs.signal?.enabled) {
      sendOps.push(sendSignalNotification(prefs.signal, message));
    }
    if (prefs.telegram?.enabled) {
      sendOps.push(sendTelegramNotification(prefs.telegram, message));
    }
    if (prefs.slack?.enabled) {
      sendOps.push(sendSlackNotification(prefs.slack, message));
    }
    if (prefs.matrix?.enabled) {
      sendOps.push(sendMatrixNotification(prefs.matrix, message));
    }
    if (prefs.whatsapp?.enabled) {
      sendOps.push(sendWhatsAppNotification(prefs.whatsapp, message));
    }
    if (prefs.sms?.enabled) {
      sendOps.push(sendSmsNotification(prefs.sms, message));
    }

    await Promise.allSettled(sendOps);

    const activeChannels = Object.values(prefs).filter((c) =>
      c?.enabled
    ).length || 0;
    const resultMessage = `✅ Sent to ${activeChannels} channels`;

    logger.info(resultMessage);
    await logger.flushToRemote();
    await monitor.success(resultMessage);

    return new Response(JSON.stringify({ message: resultMessage }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    logger.error(`Unhandled error: ${err.message}`);
    await logger.flushToRemote();
    await monitor.fail(err);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

/* ================================
   Private Functions for Channels
================================ */

async function sendPushNotification(config: any, message: string) {
  console.log(`Sending push notification: ${message}`);
  // TODO: Implement actual push notification logic here
}

// Placeholder function for sending Signal notifications
async function sendSignalNotification(config: any, message: string) {
  console.log(`Sending Signal message to ${config.number}: ${message}`);
  // TODO: Implement actual Signal notification logic here
}

// Placeholder function for sending Telegram notifications
async function sendTelegramNotification(config: any, message: string) {
  console.log(
    `Sending Telegram message to chat ID ${config.chatId}: ${message}`,
  );
  // TODO: Implement actual Telegram notification logic here
}

// Placeholder function for sending Matrix notifications
async function sendMatrixNotification(config: any, message: string) {
  console.log(`Sending Matrix message to ${config.homeserverUrl}: ${message}`);
  // TODO: Implement actual Matrix notification logic here
}
