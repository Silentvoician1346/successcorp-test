import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

type ThrottleDecoratorFactory = (
  options: Record<
    string,
    {
      limit?: number;
      ttl?: number;
      blockDuration?: number;
    }
  >,
) => MethodDecorator & ClassDecorator;

const applyThrottle = Throttle as unknown as ThrottleDecoratorFactory;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @applyThrottle({ default: { limit: 20, ttl: 60_000 } })
  @Post('login')
  login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password);
  }
}
