import { createZodDto } from 'nestjs-zod';
import {
  createProjectSchema,
  createTaskSchema,
  reorderTasksSchema,
  updateProjectSchema,
  updateTaskSchema,
} from '../shared';

export class CreateProjectDto extends createZodDto(createProjectSchema) {}
export class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
export class CreateTaskDto extends createZodDto(createTaskSchema) {}
export class UpdateTaskDto extends createZodDto(updateTaskSchema) {}
export class ReorderTasksDto extends createZodDto(reorderTasksSchema) {}
