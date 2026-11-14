import {
  Controller,
  Post,
  Body,
  Param,
  Get,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { GenerateHistoryDto } from './dto/generate-history.dto';
import { ContentService } from './content.service';

@ApiTags('content')
@Controller('content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Post('generate-history/:projectId')
  @ApiOperation({
    summary: 'Generate a complete English narrative history book',
    description: `Generates a narrative history book following this 6-step process:

Step 1: Research the subject with live web search; stop if there are too few reliable sources
Step 2: Create a chronological 12-chapter outline from that research
Step 3: Write the Introduction around one documented moment, place, object or person
Step 4: Write each main chapter in order, as narrative prose, checked against the sources for copied text
Step 5: Write the Conclusion on what changed and how it is remembered, with a timeline and source list
Step 6: Add copyright, about-the-book and table of contents

Prompts forbid invented quotes, dialogue, scenes and private thoughts; copied wording, translations and storytelling; myths presented as fact; demeaning labels; and graphic detail. Author notes add direction and facts, but the research and those rules win.`,
  })
  @ApiResponse({
    status: 201,
    description: 'Book generation started. Returns job ID for tracking.',
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async generateHistory(
    @Param('projectId') projectId: string,
    @Body() generateDto: GenerateHistoryDto,
  ) {
    return await this.contentService.generateHistoryBook(projectId, generateDto);
  }

  @Get('status/:jobId')
  @ApiOperation({ summary: 'Get book generation job status and progress' })
  @ApiResponse({ 
    status: 200, 
    description: 'Job status with progress percentage (0-100)' 
  })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getStatus(@Param('jobId') jobId: string) {
    return await this.contentService.getGenerationStatus(jobId);
  }
}