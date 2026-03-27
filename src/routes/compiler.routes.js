const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");

let sqlite3;
try {
  sqlite3 = require("sqlite3").verbose();
} catch (error) {
  sqlite3 = null;
}

const router = express.Router();

router.post("/run", (req, res) => {
  const code = req.body.code;
  const language = typeof req.body.language === "string" ? req.body.language.toLowerCase() : "cpp";
  const isSql = language === "sql";

  const tempDir = path.join(__dirname, "..", "..", "temp");
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

    sourceFile = path.join(runDir, "query.sql");
    fs.writeFileSync(sourceFile, code);
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
    sourceFile = path.join(runDir, "code.c");
    fs.writeFileSync(sourceFile, code);
    const outputFile = path.join(runDir, process.platform === "win32" ? "a.exe" : "a.out");
    compileCmd = `gcc "${sourceFile}" -o "${outputFile}"`;
    runCommand = outputFile;
    needsStdin = /\bscanf\s*\(|fgets\s*\(|getchar\s*\(/.test(code);
  } else if (language === "python") {
    sourceFile = path.join(runDir, "code.py");
    fs.writeFileSync(sourceFile, code);
    runCommand = "python3";
    runArgs = [sourceFile];
    needsStdin = /\binput\s*\(|sys\.stdin\b/.test(code);
  } else {
    sourceFile = path.join(runDir, "code.cpp");
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

    const formatTable = (rows) => {
      if (!rows || rows.length === 0) {
        return "(no rows)";
      }

      const columns = Object.keys(rows[0]);
      const widths = columns.map((column) => column.length);

      for (const row of rows) {
        columns.forEach((column, index) => {
          const cell = row[column] === null || row[column] === undefined ? "NULL" : String(row[column]);
          widths[index] = Math.max(widths[index], cell.length);
        });
      }

      const pad = (value, width) => {
        const stringValue = value === null || value === undefined ? "NULL" : String(value);
        return stringValue + " ".repeat(width - stringValue.length);
      };

      const header = columns.map((column, index) => pad(column, widths[index])).join(" | ");
      const separator = widths.map((width) => "-".repeat(width)).join("-+-");
      const rowsText = rows
        .map((row) => columns.map((column, index) => pad(row[column], widths[index])).join(" | "))
        .join("\n");

      return `${header}\n${separator}\n${rowsText}`;
    };

    const renderResults = (results) => {
      if (results.length === 0) {
        return "(no statements executed)";
      }

      const statementRows = [];
      const selectPieces = [];

      results.forEach((result, index) => {
        if (result.type === "select") {
          selectPieces.push(`-- result ${index + 1} (SELECT) --\n${formatTable(result.rows)}`);
          return;
        }

        statementRows.push({
          "#": statementRows.length + 1,
          action: result.action,
          changes: result.changes,
          lastID: result.lastID === null ? "NULL" : result.lastID,
          statement: result.statement,
        });
      });

      const pieces = [];
      if (statementRows.length > 0) {
        pieces.push(`-- statements summary --\n${formatTable(statementRows)}`);
      }
      pieces.push(...selectPieces);
      return pieces.join("\n\n");
    };

    const dbFile = path.join(runDir, "db.sqlite");
    const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (error) => {
      if (error) {
        return res.status(500).send(error.message);
      }

      const statements = query
        .split(";")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);

      const results = [];

      const runStatement = (index) => {
        if (index >= statements.length) {
          db.close(() => {});
          return res.send(renderResults(results));
        }

        const statement = statements[index];
        const action = (statement.match(/^\s*([A-Za-z_]+)/)?.[1] || "STATEMENT").toUpperCase();
        const isSelectStatement = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(statement);

        if (isSelectStatement) {
          db.all(statement, (queryError, rows) => {
            if (queryError) {
              db.close(() => {});
              return res.status(200).send(queryError.message);
            }

            results.push({ type: "select", rows });
            return runStatement(index + 1);
          });

          return;
        }

        db.run(statement, function onRun(runError) {
          if (runError) {
            db.close(() => {});
            return res.status(200).send(runError.message);
          }

          results.push({
            type: "statement",
            action,
            statement,
            changes: this.changes ?? 0,
            lastID: this.lastID ?? null,
          });

          return runStatement(index + 1);
        });
      };

      runStatement(0);
    });
  };

  const finishRun = () => {
    let runInput = "";
    if (typeof req.body.input === "string") {
      runInput = req.body.input;
    } else if (Array.isArray(req.body.input)) {
      runInput = req.body.input.join("\n");
      if (!runInput.endsWith("\n")) {
        runInput += "\n";
      }
    }

    if (isSql) {
      if (runInput.trim() !== "") {
        return res.status(400).send("SQL mode does not accept stdin; send your query in the 'code' field.");
      }
      return runSql();
    }

    if (needsStdin && runInput.trim() === "") {
      return res.status(400).send(
        "Your code reads from stdin (std::cin / getline / scanf / Scanner / System.in / input()), but no input was provided. Send a request body like { \"language\": \"cpp\", \"code\": ..., \"input\": \"line1\\nline2\\n\" }."
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

    child.on("error", (error) => {
      return res.status(500).send(error.message);
    });

    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        return res.status(200).send(stderrData || `Process exited with code ${exitCode}`);
      }

      return res.send(stdoutData);
    });

    if (runInput) {
      child.stdin.write(runInput);
    }
    child.stdin.end();
  };

  const onCompileDone = (compileError, _stdout, stderr) => {
    if (compileError) {
      if (language === "java") {
        if (compileError.code === "ENOENT" || /javac.*not recognized/i.test(stderr)) {
          return res.status(500).send(
            "Compiler not found: javac is not available on the PATH.\nInstall a JDK and ensure both javac and java are on the PATH."
          );
        }
      } else if (language === "c") {
        if (compileError.code === "ENOENT" || /gcc.*not recognized/i.test(stderr)) {
          return res.status(500).send(
            "Compiler not found: gcc is not available on the PATH.\nInstall gcc (e.g. build-essential) and ensure it is on the PATH."
          );
        }
      } else if (compileError.code === "ENOENT" || /g\+\+.*not recognized/i.test(stderr)) {
        return res.status(500).send(
          "Compiler not found: g++ is not available on the PATH.\nInstall MinGW-w64 / MSYS2 (or another C++ toolchain) and ensure g++ is on the PATH."
        );
      }

      return res.status(500).send(stderr || compileError.message);
    }

    return finishRun();
  };

  if (compileCmd) {
    exec(compileCmd, onCompileDone);
    return;
  }

  finishRun();
});

router.get("/server", (_req, res) => {
  res.send("Server working");
});

module.exports = router;
