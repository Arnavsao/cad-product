import { BaseEntity } from '../../../core/BaseEntity';
import { IDraftingEntity } from '../../../interfaces/entities';
import { Point3D, EntityId, SourceEntityId } from '../../../types';

export class CADEllipse extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADEllipse';

    public radiusX: number;
    public radiusY: number;
    public rotation: number;
    public startAngle: number;
    public endAngle: number;

    constructor(
        id: EntityId,
        public readonly center: Point3D,
        radiusX: number,
        radiusY: number,
        rotation: number,
        startAngle: number,
        endAngle: number,
        public readonly layerRef: string,
        public readonly lineType: string = 'CONTINUOUS',
        sourceEntityId: SourceEntityId = null,
        metadata: ReadonlyMap<string, string> = new Map()
    ) {
        let adjRadiusX: number, adjRadiusY: number, adjRotation: number, adjStartAngle: number, adjEndAngle: number;

        if (radiusX < radiusY) {
            adjRadiusX = radiusY;
            adjRadiusY = radiusX;
            adjRotation = rotation + Math.PI / 2;
            adjStartAngle = startAngle - Math.PI / 2;
            adjEndAngle = endAngle - Math.PI / 2;
        } else {
            adjRadiusX = radiusX;
            adjRadiusY = radiusY;
            adjRotation = rotation;
            adjStartAngle = startAngle;
            adjEndAngle = endAngle;
        }

        // Calculate exact bounding box for the ellipse arc
        const points: { x: number; y: number }[] = [];
        const getPt = (t: number) => {
            const cosT = Math.cos(t);
            const sinT = Math.sin(t);
            const cosR = Math.cos(adjRotation);
            const sinR = Math.sin(adjRotation);
            return {
                x: center.x + adjRadiusX * cosT * cosR - adjRadiusY * sinT * sinR,
                y: center.y + adjRadiusX * cosT * sinR + adjRadiusY * sinT * cosR
            };
        };

        points.push(getPt(adjStartAngle));
        points.push(getPt(adjEndAngle));

        const isAngleBetween = (target: number, start: number, end: number) => {
            if (Math.abs(end - start) >= 2 * Math.PI - 1e-5) {
                return true;
            }
            const PI2 = 2 * Math.PI;
            const norm = (a: number) => ((a % PI2) + PI2) % PI2;
            const s = norm(start);
            const e = norm(end);
            const t = norm(target);
            if (s <= e) {
                return t >= s && t <= e;
            } else {
                return t >= s || t <= e;
            }
        };

        // Extrema of the full ellipse
        const t_x1 = Math.atan2(-adjRadiusY * Math.sin(adjRotation), adjRadiusX * Math.cos(adjRotation));
        const t_x2 = t_x1 + Math.PI;
        const t_y1 = Math.atan2(adjRadiusY * Math.cos(adjRotation), adjRadiusX * Math.sin(adjRotation));
        const t_y2 = t_y1 + Math.PI;

        if (isAngleBetween(t_x1, adjStartAngle, adjEndAngle)) points.push(getPt(t_x1));
        if (isAngleBetween(t_x2, adjStartAngle, adjEndAngle)) points.push(getPt(t_x2));
        if (isAngleBetween(t_y1, adjStartAngle, adjEndAngle)) points.push(getPt(t_y1));
        if (isAngleBetween(t_y2, adjStartAngle, adjEndAngle)) points.push(getPt(t_y2));

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }

        super(id, { minX, minY, maxX, maxY }, sourceEntityId, metadata);

        this.radiusX = adjRadiusX;
        this.radiusY = adjRadiusY;
        this.rotation = adjRotation;
        this.startAngle = adjStartAngle;
        this.endAngle = adjEndAngle;
    }

    public static create(
        center: Point3D, 
        radiusX: number, 
        radiusY: number, 
        rotation: number, 
        startAngle: number, 
        endAngle: number, 
        layerRef: string, 
        lineType: string = 'CONTINUOUS'
    ): CADEllipse {
        return new CADEllipse(
            crypto.randomUUID() as EntityId, 
            { ...center }, 
            radiusX, 
            radiusY, 
            rotation, 
            startAngle, 
            endAngle, 
            layerRef, 
            lineType
        );
    }
}
