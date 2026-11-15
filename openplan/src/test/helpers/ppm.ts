/**
 * A binary PPM (P6), 100 by 10 pixels, white except for its first `red`
 * pixels, which are highlight red (200, 30, 30). A stand-in for a rendered
 * map page, for tests whose PDFs are not real.
 */
export function ppmWithRed(red: number, rgb: [number, number, number] = [200, 30, 30]): Buffer {
  const width = 100;
  const height = 10;
  if (red > width * height) throw new Error(`a ${width} by ${height} page holds at most ${width * height} pixels`);
  const pixels = Buffer.alloc(width * height * 3, 255);
  for (let i = 0; i < red; i += 1) pixels.set(rgb, i * 3);
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`, "latin1"), pixels]);
}
