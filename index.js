const express = require("express");
const fs = require("fs");
const { exec } = require("child_process");
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
    const runCmd = process.platform === "win32" ? `"${outputFile}"` : `"${outputFile}"`;

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

        exec(outputFile, (runError, stdout, stderr) => {

            if (runError) {
                return res.send(stderr);
            }

            res.send(stdout);

        });

    });

});
app.get("/server", (req, res) => {
  console.log("HOME ROUTE HIT");
  res.send("Server working");
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});
