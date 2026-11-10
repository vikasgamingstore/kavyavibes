import {
  createHmac,
  timingSafeEqual
} from "crypto";

function verifySession(req) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return false;

  const cookie = req.headers.cookie || "";

  const item = cookie.split(";")
    .map(x => x.trim())
    .find(x => x.startsWith("admin_session="));

  if (!item) return false;

  const parts = item.substring("admin_session=".length).split(".");
  if (parts.length !== 2) return false;

  const [expires, signature] = parts;

  if (!/^\d+$/.test(expires)) return false;
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  if (Number(expires) < Date.now()) return false;

  const expected = createHmac("sha256", secret)
    .update(expires)
    .digest("hex");

  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex")
  );
}

async function getCount(table, url, key, filter = null) {
  const params = new URLSearchParams();
  params.set("select", "id");

  if (filter) {
    params.set("status", `eq.${filter}`);
  }

  const response = await fetch(
    `${url}/rest/v1/${table}?${params.toString()}`,
    {
      method: "HEAD",
      headers: {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
        "Prefer": "count=exact",
        "Range": "0-0"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Count failed for ${table}`);
  }

  const range = response.headers.get("content-range");
  if (!range) throw new Error("Count unavailable");

  const total = range.split("/").pop();
  return total === "*" ? 0 : Number(total);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false });
  }

  try {
    if (!verifySession(req)) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized"
      });
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      return res.status(500).json({
        ok: false,
        message: "Supabase configuration missing"
      });
    }

    const [
      visitors,
      invites,
      requests,
      sent,
      failed,
      pending
    ] = await Promise.all([
      getCount("tracking_visitors", url, key),
      getCount("telegram_invites", url, key),
      getCount("telegram_join_requests", url, key),
      getCount("meta_conversion_events", url, key, "sent"),
      getCount("meta_conversion_events", url, key, "failed"),
      getCount("meta_conversion_events", url, key, "pending")
    ]);

    return res.status(200).json({
      ok: true,
      stats: {
        total_visitors: visitors,
        total_invites: invites,
        total_join_requests: requests,
        meta_events_sent: sent,
        meta_events_failed: failed,
        meta_events_pending: pending
      }
    });

  } catch (error) {
    console.error("Admin Stats Error:", error);

    return res.status(500).json({
      ok: false,
      message: "Could not load dashboard statistics"
    });
  }
        }
