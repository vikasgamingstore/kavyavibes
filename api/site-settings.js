export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed"
    });
  }

  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      return res.status(500).json({
        ok: false,
        message: "Supabase configuration missing"
      });
    }

    const response = await fetch(
      `${url}/rest/v1/site_settings?id=eq.1&select=website_name,profile_name,tagline,description,photo_url`,
      {
        method: "GET",
        headers: {
          "apikey": key,
          "Authorization": `Bearer ${key}`
        }
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Public Settings Error:", result);

      return res.status(500).json({
        ok: false,
        message: "Could not load website settings"
      });
    }

    return res.status(200).json({
      ok: true,
      settings: result[0] || {}
    });

  } catch (error) {
    console.error("Site Settings Error:", error);

    return res.status(500).json({
      ok: false,
      message: "Settings could not be loaded"
    });
  }
}
