require("dotenv").config();

const express = require("express");
const fs = require("fs");
const { exec, spawn } = require("child_process");
const path = require("path");

let sqlite3;
try {
  sqlite3 = require("sqlite3").verbose();
} catch (e) {
  sqlite3 = null;
}

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
  const language = typeof req.body.language === "string" ? req.body.language.toLowerCase() : "cpp";
  const isSql = language === "sql";

  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const runId = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const runDir = path.join(tempDir, runId);
  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }

  let sourceFile;
  let compileCmd = null;
  let runCommand;
  let runArgs = [];
  let needsStdin = false;

  if (isSql) {
    if (!sqlite3) {
      return res.status(500).send(
        "SQLite driver not installed. Run `npm install sqlite3` and restart the server."
      );
    }

    sourceFile = path.join(runDir, `query.sql`);
    fs.writeFileSync(sourceFile, code);

    // We'll execute the query against an on-disk sqlite database inside the run dir.
    // This keeps it isolated per request.
    needsStdin = false;
  } else if (language === "java") {
    const classMatch = code.match(/public\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/);
    const className = classMatch ? classMatch[1] : "Main";
    sourceFile = path.join(runDir, `${className}.java`);
    fs.writeFileSync(sourceFile, code);
    compileCmd = `javac "${sourceFile}"`;
    runCommand = "java";
    runArgs = ["-cp", runDir, className];
    needsStdin = /\bScanner\s*\(|System\.in\b|readLine\s*\(/.test(code);
  } else if (language === "c") {
    sourceFile = path.join(runDir, `code.c`);
    fs.writeFileSync(sourceFile, code);
    const outputFile = path.join(runDir, process.platform === "win32" ? "a.exe" : "a.out");
    compileCmd = `gcc "${sourceFile}" -o "${outputFile}"`;
    runCommand = outputFile;
    needsStdin = /\bscanf\s*\(|fgets\s*\(|getchar\s*\(/.test(code);
  } else if (language === "python") {
    sourceFile = path.join(runDir, `code.py`);
    fs.writeFileSync(sourceFile, code);
    runCommand = "python3";
    runArgs = [sourceFile];
    needsStdin = /\binput\s*\(|sys\.stdin\b/.test(code);
  } else {
    // Default to C++
    sourceFile = path.join(runDir, `code.cpp`);
    fs.writeFileSync(sourceFile, code);
    const outputFile = path.join(runDir, process.platform === "win32" ? "a.exe" : "a.out");
    compileCmd = `g++ "${sourceFile}" -o "${outputFile}"`;
    runCommand = outputFile;
    needsStdin = /\b(std::)?cin\b|getline\s*\(/.test(code);
  }

  const runSql = () => {
    if (!sqlite3) {
      return res.status(500).send(
        "SQLite driver not installed. Run `npm install sqlite3` and restart the server."
      );
    }

    const query = (code || "").toString().trim();
    if (!query) {
      return res.status(400).send("No SQL query provided.");
    }

    const dbFile = path.join(runDir, "db.sqlite");
    const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
      if (err) return res.status(500).send(err.message);

      const isSelect = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(query);
      if (isSelect) {
        db.all(query, (err2, rows) => {
          db.close(() => {});
          if (err2) return res.status(200).send(err2.message);
          res.json(rows);
        });
      } else {
        db.exec(query, (err3) => {
          db.close(() => {});
          if (err3) return res.status(200).send(err3.message);
          res.send("OK");
        });
      }
    });
  };

  const finishRun = () => {
    // Accept either a string or an array of lines for stdin.
    let runInput = "";
    if (typeof req.body.input === "string") {
      runInput = req.body.input;
    } else if (Array.isArray(req.body.input)) {
      runInput = req.body.input.join("\n");
      // Ensure the last line is terminated so getline behaves as expected.
      if (!runInput.endsWith("\n")) runInput += "\n";
    }

    if (isSql) {
      if (runInput.trim() !== "") {
        return res.status(400).send("SQL mode does not accept stdin; send your query in the 'code' field.");
      }
      return runSql();
    }

    // If the code reads from stdin but we were not provided any meaningful input, warn early.
    if (needsStdin && runInput.trim() === "") {
      return res.status(400).send(
        "Your code reads from stdin (std::cin / getline / scanf / Scanner / System.in / input()), but no input was provided. " +
        "Send a request body like { \"language\": \"cpp\", \"code\": ..., \"input\": \"line1\\nline2\\n\" }."
      );
    }

    const child = spawn(runCommand, runArgs, { cwd: runDir });

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
  };

  const onCompileDone = (compileError, stdout, stderr) => {
    if (compileError) {
      if (language === "java") {
        if (compileError.code === "ENOENT" || /javac.*not recognized/i.test(stderr)) {
          return res.status(500).send(
            "Compiler not found: javac is not available on the PATH.\n" +
            "Install a JDK and ensure both javac and java are on the PATH."
          );
        }
      } else if (language === "c") {
        if (compileError.code === "ENOENT" || /gcc.*not recognized/i.test(stderr)) {
          return res.status(500).send(
            "Compiler not found: gcc is not available on the PATH.\n" +
            "Install gcc (e.g. build-essential) and ensure it is on the PATH."
          );
        }
      } else {
        if (compileError.code === "ENOENT" || /g\+\+.*not recognized/i.test(stderr)) {
          return res.status(500).send(
            "Compiler not found: g++ is not available on the PATH.\n" +
            "Install MinGW-w64 / MSYS2 (or another C++ toolchain) and ensure g++ is on the PATH."
          );
        }
      }
      return res.status(500).send(stderr || compileError.message);
    }

    finishRun();
  };

  if (compileCmd) {
    exec(compileCmd, onCompileDone);
  } else {
    finishRun();
  }

});
app.get("/server", (req, res) => {
  console.log("HOME ROUTE HIT");
  res.send("Server working");
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
