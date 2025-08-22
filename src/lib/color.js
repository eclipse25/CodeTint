// lib/color.js
export function formatByProfile(
  profile,
  { hex, r, g, b, a } = sample("#3498DB")
) {
  const HEX = (hex || "#000000").replace("#", "").toUpperCase();
  const AHEX = (a ?? 255).toString(16).padStart(2, "0").toUpperCase();
  const R1 = (r / 255).toFixed(3);
  const G1 = (g / 255).toFixed(3);
  const B1 = (b / 255).toFixed(3);
  const AF = ((a ?? 255) / 255).toFixed(2);

  switch (profile) {
    case "flutter":
      return `const Color(0x${AHEX}${HEX})`;
    case "css-hex":
      return `#${HEX}`;
    case "css-rgba":
      return `rgba(${r}, ${g}, ${b}, ${AF})`;
    case "react-native":
      return `'#${HEX}'`;
    case "ios-swiftui":
      return `Color(red:${R1}, green:${G1}, blue:${B1}, opacity:${AF})`;
    case "ios-uikit":
      return `UIColor(red:${R1}, green:${G1}, blue:${B1}, alpha:${AF})`;
    case "android-xml":
      return `#${AHEX}${HEX}`;
    case "tailwind":
      return `text-[color:#${HEX}]`;
    default:
      return `#${HEX}`;
  }
}

export function sample(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return {
    hex: ("#" + (m ? m.slice(1).join("") : "000000")).toUpperCase(),
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
    a: 255,
  };
}

export function clamp255(n) {
  return Math.max(0, Math.min(255, n));
}

export function makeColor(r, g, b, a = 255) {
  const hex =
    "#" +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  return { hex, r, g, b, a };
}
