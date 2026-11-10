import {
  createHmac,
  createHash,
  timingSafeEqual
} from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      message: "Method Not Allowed"
    });
  }

  try {
    const adminPassword = process.env.ADMIN_DASHBOARD_PASSWORD;
    const sessionSecret = process.env.ADMIN_SESSION_SECRET;

    if (!adminPassword || !sessionSecret) {
      return res.status(500).json({
        ok: false,
        message: "Admin security is not configured"
      });
    }

    const submittedPassword = String(
      req.body?.password || ""
    );

    const submittedHash = createHash("sha256")
      .update(submittedPassword)
      .digest();

    const correctHash = createHash("sha256")
      .update(adminPassword)
      .digest();

    if (!timingSafeEqual(submittedHash, correctHash)) {
      return res.status(401).json({
        ok: false,
        message: "Incorrect password"
      });
    }

    // 8 hours session
    const expires = Date.now() + 8 * 60 * 60 * 1000;

    const signature = createHmac("sha256", sessionSecret)
      .update(String(expires))
      .digest("hex");

    const session = `${expires}.${signature}`;

    res.setHeader("Set-Cookie",
      `admin_session=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
    );

    return res.status(200).json({
      ok: true,
      message: "Login successful"
    });

  } catch (error) {
    console.error("Admin login error:", error);

    return res.status(500).json({
      ok: false,
      message: "Internal Server Error"
    });
  }
}
