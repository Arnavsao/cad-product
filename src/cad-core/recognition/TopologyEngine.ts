import { Point3D, BoundingBox } from '../types';

export class TopologyEngine {
    private clipStack: BoundingBox[] = [];

    // Constants for Cohen-Sutherland
    private readonly INSIDE = 0; // 0000
    private readonly LEFT = 1;   // 0001
    private readonly RIGHT = 2;  // 0010
    private readonly BOTTOM = 4; // 0100
    private readonly TOP = 8;    // 1000

    public pushClip(bbox: BoundingBox) {
        // Intersect with current top of stack if it exists
        if (this.clipStack.length > 0) {
            const current = this.clipStack[this.clipStack.length - 1];
            const intersected: BoundingBox = {
                minX: Math.max(current.minX, bbox.minX),
                minY: Math.max(current.minY, bbox.minY),
                maxX: Math.min(current.maxX, bbox.maxX),
                maxY: Math.min(current.maxY, bbox.maxY)
            };
            this.clipStack.push(intersected);
        } else {
            this.clipStack.push(bbox);
        }
    }

    public popClip() {
        this.clipStack.pop();
    }

    public get hasActiveClip(): boolean {
        return this.clipStack.length > 0;
    }

    private computeOutCode(x: number, y: number, bbox: BoundingBox): number {
        let code = this.INSIDE;
        if (x < bbox.minX) code |= this.LEFT;
        else if (x > bbox.maxX) code |= this.RIGHT;
        
        if (y < bbox.minY) code |= this.BOTTOM;
        else if (y > bbox.maxY) code |= this.TOP;
        
        return code;
    }

    /**
     * Clips a line against the active clipping region using the Cohen-Sutherland algorithm.
     * Returns null if the line is completely outside the clip region.
     * Returns a new truncated line [Point3D, Point3D] if it partially or fully intersects.
     */
    public clipLine(p1: Point3D, p2: Point3D): [Point3D, Point3D] | null {
        if (!this.hasActiveClip) return [ { ...p1 }, { ...p2 } ];
        
        const bbox = this.clipStack[this.clipStack.length - 1];
        
        // If the bounding box is mathematically invalid (e.g., disjoint intersection)
        if (bbox.minX > bbox.maxX || bbox.minY > bbox.maxY) return null;

        let x0 = p1.x, y0 = p1.y;
        let x1 = p2.x, y1 = p2.y;
        
        let outcode0 = this.computeOutCode(x0, y0, bbox);
        let outcode1 = this.computeOutCode(x1, y1, bbox);
        let accept = false;

        while (true) {
            if (!(outcode0 | outcode1)) {
                // Both endpoints are inside the clip window
                accept = true;
                break;
            } else if (outcode0 & outcode1) {
                // Both endpoints share an outside zone (completely outside)
                break;
            } else {
                // Calculate the line intersection to clip
                let x = 0, y = 0;
                let outcodeOut = outcode0 ? outcode0 : outcode1;

                if (outcodeOut & this.TOP) {
                    x = x0 + (x1 - x0) * (bbox.maxY - y0) / (y1 - y0);
                    y = bbox.maxY;
                } else if (outcodeOut & this.BOTTOM) {
                    x = x0 + (x1 - x0) * (bbox.minY - y0) / (y1 - y0);
                    y = bbox.minY;
                } else if (outcodeOut & this.RIGHT) {
                    y = y0 + (y1 - y0) * (bbox.maxX - x0) / (x1 - x0);
                    x = bbox.maxX;
                } else if (outcodeOut & this.LEFT) {
                    y = y0 + (y1 - y0) * (bbox.minX - x0) / (x1 - x0);
                    x = bbox.minX;
                }

                if (outcodeOut === outcode0) {
                    x0 = x; y0 = y;
                    outcode0 = this.computeOutCode(x0, y0, bbox);
                } else {
                    x1 = x; y1 = y;
                    outcode1 = this.computeOutCode(x1, y1, bbox);
                }
            }
        }

        if (accept) {
            return [ { x: x0, y: y0, z: p1.z }, { x: x1, y: y1, z: p2.z } ];
        }
        return null;
    }
}
