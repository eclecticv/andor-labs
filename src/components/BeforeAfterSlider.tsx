import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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

// The "after" site embed renders at a fixed desktop viewport width and is
// scaled down to fit its container. Without this, the iframe takes the
// container's own width as its viewport, the embedded site re-lays-out at a
// tablet breakpoint, and the pane looks zoomed-in next to the static "before"
// screenshot (which scales like an image).
const EMBED_DESIGN_WIDTH = 1440;

function SiteEmbed({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / EMBED_DESIGN_WIDTH);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <iframe
        src={src}
        title={title}
        loading="lazy"
        scrolling="no"
        style={{
          width: EMBED_DESIGN_WIDTH,
          height: `${100 / scale}%`,
          border: "none",
          display: "block",
          pointerEvents: "none",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
}

// Corner labels live INSIDE each pane so the compare clipping applies to them
// too — "BEFORE" can only ever appear over the before layer, wherever the
// divider is dragged. Solid backgrounds keep them legible over screenshots.
function Pane({ side, children }: { side: "before" | "after"; children: ReactNode }) {
  const isAfter = side === "after";
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {children}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: 14, // bottom corners: both panes' embedded site navs live at the top
          ...(isAfter ? { right: 14 } : { left: 14 }),
          zIndex: 2,
          pointerEvents: "none",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          lineHeight: 1,
          padding: "6px 10px",
          borderRadius: "var(--radius-xs)",
          ...(isAfter
            ? { background: "var(--blue-500)", color: "#fff" }
            : { background: "rgba(255,255,255,0.95)", color: "var(--ink-900)", border: "1px solid var(--ink-300)" }),
        }}
      >
        {isAfter ? "After" : "Before"}
      </span>
    </div>
  );
}

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
          <Pane side="before">
            <img
              src={beforeSrc}
              alt={beforeAlt}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </Pane>
        }
        itemTwo={
          <Pane side="after">
          {afterType === "site" ? (
            // The real live hero, embedded directly — accurate by construction,
            // no capture/encoding step to go stale or look janky. Rendered at a
            // fixed desktop viewport and scaled to fit (see SiteEmbed).
            <SiteEmbed src={afterSrc} title={afterAlt} />
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
          )}
          </Pane>
        }
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
