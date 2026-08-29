/**
 * Handles AutoCAD-style dimension text formatting and overrides.
 */
export class DimensionTextFormatter {
    /**
     * Parses a dimension text override string and injects the measured value.
     * @param override The text override string (e.g. "<> TYP", "R=<>", "%%C<>"). Null/empty uses measured default.
     * @param measuredValue The raw mathematical distance/angle.
     * @param precision The decimal precision (DIMDEC).
     * @param prefix Global style prefix (DIMPOST).
     * @param suffix Global style suffix (DIMPOST).
     * @returns Formatted display string.
     */
    public static format(
        override: string | undefined | null,
        measuredValue: number,
        precision: number,
        prefix: string = '',
        suffix: string = ''
    ): string {
        // 1. Format the raw number according to precision
        // TODO: Handle architectural/fractional formats based on DIMLUNIT later.
        const numericStr = measuredValue.toFixed(precision);
        
        // 2. Combine prefix, measurement, and suffix
        const standardText = `${prefix}${numericStr}${suffix}`;

        // 3. If no override is provided, return standard text.
        if (override === undefined || override === null || override === '') {
            return standardText;
        }

        // 4. Substitute <> with the standard text
        let result = override.replace(/<>/g, standardText);

        // 5. Parse standard AutoCAD control codes
        // %%C -> Ø (Diameter)
        // %%D -> ° (Degree)
        // %%P -> ± (Plus/Minus)
        // \X  -> \n (Line break, handled by rendering engine later, we keep it or replace with \n)
        
        result = result.replace(/%%C/gi, 'Ø');
        result = result.replace(/%%D/gi, '°');
        result = result.replace(/%%P/gi, '±');
        
        // Replace \X with actual newline for easier rendering evaluation
        result = result.replace(/\\X/g, '\n');

        return result;
    }
}
