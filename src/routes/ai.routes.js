const express = require("express");
const rateLimit = require("express-rate-limit");

const { generateChatReply } = require("../services/gemini.service");

const router = express.Router();

const chatRateLimit = rateLimit({
  windowMs: Number(process.env.AI_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.AI_RATE_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many AI requests. Please try again shortly.",
  },
});

router.post("/chat", chatRateLimit, async (req, res, next) => {
  try {
    const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
    const codeContext =
      typeof req.body.codeContext === "string" ? req.body.codeContext.trim() : "";
    const language =
      typeof req.body.language === "string" && req.body.language.trim()
        ? req.body.language.trim()
        : "text";

    if (!message) {
      console.warn("AI chat validation failed: missing message");
      return res.status(400).json({
        success: false,
        error: "`message` is required.",
      });
    }

    console.log("AI chat request received", {
      language,
      messageLength: message.length,
      codeContextLength: codeContext.length,
    });

    const reply = await generateChatReply({ message, codeContext, language });

    console.log("AI chat request completed", {
      language,
      replyLength: reply.length,
    });

    return res.json({
      success: true,
      reply,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
