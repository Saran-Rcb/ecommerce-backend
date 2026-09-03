import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * The configurator has no login gate and section 14 forbids adding one, so a
 * wholesale submission may legitimately arrive from an anonymous visitor.
 *
 * When a bearer token is present and valid it is resolved normally, which lets
 * the submission be linked to the real account and its stored name and phone
 * carried into the admin view. When it is absent or bad, the request continues
 * as a guest and ownership rests on the accessKey issued in the response.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(err: any, user: any): TUser {
    return (user ?? undefined) as TUser;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch {
      // Anonymous is a supported state here, not a failure.
    }

    return true;
  }
}
