import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AppService } from './app.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

type RequestWithUser = Request & {
  user: {
    sub: string;
    email: string;
    role: string;
  };
};

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    return { status: 'ok' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() req: RequestWithUser) {
    return { user: req.user };
  }
}
