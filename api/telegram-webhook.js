import { createHash } from "crypto";

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "Telegram Join Request Tracker is running"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  try {
    const update = req.body;

    // Sirf asli Telegram Join Request process hoga
    if (!update || !update.chat_join_request) {
      return res.status(200).json({
        ok: true,
        message: "No join request"
      });
    }

    const request = update.chat_join_request;

    const token = process.env.META_ACCESS_TOKEN;
    const datasetId = process.env.META_DATASET_ID;

    if (!token || !datasetId) {
      console.error("Meta environment variables missing");
      return res.status(500).json({ ok: false });
    }

    // Telegram user ID ko SHA-256 hash karna
    const externalId = createHash("sha256")
      .update(String(request.from.id))
      .digest("hex");

    // Har Join Request ke liye unique Event ID
    const eventId =
      `telegram_${request.chat.id}_${request.from.id}_${request.date}`;

    const eventData = {
  data: [
        {
          event_name: "CompleteRegistration",
          event_time: request.date,
          event_id: eventId,
          event_source_url:
            request.invite_link?.invite_link || "https://t.me/",
          action_source: "other",
          user_data: {
            external_id: [externalId]
          },
          custom_data: {
            content_name: "PAID FUN Telegram Join Request",
            platform: "Telegram"
          }
        }
      ]
    };

    const metaUrl =
      `https://graph.facebook.com/v25.0/${datasetId}/events` +
      `?access_token=${encodeURIComponent(token)}`;

    const metaResponse = await fetch(metaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(eventData)
    });

    const metaResult = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error("Meta CAPI Error:", metaResult);
      return res.status(500).json({
        ok: false,
        message: "Meta event sending failed"
      });
    }

    console.log("META EVENT SENT:", {
      event_name: "CompleteRegistration",
      event_id: eventId,
      events_received: metaResult.events_received
    });

    return res.status(200).json({
      ok: true,
      message: "Join Request sent to Meta"
    });

  } catch (error) {
    console.error("Webhook Error:", error);

    return res.status(500).json({
      ok: false,
      message: "Internal Server Error"
    });
  }
}

