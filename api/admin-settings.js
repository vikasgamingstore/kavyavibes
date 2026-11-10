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

export default async function handler(req, res) {
  if (!["GET", "PATCH"].includes(req.method)) {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed"
    });
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

    const headers = {
      "apikey": key,
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json"
    };

    if (req.method === "GET") {
      const response = await fetch(
        `${url}/rest/v1/site_settings?id=eq.1&select=website_name,profile_name,tagline,description,photo_url`,
        { headers }
      );

      const result = await response.json();

      if (!response.ok) {
        console.error("Settings Read Error:", result);
        throw new Error("Could not read website settings. Check site_settings table.");
      }

      return res.status(200).json({
        ok: true,
        settings: result[0] || {}
      });
    }

    const body = req.body || {};

    const fields = [
      "website_name",
      "profile_name",
      "tagline",
      "description"
    ];

    const settings = { id: 1 };

    for (const field of fields) {
      if (typeof body[field] !== "string") {
        return res.status(400).json({
          ok: false,
          message: `Invalid ${field}`
        });
      }

      if (body[field].length > 2000) {
        return res.status(400).json({
          ok: false,
          message: `${field} is too long`
        });
      }

      settings[field] = body[field].trim();
    }

    settings.updated_at = new Date().toISOString();

    const response = await fetch(
      `${url}/rest/v1/site_settings?on_conflict=id`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Prefer": "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(settings)
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Settings Save Error:", result);
      throw new Error("Could not save settings. Check site_settings table.");
    }

    return res.status(200).json({
      ok: true,
      message: "Website settings saved successfully"
    });

  } catch (error) {
    console.error("Admin Settings Error:", error);

    return res.status(500).json({
      ok: false,
      message: error.message || "Settings operation failed"
    });
  }
}
