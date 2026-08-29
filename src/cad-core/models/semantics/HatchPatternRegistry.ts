export class HatchPatternRegistry {
    private static validPatterns: Set<string> = new Set([
        'ANSI31',
        'ANSI32',
        'ANSI33',
        'ANSI37',
        'AR-CONC',
        'AR-SAND',
        'AR-RIPRAP',
        'SOLID'
    ]);

    public static registerUserPattern(patternName: string) {
        this.validPatterns.add(patternName);
    }

    public static isValid(patternName: string): boolean {
        return this.validPatterns.has(patternName);
    }

    public static fallbackPattern(): string {
        return 'SOLID';
    }
}
