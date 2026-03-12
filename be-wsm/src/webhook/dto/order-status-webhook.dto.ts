import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class OrderStatusWebhookDto {
  @IsString()
  @IsNotEmpty()
  order_sn!: string;

  @IsString()
  @IsNotEmpty()
  status!: string;

  @IsOptional()
  @IsString()
  shop_id?: string;
}
