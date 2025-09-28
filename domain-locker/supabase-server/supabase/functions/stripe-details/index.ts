import { serve } from "../shared/serveWithCors.ts";
import { getSupabaseClient } from "../shared/supabaseClient.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_BASE = "https://api.stripe.com/v1";

const headers = {
  Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
};

serve(async (req) => {
  // Initialize Supabase client (service role for RLS bypass)
  const supabase = getSupabaseClient(req);

  if (!STRIPE_SECRET_KEY) {
    return jsonResponse({ error: "Stripe integration not configured" }, 500);
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Only POST allowed" }, 405);
    }

    const body = await req.json();
    let customerId = body.customerId;
    const userId = body.userId;

    if (!userId && !customerId) {
      return jsonResponse(
        { error: "Missing or invalid user or customer id" },
        400,
      );
    }

    if (!customerId) {
      const { data: billing, error: billingErr } = await supabase
        .from("billing")
        .select("meta")
        .eq("user_id", userId)
        .maybeSingle();

      const existingId = billing?.meta?.customer;
      if (existingId) {
        customerId = existingId;
      } else {
        return jsonResponse(
          { error: "No customer ID found for this user" },
          404,
        );
      }
    }

    const result: Record<string, unknown> = {
      customer_id: customerId,
    };

    // Fetch subscription
    try {
      const subRes = await fetch(
        `${STRIPE_BASE}/customers/${customerId}/subscriptions?limit=5&expand[]=data.items`,
        {
          headers,
        },
      );

      const subData = await subRes.json();
      const subscription = subData?.data?.[0];

      if (subRes.ok && subscription) {
        result.status = subscription.status;
        result.subscription_id = subscription.id;
        result.plan = subscription.items?.data?.[0]?.price?.lookup_key;
        result.current_period_start = toISO(subscription.current_period_start);
        result.current_period_end = toISO(subscription.current_period_end);
        result.cancel_at = toISO(subscription.cancel_at);
        result.cancel_at_period_end = subscription.cancel_at_period_end;
        result.discount =
          (subscription.discount && subscription.discount.coupon)
            ? {
              percent_off: subscription.discount?.coupon?.percent_off,
              name: subscription.discount?.coupon?.name,
              duration: subscription.discount?.coupon?.duration,
            }
            : null;
      } else {
        result.status = "none";
      }
    } catch (err) {
      console.warn("⚠️ Subscription fetch failed:", err);
    }

    // Fetch past invoices
    try {
      const invRes = await fetch(
        `${STRIPE_BASE}/invoices?customer=${customerId}&limit=10`,
        { headers },
      );
      const invData = await invRes.json();

      if (invRes.ok) {
        result.invoices = invData.data.map((inv: any) => ({
          amount_paid: inv.amount_paid,
          currency: inv.currency,
          status: inv.status,
          number: inv.number,
          hosted_invoice_url: inv.hosted_invoice_url,
          invoice_pdf: inv.invoice_pdf,
          date: toISO(inv.created),
        }));
      }
    } catch (err) {
      console.warn("⚠️ Invoice history fetch failed:", err);
    }

    // Fetch upcoming invoice
    try {
      const upRes = await fetch(
        `${STRIPE_BASE}/invoices/upcoming?customer=${customerId}`,
        { headers },
      );
      const up = await upRes.json();

      if (upRes.ok && up?.amount_due) {
        result.upcoming_invoice = {
          amount_due: up.amount_due,
          currency: up.currency,
          due_date: toISO(up.next_payment_attempt),
          hosted_invoice_url: up.hosted_invoice_url,
        };
      }
    } catch (err) {
      console.warn("⚠️ Upcoming invoice fetch failed:", err);
    }

    // Fetch default payment method
    try {
      const pmRes = await fetch(
        `${STRIPE_BASE}/payment_methods?customer=${customerId}&type=card`,
        { headers },
      );
      const pmData = await pmRes.json();
      const card = pmData?.data?.[0]?.card;

      if (pmRes.ok && card) {
        result.payment_method = {
          brand: card.brand,
          last4: card.last4,
          exp_month: card.exp_month,
          exp_year: card.exp_year,
        };
      }
    } catch (err) {
      console.warn("⚠️ Payment method fetch failed:", err);
    }

    return jsonResponse(result, 200);
  } catch (err: any) {
    console.error("❌ Unexpected error:", err);
    return jsonResponse({ error: err.message || "Internal Server Error" }, 500);
  }
});

// Convert Unix timestamp (seconds) to ISO string
function toISO(timestamp?: number): string | null {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

// JSON response helper
function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}
