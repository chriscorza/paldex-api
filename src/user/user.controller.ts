import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserService } from './user.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRoleDto } from './dto/assign-role.dto';

@ApiTags('user')
@ApiBearerAuth('jwt')
@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly permissionsService: PermissionsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('me')
  @RequirePermissions()
  findMe(@CurrentUser() user: { id: number; email: string }) {
    return this.userService.findMe(user.id);
  }

  @Patch('me')
  @RequirePermissions()
  updateMe(
    @CurrentUser() user: { id: number; email: string },
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.updateMe(user.id, dto);
  }

  @Delete('me')
  @RequirePermissions()
  removeMe(@CurrentUser() user: { id: number; email: string }) {
    return this.userService.removeMe(user.id);
  }

  @Get()
  @RequirePermissions('user:read')
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.userService.findAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 10,
      search,
    );
  }

  @Patch(':id/role')
  @RequirePermissions('user:assign_role')
  assignRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignRoleDto,
  ) {
    return this.userService.assignRole(id, dto.role_id);
  }

  @Get('me/permissions')
  @RequirePermissions()
  @ApiOperation({
    summary: 'Permisos efectivos del usuario autenticado',
    description:
      'Devuelve un objeto { "recurso:accion": "OWN" | "ANY" } con lo que el usuario puede hacer. Vacío si no tiene rol asignado.',
  })
  async getPermissions(@CurrentUser() user: { id: number; email: string }) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { role_id: true },
    });
    if (!dbUser?.role_id) {
      return {};
    }
    const perms = await this.permissionsService.resolvePermissions(
      dbUser.role_id,
    );
    return Object.fromEntries(perms);
  }
}
