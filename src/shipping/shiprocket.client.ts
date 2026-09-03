import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * The only place that knows Shiprocket exists: URL, auth, token lifetime and
 * error shape. ShippingService talks to this, never to fetch() directly.
 */

const DEFAULT_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

// Shiprocket session tokens expire; refresh a minute early so a request never
// goes out with a token that dies in flight.
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

export type ShiprocketState = {
  configured: boolean;
  enabled: boolean;
  baseUrl: string;
  missingEnv: string[];
};

export type ParcelDefaults = {
  weight: number;
  length: number;
  breadth: number;
  height: number;
};

@Injectable()
export class ShiprocketClient {
  private readonly logger = new Logger(ShiprocketClient.name);
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  private env(name: string): string | null {
    const value = this.config.get<string>(name);
    return value && value.trim() ? value.trim() : null;
  }

  get baseUrl(): string {
    return this.env('SHIPROCKET_BASE_URL') ?? DEFAULT_BASE_URL;
  }

  /** Automatic shipment creation is opt-in per deployment. */
  get autoCreateEnabled(): boolean {
    return (this.env('SHIPROCKET_ENABLED') ?? 'false').toLowerCase() === 'true';
  }

  get hasCredentials(): boolean {
    return Boolean(this.env('SHIPROCKET_EMAIL') && this.env('SHIPROCKET_PASSWORD'));
  }

  state(): ShiprocketState {
    const missingEnv: string[] = [];
    if (!this.env('SHIPROCKET_EMAIL')) missingEnv.push('SHIPROCKET_EMAIL');
    if (!this.env('SHIPROCKET_PASSWORD')) missingEnv.push('SHIPROCKET_PASSWORD');

    return {
      configured: missingEnv.length === 0,
      enabled: this.autoCreateEnabled,
      baseUrl: this.baseUrl,
      missingEnv,
    };
  }

  /**
   * Raised only by Shiprocket-specific operations. Order management never
   * reaches this path, so the app stays usable without credentials.
   */
  assertConfigured(): void {
    const { configured, missingEnv } = this.state();

    if (!configured) {
      throw new ServiceUnavailableException(
        `Shiprocket is not configured. Missing ${missingEnv.join(', ')} in backend/.env.`,
      );
    }
  }

  /**
   * Forces a fresh login so an operator can prove the configured credentials
   * actually authenticate, rather than trusting a cached token.
   */
  async verifyCredentials(): Promise<void> {
    this.assertConfigured();
    await this.getToken(true);
  }

  /**
   * Packing envelope is warehouse configuration, not product data. Products
   * carry no weight or dimensions in this catalog, so the values are declared
   * per deployment instead of being invented per shipment.
   */
  parcelDefaults(): ParcelDefaults | null {
    const weight = Number(this.env('SHIPROCKET_PARCEL_WEIGHT'));
    const length = Number(this.env('SHIPROCKET_PARCEL_LENGTH'));
    const breadth = Number(this.env('SHIPROCKET_PARCEL_BREADTH'));
    const height = Number(this.env('SHIPROCKET_PARCEL_HEIGHT'));

    const values = [weight, length, breadth, height];
    if (values.some((v) => !Number.isFinite(v) || v <= 0)) return null;

    return { weight, length, breadth, height };
  }

  pickupLocation(): string | null {
    return this.env('SHIPROCKET_PICKUP_LOCATION');
  }

  /**
   * GET against the External API. Returns the parsed body untouched apart from
   * error mapping, so callers see Shiprocket's real field names.
   */
  async get<T = Record<string, unknown>>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
  }

  private async request<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: string },
  ): Promise<T> {
    this.assertConfigured();

    let token = await this.getToken();

    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        ...(init.body ? { body: init.body } : {}),
      });

      // A token revoked or expired upstream is the one failure worth
      // recovering from silently. Only ever retried once.
      if (response.status === 401 && attempt === 0) {
        this.logger.warn('Shiprocket rejected the cached token; re-authenticating');
        token = await this.getToken(true);
        continue;
      }

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new BadGatewayException(
          this.upstreamMessage(payload, `Shiprocket request failed (${response.status})`),
        );
      }

      // Shiprocket reports business failures as HTTP 200 with status_code +
      // message, so a green status alone never proves the call worked.
      const statusCode = (payload as { status_code?: number | string } | null)
        ?.status_code;
      if (statusCode !== undefined && Number(statusCode) !== 200) {
        throw new BadGatewayException(
          this.upstreamMessage(payload, 'Shiprocket rejected the request'),
        );
      }

      return payload as T;
    }
  }

  private upstreamMessage(payload: unknown, fallback: string): string {
    const message = (payload as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message.trim()) {
      return `Shiprocket: ${message.trim()}`;
    }
    return fallback;
  }

  private async getToken(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      this.token &&
      this.tokenExpiresAt - TOKEN_REFRESH_SKEW_MS > Date.now()
    ) {
      return this.token;
    }

    const email = this.env('SHIPROCKET_EMAIL');
    const password = this.env('SHIPROCKET_PASSWORD');

    if (!email || !password) {
      throw new ServiceUnavailableException(
        'Shiprocket is not configured. Missing SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD in backend/.env.',
      );
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new BadGatewayException('Unable to reach Shiprocket');
    }

    const payload = (await response.json().catch(() => null)) as {
      token?: string;
      message?: string;
    } | null;

    if (!response.ok || !payload?.token) {
      this.token = null;
      this.tokenExpiresAt = 0;
      throw new UnauthorizedException(
        payload?.message
          ? `Shiprocket authentication failed: ${payload.message}`
          : 'Shiprocket authentication failed',
      );
    }

    this.token = payload.token;
    this.tokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;

    return this.token;
  }
}
