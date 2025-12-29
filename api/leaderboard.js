// api/leaderboard.js
// Vercel serverless function to fetch top scores from Supabase

module.exports = async (_req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    res.statusCode = 500;
    return res.json({ error: 'Supabase env vars missing' });
  }

  // Build the REST query:
  // select handle,score,created_at
  // order by score desc, created_at asc
  // limit 20
  const url =
    `${supabaseUrl}/rest/v1/scores` +
    `?select=handle,score,created_at` +
    `&order=score.desc` +
    `&order=created_at.asc` +
    `&limit=20`;

  try {
    const response = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Supabase error:', text);
      res.statusCode = 500;
      return res.json({ error: 'db fetch failed' });
    }

    const data = await response.json();
    res.statusCode = 200;
    return res.json(data);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    return res.json({ error: 'unexpected error' });
  }
};
