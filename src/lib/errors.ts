/** blocked：地址不在允许范围（默认只允许局域网和 Tailscale），请求没有发出去 */
export type ConnectorErrorKind = 'network' | 'timeout' | 'auth' | 'http' | 'unsupported' | 'device' | 'blocked';

export class ConnectorError extends Error {
  constructor(
    readonly kind: ConnectorErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export const isConnectorError = (e: unknown): e is ConnectorError => e instanceof ConnectorError;
