export function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;

  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

export function describeArc(
  x: number,
  y: number,
  radius: number,
  startAngle: number,
  endAngle: number
) {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);

  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  const d = [
    "M",
    start.x,
    start.y,
    "A",
    radius,
    radius,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
    "L",
    x,
    y,
    "Z", // Close path
  ].join(" ");

  return d;
}

export function getAngle(x: number, y: number, cx: number, cy: number): number {
  const dy = y - cy;
  const dx = x - cx;
  let theta = Math.atan2(dy, dx); // range (-PI, PI)
  theta *= 180 / Math.PI; // rads to degs, range (-180, 180)

  // Convert to 0-360 range, starting from top (12 o'clock)
  // Standard atan2: 0=East, 90=South, 180=West, -90=North
  // We want 0=North, 90=East, 180=South, 270=West

  // Shift by 90 degrees
  let angle = theta + 90;
  if (angle < 0) angle += 360;
  return angle;
}


