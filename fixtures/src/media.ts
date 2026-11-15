/**
 * Schematic placeholder media for DEVELOPMENT FIXTURES ONLY.
 *
 * These are deliberately crude line drawings with prominent "PLACEHOLDER — NOT A PATIENT
 * IMAGE" watermarks. They exist to exercise the viewer (stacks, comparison, render errors)
 * and must never be used in a scored clinical case (validation rejects placeholder media
 * when isDevelopmentFixture is false).
 */

const W = 512;
const H = 512;

function frame(label: string, index: number, total: number, orientation: [string, string, string, string], body: string): string {
  const [top, right, bottom, left] = orientation;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#000"/>
  ${body}
  <g font-family="DejaVu Sans, sans-serif" fill="#ffd54a">
    <text x="${W / 2}" y="22" font-size="14" text-anchor="middle" font-weight="bold">DEVELOPMENT FIXTURE · SCHEMATIC PLACEHOLDER</text>
    <text x="${W / 2}" y="${H - 12}" font-size="12" text-anchor="middle">${escapeXml(label)} · frame ${index + 1}/${total}</text>
  </g>
  <g font-family="DejaVu Sans, sans-serif" fill="#9ad" font-size="16" font-weight="bold">
    <text x="${W / 2}" y="44" text-anchor="middle">${top}</text>
    <text x="${W - 14}" y="${H / 2}" text-anchor="end">${right}</text>
    <text x="${W / 2}" y="${H - 30}" text-anchor="middle">${bottom}</text>
    <text x="14" y="${H / 2}">${left}</text>
  </g>
  <text x="${W / 2}" y="${H / 2}" transform="rotate(-35 ${W / 2} ${H / 2})" font-family="DejaVu Sans, sans-serif" font-size="26" font-weight="bold" fill="#ffd54a" fill-opacity="0.35" text-anchor="middle">PLACEHOLDER — NOT A PATIENT IMAGE</text>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Axial head CT schematic. Radiological convention: patient left on image right. */
export function ctHeadAxial(index: number, total: number): string {
  const t = index / Math.max(1, total - 1); // 0 = skull base, 1 = vertex
  const rx = 150 + 40 * Math.sin(Math.PI * Math.min(1, t * 1.2));
  const ry = 185 + 40 * Math.sin(Math.PI * Math.min(1, t * 1.2));
  const vent = t > 0.3 && t < 0.75 ? `<ellipse cx="236" cy="250" rx="${10 + 14 * t}" ry="${30 + 30 * t}" fill="#222"/><ellipse cx="276" cy="250" rx="${10 + 14 * t}" ry="${30 + 30 * t}" fill="#222"/>` : "";
  const hypo = index >= Math.floor(total * 0.4) && index <= Math.floor(total * 0.7)
    ? `<path d="M300 190 Q370 200 380 260 Q370 320 305 330 Q290 260 300 190 Z" fill="#5f5f5f"/>`
    : "";
  const dense = index >= Math.floor(total * 0.45) && index <= Math.floor(total * 0.55)
    ? `<line x1="300" y1="262" x2="352" y2="252" stroke="#e8e8e8" stroke-width="5" stroke-linecap="round"/>`
    : "";
  return frame("CT head axial (schematic)", index, total, ["A", "L", "P", "R"], `
  <ellipse cx="256" cy="262" rx="${rx + 12}" ry="${ry + 12}" fill="#f0f0f0"/>
  <ellipse cx="256" cy="262" rx="${rx}" ry="${ry}" fill="#707070"/>
  ${vent}${hypo}${dense}`);
}

/** CT angiography MIP schematic with a truncated vessel on the image right (patient left). */
export function ctaMip(index: number, total: number): string {
  return frame("CTA head axial MIP (schematic)", index, total, ["A", "L", "P", "R"], `
  <ellipse cx="256" cy="262" rx="200" ry="230" fill="none" stroke="#333" stroke-width="10"/>
  <g stroke="#d8d8d8" stroke-width="6" fill="none" stroke-linecap="round">
    <path d="M236 340 L236 300 L256 280 L276 300 L276 340"/>
    <path d="M256 280 L256 230"/>
    <path d="M236 300 L170 285 L120 250"/><path d="M170 285 L140 320"/><path d="M120 250 L100 210"/>
    <path d="M276 300 L300 296"/>
    <path d="M256 230 L230 170"/><path d="M256 230 L282 170"/>
  </g>`);
}

/** Sagittal thoracic spine schematic; `weighting` changes intensities only. */
export function spineSagittal(weighting: "t2" | "t1c") {
  return (index: number, total: number): string => {
    const centre = Math.abs(index - (total - 1) / 2) / ((total - 1) / 2); // 0 = midline
    const cordOpacity = Math.max(0, 1 - centre * 1.4);
    const csf = weighting === "t2" ? "#e6e6e6" : "#3a3a3a";
    const cord = weighting === "t2" ? "#8a8a8a" : "#7a7a7a";
    const body = weighting === "t2" ? "#585858" : "#9a9a9a";
    const mass = weighting === "t2" ? "#a0a0a0" : "#eeeeee";
    let vertebrae = "";
    for (let i = 0; i < 9; i++) {
      const y = 70 + i * 44;
      vertebrae += `<rect x="170" y="${y}" width="90" height="34" rx="6" fill="${body}"/><rect x="172" y="${y + 34}" width="86" height="10" fill="#aaaaaa"/>`;
    }
    return frame(`MRI thoracic spine sagittal ${weighting.toUpperCase()} (schematic)`, index, total, ["S", "P", "I", "A"], `
    ${vertebrae}
    <rect x="270" y="60" width="44" height="400" fill="${csf}"/>
    <path d="M280 60 L304 60 L304 230 Q296 250 304 270 L304 460 L280 460 L280 270 Q290 250 280 230 Z" fill="${cord}" fill-opacity="${cordOpacity.toFixed(2)}"/>
    <path d="M262 218 Q300 238 262 282 Z" fill="${mass}"/>`);
  };
}

/** Axial brain MRI schematic with a ring lesion on the image left (patient right). */
export function brainMriAxial(weighting: "t1c" | "flair") {
  return (index: number, total: number): string => {
    const show = index >= Math.floor(total * 0.3) && index <= Math.floor(total * 0.65);
    const edema = weighting === "flair" && show ? `<path d="M140 150 Q220 120 240 200 Q235 270 160 280 Q110 230 140 150 Z" fill="#c8c8c8"/>` : "";
    const ring = show
      ? weighting === "t1c"
        ? `<circle cx="190" cy="205" r="34" fill="#3a3a3a" stroke="#f2f2f2" stroke-width="7"/>`
        : `<circle cx="190" cy="205" r="30" fill="#d8d8d8"/>`
      : "";
    return frame(`MRI brain axial ${weighting === "t1c" ? "T1 post-contrast" : "FLAIR"} (schematic)`, index, total, ["A", "L", "P", "R"], `
    <ellipse cx="256" cy="262" rx="196" ry="226" fill="#1a1a1a" stroke="#555" stroke-width="10"/>
    <ellipse cx="256" cy="262" rx="182" ry="212" fill="${weighting === "flair" ? "#6a6a6a" : "#5a5a5a"}"/>
    ${edema}${ring}`);
  };
}

/** CT neck axial schematic (soft tissue). */
export function ctNeckAxial(index: number, total: number): string {
  const show = index >= Math.floor(total * 0.35) && index <= Math.floor(total * 0.7);
  return frame("CT neck axial with contrast (schematic)", index, total, ["A", "L", "P", "R"], `
  <ellipse cx="256" cy="270" rx="170" ry="140" fill="#6c6c6c"/>
  <ellipse cx="256" cy="330" rx="40" ry="34" fill="#cfcfcf"/>
  <ellipse cx="256" cy="210" rx="30" ry="22" fill="#111"/>
  <circle cx="186" cy="260" r="12" fill="#e0e0e0"/><circle cx="326" cy="260" r="12" fill="#e0e0e0"/>
  ${show ? `<ellipse cx="256" cy="262" rx="58" ry="20" fill="#3c3c3c" stroke="#d0d0d0" stroke-width="4"/>` : ""}`);
}
