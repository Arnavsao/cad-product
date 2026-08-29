import { Injectable, inject } from '@angular/core';
import { HttpManagerService } from '../../../../../core/services/http-manager.service';
import { L_SECTION_ENDPOINTS } from '../endpoints/l-section.endpoints';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface GenerateLSectionPayload {
  projectId: string;
  files: Record<string, string>;
}

export interface GenerateLSectionResponse {
  dxfUrl: string;
}

@Injectable({ providedIn: 'root' })
export class LSectionService {
  private api = inject(HttpManagerService);

  generateDxf(payload: GenerateLSectionPayload): Observable<GenerateLSectionResponse> {
    return this.api.post<any>(L_SECTION_ENDPOINTS.GENERATE_DXF, payload).pipe(
      map(res => {
        // If wrapped in a 'data' object, adjust accordingly
        return res.data ? res.data : res;
      })
    );
  }
}
