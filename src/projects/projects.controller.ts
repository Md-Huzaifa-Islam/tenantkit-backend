import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, CurrentWorkspace, RequirePermission } from '../common/decorators';
import type { AuthUser, WorkspaceContext } from '../common/request-context';
import { CreateProjectDto, CreateTaskDto, ReorderTasksDto, UpdateProjectDto, UpdateTaskDto } from './dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiBearerAuth()
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('projects')
  @RequirePermission('project.read')
  list(@CurrentWorkspace() ws: WorkspaceContext, @CurrentUser() user: AuthUser) {
    return this.projects.list(ws, user);
  }

  @Post('projects')
  @RequirePermission('project.create')
  create(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Body() body: CreateProjectDto,
    @ClientIp() ip: string | null,
  ) {
    return this.projects.create(ws, user, body, ip);
  }

  @Get('projects/:id')
  @RequirePermission('project.read')
  get(@CurrentWorkspace() ws: WorkspaceContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(ws, user, id);
  }

  @Patch('projects/:id')
  @RequirePermission('project.update')
  update(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProjectDto,
  ) {
    return this.projects.update(ws, user, id, body);
  }

  @Delete('projects/:id')
  @HttpCode(204)
  @RequirePermission('project.delete')
  async remove(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ) {
    await this.projects.remove(ws, user, id, ip);
  }

  @Get('projects/:id/tasks')
  @RequirePermission('task.read')
  listTasks(@CurrentWorkspace() ws: WorkspaceContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.listTasks(ws, user, id);
  }

  @Post('projects/:id/tasks')
  @RequirePermission('task.create')
  createTask(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateTaskDto,
  ) {
    return this.projects.createTask(ws, user, id, body);
  }

  @Patch('tasks/:id')
  @RequirePermission('task.create')
  updateTask(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTaskDto,
  ) {
    return this.projects.updateTask(ws, user, id, body);
  }

  @Delete('tasks/:id')
  @HttpCode(204)
  @RequirePermission('task.create')
  async removeTask(@CurrentWorkspace() ws: WorkspaceContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.projects.removeTask(ws, user, id);
  }

  @Post('tasks/reorder')
  @HttpCode(200)
  @RequirePermission('task.create')
  reorder(@CurrentWorkspace() ws: WorkspaceContext, @CurrentUser() user: AuthUser, @Body() body: ReorderTasksDto) {
    return this.projects.reorder(ws, user, body);
  }
}
