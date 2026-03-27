const { AppError } = require("../utils/app-error");

const GEMINI_API_BASE_URL =
  process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";

function buildPrompt({ message, codeContext, language }) {
  return `You are Chetan, a concise programming buddy. Be short, friendly, and actionable.
Language: ${language}
Code:
${codeContext || "(no code context provided)"}

User:
${message}`;
}

function extractReply(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return "";
  }

  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

async function generateChatReply({ message, codeContext, language }) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  if (!apiKey) {
    throw new AppError("AI service is not configured on the server.", 500);
  }

  const prompt = buildPrompt({ message, codeContext, language });
  const endpoint = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
    });
  } catch (_error) {
    throw new AppError("Unable to reach the AI service right now.", 502);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    throw new AppError("AI service returned an invalid response.", 502);
  }

  if (!response.ok) {
    const providerMessage = payload?.error?.message;
    const safeMessage =
      response.status >= 500
        ? "AI service is temporarily unavailable."
        : providerMessage || "AI request failed.";

    throw new AppError(safeMessage, response.status >= 500 ? 502 : 400);
  }

  const reply = extractReply(payload);
  if (!reply) {
    throw new AppError("AI service returned an empty reply.", 502);
  }

  return reply;
}

module.exports = {
  generateChatReply,
};
