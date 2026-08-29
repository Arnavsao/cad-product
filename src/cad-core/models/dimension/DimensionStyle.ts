export interface DimensionStyle {
    id: string;
    name: string;
    
    // Lines & Arrows
    dimLineColor: string;       // DIMCLRD
    dimLineWeight: number;      // DIMLWD
    dimLineType: string;        // DIMLTYPE
    
    extLineColor: string;       // DIMCLRE
    extLineWeight: number;      // DIMLWE
    extLineType: string;        // DIMLTEX1, DIMLTEX2
    
    extendBeyondDim: number;    // DIMEXE
    offsetFromOrigin: number;   // DIMEXO
    baselineSpacing: number;    // DIMDLI
    
    arrowSize: number;          // DIMASZ
    arrowType1: string;         // DIMBLK1
    arrowType2: string;         // DIMBLK2
    centerMarkSize: number;     // DIMCEN
    
    // Text
    textHeight: number;         // DIMTXT
    textColor: string;          // DIMCLRT
    textStyleId: string;        // DIMTXSTY
    textGap: number;            // DIMGAP
    
    textPlacementVert: 'Above' | 'Centered' | 'Outside'; // DIMTAD
    textPlacementHoriz: 'Centered' | 'AtExt1' | 'AtExt2' | 'OverExt1' | 'OverExt2'; // DIMJUST
    
    textInsideAlign: 'Horizontal' | 'Aligned' | 'ISO';   // DIMTIH
    textOutsideAlign: 'Horizontal' | 'Aligned' | 'ISO';  // DIMTOH
    
    // Fit
    globalScale: number;        // DIMSCALE
    annotative: boolean;        // ANNOTATIVEDWG
    fitMode: 'TextAndArrows' | 'ArrowsOnly' | 'TextOnly' | 'BestFit'; // DIMATFIT
    textMovement: 'KeepWithLine' | 'MoveAddLeader' | 'MoveNoLeader'; // DIMTMOVE
    
    // Units
    linearFormat: 'Decimal' | 'Architectural' | 'Engineering' | 'Fractional' | 'Scientific'; // DIMLUNIT
    linearPrecision: number;    // DIMDEC
    angularFormat: 'DecimalDegrees' | 'DegMinSec' | 'Gradians' | 'Radians'; // DIMAUNIT
    angularPrecision: number;   // DIMADEC
    
    prefix: string;             // DIMPOST (prefix part)
    suffix: string;             // DIMPOST (suffix part)
    zeroSuppression: 'None' | 'Leading' | 'Trailing' | 'Both'; // DIMZIN
    
    // Alternate Units & Tolerances (Phase B additions)
    // ...
}

export const DEFAULT_DIMENSION_STYLE: DimensionStyle = {
    id: 'STANDARD',
    name: 'Standard',
    
    dimLineColor: 'ByBlock',
    dimLineWeight: -1,
    dimLineType: 'Continuous',
    
    extLineColor: 'ByBlock',
    extLineWeight: -1,
    extLineType: 'Continuous',
    
    extendBeyondDim: 1.25,
    offsetFromOrigin: 0.625,
    baselineSpacing: 3.75,
    
    arrowSize: 2.5,
    arrowType1: 'ClosedFilled',
    arrowType2: 'ClosedFilled',
    centerMarkSize: 2.5,
    
    textHeight: 2.5,
    textColor: 'ByBlock',
    textStyleId: 'Standard',
    textGap: 0.625,
    
    textPlacementVert: 'Centered',
    textPlacementHoriz: 'Centered',
    
    textInsideAlign: 'Aligned',
    textOutsideAlign: 'Horizontal',
    
    globalScale: 1.0,
    annotative: false,
    fitMode: 'BestFit',
    textMovement: 'KeepWithLine',
    
    linearFormat: 'Decimal',
    linearPrecision: 2,
    angularFormat: 'DecimalDegrees',
    angularPrecision: 0,
    
    prefix: '',
    suffix: '',
    zeroSuppression: 'Trailing'
};
