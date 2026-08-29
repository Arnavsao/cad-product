import { IDraftingEntity } from '../interfaces/entities';

export interface BoundingBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export class QuadNode {
    public entities: IDraftingEntity[] = [];
    public children: QuadNode[] | null = null;

    constructor(public bounds: BoundingBox, public capacity: number = 50) {}

    public insert(entity: IDraftingEntity): boolean {
        if (!entity.boundingBox || !this.contains(this.bounds, entity.boundingBox)) {
            return false;
        }

        if (this.children === null) {
            if (this.entities.length < this.capacity) {
                this.entities.push(entity);
                return true;
            }
            this.subdivide();
        }

        if (this.children) {
            for (const child of this.children) {
                if (child.insert(entity)) return true;
            }
        }
        
        // If it straddles boundaries, store in this node
        this.entities.push(entity);
        return true;
    }

    public query(range: BoundingBox, found: IDraftingEntity[] = []): IDraftingEntity[] {
        if (!this.intersects(this.bounds, range)) {
            return found;
        }

        for (const e of this.entities) {
            if (e.boundingBox && this.intersects(range, e.boundingBox)) {
                found.push(e);
            }
        }

        if (this.children) {
            for (const child of this.children) {
                child.query(range, found);
            }
        }

        return found;
    }

    private subdivide() {
        const midX = (this.bounds.minX + this.bounds.maxX) / 2;
        const midY = (this.bounds.minY + this.bounds.maxY) / 2;

        this.children = [
            new QuadNode({ minX: this.bounds.minX, minY: this.bounds.minY, maxX: midX, maxY: midY }, this.capacity),
            new QuadNode({ minX: midX, minY: this.bounds.minY, maxX: this.bounds.maxX, maxY: midY }, this.capacity),
            new QuadNode({ minX: this.bounds.minX, minY: midY, maxX: midX, maxY: this.bounds.maxY }, this.capacity),
            new QuadNode({ minX: midX, minY: midY, maxX: this.bounds.maxX, maxY: this.bounds.maxY }, this.capacity)
        ];

        // Re-distribute existing
        const oldEntities = this.entities;
        this.entities = [];
        for (const e of oldEntities) {
            let placed = false;
            for (const child of this.children) {
                if (child.insert(e)) {
                    placed = true;
                    break;
                }
            }
            if (!placed) this.entities.push(e);
        }
    }

    private contains(container: BoundingBox, target: BoundingBox): boolean {
        return target.minX >= container.minX && target.maxX <= container.maxX &&
               target.minY >= container.minY && target.maxY <= container.maxY;
    }

    private intersects(a: BoundingBox, b: BoundingBox): boolean {
        return !(b.minX > a.maxX || b.maxX < a.minX || b.minY > a.maxY || b.maxY < a.minY);
    }
}

export class SpatialIndex {
    private root: QuadNode;

    constructor(worldBounds: BoundingBox, capacity: number = 50) {
        this.root = new QuadNode(worldBounds, capacity);
    }

    public insert(entity: IDraftingEntity) {
        if (entity.boundingBox) {
            this.root.insert(entity);
        }
    }

    public query(bounds: BoundingBox): IDraftingEntity[] {
        return this.root.query(bounds);
    }
}
