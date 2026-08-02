"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";

type ShapeVariant = "pill" | "rounded";

interface ShapeClasses {
  item: string;
  bg: string;
  focusRing: string;
  mergedBg: string;
  container: string;
  button: string;
  input: string;
  // Numeric counterparts of `bg` / `mergedBg`, in px. Needed where individual
  // corners are animated (e.g. the selected-background merge/split animation),
  // which requires per-corner numeric border-radii rather than a class.
  bgRadius: number;
  mergedRadius: number;
}

// Radii come from the semantic design tokens rather than literal pixel values,
// so a change in tokens.css moves the React controls and hand-written CSS
// together. Menu shells use concentric pairs: container − content padding
// (--sp-1 / p-1) = row highlight. The inner corner must be smaller than the
// shell — never equal or larger — or the selected pill reads as ballooned.
const shapeMap: Record<ShapeVariant, ShapeClasses> = {
  pill: {
    // Menus sit at the md scale (14 outer / 10 inner). lg/xl read as soft as
    // search fields and make the highlight look rounder than the shell.
    item: "rounded-[var(--radius-inset-module)]",
    bg: "rounded-[var(--radius-inset-module)]",
    focusRing: "rounded-[var(--radius-inset-module)]",
    mergedBg: "rounded-[var(--radius-control)]",
    container: "rounded-[var(--radius-module)]",
    button: "rounded-[var(--radius-control)]",
    input: "rounded-[var(--radius-module)]",
    bgRadius: 10,
    mergedRadius: 8,
  },
  rounded: {
    item: "rounded-[var(--radius-compact)]",
    bg: "rounded-[var(--radius-compact)]",
    focusRing: "rounded-[var(--radius-compact)]",
    mergedBg: "rounded-[var(--radius-compact)]",
    container: "rounded-[var(--radius-control)]",
    button: "rounded-[var(--radius-control)]",
    input: "rounded-[var(--radius-control)]",
    bgRadius: 2,
    mergedRadius: 2,
  },
};

interface ShapeContextValue {
  shape: ShapeVariant;
  setShape: (shape: ShapeVariant) => void;
  classes: ShapeClasses;
}

const ShapeContext = createContext<ShapeContextValue | null>(null);

function useShape(): ShapeClasses {
  const ctx = useContext(ShapeContext);
  if (!ctx) return shapeMap.pill;
  return ctx.classes;
}

function useShapeContext() {
  const ctx = useContext(ShapeContext);
  if (!ctx) throw new Error("useShapeContext must be used within a ShapeProvider");
  return ctx;
}

function ShapeProvider({
  children,
  defaultShape = "pill",
}: {
  children: ReactNode;
  defaultShape?: ShapeVariant;
}) {
  const [shape, setShapeState] = useState<ShapeVariant>(defaultShape);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Run a state change under the `.transitioning` guard (added + reflow-flushed
  // first so the 180ms border-radius cross-fade applies). Clearing the previous
  // timeout first keeps a double-press from removing the class mid-fade.
  const transitionShape = useCallback((callback: () => void) => {
    const root = document.documentElement;
    root.classList.add("transitioning");
    void root.offsetHeight;
    callback();
    if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    transitionTimeoutRef.current = setTimeout(
      () => root.classList.remove("transitioning"),
      200
    );
  }, []);

  const setShape = useCallback(
    (next: ShapeVariant) => {
      transitionShape(() => setShapeState(next));
    },
    [transitionShape]
  );

  // Publish the current element radius as a CSS custom property so plain-CSS
  // consumers that can't read React context stay in sync with the shape
  // system — e.g. the @layer base :focus-visible fallback ring in
  // globals.css. Set on <html> so portalled content sees it too.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--shape-input-radius",
      `${shapeMap[shape].bgRadius}px`
    );
  }, [shape]);

  const value = useMemo(
    () => ({ shape, setShape, classes: shapeMap[shape] }),
    [shape, setShape]
  );

  return (
    <ShapeContext.Provider value={value}>
      {children}
    </ShapeContext.Provider>
  );
}

export { ShapeProvider, useShape, useShapeContext, shapeMap };
export type { ShapeVariant, ShapeClasses };
