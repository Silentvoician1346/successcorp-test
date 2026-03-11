import { WmsStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class GetOrdersQueryDto {
  @IsOptional()
  @IsEnum(WmsStatus)
  wms_status?: WmsStatus;
}
