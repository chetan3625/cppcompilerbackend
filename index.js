require("dotenv").config();

const express = require("express");
const fs = require("fs");
const { exec, spawn } = require("child_process");
const path = require("path");

console.log("[index.js] loaded", { cwd: process.cwd(), filename: __filename });

const app = express();

app.use(express.json());

// Log incoming requests for debugging
app.use((req, res, next) => {
  console.log("REQ", req.method, req.path);
  next();
});

app.post("/run", (req, res) => {
        console.log("RUN API HIT");

    const code = req.body.code;

    const fileName = `code_${Date.now()}.cpp`;

    const tempDir = path.join(__dirname, "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const filepath = path.join(tempDir, fileName);

    fs.writeFileSync(filepath, code);

    const outputFile = process.platform === "win32"
      ? filepath.replace(/\.cpp$/i, ".exe")
      : filepath.replace(/\.cpp$/i, "");

    const compileCmd = `g++ "${filepath}" -o "${outputFile}"`;

    exec(compileCmd, (compileError, stdout, stderr) => {

        if (compileError) {
            // Friendly error when g++ is missing
            if (compileError.code === "ENOENT" || /g\+\+.*not recognized/i.test(stderr)) {
                return res.status(500).send(
                    "Compiler not found: g++ is not available on the PATH.\n" +
                    "Install MinGW-w64 / MSYS2 (or another C++ toolchain) and ensure g++ is on the PATH."
                );
            }
            return res.status(500).send(stderr || compileError.message);
        }

        const runInput = typeof req.body.input === "string" ? req.body.input : "";

        const child = spawn(outputFile, { cwd: tempDir });

        let stdoutData = "";
        let stderrData = "";

        child.stdout.on("data", (data) => {
          stdoutData += data.toString();
        });
        child.stderr.on("data", (data) => {
          stderrData += data.toString();
        });

        child.on("error", (err) => {
          return res.status(500).send(err.message);
        });

        child.on("close", (code) => {
          if (code !== 0) {
            // Prefer stderr when available
            return res.status(200).send(stderrData || `Process exited with code ${code}`);
          }
          res.send(stdoutData);
        });

        if (runInput) {
          child.stdin.write(runInput);
        }
        child.stdin.end();

    });

});
app.get("/server", (req, res) => {
  console.log("HOME ROUTE HIT");
  res.send("Server working");
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
