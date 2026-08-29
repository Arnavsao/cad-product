import type { IBBox } from '../../../core/models/entity.model';

/**
 * A logical view (drawing) detected in model space by clustering entities
 * that sit close together — e.g. a plan, elevation, section, or detail.
 * Produced by ViewDetectionService.
 */
export interface DetectedView {
  /** Stable id derived from the cluster centroid (survives small edits). */
  id: string;
  /** Best-guess label (from a TEXT/MTEXT inside the cluster) or "View N". */
  label: string;
  /** Combined world-space bounding box of all member entities. */
  bbox: IBBox;
  /** Ids of the entities belonging to this view. */
  entityIds: number[];
}

/** Direction keyword → unit vector sign, in world coordinates (Y is up). */
export type MoveDirection = 'left' | 'right' | 'up' | 'down';

export interface MoveVector {
  dx: number;
  dy: number;
}
