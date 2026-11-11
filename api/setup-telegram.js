export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Method Not Allowed"
    });
  }

  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      return res.status(500).json({
        ok: false,
        message: "TELEGRAM_BOT_TOKEN is not configured"
      });
    }

    const webhookUrl =
      "https://kavyavibes.vercel.app/api/telegram-webhook";

    const response = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ["chat_join_request"]
        })
      }
    );

    const result = await response.json();

    return res.status(200).json({
      ok: result.ok,
      webhook_url: webhookUrl,
      telegram: result
    });

  } catch (error) {
    console.error("Setup Error:", error);

    return res.status(500).json({
      ok: false,
      message: "Webhook setup failed"
    });
  }
}
