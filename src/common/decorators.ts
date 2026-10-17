import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Skip JWT authentication for a route or controller. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
