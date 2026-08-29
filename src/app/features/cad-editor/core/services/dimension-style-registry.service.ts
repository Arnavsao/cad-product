import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { DimensionStyle, DEFAULT_DIMENSION_STYLE } from '../../../../../cad-core/models/dimension/DimensionStyle';

@Injectable({
    providedIn: 'root'
})
export class DimensionStyleRegistryService {
    private styles: Map<string, DimensionStyle> = new Map();
    private currentStyleIdSubject = new BehaviorSubject<string>(DEFAULT_DIMENSION_STYLE.id);
    public currentStyleId$ = this.currentStyleIdSubject.asObservable();

    constructor() {
        // Initialize with standard style
        this.addStyle(DEFAULT_DIMENSION_STYLE);
    }

    /**
     * Gets all registered dimension styles.
     */
    public getAllStyles(): DimensionStyle[] {
        return Array.from(this.styles.values());
    }

    /**
     * Gets a dimension style by ID.
     */
    public getStyle(id: string): DimensionStyle | undefined {
        return this.styles.get(id);
    }

    /**
     * Gets the currently active dimension style.
     */
    public getCurrentStyle(): DimensionStyle {
        const id = this.currentStyleIdSubject.getValue();
        return this.styles.get(id) || DEFAULT_DIMENSION_STYLE;
    }

    /**
     * Sets the active dimension style.
     */
    public setCurrentStyle(id: string): void {
        if (this.styles.has(id)) {
            this.currentStyleIdSubject.next(id);
        } else {
            console.warn(`Dimension style ${id} not found.`);
        }
    }

    /**
     * Adds or updates a dimension style.
     */
    public addStyle(style: DimensionStyle): void {
        this.styles.set(style.id, { ...style });
    }

    /**
     * Removes a dimension style. Standard style cannot be removed.
     */
    public removeStyle(id: string): void {
        if (id === DEFAULT_DIMENSION_STYLE.id) return;
        
        this.styles.delete(id);
        
        // Revert to standard if the active style was removed
        if (this.currentStyleIdSubject.getValue() === id) {
            this.currentStyleIdSubject.next(DEFAULT_DIMENSION_STYLE.id);
        }
    }

    /**
     * Creates an override style for a specific entity.
     * Generates an "anonymous" style ID (similar to AutoCAD override logic).
     */
    public createOverride(baseStyleId: string, overrides: Partial<DimensionStyle>): DimensionStyle {
        const baseStyle = this.getStyle(baseStyleId) || DEFAULT_DIMENSION_STYLE;
        const overrideId = `${baseStyleId}_OVERRIDE_${Date.now()}`;
        
        const newStyle: DimensionStyle = {
            ...baseStyle,
            ...overrides,
            id: overrideId,
            name: `${baseStyle.name} (Override)`
        };
        
        this.addStyle(newStyle);
        return newStyle;
    }
}
