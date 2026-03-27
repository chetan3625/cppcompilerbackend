require("dotenv").config();

const app = require("./src/app");

const port = Number(process.env.PORT) || 3000;

if (!process.env.GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY is not set. /api/ai/chat will not work until it is configured.");
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
