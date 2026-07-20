import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { ImageDto } from './dto/image.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('oss/upload-signature')
  getUploadSignature(@Query('ext') ext?: string) {
    return this.aiService.getUploadSignature(ext);
  }

  @Get('image/list')
  listImages() {
    return this.aiService.listImages();
  }

  @Post('image')
  createImage(@Body() dto: ImageDto) {
    return this.aiService.createImage(dto);
  }

  @Delete('image/:id')
  deleteImage(@Param('id') id: string) {
    this.aiService.deleteImage(id);
    return { ok: true };
  }
}
