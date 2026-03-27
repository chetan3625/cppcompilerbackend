const { AppError } = require("../utils/app-error");

function notFoundHandler(_req, res) {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
} 

function errorHandler(error, _req, res, _next) {
  const statusCode =
    error instanceof AppError
      ? error.statusCode
      : error.message === "Origin not allowed by CORS"
        ? 403
        : 500;

  if (statusCode >= 500) {
    console.error("Server error:", error.message);
  }

  res.status(statusCode).json({
    success: false,
    error:
      statusCode === 500
        ? "Something went wrong on the server."
        : error.message || "Request failed.",
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
