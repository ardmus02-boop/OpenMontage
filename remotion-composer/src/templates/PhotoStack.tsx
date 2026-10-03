import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type PhotoStackProps = { imageSrc: string; title?: string; };

export const PhotoStack: React.FC<PhotoStackProps> = ({ imageSrc, title = "" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = interpolate(frame, [0, 3 * fps, 10 * fps], [1.08, 1, 1], { extrapolateRight: "clamp" });
  const rotate = interpolate(frame, [0, 2 * fps, 8 * fps], [-3, 1, 0], { extrapolateRight: "clamp" });
  const opacity = interpolate(frame, [0, 0.5 * fps], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#111", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "72%", height: "78%", backgroundColor: "#fff", padding: 28, boxShadow: "0 25px 70px rgba(0,0,0,0.45)", transform: `scale(${scale}) rotate(${rotate}deg)`, opacity }}>
        <Img src={imageSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      {title && (
        <div style={{ position: "absolute", bottom: 70, left: 0, right: 0, textAlign: "center", color: "white", fontSize: 42, fontFamily: "Arial, sans-serif", fontWeight: 600, textShadow: "0 3px 12px rgba(0,0,0,0.7)" }}>
          {title}
        </div>
      )}
    </AbsoluteFill>
  );
};
