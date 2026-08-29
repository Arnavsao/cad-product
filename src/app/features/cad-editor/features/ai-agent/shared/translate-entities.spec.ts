import { resolveMoveVector } from './translate-entities.cmd';

describe('resolveMoveVector', () => {
  it('returns an explicit dx/dy vector', () => {
    expect(resolveMoveVector({ dx: 10, dy: -5 })).toEqual({ dx: 10, dy: -5 });
  });

  it('treats a missing component of an explicit vector as 0', () => {
    expect(resolveMoveVector({ dx: 10 })).toEqual({ dx: 10, dy: 0 });
    expect(resolveMoveVector({ dy: 7 })).toEqual({ dx: 0, dy: 7 });
  });

  it('resolves distance + direction (world Y up)', () => {
    expect(resolveMoveVector({ distance: 100, direction: 'right' })).toEqual({ dx: 100, dy: 0 });
    expect(resolveMoveVector({ distance: 100, direction: 'left' })).toEqual({ dx: -100, dy: 0 });
    expect(resolveMoveVector({ distance: 100, direction: 'up' })).toEqual({ dx: 0, dy: 100 });
    expect(resolveMoveVector({ distance: 100, direction: 'down' })).toEqual({ dx: 0, dy: -100 });
  });

  it('returns null when neither vector nor distance+direction supplied', () => {
    expect(resolveMoveVector({})).toBeNull();
    expect(resolveMoveVector({ distance: 100 })).toBeNull();
    expect(resolveMoveVector({ direction: 'left' })).toBeNull();
  });

  it('prefers an explicit vector over distance+direction', () => {
    expect(resolveMoveVector({ dx: 1, dy: 2, distance: 999, direction: 'right' }))
      .toEqual({ dx: 1, dy: 2 });
  });
});
