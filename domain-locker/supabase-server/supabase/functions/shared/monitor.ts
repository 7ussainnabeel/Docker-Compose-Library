/**
 * Monitor class for job health checks and error reporting
 * Integrates with healthchecks.io and GlitchTip for simple
 * monitoring of job status and error reporting.
 */

const enabledMonitors = [
  "trigger-updates",
  "expiration-invites",
  "expiration-reminders",
  "website-monitor",
  "cleanup-notifications",
  "user-billing-check",
  "cleanup-monitor-data",
  "domain-update-batcher",
];

export interface MonitorOptions {
  healthcheckUrl?: string; // healthchecks.io UUID ping URL
  glitchtipUrl?: string; // GlitchTip endpoint (optional)
  glitchtipToken?: string; // GlitchTip auth token (optional)
  jobName?: string; // Optional label for logs
  notifyOnStart?: boolean; // Whether to ping "start" at beginning
  cronHeader?: string; // Header to check for cron runs
}

export class Monitor {
  private healthcheckUrl?: string;
  private glitchtipUrl?: string;
  private glitchtipToken?: string;
  private jobName?: string;
  private enabled: boolean = false;
  private cronHeader: string = "X-Cron-Run";

  constructor(jobName: string, opts: MonitorOptions = {}) {
    this.jobName = jobName;
    this.healthcheckUrl = opts.healthcheckUrl || Deno.env.get("HC_URL");
    this.glitchtipUrl = opts.glitchtipUrl || Deno.env.get("GLITCHTIP_URL");
    this.glitchtipToken = opts.glitchtipToken ||
      Deno.env.get("GLITCHTIP_TOKEN");
    this.enabled = enabledMonitors.includes(jobName);
    this.cronHeader = opts.cronHeader || "X-Cron-Run";

    if (opts.notifyOnStart) {
      this.ping("start");
    }
  }

  // Log info and ping success endpoint
  public success(msg = "Job completed successfully") {
    console.info(`✅ [${this.jobName}] ${msg}`);
    this.ping("success", msg); // default = success
  }

  // Log error, send to glitchtip, ping fail endpoint
  public fail(error: any, context: Record<string, any> = {}) {
    const errMessage = error?.message || "Unknown error";
    console.error(`❌ [${this.jobName}] ${errMessage}`);
    if (this.glitchtipUrl && this.glitchtipToken) {
      this.sendToGlitchTip(error, context);
    }
    this.ping("fail");
  }

  private isCronRun(req?: Request): boolean {
    return req?.headers.get(this.cronHeader) === "true";
  }

  public start(req?: Request) {
    if (!this.isCronRun(req)) {
      this.enabled = false;
    }
    console.info(`🔄 [${this.jobName}] Job started`);
    this.ping("start");
  }

  // Ping healthchecks.io
  private ping(type?: "start" | "fail" | "success", message?: string) {
    if (!this.healthcheckUrl) return;
    if (!this.enabled) return;
    let url = `${this.healthcheckUrl}/${this.jobName}`;

    let method: "GET" | "POST" = "GET";
    let body: string | undefined;

    // Use GET for start/fail; POST only for success with logs
    if (type === "start") {
      url += "/start";
    } else if (type === "fail") {
      url += "/fail";
    } else {
      method = "POST";
      body = message || "";
    }

    console.log(
      `🔗 [${this.jobName}] Pinging healthcheck: ${url} (${type || "success"})`,
    );
    fetch(url, {
      method,
      headers: method === "POST" ? { "Content-Type": "text/plain" } : undefined,
      body,
    }).catch((e) => {
      console.warn(
        `⚠️ [${this.jobName}] Healthcheck ping (${type || "success"}) failed:`,
        e,
      );
    });
  }

  // Send structured error report to GlitchTip (or Sentry-compatible)
  private async sendToGlitchTip(error: any, context: Record<string, any>) {
    const body = {
      exception: {
        values: [{
          type: error?.name || "Error",
          value: error?.message || "Unknown Error",
          stacktrace: {
            frames: (error?.stack || "").split("\n").map((line: string) => ({
              function: line.trim(),
            })),
          },
        }],
      },
      message: error?.message,
      level: "error",
      platform: "javascript",
      timestamp: Math.floor(Date.now() / 1000),
      tags: { job: this.jobName },
      contexts: context,
    };

    try {
      await fetch(this.glitchtipUrl!, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.glitchtipToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.warn(`⚠️ [${this.jobName}] GlitchTip reporting failed:`, err);
    }
  }
}
