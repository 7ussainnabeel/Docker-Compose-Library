import { SlackConfig } from "../types.ts";
import { handleError } from "../error-handler.ts";

/**
 * Sends a Slack notification using a webhook URL.
 */
export async function sendSlackNotification(
  config: SlackConfig,
  message: string,
): Promise<void> {
  try {
    if (!config.webhookUrl) {
      throw new Error("Slack Webhook URL is required.");
    }

    const payload = { text: message };

    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Slack request failed with status ${response.status}: ${await response
          .text()}`,
      );
    }

    console.log(`✅ Slack message sent successfully`);
  } catch (error) {
    handleError(error, "Slack Notification");
  }
}
