// netlify/functions/chat.js
// Server-side Groq proxy with automatic model fallback.
// Tries multiple models until one works, so future deprecations
// don't break the app.

const PREFERRED_MODELS = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "llama-3.1-8b-instant"
];

export default async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return json({ error: "GROQ_API_KEY not set in Netlify environment" }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const messages = body.messages;
  const temperature = body.temperature ?? 0.6;
  const max_tokens = body.max_tokens ?? 400;
  const userModel = body.model;

  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "messages array is required" }, 400);
  }

  // Try user-specified model first, then all others
  const modelsToTry = userModel
    ? [userModel, ...PREFERRED_MODELS.filter((m) => m !== userModel)]
    : PREFERRED_MODELS;

  const errors = [];

  for (const model of modelsToTry) {
    try {
      const groqRes = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens
          })
        }
      );

      const data = await groqRes.json();

      // Success — return immediately with which model was used
      if (groqRes.ok) {
        return json(
          {
            ...data,
            _model_used: model
          },
          200
        );
      }

      // Model-not-found → try the next one
      const code = data?.error?.code;
      if (code === "model_not_found") {
        errors.push({ model, code });
        continue;
      }

      // Any other error (auth, rate limit) → stop, this is a real problem
      return json(
        {
          ...data,
          _tried_model: model,
          _all_errors: errors
        },
        groqRes.status
      );
    } catch (fetchErr) {
      errors.push({ model, error: fetchErr.message });
      continue;
    }
  }

  // Every model failed
  return json(
    {
      error: "All models failed. This usually means none of the model IDs are valid for this API key.",
      tried: modelsToTry,
      errors
    },
    502
  );
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

export const config = { path: "/api/chat" };
