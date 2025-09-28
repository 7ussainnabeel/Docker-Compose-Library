import { WebHookConfig } from "../types.ts";
import { handleError } from "../error-handler.ts";

export async function sendWebHookNotification(
  config: WebHookConfig,
  message: string,
): Promise<void> {
  try {
    if (!config.url) {
      throw new Error("Webhook URL is required.");
    }

    let url = config.url.trim().startsWith("http")
      ? config.url.trim()
      : `https://${config.url.trim()}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    let payload: Record<string, any> | string = { message };

    switch (config.provider) {
      case "ntfy":
        if (!config.topic) throw new Error("Ntfy requires a topic.");
        url = `${url}/${config.topic}`;
        payload = message;
        break;

      case "gotify":
        if (!config.token) throw new Error("Gotify requires a token.");
        url = `${url}/message?token=${config.token}`;
        break;

      case "pushbits":
        if (!config.token || !config.userId) {
          throw new Error("Pushbits requires a token and user ID.");
        }
        payload = { ...payload, token: config.token, user: config.userId };
        break;

      case "pushbullet":
        if (!config.accessToken) {
          throw new Error("Pushbullet requires an access token.");
        }
        headers["Access-Token"] = config.accessToken;
        payload = { type: "note", body: message };
        break;

      case "custom":
        if (config.headers) {
          try {
            const customHeaders = JSON.parse(config.headers);
            Object.assign(headers, customHeaders);
          } catch {
            throw new Error("Invalid JSON in custom headers.");
          }
        }
        break;

      default:
        throw new Error(`Unsupported provider: ${config.provider}`);
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Request failed with status ${response.status}: ${response.statusText}`,
      );
    }

    console.log(`✅ Webhook sent successfully to ${config.provider}`);
  } catch (error) {
    handleError(error, "WebHook Notification");
  }
}
