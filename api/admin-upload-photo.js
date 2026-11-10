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
  if (req.method !== "POST") {
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

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        ok: false,
        message: "Supabase configuration missing"
      });
    }

    const { filename, contentType, imageBase64 } = req.body || {};

    const allowedTypes = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    };

    if (!allowedTypes[contentType]) {
      return res.status(400).json({
        ok: false,
        message: "Only JPG, PNG and WEBP images are allowed"
      });
    }

    if (typeof imageBase64 !== "string" || !imageBase64) {
      return res.status(400).json({
        ok: false,
        message: "Image data missing"
      });
    }

    const cleanBase64 = imageBase64.replace(
      /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
      ""
    );

    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleanBase64)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid image data"
      });
    }

    const imageBuffer = Buffer.from(cleanBase64, "base64");

    if (
      imageBuffer.length === 0 ||
      imageBuffer.length > 5 * 1024 * 1024
    ) {
      return res.status(400).json({
        ok: false,
        message: "Image must be smaller than 5 MB"
      });
    }

    const extension = allowedTypes[contentType];
    const safeFilename = `profile-${Date.now()}.${extension}`;

    const uploadUrl =
      `${supabaseUrl}/storage/v1/object/site-assets/${safeFilename}`;

    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": contentType,
        "x-upsert": "true"
      },
      body: imageBuffer
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("Photo Upload Error:", errorText);

      return res.status(500).json({
        ok: false,
        message: "Photo upload failed. Check site-assets bucket."
      });
    }

    const photoUrl =
      `${supabaseUrl}/storage/v1/object/public/site-assets/${safeFilename}`;

    const saveResponse = await fetch(
      `${supabaseUrl}/rest/v1/site_settings?on_conflict=id`,
      {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify({
          id: 1,
          photo_url: photoUrl,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!saveResponse.ok) {
      const errorText = await saveResponse.text();
      console.error("Photo URL Save Error:", errorText);

      return res.status(500).json({
        ok: false,
        message: "Photo uploaded but settings could not be updated. Check site_settings table."
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Profile photo uploaded successfully",
      photo_url: photoUrl
    });

  } catch (error) {
    console.error("Admin Photo Upload Error:", error);

    return res.status(500).json({
      ok: false,
      message: error.message || "Photo upload failed"
    });
  }
}
