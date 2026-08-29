import { DimensionStyle } from './DimensionStyle';

export class DimensionArrowPlacement {
    /**
     * Determines the optimal placement of text and arrows based on available space between extension lines.
     * @param availableSpace The raw distance between the extension lines.
     * @param textWidth The computed width of the formatted text string.
     * @param arrowSize The visual size of the arrowhead (DIMASZ).
     * @param style The dimension style configuring the fit mode (DIMATFIT).
     * @returns An object detailing whether arrows and text should be placed inside or outside.
     */
    public static calculateFit(
        availableSpace: number,
        textWidth: number,
        arrowSize: number,
        style: DimensionStyle
    ): { arrowsInside: boolean; textInside: boolean } {
        
        // The space required for two arrows pointing inward
        const arrowsRequiredSpace = arrowSize * 2;
        // Total space required for arrows and text inline (plus some gap)
        const totalRequiredSpace = arrowsRequiredSpace + textWidth + (style.textGap * 2);

        let arrowsInside = true;
        let textInside = true;

        switch (style.fitMode) {
            case 'TextAndArrows':
                // If there isn't enough room for both, move both outside
                if (availableSpace < totalRequiredSpace) {
                    arrowsInside = false;
                    textInside = false;
                }
                break;

            case 'ArrowsOnly':
                // Keep arrows inside if possible, move text outside if cramped
                if (availableSpace < arrowsRequiredSpace) {
                    arrowsInside = false;
                    textInside = false;
                } else if (availableSpace < totalRequiredSpace) {
                    textInside = false;
                }
                break;

            case 'TextOnly':
                // Keep text inside if possible, move arrows outside if cramped
                if (availableSpace < textWidth) {
                    textInside = false;
                    arrowsInside = false;
                } else if (availableSpace < totalRequiredSpace) {
                    arrowsInside = false;
                }
                break;

            case 'BestFit':
            default:
                // AutoCAD default: move whichever fits best, preferring to keep text inside if possible
                if (availableSpace >= totalRequiredSpace) {
                    arrowsInside = true;
                    textInside = true;
                } else if (availableSpace >= textWidth) {
                    // Text fits, but arrows don't. Flip arrows outside.
                    arrowsInside = false;
                    textInside = true;
                } else if (availableSpace >= arrowsRequiredSpace) {
                    // Arrows fit, but text doesn't. Move text outside.
                    arrowsInside = true;
                    textInside = false;
                } else {
                    // Neither fit. Move both outside.
                    arrowsInside = false;
                    textInside = false;
                }
                break;
        }

        return { arrowsInside, textInside };
    }
}
