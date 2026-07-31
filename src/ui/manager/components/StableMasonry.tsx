import {
  Children,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode
} from "react";

interface StableMasonryProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  minColumnWidth?: number;
  maxColumns?: number;
}

type MasonryStyle = CSSProperties & {
  "--masonry-column-count": number;
};

export function distributeMasonryItems<T>(
  items: readonly T[],
  columnCount: number
): T[][] {
  const safeColumnCount = Math.max(1, Math.floor(columnCount));
  const columns = Array.from(
    { length: safeColumnCount },
    () => [] as T[]
  );
  items.forEach((item, index) => {
    columns[index % safeColumnCount].push(item);
  });
  return columns;
}

function columnCountForWidth(
  width: number,
  gap: number,
  minColumnWidth: number,
  maxColumns: number
): number {
  const safeGap = Math.max(0, gap);
  const safeMinWidth = Math.max(1, minColumnWidth);
  const safeMaxColumns = Math.max(1, Math.floor(maxColumns));
  return Math.max(
    1,
    Math.min(
      safeMaxColumns,
      Math.floor(
        (Math.max(0, width) + safeGap) /
          (safeMinWidth + safeGap)
      )
    )
  );
}

export function StableMasonry({
  children,
  className,
  minColumnWidth = 240,
  maxColumns = 4,
  style,
  ...props
}: StableMasonryProps) {
  const rootRef = useRef<HTMLElement>(null);
  const [columnCount, setColumnCount] = useState(
    Math.max(1, Math.floor(maxColumns))
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function update(width: number) {
      const gap = Number.parseFloat(
        window.getComputedStyle(root!).columnGap
      );
      const nextCount = columnCountForWidth(
        width,
        Number.isFinite(gap) ? gap : 0,
        minColumnWidth,
        maxColumns
      );
      setColumnCount((current) =>
        current === nextCount ? current : nextCount
      );
    }

    update(root.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(([entry]) => {
      update(entry?.contentRect.width ?? root.clientWidth);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [maxColumns, minColumnWidth]);

  const columns = useMemo(
    () =>
      distributeMasonryItems(
        Children.toArray(children),
        columnCount
      ),
    [children, columnCount]
  );
  const masonryStyle: MasonryStyle = {
    ...style,
    "--masonry-column-count": columnCount
  };

  return (
    <section
      {...props}
      ref={rootRef}
      className={className}
      style={masonryStyle}
      data-column-count={columnCount}
    >
      {columns.map((column, index) => (
        <div className="library-masonry-column" key={index}>
          {column}
        </div>
      ))}
    </section>
  );
}
