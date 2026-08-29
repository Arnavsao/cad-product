export abstract class CadError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'CadError';
    }
}

export class GeometryError extends CadError {
    constructor(message: string) {
        super(message, 'ERR_GEOMETRY');
        this.name = 'GeometryError';
    }
}

export class LayoutError extends CadError {
    constructor(message: string) {
        super(message, 'ERR_LAYOUT');
        this.name = 'LayoutError';
    }
}

export class AnnotationError extends CadError {
    constructor(message: string) {
        super(message, 'ERR_ANNOTATION');
        this.name = 'AnnotationError';
    }
}

export class RendererError extends CadError {
    constructor(message: string) {
        super(message, 'ERR_RENDERER');
        this.name = 'RendererError';
    }
}

export class ValidationError extends CadError {
    constructor(message: string) {
        super(message, 'ERR_VALIDATION');
        this.name = 'ValidationError';
    }
}
