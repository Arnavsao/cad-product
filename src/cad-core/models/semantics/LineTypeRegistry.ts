export class LineTypeRegistry {
    /**
     * Maps an HTML5 Canvas dash array to a standard AutoCAD semantic linetype.
     */
    public static resolveFromDashArray(dashArray: number[]): string {
        if (!dashArray || dashArray.length === 0) return 'CONTINUOUS';
        
        const sig = dashArray.join(',');
        
        // Map common canvas dashes used in the legacy renderer to native DXF types
        switch (sig) {
            case '4,4': return 'DASHED';
            case '5,5': return 'DASHED';
            case '2,2': return 'HIDDEN';
            case '10,2,2,2': return 'CENTER';
            case '10,2,2,2,2,2': return 'PHANTOM';
            case '8,2,8,2,2,2': return 'BORDER';
            case '8,2,2,2,2,2': return 'DIVIDE';
            case '6,2,2,2': return 'DASHDOT';
            default: return 'DASHED'; // Fallback semantic linetype
        }
    }
}
