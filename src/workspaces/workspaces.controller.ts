import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, CurrentWorkspace, RequirePermission } from '../common/decorators';
import type { AuthUser, WorkspaceContext } from '../common/request-context';
import { CreateWorkspaceDto, TransferOwnershipDto, UpdateWorkspaceDto } from './dto';
import { MAX_LOGO_BYTES, WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@ApiBearerAuth()
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateWorkspaceDto, @ClientIp() ip: string | null) {
    return this.workspaces.create(user, body, ip);
  }

  @Get(':workspaceId')
  @RequirePermission('workspace.read')
  get(@CurrentWorkspace() ws: WorkspaceContext, @CurrentUser() user: AuthUser, @Param('workspaceId') _id: string) {
    return this.workspaces.get(ws, user.id);
  }

  @Patch(':workspaceId')
  @RequirePermission('workspace.update')
  update(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateWorkspaceDto,
    @ClientIp() ip: string | null,
  ) {
    return this.workspaces.update(ws, user, body, ip);
  }

  @Delete(':workspaceId')
  @HttpCode(204)
  @RequirePermission('workspace.delete')
  async remove(@CurrentWorkspace() ws: WorkspaceContext) {
    await this.workspaces.remove(ws);
  }

  @Post(':workspaceId/transfer')
  @HttpCode(200)
  @RequirePermission('workspace.transfer')
  transfer(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Body() body: TransferOwnershipDto,
    @ClientIp() ip: string | null,
  ) {
    return this.workspaces.transferOwnership(ws, user, body.userId, ip);
  }

  @Post(':workspaceId/logo')
  @HttpCode(200)
  @RequirePermission('workspace.update')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES + 1, files: 1 } }))
  uploadLogo(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @ClientIp() ip: string | null,
  ) {
    return this.workspaces.uploadLogo(ws, user, file, ip);
  }
}
