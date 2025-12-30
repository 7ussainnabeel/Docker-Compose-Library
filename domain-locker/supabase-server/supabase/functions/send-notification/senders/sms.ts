import { handleError } from "../error-handler.ts";
import { SmsConfig } from "../types.ts";

const TWILIO_SID = Deno.env.get("TWILIO_SID") ?? "";
const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY") ?? "";
const TWILIO_API_SECRET = Deno.env.get("TWILIO_API_SECRET") ?? "";
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER") ?? "";
const TWILIO_API_URL =
  `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;

/**
 * Sends an SMS notification using Twilio.
 */
export async function sendSmsNotification(
  config: SmsConfig,
  message: string,
): Promise<void> {
  try {
    if (!config.number) {
      throw new Error("Recipient phone number is required.");
    }

    if (
      !TWILIO_SID || !TWILIO_API_KEY || !TWILIO_API_SECRET ||
      !TWILIO_PHONE_NUMBER
    ) {
      throw new Error("Twilio environment variables are missing.");
    }

    const payload = new URLSearchParams({
      To: config.number,
      From: TWILIO_PHONE_NUMBER,
      Body: message,
    });

    const response = await fetch(TWILIO_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${
          btoa(`${TWILIO_API_KEY}:${TWILIO_API_SECRET}`)
        }`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Twilio error: ${data.message || response.statusText}`);
    }

    console.log(`✅ SMS sent successfully to ${config.number}`);
  } catch (error) {
    handleError(error, "SMS Notification");
  }
}
