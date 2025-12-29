
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end('Method Not Allowed');
  }
  const MAX_SCORE = 158;
  
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const originHeader = req.headers.origin || '';
  const referrerHeader = req.headers.referer || '';
  const hostHeader = req.headers.host || '';
  const requestedWith = req.headers['x-requested-with'];
  const secFetchSite = req.headers['sec-fetch-site'];
  const secFetchMode = req.headers['sec-fetch-mode'];
  
  const deriveOrigin = () => {
    if (originHeader) return originHeader;
    try {
      if (referrerHeader) return new URL(referrerHeader).origin;
    } catch (e) {
      // ignore bad URLs
    }
    return '';
  };

  const origin = deriveOrigin();

  const derivedAllowedOrigins = (() => {
    if (allowedOrigins.length) return allowedOrigins;
    if (!hostHeader) return [];
    const baseHost = hostHeader.startsWith('localhost')
      ? `http://${hostHeader}`
      : `https://${hostHeader}`;
    return [baseHost, `http://${hostHeader}`];
  })();

  if (derivedAllowedOrigins.length) {
    if (!origin || !derivedAllowedOrigins.includes(origin)) {
      res.statusCode = 403;
      return res.json({ error: 'origin not allowed' });
    }
  }

  if (requestedWith !== 'dragonballer-game') {
    res.statusCode = 403;
    return res.json({ error: 'missing integrity header' });
  }

  if (secFetchSite && secFetchSite === 'cross-site') {
    res.statusCode = 403;
    return res.json({ error: 'cross-site not allowed' });
  }

  if (secFetchMode && secFetchMode !== 'cors' && secFetchMode !== 'same-origin') {
    res.statusCode = 400;
    return res.json({ error: 'bad fetch mode' });
  }

  const parsedBody =
    typeof req.body === 'string'
      ? (() => {
          try {
            return JSON.parse(req.body);
          } catch (e) {
            return {};
          }
        })()
  : req.body && typeof req.body === 'object'
        ? { ...req.body }
        : {};

   const { handle, score, duration } = parsedBody;

  const numericScore = Number(score);
  const numericDuration = Number(duration);
  
  if (!handle || !Number.isFinite(numericScore)) {
    res.statusCode = 400;
    return res.json({ error: 'missing handle or score' });
  }

if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
    res.statusCode = 400;
    return res.json({ error: 'nono' });
  }

  const MIN_DURATION = 3;
  if (numericDuration < MIN_DURATION) {
    res.statusCode = 400;
    return res.json({ error: 'nono' });
  }
  
  if (!Number.isSafeInteger(numericScore)) {
    res.statusCode = 400;
    return res.json({ error: 'nono' });
  }
  
  // Basic sanity checks
  const handlePattern = /^@?[A-Za-z0-9_]{1,15}$/;
  if (!handlePattern.test(handle)) {
    res.statusCode = 400;
    return res.json({ error: 'invalid handle format' });
  }

if (numericScore < 0 || numericScore > MAX_SCORE) {
    res.statusCode = 400;
    return res.json({ error: 'hmmmm' });
  }
  // Playtime
  const MAX_DURATION = 1000; 
  if (numericDuration > MAX_DURATION) {
    res.statusCode = 400;
    return res.json({ error: 'hmmmm' });
  }

  const cleanDuration = Math.floor(numericDuration);

  // Guardrail
  const maxScoreAllowed = Math.max(10, cleanDuration * 5);
  if (numericScore > maxScoreAllowed) {
    res.statusCode = 400;
    return res.json({ error: 'ups' });
  }
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    res.statusCode = 500;
    return res.json({ error: 'hmmmm' });
  }

  const baseHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };

  try {
    const normalizedHandle = String(handle).trim();
    const cleanHandle = normalizedHandle.startsWith('@')
      ? normalizedHandle
      : `@${normalizedHandle}`;
 const cleanScore = Math.floor(numericScore);

    
    // 1) Check if this handle already exists
    const handleParam = encodeURIComponent(cleanHandle);
    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/scores?handle=eq.${handleParam}&select=id,score&limit=1`,
      { headers: baseHeaders }
    );

    if (!existingRes.ok) {
      const text = await existingRes.text();
      console.error('Supabase select error:', text);
      res.statusCode = 500;
      return res.json({ error: 'db select failed' });
    }

    const existing = await existingRes.json();

    // 2) If no existing row, INSERT new score
    if (!Array.isArray(existing) || existing.length === 0) {
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/scores`, {
        method: 'POST',
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ handle: cleanHandle, score: cleanScore }),
      });

      if (!insertRes.ok) {
        const text = await insertRes.text();
        console.error('Supabase insert error:', text);
        res.statusCode = 500;
        return res.json({ error: 'db insert failed' });
      }

      res.statusCode = 200;
      return res.json({ ok: true, inserted: true });
    }

    // 3) If row exists, UPDATE only if new score is higher
    const current = existing[0];

    if (cleanScore > current.score) {
      const updateRes = await fetch(
        `${supabaseUrl}/rest/v1/scores?id=eq.${current.id}`,
        {
          method: 'PATCH',
          headers: {
            ...baseHeaders,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ score: cleanScore }),
        }
      );

      if (!updateRes.ok) {
        const text = await updateRes.text();
        console.error('Supabase update error:', text);
        res.statusCode = 500;
        return res.json({ error: 'db update failed' });
      }

      res.statusCode = 200;
      return res.json({ ok: true, updated: true });
    }

    // New score is not higher – keep the old one
    res.statusCode = 200;
    return res.json({ ok: true, unchanged: true });
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    return res.json({ error: 'unexpected error' });
  }
};
