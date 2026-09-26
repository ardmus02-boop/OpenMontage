const express = require("express");
const { selectComposition, renderMedia } = require("@remotion/renderer");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

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
      id: compositionId,
      inputProps,
    });

    await renderMedia({
      composition: durationInFrames ? { ...composition, durationInFrames: Number(durationInFrames) } : composition,
      serveUrl: "./build",
      codec: "h264",
      outputLocation,
      inputProps,
    });

    res.download(outputLocation, "openmontage.mp4");
  } catch (error) {
    console.error("Render error:", error);
    res.status(500).json({
      error: error?.message || String(error),
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`OpenMontage server listening on port ${PORT}`);
});
