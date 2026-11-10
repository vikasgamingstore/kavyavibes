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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const metaToken = process.env.META_ACCESS_TOKEN;
  const datasetId = process.env.META_DATASET_ID;

  const headers = {
    "Content-Type": "application/json",
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`
  };

  try {
    const request = req.body?.chat_join_request;

    if (!request) {
      return res.status(200).json({
        ok: true,
        message: "No join request"
      });
    }

    if (!supabaseUrl || !supabaseKey || !metaToken || !datasetId) {
      console.error("Required environment variables missing");
      return res.status(500).json({ ok: false });
    }

    const inviteLink = request.invite_link?.invite_link;

    if (!inviteLink) {
      return res.status(200).json({
        ok: true,
        message: "No tracked invite link"
      });
    }

    // Supabase mein visitor ka unique invite link khojein
    const inviteQuery = new URLSearchParams({
      select: "id,visitor_id",
      invite_link: `eq.${inviteLink}`,
      is_revoked: "eq.false",
      limit: "1"
    });

    const inviteResponse = await fetch(
      `${supabaseUrl}/rest/v1/telegram_invites?${inviteQuery}`,
      { headers }
    );

    const inviteRows = await inviteResponse.json();

    if (!inviteResponse.ok) {
      console.error("Invite lookup error:", inviteRows);
      return res.status(500).json({ ok: false });
    }

    if (!inviteRows.length) {
      return res.status(200).json({
        ok: true,
        message: "Untracked invite link"
      });
    }

    const invite = inviteRows[0];

    // Visitor ki Facebook attribution information nikalein
    const visitorQuery = new URLSearchParams({
      select: "id,fbclid,fbc,fbp,landing_url",
      id: `eq.${invite.visitor_id}`,
      limit: "1"
    });

    const visitorResponse = await fetch(
      `${supabaseUrl}/rest/v1/tracking_visitors?${visitorQuery}`,
      { headers }
    );

    const visitorRows = await visitorResponse.json();

    if (!visitorResponse.ok || !visitorRows.length) {
      console.error("Visitor lookup error:", visitorRows);
      return res.status(500).json({ ok: false });
    }

    const visitor = visitorRows[0];

    // Telegram user ID ko SHA-256 hash karein
    const externalId = createHash("sha256")
      .update(String(request.from.id))
      .digest("hex");

    const eventId =
      `telegram_${request.chat.id}_${request.from.id}_${request.date}`;

    // Actual join request Supabase mein save karein
    const joinResponse = await fetch(
      `${supabaseUrl}/rest/v1/telegram_join_requests`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          invite_id: invite.id,
          visitor_id: visitor.id,
          telegram_chat_id: String(request.chat.id),
          telegram_user_hash: externalId,
          request_timestamp: new Date(
            request.date * 1000
          ).toISOString(),
          event_id: eventId
        })
      }
    );

    const joinRows = await joinResponse.json();

    if (!joinResponse.ok) {
      if (joinResponse.status === 409) {
        return res.status(200).json({
          ok: true,
          message: "Join request already recorded"
        });
      }

      console.error("Join request save error:", joinRows);
      return res.status(500).json({ ok: false });
    }

    const joinRequestId = joinRows[0].id;

    // Meta event ka pending record banayein
    const conversionResponse = await fetch(
      `${supabaseUrl}/rest/v1/meta_conversion_events`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          join_request_id: joinRequestId,
          event_name: "CompleteRegistration",
          event_id: eventId,
          status: "pending"
        })
      }
    );

    const conversionRows = await conversionResponse.json();

    if (!conversionResponse.ok || !conversionRows.length) {
      console.error("Conversion record error:", conversionRows);
      return res.status(500).json({ ok: false });
    }

    const conversionId = conversionRows[0].id;

    // Meta Conversions API event
    const userData = {
      external_id: [externalId]
    };

    if (visitor.fbp) userData.fbp = visitor.fbp;
    if (visitor.fbc) userData.fbc = visitor.fbc;

    const eventData = {
      data: [
        {
          event_name: "CompleteRegistration",
          event_time: request.date,
          event_id: eventId,
          event_source_url: visitor.landing_url || "https://t.me/",
          action_source: "other",
          user_data: userData,
          custom_data: {
            content_name: "PAID FUN Telegram Join Request",
            platform: "Telegram"
          }
        }
      ]
    };

    const metaUrl =
      `https://graph.facebook.com/v25.0/${datasetId}/events` +
      `?access_token=${encodeURIComponent(metaToken)}`;

    const metaResponse = await fetch(metaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(eventData)
    });

    const metaResult = await metaResponse.json();

    // Meta result Supabase mein update karein
    await fetch(
      `${supabaseUrl}/rest/v1/meta_conversion_events?id=eq.${conversionId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: metaResponse.ok ? "sent" : "failed",
          events_received: metaResult.events_received || 0,
          meta_response: metaResult,
          error_message: metaResponse.ok
            ? null
            : JSON.stringify(metaResult),
          sent_at: metaResponse.ok
            ? new Date().toISOString()
            : null
        })
      }
    );

    if (!metaResponse.ok) {
      console.error("Meta CAPI Error:", metaResult);
      return res.status(500).json({
        ok: false,
        message: "Meta event sending failed"
      });
    }

    console.log("TRACKED JOIN REQUEST:", {
      event_id: eventId,
      visitor_id: visitor.id,
      events_received: metaResult.events_received
    });

    return res.status(200).json({
      ok: true,
      message: "Join request saved and Meta event sent"
    });

  } catch (error) {
    console.error("Webhook Error:", error);

    return res.status(500).json({
      ok: false,
      message: "Internal Server Error"
    });
  }
}
