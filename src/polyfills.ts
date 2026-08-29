/**
 * Runtime patches required by the CAD renderer.
 *
 * CanvasRenderingContext2D.ellipse() throws `IndexSizeError` for negative
 * radii. Entity transforms (mirror/scale) can legitimately produce them, so
 * radii are clamped to their absolute value before reaching the browser.
 */
const originalEllipse = CanvasRenderingContext2D.prototype.ellipse;
CanvasRenderingContext2D.prototype.ellipse = function (
  this: CanvasRenderingContext2D,
  x: number, y: number, radiusX: number, radiusY: number,
  rotation: number, startAngle: number, endAngle: number, counterclockwise?: boolean,
) {
  return originalEllipse.call(this, x, y, Math.abs(radiusX), Math.abs(radiusY), rotation, startAngle, endAngle, counterclockwise);
};
