import type { BooleanExpr } from "../std/sql_utils";
import { Show, useApp, usePhase } from "std/ui";
import { SeededRandom } from "std/utils/seeded_random";

/** Props for {@link Confetti}. */
interface ConfettiProps {
  /** Show the confetti burst when this expression is true. */
  show: BooleanExpr;
  /** Number of confetti pieces (defaults to a sensible value). */
  count?: number;
  /** Horizontal origin (0–100, percentage from left). */
  sourceX?: number;
  /** Vertical origin (0–100, percentage from top). */
  sourceY?: number;
}

/**
 * Burst of celebratory confetti rendered as a CSS-keyframe animation.
 * Use sparingly — typically once at the end of a milestone flow (form
 * submit, scan completion, onboarding step). The burst plays only while
 * `show` is true; toggle the scalar back to false after the animation
 * (or leave it — the animation is one-shot).
 */
export function Confetti(props: ConfettiProps) {
  if (usePhase() === "gather") {
    return null;
  }
  const app = useApp();
  const keyframes = app.registerKeyframes({
    "0%": {
      transform: "translate3d(0, 0, 0) rotate(var(--rotation-start))",
      opacity: 0,
    },
    "15%": {
      transform:
        "translate3d(var(--tx-peak), var(--ty-peak), 0) rotate(var(--rotation-peak))",
      opacity: 1,
    },
    "100%": {
      transform:
        "translate3d(var(--tx-end), var(--ty-end), 0) rotate(var(--rotation-end))",
      opacity: 0,
    },
  });

  const count = props.count ?? 75;

  // Group confetti pieces into batches of 5 for better performance
  const batchCount = Math.ceil(count / 5);
  const batches = Array(batchCount).fill(null);

  const random = new SeededRandom(app.domain);

  return (
    <Show when={props.show}>
      <div
        sx={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 99999,
        }}
      >
        {batches.map((_, batchIndex) => (
          <ConfettiBatch
            keyFrames={keyframes}
            sourceX={props.sourceX ?? 50}
            sourceY={props.sourceY ?? 50}
            startIndex={batchIndex * 5}
            count={Math.min(5, count - batchIndex * 5)}
            random={random}
          />
        ))}
      </div>
    </Show>
  );
}

interface ConfettiBatchProps {
  keyFrames: string;
  sourceX: number;
  sourceY: number;
  startIndex: number;
  count: number;
  random: SeededRandom;
}

function ConfettiBatch(props: ConfettiBatchProps) {
  const { keyFrames, sourceX, sourceY, count, random } = props;
  const pieces = Array(count).fill(null);
  return (
    <div
      sx={{
        position: "absolute",
        left: `${sourceX}%`,
        top: `${sourceY}%`,
        willChange: "transform",
      }}
    >
      {pieces.map(() => (
        <ConfettiPiece
          keyFrames={keyFrames}
          delay={random.random() * 0.3} // Reduced max delay
          random={random}
        />
      ))}
    </div>
  );
}

interface ConfettiPieceProps {
  keyFrames: string;
  delay: number;
  random: SeededRandom;
}

function ConfettiPiece({ keyFrames, delay, random }: ConfettiPieceProps) {
  // Pre-calculate random values to reduce runtime calculations
  const angle = random.random() * 360 * (Math.PI / 180);
  const velocity = random.random() * 20 + 15; // Reduced velocity range
  const peakX = Math.cos(angle) * velocity;
  const peakY = Math.sin(angle) * velocity - 15;
  const endX = peakX * 1.5; // Reduced spread
  const endY = 80;
  const rotationStart = random.random() * 360;
  const rotationPeak = rotationStart + random.random() * 120 - 60; // Reduced rotation
  const rotationEnd = rotationPeak + random.random() * 360 - 180;
  const size = random.random() * 0.3 + 0.3; // Smaller pieces

  return (
    <div
      sx={{
        position: "absolute",
        width: `${size}rem`,
        height: `${size}rem`,
        borderRadius: "2px",
        opacity: 0,
        animation: `${keyFrames} 5s cubic-bezier(0.25, 0.1, 0.25, 1) forwards`,
        willChange: "transform, opacity",
      }}
      style={{
        "background-color": `hsl(${random.random() * 360}, 70%, 50%)`,
        "animation-delay": `${delay}s`,
        "--tx-peak": `${peakX}vw`,
        "--ty-peak": `${peakY}vh`,
        "--tx-end": `${endX}vw`,
        "--ty-end": `${endY}vh`,
        "--rotation-start": `${rotationStart}deg`,
        "--rotation-peak": `${rotationPeak}deg`,
        "--rotation-end": `${rotationEnd}deg`,
      }}
    />
  );
}
