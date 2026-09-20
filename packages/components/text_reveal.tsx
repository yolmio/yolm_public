import { sql } from "std/sql_utils";
import type { Style } from "std/style_types";
import { Data } from "std/data";
import { EventHandlers } from "std/ui";

export interface TextRevealProps {
  /** Array of text lines to reveal */
  lines: string[];
  /** Container element ID to track for scroll calculations */
  containerId?: string;
  /** Pixels offset for each character in the reveal sequence */
  charOffsetPixels?: number;
  /** Base offset for reveal start */
  baseRevealOffset?: number;
  /** Secondary offset for partial reveal */
  secondaryRevealOffset?: number;
  /** Color when fully revealed */
  revealedColor?: string;
  /** Color when partially revealed */
  partiallyRevealedColor?: string;
  /** Color when not revealed */
  unrevealedColor?: string;
  /** Optional CSS class for the line container */
  lineContainerClassName?: string;
  /** Optional CSS class for each character span */
  charClassName?: string;
  /** Optional style for the text container */
  textContainerStyle?: Style;
  /** Optional style for each character */
  charStyle?: Style;
  /** Optional prefix for state variable names to avoid conflicts */
  statePrefix?: string;
}

export function TextReveal({
  lines,
  containerId = "text-reveal-container",
  charOffsetPixels = 3,
  baseRevealOffset = 400,
  secondaryRevealOffset = 350,
  revealedColor = "#FF1744",
  partiallyRevealedColor = "rgba(255, 23, 68, 0.6)",
  unrevealedColor = "rgba(156, 163, 175, 0.3)",
  lineContainerClassName = "flex items-center justify-center gap-4 w-full",
  charClassName = "text-white font-extrabold font-inter m-0",
  textContainerStyle = {
    my: 6,
  },
  charStyle = {
    lineHeight: "1",
    letterSpacing: "-0.02em",
  },
  statePrefix = "",
}: TextRevealProps) {
  const viewportHeightVar = statePrefix
    ? `${statePrefix}_viewport_height`
    : "viewport_height";
  const viewportHeightReadVar = statePrefix
    ? `${statePrefix}_viewport_height_read`
    : "viewport_height_read";
  const containerTopVar = statePrefix
    ? `${statePrefix}_container_top`
    : "container_top";

  // Calculate cumulative character counts for proper sequential reveal
  const cumulativeCharCounts = [0];
  for (let i = 0; i < lines.length; i++) {
    cumulativeCharCounts.push(cumulativeCharCounts[i] + lines[i].length);
  }

  return (
    <Data
      local
      procedure={(s) => {
        // Initialize with proper values
        s.defScalar(viewportHeightVar, 800);
        s.defScalar(containerTopVar, 0);
      }}
    >
      <EventHandlers
        window={{
          scroll: (s) => {
            s.window.getInnerHeight(viewportHeightReadVar);
            s.setScalar(
              viewportHeightVar,
              sql`${sql.ref(viewportHeightReadVar)}`,
            );
            s.element(containerId).getBoundingClientRect("container_rect");
            s.setScalar(containerTopVar, sql`container_rect.top`);
          },
        }}
      />

      {lines.map((item, lineIndex) => {
        // Split text into individual characters for the reveal effect
        const chars = item.split("");
        const previousCharsTotal = cumulativeCharCounts[lineIndex];

        return (
          <div className={lineContainerClassName}>
            {/* Text with letter-by-letter reveal */}
            <span
              className="inline-block"
              sx={textContainerStyle}
            >
              {chars.map((char, charIndex) => {
                // Calculate when this character should start revealing
                // Each character gets offset pixels, and we use cumulative count for proper sequencing
                const charOffset = (previousCharsTotal + charIndex) *
                  charOffsetPixels;
                const scrollProgress = sql`(${sql.ref(viewportHeightVar)} - ${
                  sql.ref(containerTopVar)
                } -100)`;

                return (
                  <span
                    style={{
                      color: sql`
                        case 
                          when ${scrollProgress} > ${
                        baseRevealOffset + charOffset
                      } then ${sql.lit(revealedColor)}
                          when ${scrollProgress} > ${
                        secondaryRevealOffset + charOffset
                      } then ${sql.lit(partiallyRevealedColor)}
                          else ${sql.lit(unrevealedColor)}
                        end
                      `,
                      transition: "color 0.4s ease",
                      display: "inline-block",
                    }}
                    className={charClassName}
                    sx={charStyle}
                  >
                    {char === " " ? "\u00A0" : char}
                  </span>
                );
              })}
            </span>
          </div>
        );
      })}
    </Data>
  );
}
