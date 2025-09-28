type LogLevel = "info" | "warn" | "error" | "debug";

export class Logger {
  private enabled: boolean;
  private prefix: string;
  private centralLogUrl?: string;
  private logs: { level: LogLevel; message: string; timestamp: string }[] = [];

  constructor(prefix = "") {
    this.enabled = Deno.env.get("DL_LOGGING_ENABLED") === "true";
    this.prefix = prefix;
    this.centralLogUrl = Deno.env.get("LOGFLARE_ENDPOINT_URL") ??
      Deno.env.get("DL_CENTRAL_LOG_URL");
  }

  public info(msg: string) {
    this.log("info", msg, "🟢");
  }
  public warn(msg: string) {
    this.log("warn", msg, "🟡");
  }
  public error(msg: string) {
    this.log("error", msg, "🔴");
  }
  public debug(msg: string) {
    this.log("debug", msg, "🔍");
  }

  private log(level: LogLevel, msg: string, icon: string) {
    const timestamp = new Date().toISOString();
    const formatted = `${icon} ${this.prefix} ${msg}`;

    this.logs.push({ level, message: msg, timestamp });

    if (!this.enabled) return;

    try {
      level === "error"
        ? console.error(formatted)
        : level === "warn"
        ? console.warn(formatted)
        : console.log(formatted);
    } catch {}
  }

  public getLogs() {
    return this.logs;
  }

  public async flushToRemote() {
    if (!this.centralLogUrl || this.logs.length === 0) return;

    try {
      // Asynchronously (as to not block), send logs to a place far, far away
      const payload = {
        prefix: this.prefix,
        timestamp: new Date().toISOString(),
        logs: this.logs,
      };
      await fetch(this.centralLogUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch((err) => this.warn("Logflare send error: " + err.message));
    } catch (_) {
      this.warn("Error in flushToRemote");
    }
  }
}
