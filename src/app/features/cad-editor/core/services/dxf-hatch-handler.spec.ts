import { DxfHatchHandler } from './dxf-hatch-handler';

describe('DxfHatchHandler', () => {
  it('retains the complete counted HATCH definition instead of a display-only subset', () => {
    const groups = [
      { code: 5, value: 'A1' }, { code: 8, value: 'HATCHES' },
      { code: 10, value: 0 }, { code: 20, value: 0 }, { code: 30, value: 12 },
      { code: 210, value: 0 }, { code: 220, value: 1 }, { code: 230, value: 0 },
      { code: 2, value: 'CUSTOM_X' }, { code: 70, value: 0 }, { code: 71, value: 1 },
      { code: 91, value: 2 },
      // Path 1: an external, closed bulged polyline with an associative source.
      { code: 92, value: 3 }, { code: 72, value: 1 }, { code: 73, value: 1 }, { code: 93, value: 2 },
      { code: 10, value: 1 }, { code: 20, value: 2 }, { code: 42, value: 0.5 },
      { code: 10, value: 3 }, { code: 20, value: 4 }, { code: 42, value: 0 },
      { code: 97, value: 1 }, { code: 330, value: 'B2' },
      // Path 2: a circular arc edge.
      { code: 92, value: 1 }, { code: 93, value: 1 }, { code: 72, value: 2 },
      { code: 10, value: 5 }, { code: 20, value: 6 }, { code: 40, value: 7 },
      { code: 50, value: 10 }, { code: 51, value: 110 }, { code: 73, value: 0 }, { code: 97, value: 0 },
      { code: 75, value: 2 }, { code: 76, value: 2 }, { code: 52, value: 30 },
      { code: 41, value: 2.5 }, { code: 77, value: 1 },
      { code: 78, value: 1 }, { code: 53, value: 45 }, { code: 43, value: 9 }, { code: 44, value: 8 },
      { code: 45, value: 7 }, { code: 46, value: 6 }, { code: 79, value: 3 },
      { code: 49, value: 4 }, { code: 49, value: -2 }, { code: 49, value: 0 },
      { code: 47, value: 0.25 }, { code: 98, value: 1 }, { code: 10, value: 1.5 }, { code: 20, value: 2.5 },
      { code: 450, value: 1 }, { code: 451, value: 0 }, { code: 460, value: 1.25 }, { code: 461, value: 0.4 },
      { code: 452, value: 0 }, { code: 462, value: 0.2 }, { code: 453, value: 2 },
      { code: 463, value: 0 }, { code: 63, value: 1 }, { code: 421, value: 0xff0000 },
      { code: 463, value: 1 }, { code: 63, value: 5 }, { code: 421, value: 0x0000ff }, { code: 470, value: 'LINEAR' },
      // An unknown extension tag proves ordered raw data is retained too.
      { code: 1001, value: 'MY_APP' },
    ];
    const entity: any = {};

    (new DxfHatchHandler() as any)._parseGroups(entity, groups);

    expect(entity.dxfHatch.rawTags).toEqual([{ code: 0, value: 'HATCH' }, ...groups]);
    expect(entity.dxfHatch.elevation).toEqual({ x: 0, y: 0, z: 12 });
    expect(entity.dxfHatch.extrusion).toEqual({ x: 0, y: 1, z: 0 });
    expect(entity.dxfHatch.pattern).toEqual(jasmine.objectContaining({
      name: 'CUSTOM_X', solidFill: false, associative: true, style: 2, type: 2,
      angle: 30, scale: 2.5, double: true,
    }));
    expect(entity.dxfHatch.pattern.definitionLines).toEqual([
      { angle: 45, x0: 9, y0: 8, dx: 7, dy: 6, dashArray: [4, -2, 0] },
    ]);
    expect(entity.dxfHatch.boundaryPaths[0]).toEqual(jasmine.objectContaining({
      kind: 'polyline', flags: 3, hasBulges: true, closed: true, sourceBoundaryHandles: ['B2'],
    }));
    expect(entity.dxfHatch.boundaryPaths[0].vertices[0]).toEqual({ point: { x: 1, y: 2 }, bulge: 0.5 });
    expect(entity.dxfHatch.boundaryPaths[1].edges[0]).toEqual(jasmine.objectContaining({
      kind: 'arc', radius: 7, startAngleDeg: 10, endAngleDeg: 110, counterClockwise: false,
    }));
    expect(entity.dxfHatch.seedPoints).toEqual([{ x: 1.5, y: 2.5 }]);
    expect(entity.dxfHatch.gradient).toEqual(jasmine.objectContaining({
      isGradient: true, angleRad: 1.25, centeredShift: 0.4, tint: 0.2, name: 'LINEAR',
    }));
    expect(entity.dxfHatch.gradient.colors).toEqual([
      { shift: 0, aci: 1, trueColor: 0xff0000 },
      { shift: 1, aci: 5, trueColor: 0x0000ff },
    ]);
  });
});
