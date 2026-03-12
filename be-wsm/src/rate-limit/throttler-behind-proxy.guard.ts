import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const headers =
      typeof req.headers === 'object' && req.headers !== null
        ? (req.headers as Record<string, unknown>)
        : null;
    const forwardedFor = headers?.['x-forwarded-for'];
    const headerValues = Array.isArray(forwardedFor)
      ? forwardedFor
      : [forwardedFor];

    for (const value of headerValues) {
      if (typeof value !== 'string') {
        continue;
      }

      const firstForwarded = value
        .split(',')
        .map((segment) => segment.trim())
        .find(Boolean);
      if (firstForwarded) {
        return Promise.resolve(firstForwarded);
      }
    }

    const directIp = req.ip;
    if (typeof directIp === 'string' && directIp.trim()) {
      return Promise.resolve(directIp.trim());
    }

    return Promise.resolve('unknown-client');
  }
}
