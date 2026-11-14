import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateHistoryDto {
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
  subject: string;

  @ApiProperty({
    example: 'Focus on the defenders and ordinary people inside the city.',
    description:
      'Optional facts or direction from the author. Research wins where they conflict.',
    required: false,
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ example: 12, default: 12, minimum: 5, maximum: 30 })
  @IsInt()
  @Min(5)
  @Max(30)
  @IsOptional()
  numberOfChapters?: number = 12;
}

export class BookOutlineDto {
  @ApiProperty()
  title: string;

  @ApiProperty()
  subtitle?: string;

  @ApiProperty()
  author: string;

  @ApiProperty({ type: [Object] })
  chapters: ChapterOutline[];
}

export class ChapterOutline {
  chapterNumber: number;
  chapterTitle: string;
  sections: SectionOutline[];
}

export class SectionOutline {
  sectionTitle: string;
  subsections: string[];
}
