import { Point2D as Point } from '../../types';

export interface DimensionTextConfig {
    textPlacementVert: 'Above' | 'Centered' | 'Outside';
    textInsideAlign: 'Horizontal' | 'Aligned' | 'ISO';
    textOutsideAlign: 'Horizontal' | 'Aligned' | 'ISO';
    textHeight: number;
    textGap: number;
}

export class DimensionTextPlacement {
    /**
     * Determines the optimal rotation angle for dimension text to maintain ISO readability.
     * Text must be readable from the bottom or right side of the drawing.
     * @param dimAngle The raw angle of the dimension line in degrees (0-360).
     * @param isOutside Whether the text has been forced outside the extension lines.
     * @param config The dimension text alignment configuration.
     * @returns The corrected text rotation angle in degrees.
     */
    public static calculateReadabilityRotation(
        dimAngle: number,
        isOutside: boolean,
        config: DimensionTextConfig
    ): number {
        const alignMode = isOutside ? config.textOutsideAlign : config.textInsideAlign;
        
        if (alignMode === 'Horizontal') {
            return 0; // Force horizontal text
        }
        
        let textRotation = dimAngle;
        
        // Normalize angle between 0 and 360
        let normalized = (dimAngle % 360 + 360) % 360;
        
        if (alignMode === 'ISO') {
            // ISO Rule: Text is always readable from bottom or right.
            // If angle is between strictly 90 and 270 degrees, text is upside-down or reading left-to-right backwards.
            // We use a small epsilon to bias exact vertical lines (90 deg) to read from the right.
            if (normalized > 90.001 && normalized <= 270.001) {
                textRotation = (normalized + 180) % 360;
            }
        } else if (alignMode === 'Aligned') {
            // Standard Aligned mode often still flips text to keep it readable, similar to ISO,
            // but might lack specific ISO horizontal dogleg behavior (which we handle in leader generation).
            if (normalized > 90.001 && normalized <= 270.001) {
                textRotation = (normalized + 180) % 360;
            }
        }
        
        return textRotation;
    }
}
