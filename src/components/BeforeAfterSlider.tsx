import { useEffect, useRef } from "react";
import { ReactCompareSlider, ReactCompareSliderHandle } from "react-compare-slider";

interface Props {
  beforeSrc: string;
  beforeAlt: string;
  afterSrc: string;
  afterAlt: string;
  afterType: "image" | "video" | "site";
}

// Rests at 20% old / 80% new. On mount it sweeps through a few positions
// first so the divider's draggable before/after mechanism reads as obvious
// before settling — ending exactly on FINAL_POSITION, the same value
// `defaultPosition` already gives the library's own internal position ref,
// so nothing desyncs once the sweep finishes.
const FINAL_POSITION = 20;
const SWIVEL_SEQUENCE = [55, 75, 30, 62, FINAL_POSITION];

// Custom handle in the DS's signal-blue — a plain vertical line + square grip,
// matching the crop-tick/registration-mark visual language rather than
// react-compare-slider's default rounded pill.
function Handle() {
  return (
    <ReactCompareSliderHandle
      buttonStyle={{
        width: 32,
        height: 32,
        border: "2px solid var(--blue-500)",
        borderRadius: "var(--radius-xs)",
        background: "#fff",
        boxShadow: "var(--shadow-hard-blue)",
      }}
      linesStyle={{ opacity: 1, background: "var(--blue-500)", width: 2 }}
    />
  );
}

export default function BeforeAfterSlider({ beforeSrc, beforeAlt, afterSrc, afterAlt, afterType }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = containerRef.current?.querySelector<HTMLElement>('[data-rcs="root"]');
    if (!root) return;

    const timers: number[] = [];
    let t = 500;
    for (const pos of SWIVEL_SEQUENCE) {
      timers.push(window.setTimeout(() => root.style.setProperty("--rcs-raw-position", `${pos}%`), t));
      t += 550;
    }
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <ReactCompareSlider
        handle={<Handle />}
        defaultPosition={FINAL_POSITION}
        transition="0.55s cubic-bezier(0.65, 0, 0.35, 1)"
        itemOne={
          <img
            src={beforeSrc}
            alt={beforeAlt}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        }
        itemTwo={
          afterType === "site" ? (
            // The real live hero, embedded directly — accurate by construction,
            // no capture/encoding step to go stale or look janky. The hero fills
            // `min-h-dvh` on the source site, so a 100%-sized iframe naturally
            // shows just the hero, not the full scrollable page.
            <iframe
              src={afterSrc}
              title={afterAlt}
              loading="lazy"
              scrolling="no"
              style={{ width: "100%", height: "100%", border: "none", display: "block", pointerEvents: "none" }}
            />
          ) : afterType === "video" ? (
            <video
              src={afterSrc}
              aria-label={afterAlt}
              autoPlay
              muted
              loop
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <img
              src={afterSrc}
              alt={afterAlt}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          )
        }
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
