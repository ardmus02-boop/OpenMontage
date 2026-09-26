const express = require("express");
const path = require("path");
const { selectComposition, renderMedia } = require("@remotion/renderer");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const browserExecutable = path.join(__dirname, "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell");

app.get("/", (req, res) => {
  res.send("OpenMontage Remotion Server is running.");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
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
