import { EmailConfig } from "../types.ts";
import { handleError } from "../error-handler.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_SENDER = Deno.env.get("RESEND_SENDER") ?? "";
const RESEND_API_URL = "https://api.resend.com/emails ";
const TEMPLATE_PATH = Deno.env.get("EMAIL_TEMPLATE_PATH") ?? "";

async function loadEmailTemplate(): Promise<string> {
  try {
    const response = await fetch(TEMPLATE_PATH);
    if (!response.ok) {
      throw new Error(`Failed to fetch email template: ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    throw new Error(
      "Failed to load email template from URL. Ensure the URL is correct and accessible.",
    );
  }
}

/**
 * Sends an email notification using Resend.
 *
 * @param {EmailConfig} config - User's email configuration
 * @param {string} message - The message content to send
 */
export async function sendEmailNotification(
  config: EmailConfig,
  message: string,
): Promise<void> {
  try {
    if (!RESEND_API_KEY) {
      throw new Error(
        "Resend API key is missing. Set RESEND_API_KEY in environment variables.",
      );
    }

    if (!RESEND_SENDER) {
      throw new Error(
        "Resend sender email is missing. Set RESEND_SENDER in environment variables.",
      );
    }

    if (!config.address) {
      throw new Error("Recipient email address is required.");
    }

    let emailHtml = await loadEmailTemplate();
    emailHtml = emailHtml.replace("{{MESSAGE_BODY}}", message);

    const emailPayload = {
      from: RESEND_SENDER,
      to: config.address,
      subject: "Notification from Domain Locker",
      html: emailHtml,
    };

    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    // Handle non-JSON responses
    const responseText = await response.text();
    let responseData;

    try {
      responseData = JSON.parse(responseText);
    } catch (jsonError) {
      throw new Error(`Unexpected response from Resend: ${responseText}`);
    }

    if (!response.ok) {
      throw new Error(
        `Failed to send email: ${responseData.message || response.statusText}`,
      );
    }

    console.log(`✅ Email sent successfully to ${config.address}`);
  } catch (error) {
    handleError(error, "Email Notification");
  }
}
