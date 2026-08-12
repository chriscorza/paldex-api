import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('invitations')
@ApiBearerAuth('jwt')
@Controller('invitations')
@RequirePermissions('invitation:read')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @RequirePermissions('invitation:create')
  @ApiOperation({
    summary: 'Invitar un email',
    description:
      'Agrega un email a la whitelist de invitaciones. Si el email ya tenía una invitación revocada, la reactiva en vez de crear una fila nueva.',
  })
  @ApiCreatedResponse({ description: 'Invitación creada o reactivada' })
  create(
    @CurrentUser() user: { id: number; email: string },
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.create(dto.email, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar invitaciones' })
  @ApiOkResponse({
    description: 'Listado de invitaciones, sin filtrar por estado',
  })
  findAll() {
    return this.invitationsService.findAll();
  }

  @Delete(':id')
  @RequirePermissions('invitation:delete')
  @ApiOperation({
    summary: 'Revocar el acceso de una invitación',
    description:
      'Revocación blanda: la invitación pasa a REVOKED, no se borra la fila. Si ya tenía una cuenta vinculada, esa cuenta deja de poder loguear de inmediato.',
  })
  @ApiOkResponse({ description: 'Invitación revocada' })
  revoke(@Param('id', ParseIntPipe) id: number) {
    return this.invitationsService.revoke(id);
  }
}
