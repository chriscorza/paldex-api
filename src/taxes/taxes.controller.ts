import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TaxesService } from './taxes.service';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CreateTaxDto } from './dto/create-tax.dto';
import { UpdateTaxDto } from './dto/update-tax.dto';
import { FilterTaxesDto } from './dto/filter-taxes.dto';

@ApiTags('taxes')
@ApiBearerAuth('jwt')
@Controller('taxes')
@RequirePermissions('tax:read')
export class TaxesController {
  constructor(private readonly taxesService: TaxesService) {}

  @Post()
  @RequirePermissions('tax:create')
  create(@Body() dto: CreateTaxDto) {
    return this.taxesService.create(dto);
  }

  @Get()
  findAll(@Query() filters: FilterTaxesDto) {
    return this.taxesService.findAll(filters);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.taxesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('tax:update')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaxDto) {
    return this.taxesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('tax:delete')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.taxesService.remove(id);
  }
}
