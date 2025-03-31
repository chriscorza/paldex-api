import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { IncomesService } from './incomes.service';
import { Public } from 'src/auth/auth.decorator';

@Controller('incomes')
export class IncomesController {
  constructor(private readonly incomesService: IncomesService) {}
  @Public()
  // @Post()
  // create(@Body() createIncomeDto: CreateIncomeDto) {
  //   return this.incomesService.create(createIncomeDto);
  // }

  @Get()
  findAll() {
    const incomesWhereInput = {}; // Replace with appropriate filter criteria
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
