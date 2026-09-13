import "./aarre-icon.css";

/** Figma A1 artwork; the shared theme selects the color or neutral dark tile. */
export function AarreIcon({ size = 24 }: { size?: number }) {
  return <span className="aarre-product-icon" style={{ width: size, height: size }} aria-hidden="true">
    <img className="aarre-product-icon-light" src="/icons/icon.svg" alt="" width={128} height={128} draggable={false} />
    <img className="aarre-product-icon-dark" src="/icons/icon-dark.svg" alt="" width={128} height={128} draggable={false} />
  </span>;
}
