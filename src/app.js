const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const aiRoutes = require("./routes/ai.routes");
const compilerRoutes = require("./routes/compiler.routes");
const { notFoundHandler, errorHandler } = require("./middleware/error.middleware");

const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      const configuredOrigins = (process.env.CORS_ORIGIN || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      if (!origin || configuredOrigins.length === 0 || configuredOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
  })
);
app.use(express.json({ limit: "1mb" }));

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ success: true, message: "Server is healthy" });
});

app.use("/api/ai", aiRoutes);
app.use("/", compilerRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
