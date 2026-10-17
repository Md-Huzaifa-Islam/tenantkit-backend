import { createZodDto } from 'nestjs-zod';
import { createWorkspaceSchema, transferOwnershipSchema, updateWorkspaceSchema } from '../shared';

export class CreateWorkspaceDto extends createZodDto(createWorkspaceSchema) {}
export class UpdateWorkspaceDto extends createZodDto(updateWorkspaceSchema) {}
export class TransferOwnershipDto extends createZodDto(transferOwnershipSchema) {}
