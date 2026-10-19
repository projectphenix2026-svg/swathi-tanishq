/** The shop's logo mark (web/public/brand/mark.png), used wherever the app shows its badge. */
export function BrandMark({ size = 36, style }) {
  return (
    <div className="brand-mark" style={{ width: size, height: size, ...style }}>
      <img src="/brand/mark.png" alt="" width={size} height={size} />
    </div>
  );
}
