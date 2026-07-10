import { SPHttpClient } from '@microsoft/sp-http';
import type { SPHttpClientResponse } from '@microsoft/sp-http';
import type { ISharePointTransport } from './storageTypes';

const JSON_NO_METADATA_MEDIA_TYPE = 'application/json;odata.metadata=none';
const JSON_REQUEST_MEDIA_TYPE = 'application/json;charset=utf-8';
const ODATA_VERSION = '4.0';

/** Sends site-scoped JSON requests through SPFx's authenticated SharePoint client. */
export class SpHttpTransport implements ISharePointTransport {
  /**
   * Creates a transport restricted to one SharePoint web origin.
   *
   * @param client - The SPFx-authenticated SharePoint HTTP client.
   * @param webAbsoluteUrl - The HTTPS URL of the current SharePoint web.
   */
  public constructor(
    private readonly client: SPHttpClient,
    private readonly webAbsoluteUrl: string
  ) {}

  /**
   * Sends an authenticated SharePoint GET request.
   *
   * @param path - A site-relative API path or same-origin continuation URL.
   * @returns The validated JSON response body.
   * @throws Throws when SharePoint fails or returns an unexpected response type.
   */
  public async get<T>(path: string): Promise<T> {
    const response = await this.client.get(this.toUrl(path), SPHttpClient.configurations.v1, {
      headers: {
        Accept: JSON_NO_METADATA_MEDIA_TYPE,
        'OData-Version': ODATA_VERSION
      }
    });
    return this.read<T>(response);
  }

  /**
   * Sends an authenticated SharePoint POST request.
   *
   * @param path - A site-relative API path or same-origin continuation URL.
   * @param body - The optional serializable request body.
   * @returns The validated JSON response body, or `undefined` for an empty success response.
   * @throws Throws when SharePoint fails or returns an unexpected response type.
   */
  public async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.client.post(this.toUrl(path), SPHttpClient.configurations.v1, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: JSON_NO_METADATA_MEDIA_TYPE,
        'Content-Type': JSON_REQUEST_MEDIA_TYPE,
        'OData-Version': ODATA_VERSION
      }
    });
    return this.read<T>(response);
  }

  /**
   * Updates an existing SharePoint entity using the OData 4 PATCH method.
   *
   * @param path - A site-relative entity endpoint.
   * @param body - The serializable partial entity update.
   * @returns The validated JSON response body, or `undefined` for an empty success response.
   * @throws Throws when SharePoint fails or returns an unexpected response type.
   */
  public async patch<T>(path: string, body: unknown): Promise<T> {
    const response = await this.client.fetch(this.toUrl(path), SPHttpClient.configurations.v1, {
      body: JSON.stringify(body),
      headers: {
        Accept: JSON_NO_METADATA_MEDIA_TYPE,
        'Content-Type': JSON_REQUEST_MEDIA_TYPE,
        'If-Match': '*',
        'OData-Version': ODATA_VERSION
      },
      method: 'PATCH'
    });
    return this.read<T>(response);
  }

  /**
   * Resolves an API path while rejecting cross-origin and non-HTTPS endpoints.
   *
   * @param path - The API path or continuation URL to resolve.
   * @returns An allow-listed absolute SharePoint URL.
   * @throws Throws when the resolved URL is outside the configured SharePoint origin.
   */
  private toUrl(path: string): string {
    const webUrl = new URL(this.webAbsoluteUrl);
    const resolvedUrl = new URL(
      path.replace(/^\//, ''),
      `${this.webAbsoluteUrl.replace(/\/$/, '')}/`
    );
    if (
      webUrl.protocol !== 'https:' ||
      resolvedUrl.protocol !== 'https:' ||
      resolvedUrl.origin !== webUrl.origin
    ) {
      throw new Error('SharePoint requests must use the configured HTTPS origin.');
    }
    return resolvedUrl.toString();
  }

  /**
   * Validates and reads one SharePoint response without exposing response bodies in errors.
   *
   * @param response - The SPFx response to inspect.
   * @returns The parsed JSON body, or `undefined` for HTTP 204.
   * @throws Throws for failed responses or non-JSON payloads.
   */
  private async read<T>(response: SPHttpClientResponse): Promise<T> {
    if (!response.ok) {
      throw new Error(`SharePoint request failed with status ${response.status}.`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^application\/json(?:;|$)/i.test(contentType)) {
      throw new Error('SharePoint returned an unexpected response type.');
    }
    return response.json() as Promise<T>;
  }
}
