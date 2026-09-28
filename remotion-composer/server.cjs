const express = require("express");
const path = require("path");
const AdmZip = require("adm-zip");
const { selectComposition, renderMedia } = require("@remotion/renderer");

const app = express();
process.on('SIGTERM', () => console.log('PROCESS SIGTERM'));
process.on('SIGINT', () => console.log('PROCESS SIGINT'));
process.on('uncaughtException', (e) => console.error('UNCAUGHT:', e));
process.on('unhandledRejection', (e) => console.error('UNHANDLED:', e));
app.use(express.json());
const PORT = process.env.PORT || 3000;
const browserExecutable = path.join(__dirname, "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell");

app.get("/", (req, res) => {
  res.send("OpenMontage Remotion Server is running.");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/render-zip", express.raw({ type: "application/zip", limit: "200mb" }), async (req, res) => {
  const fs = require("fs");
  const workDir = `/tmp/openmontage-${Date.now()}`;
  const zipPath = `${workDir}.zip`;
  const outputLocation = `${workDir}/openmontage-output.mp4`;

  try {
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(zipPath, req.body);

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(workDir, true);

    const propsPath = path.join(workDir, "props.json");
    const inputProps = JSON.parse(fs.readFileSync(propsPath, "utf8"));

    const normalizeMediaPaths = (value) => {
      if (typeof value === "string") {
        if (value.startsWith("file://")) {
          return path.basename(value.replace(/^file:\/\//i, ""));
        }
        if (path.isAbsolute(value)) {
          return path.basename(value);
        }
        return value;
      }
      if (Array.isArray(value)) return value.map(normalizeMediaPaths);
      if (value && typeof value === "object") {
        for (const key of Object.keys(value)) {
          value[key] = normalizeMediaPaths(value[key]);
        }
      }
      return value;
    };

    normalizeMediaPaths(inputProps);

    const sourceBuildDir = path.join(__dirname, "build");
    const buildDir = path.join(workDir, "build");
    const publicDir = path.join(buildDir, "public");

    fs.cpSync(sourceBuildDir, buildDir, { recursive: true });
    fs.mkdirSync(publicDir, { recursive: true });

    const copyStagedMedia = (dir, relative = "") => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "build" && relative === "") continue;
        if (entry.name === "props.json" && relative === "") continue;

        const fullPath = path.join(dir, entry.name);
        const relPath = path.join(relative, entry.name);

        if (entry.isDirectory()) {
          copyStagedMedia(fullPath, relPath);
        } else {
          const destPath = path.join(publicDir, relPath);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(fullPath, destPath);
        }
      }
    };

    copyStagedMedia(workDir);

    const compositionId = req.headers["x-composition-id"] || "Explainer";

    const composition = await selectComposition({
      serveUrl: buildDir,
      browserExecutable,
      id: compositionId,
      inputProps,
    });

    console.log("ZIP RENDER START:", new Date().toISOString());

    await renderMedia({
      composition,
      serveUrl: buildDir,
      browserExecutable,
      codec: "h264",
      crf: 28,
      scale: 0.5,
      concurrency: 1,
      outputLocation,
      inputProps,
    });

    res.download(outputLocation, "openmontage.mp4", () => {
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.rmSync(zipPath, { force: true });
    });

    console.log("ZIP RENDER END:", new Date().toISOString());
  } catch (error) {
    console.error("ZIP Render error:", error);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
    res.status(500).json({ error: error?.message || String(error) });
  }
});

app.post("/render", async (req, res) => {
  const compositionId = req.body?.compositionId || "Explainer";
  const inputProps = req.body?.inputProps || {};
  const durationInFrames = req.body?.durationInFrames;
  const outputLocation = "/tmp/openmontage-output.mp4";

  try {
    const composition = await selectComposition({
      serveUrl: "./build",
      browserExecutable,
      id: compositionId,
      inputProps,
    });

    console.log("RENDER START:", new Date().toISOString(), "FRAMES:", durationInFrames);
    await renderMedia({
      composition: durationInFrames ? { ...composition, durationInFrames: Number(durationInFrames) } : composition,
      serveUrl: "./build",
      browserExecutable,
      codec: "h264",
      crf: 28,
      scale: 0.5,
      concurrency: 1,
      outputLocation,
      inputProps,
    });

    res.download(outputLocation, "openmontage.mp4");
    console.log("RENDER END:", new Date().toISOString());
  } catch (error) {
    console.error("Render error:", error);
    res.status(500).json({
      error: error?.message || String(error),
    });
  }
});

console.log("BROWSER:", browserExecutable, "EXISTS:", require("fs").existsSync(browserExecutable));
app.listen(PORT, "0.0.0.0", () => {
  console.log(`OpenMontage server listening on port ${PORT}`);
});
