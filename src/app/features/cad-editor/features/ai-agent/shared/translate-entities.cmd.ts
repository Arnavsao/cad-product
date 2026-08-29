import type { ICommand, IModifyEntitiesCmdHooks } from '../../../core/models/command.model';
import type { Entity } from '../../../core/models/entity.model';
import { moveEntityInPlace } from '../../../tools/geometry-utils';
import type { MoveDirection, MoveVector } from '../models/ai-view.model';

/**
 * Undoable translation of a set of entities by a fixed (dx, dy) world vector.
 *
 * `moveEntityInPlace` adds (dx, dy) to every coordinate of an entity and is
 * exactly invertible by negation, so undo simply translates by (-dx, -dy).
 * This lets the AI tools build the command in `compile()` WITHOUT mutating any
 * entity — the mutation only happens when CommandStackService runs execute().
 */
export class TranslateEntitiesCmd implements ICommand {
  constructor(
    private readonly entities: Entity[],
    private readonly dx: number,
    private readonly dy: number,
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}

  execute(): void {
    for (const e of this.entities) moveEntityInPlace(e, this.dx, this.dy);
    this.hooks.markDirty();
  }

  undo(): void {
    for (const e of this.entities) moveEntityInPlace(e, -this.dx, -this.dy);
    this.hooks.markDirty();
  }
}

/** Resolve a move vector from either an explicit {dx,dy} or distance+direction. */
export function resolveMoveVector(params: {
  dx?: number;
  dy?: number;
  distance?: number;
  direction?: MoveDirection;
}): MoveVector | null {
  if (typeof params.dx === 'number' || typeof params.dy === 'number') {
    return { dx: params.dx ?? 0, dy: params.dy ?? 0 };
  }
  if (typeof params.distance === 'number' && params.direction) {
    const d = params.distance;
    switch (params.direction) {
      case 'right': return { dx: d, dy: 0 };
      case 'left': return { dx: -d, dy: 0 };
      case 'up': return { dx: 0, dy: d };
      case 'down': return { dx: 0, dy: -d };
    }
  }
  return null;
}
