import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ShippingStatusWebhookDto {
  @IsString()
  @IsNotEmpty()
  order_sn!: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  shipping_state?: string;

  @IsOptional()
  @IsString()
  shop_id?: string;

  @IsOptional()
  @IsString()
  tracking_no?: string;

  @IsOptional()
  @IsString()
  tracking_number?: string;
}
