import { NotFoundException } from '@nestjs/common';
import { PayablesService } from './payables.service';
import { ReceivablesService } from '../receivables/receivables.service';

/*
 * Borrar un pago o un cobro buscaba sólo por id: cualquiera con permiso de
 * actualizar podía borrar el de otro dueño. Ahora se busca por su dueño.
 */
describe('borrar pagos y cobros respeta al dueño', () => {
  const own = { userId: 1, scope: 'OWN' as const };

  it('un pago de otro dueño es 404 y no se toca', async () => {
    const prisma: any = {
      payablePayment: {
        findFirst: jest.fn().mockResolvedValue(null),
        delete: jest.fn(),
      },
    };
    const service = new PayablesService(prisma);

    await expect(service.removePayment(own, 5)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.payablePayment.findFirst).toHaveBeenCalledWith({
      where: { id: 5, payable: { user_id: 1 } },
    });
    expect(prisma.payablePayment.delete).not.toHaveBeenCalled();
  });

  it('un cobro de otro dueño es 404 y no se toca', async () => {
    const prisma: any = {
      receivableCollection: {
        findFirst: jest.fn().mockResolvedValue(null),
        delete: jest.fn(),
      },
    };
    const service = new ReceivablesService(prisma);

    await expect(service.removeCollection(own, 6)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.receivableCollection.findFirst).toHaveBeenCalledWith({
      where: { id: 6, receivable: { user_id: 1 } },
    });
    expect(prisma.receivableCollection.delete).not.toHaveBeenCalled();
  });
});
