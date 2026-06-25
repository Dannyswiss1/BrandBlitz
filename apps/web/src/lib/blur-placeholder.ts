/**
 * Generate a low-resolution base64 blur placeholder for images.
 * Used for Next.js Image component placeholder="blur" prop.
 * 
 * This creates a tiny 1x1 transparent PNG as a minimal blur placeholder.
 * For production, consider generating actual blurred thumbnails at build time
 * or via a server action using sharp/jimp.
 */
export function generateBlurPlaceholder(): string {
  // 1x1 transparent PNG (smallest valid PNG)
  const transparentPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  return transparentPng;
}

/**
 * Generate a colored blur placeholder based on brand primary color.
 * Creates a small colored square that provides visual continuity during load.
 */
export function generateColoredBlurPlaceholder(hexColor: string = "#6366f1"): string {
  // Validate and normalize hex color
  const color = hexColor.startsWith("#") ? hexColor.slice(1) : hexColor;
  
  // For a colored placeholder, we use a 4x4 SVG with the brand color
  const svg = `
    <svg width="4" height="4" xmlns="http://www.w3.org/2000/svg">
      <rect width="4" height="4" fill="#${color}"/>
    </svg>
  `.trim();
  
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
