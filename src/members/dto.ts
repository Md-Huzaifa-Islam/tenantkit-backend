import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { acceptInviteSchema, createInviteSchema, updateMemberRoleSchema } from '../shared';

export class UpdateMemberRoleDto extends createZodDto(updateMemberRoleSchema) {}
export class CreateInviteDto extends createZodDto(createInviteSchema) {}
export class AcceptInviteDto extends createZodDto(acceptInviteSchema) {}
export class PreviewInviteDto extends createZodDto(z.object({ token: z.string().min(10).max(300) })) {}
