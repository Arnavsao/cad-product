import { IDraftingEntity } from '../../interfaces/entities';
import { CADLine } from './entities/CADLine';
import { CADPolyline } from './entities/CADPolyline';
import { CADBlock } from './entities/CADBlock';
import { CADInsert } from './entities/CADInsert';
import { CADEllipse } from './entities/CADEllipse';
import { CADDimension } from './entities/CADDimension';
import { CADPoint, CADLWPolyline, CADPolygon, CADRectangle, CADCircle, CADSpline, CADRegion, CADMText, CADAttributeDefinition, CADAttribute, CADLeader, CADMLeader, CADRevisionCloud, CADCallout, CADLinearDimension, CADAngularDimension, CADRadiusDimension, CADDiameterDimension, CADOrdinateDimension } from './entities/ExtendedEntities';

export class CADEntityRegistry {
    private static constructors: Map<string, any> = new Map();

    static {
        CADEntityRegistry.register('CADLine', CADLine);
        CADEntityRegistry.register('CADPolyline', CADPolyline);
        CADEntityRegistry.register('CADBlock', CADBlock);
        CADEntityRegistry.register('CADInsert', CADInsert);
        CADEntityRegistry.register('CADEllipse', CADEllipse);
        CADEntityRegistry.register('CADDimension', CADDimension);
        
        // Extended Entities
        CADEntityRegistry.register('CADPoint', CADPoint);
        CADEntityRegistry.register('CADLWPolyline', CADLWPolyline);
        CADEntityRegistry.register('CADPolygon', CADPolygon);
        CADEntityRegistry.register('CADRectangle', CADRectangle);
        CADEntityRegistry.register('CADCircle', CADCircle);
        CADEntityRegistry.register('CADSpline', CADSpline);
        CADEntityRegistry.register('CADRegion', CADRegion);
        CADEntityRegistry.register('CADMText', CADMText);
        CADEntityRegistry.register('CADAttributeDefinition', CADAttributeDefinition);
        CADEntityRegistry.register('CADAttribute', CADAttribute);
        CADEntityRegistry.register('CADLeader', CADLeader);
        CADEntityRegistry.register('CADMLeader', CADMLeader);
        CADEntityRegistry.register('CADRevisionCloud', CADRevisionCloud);
        CADEntityRegistry.register('CADCallout', CADCallout);
        CADEntityRegistry.register('CADLinearDimension', CADLinearDimension);
        CADEntityRegistry.register('CADAngularDimension', CADAngularDimension);
        CADEntityRegistry.register('CADRadiusDimension', CADRadiusDimension);
        CADEntityRegistry.register('CADDiameterDimension', CADDiameterDimension);
        CADEntityRegistry.register('CADOrdinateDimension', CADOrdinateDimension);
    }

    public static register(typeStr: string, constructorFunc: any) {
        this.constructors.set(typeStr, constructorFunc);
    }

    public static createFromJSON(jsonObj: any): IDraftingEntity | null {
        if (!jsonObj || !jsonObj.draftingType) return null;
        
        const ctor = this.constructors.get(jsonObj.draftingType);
        if (!ctor) {
            console.warn(`CADEntityRegistry: Unknown semantic entity type: ${jsonObj.draftingType}`);
            return null;
        }

        // Direct prototype injection for highly-performant JSON deserialization 
        // without invoking constructors for raw payloads.
        const instance = Object.create(ctor.prototype);
        return Object.assign(instance, jsonObj);
    }
}
