import { Resend } from "resend";

/**
 * Outbound email. Entirely optional: with no RESEND_API_KEY configured every
 * call is a no-op that logs, so the feature can ship before the account exists
 * and nothing in the request path can fail because email isn't set up yet.
 *
 * Needs RESEND_API_KEY, and ALERT_EMAIL_TO / ALERT_EMAIL_FROM for the addresses
 * (the from-address must be on a domain verified with Resend).
 */
function config() {
  const apiKey = process.env["RESEND_API_KEY"];
  const to = process.env["ALERT_EMAIL_TO"];
  const from = process.env["ALERT_EMAIL_FROM"] || "alerts@3d.kbrlive.com";
  if (!apiKey || !to) return null;
  return { apiKey, to, from };
}

export function emailConfigured(): boolean {
  return config() !== null;
}

/**
 * Never throws and never blocks the caller's result — an alert failing must not
 * turn a working request into an error.
 */
export async function sendAlert(subject: string, body: string): Promise<void> {
  const cfg = config();
  if (!cfg) {
    console.log(`[alert] (email not configured) ${subject}`);
    return;
  }
  try {
    const resend = new Resend(cfg.apiKey);
    await resend.emails.send({
      from: cfg.from,
      to: cfg.to,
      subject,
      text: body,
    });
  } catch (err) {
    console.error("[alert] send failed:", (err as Error).message);
  }
}
