import {
  IsString,
  IsOptional,
  IsArray,
  IsUUID,
  IsNotEmpty,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBookDto {
  @IsUUID()
  userId: string;

  @ApiProperty({ example: 'The Last Days of Constantinople' })
  @IsString()
  title: string;

  @ApiProperty({
    example: 'The Siege of 1453 and the End of an Empire',
    required: false,
  })
  @IsString()
  @IsOptional()
  subtitle?: string;

  @ApiProperty({ example: 'John Smith' })
  @IsString()
  author: string;

  @ApiProperty({
    example: 'The Fall of Constantinople (1453)',
    description:
      'The historical event, era, place, people or movement the book covers, by the name it is generally known by',
  })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({
    example: 'Focus on the defenders and ordinary people inside the city.',
    description: 'Optional facts or direction. Research wins where they conflict.',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(4000)
  notes?: string;

  @ApiProperty({ example: 12, default: 12, minimum: 5, maximum: 30 })
  @IsInt()
  @Min(5)
  @Max(30)
  @IsOptional()
  numberOfChapters?: number = 12;

  // Images are handled by @UseInterceptors, not the DTO

  @ApiProperty({
    example: ['Chapter 1 image', 'Chapter 2 image'],
    description: 'Captions for each image (optional)',
    required: false,
    type: [String],
  })
  @IsArray()
  @IsOptional()
  imageCaptions?: string[];

  @ApiProperty({
    example: [1, 2, 2, 3, 3, 3, 4, 5, 5, 6],
    description:
      'Chapter numbers for each image (if not provided, auto-distributed)',
    required: false,
    type: [Number],
  })
  @IsArray()
  @IsOptional()
  imageChapterNumbers?: number[];
}
