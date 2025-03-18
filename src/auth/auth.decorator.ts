import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from 'src/globalConstants';

export const Public = () => SetMetadata(IS_PUBLIC_KEY,true)
