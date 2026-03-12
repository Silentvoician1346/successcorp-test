import { Prisma, WmsStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

function toQueryArray(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const segments = (Array.isArray(value) ? value : [value]).flatMap((entry) =>
    typeof entry === 'string' ? entry.split(',') : [],
  );
  const normalized = Array.from(
    new Set(segments.map((entry) => entry.trim()).filter(Boolean)),
  );

  return normalized.length > 0 ? normalized : undefined;
}

export class GetOrdersQueryDto {
  @IsOptional()
  @Transform(({ value }) => toQueryArray(value))
  @IsArray()
  @IsEnum(WmsStatus, { each: true })
  wms_status?: WmsStatus[];

  @IsOptional()
  @Transform(({ value }) => toQueryArray(value))
  @IsArray()
  @IsString({ each: true })
  marketplace_status?: string[];

  @IsOptional()
  @Transform(({ value }) => toQueryArray(value))
  @IsArray()
  @IsString({ each: true })
  shipping_status?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number;

  @IsOptional()
  @IsEnum(Prisma.SortOrder)
  updated_at_order?: Prisma.SortOrder;
}
