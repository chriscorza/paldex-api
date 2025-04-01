import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { IncomesService } from './incomes.service';
import { Public } from 'src/auth/auth.decorator';
import { Prisma } from '.prisma/client';
import * as request from 'supertest';
import { FilteredInput } from 'src/types';

@Controller('incomes')
export class IncomesController {
  constructor(private readonly incomesService: IncomesService) {}
  @Public()
  // @Post()
  // create(@Body() createIncomeDto: CreateIncomeDto) {
  //   return this.incomesService.create(createIncomeDto);
  // }

  @Get()
  findAll(@Query() query: FilteredInput) {
    const { start_date, end_date , search , sort_by, order } = query;
    const incomesWhereInput : Prisma.IncomeWhereInput = {

    }; // Replace with appropriate filter criteria
    return this.incomesService.findAll(incomesWhereInput);
  }

  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.incomesService.findOne(+id);
  // }

  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateIncomeDto: UpdateIncomeDto) {
  //   return this.incomesService.update(+id, updateIncomeDto);
  // }

  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.incomesService.remove(+id);
  // }
}
