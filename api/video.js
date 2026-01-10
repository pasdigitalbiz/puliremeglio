export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const { q } = req.query || {};
    const query = (q || "").trim();

    if (!query) {
      res.status(400).json({
        error: "missing_query",
        message: "Missing search query"
      });
      return;
    }

    // Costruiamo una query prudente e utile
    const safeQuery = encodeURIComponent(query + " pulizia");
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?search_query=${safeQuery}`;

    const ytRes = await fetch(feedUrl, {
      headers: {
        "user-agent": "pulire-meglio-bot"
      }
    });

    if (!ytRes.ok) {
      res.status(502).json({
        error: "youtube_unreachable",
        message: "YouTube feed not reachable"
      });
      return;
    }

    const xml = await ytRes.text();

    // Estrazione semplice e robusta del primo video
    const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
    if (!entryMatch) {
      res.status(200).json({
        found: false
      });
      return;
    }

    const entry = entryMatch[1];

    const idMatch =
      entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/) ||
      entry.match(/<id>yt:video:(.*?)<\/id>/);

    const titleMatch = entry.match(/<title>(.*?)<\/title>/);

    if (!idMatch) {
      res.status(200).json({
        found: false
      });
      return;
    }

    const videoId = idMatch[1];
    const title = titleMatch ? titleMatch[1] : "Video di supporto";

    res.status(200).json({
      found: true,
      videoId,
      title
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "server_error",
      message: "Unexpected error"
    });
  }
}
