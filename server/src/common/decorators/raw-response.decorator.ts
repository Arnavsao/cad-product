import { SetMetadata } from '@nestjs/common';

/** Metadata key read by `ResponseEnvelopeInterceptor`. */
export const RAW_RESPONSE_KEY = 'cad:rawResponse';

/**
 * Opts a handler out of the `{ success: true, data }` envelope. Use for
 * endpoints whose body is consumed by something other than the Angular
 * `HttpManagerService` (e.g. a text/plain DXF proxy or a redirect).
 */
export const RawResponse = (): MethodDecorator => SetMetadata(RAW_RESPONSE_KEY, true);
