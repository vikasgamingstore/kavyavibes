import { randomUUID } from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      message: "Method Not Allowed"
    });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!supabaseUrl || !supabaseKey || !telegramToken || !chatId) {
      return res.status(500).json({
        ok: false,
        message: "Required environment variables are missing"
      });
    }

    const body = req.body || {};
    const sessionId = randomUUID();

    const headers = {
      "Content-Type": "application/json",
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`
    };

    // Visitor ki information Supabase mein save karein
    const visitorData = {
      session_id: sessionId,
      fbclid: body.fbclid || null,
      fbc: body.fbc || null,
      fbp: body.fbp || null,
      utm_source: body.utm_source || null,
      utm_medium: body.utm_medium || null,
      utm_campaign: body.utm_campaign || null,
      utm_content: body.utm_content || null,
      utm_term: body.utm_term || null,
      landing_url: body.landing_url || null,
      referrer: body.referrer || null
    };

    const visitorResponse = await fetch(
      `${supabaseUrl}/rest/v1/tracking_visitors`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Prefer": "return=representation"
        },
        body: JSON.stringify(visitorData)
      }
    );

    const visitorResult = await visitorResponse.json();

    if (!visitorResponse.ok || !visitorResult.length) {
      console.error("Supabase visitor error:", visitorResult);
      return res.status(500).json({
        ok: false,
        message: "Visitor could not be saved"
      });
    }

    const visitorId = visitorResult[0].id;

    // Telegram par unique Join Request link banayein
    const expiryTimestamp =
      Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${telegramToken}/createChatInviteLink`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          name: `Visitor-${sessionId.slice(0, 8)}`,
          expire_date: expiryTimestamp,
          creates_join_request: true
        })
      }
    );

    const telegramResult = await telegramResponse.json();

    if (!telegramResponse.ok || !telegramResult.ok) {
      console.error("Telegram invite error:", telegramResult);
      return res.status(500).json({
        ok: false,
        message: "Telegram invite creation failed"
      });
    }

    const inviteLink = telegramResult.result.invite_link;

    // Invite link ko visitor ke saath Supabase mein save karein
    const inviteResponse = await fetch(
      `${supabaseUrl}/rest/v1/telegram_invites`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          visitor_id: visitorId,
          invite_link: inviteLink,
          telegram_chat_id: String(chatId),
          expires_at: new Date(expiryTimestamp * 1000).toISOString()
        })
      }
    );

    const inviteResult = await inviteResponse.json();

    if (!inviteResponse.ok) {
      console.error("Supabase invite error:", inviteResult);
      return res.status(500).json({
        ok: false,
        message: "Invite could not be saved"
      });
    }

    return res.status(200).json({
      ok: true,
      session_id: sessionId,
      invite_link: inviteLink
    });

  } catch (error) {
    console.error("Create Invite Error:", error);

    return res.status(500).json({
      ok: false,
      message: "Internal Server Error"
    });
  }
          }
