jest.mock('@microsoft/sp-http', () => ({
  SPHttpClient: { configurations: { v1: {} } }
}));

import type { SPHttpClient, SPHttpClientResponse } from '@microsoft/sp-http';
import { SpHttpTransport } from './spHttpTransport';

function createResponse(status: number, contentType: string, body: unknown): SPHttpClientResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType }),
    json: async () => body
  } as SPHttpClientResponse;
}

function createClient(response: SPHttpClientResponse): SPHttpClient {
  return {
    fetch: jest.fn(async () => response),
    get: jest.fn(async () => response),
    post: jest.fn(async () => response)
  } as unknown as SPHttpClient;
}

describe('SpHttpTransport', () => {
  it('uses the configured HTTPS SharePoint web for relative requests', async () => {
    const client = createClient(
      createResponse(200, 'application/json;odata.metadata=none', { ok: true })
    );
    const transport = new SpHttpTransport(client, 'https://example.sharepoint.com/sites/team');

    await expect(transport.get<{ readonly ok: boolean }>('_api/web')).resolves.toEqual({
      ok: true
    });
    expect(client.get).toHaveBeenCalledWith(
      'https://example.sharepoint.com/sites/team/_api/web',
      expect.anything(),
      expect.objectContaining({
        headers: {
          Accept: 'application/json;odata.metadata=none',
          'OData-Version': '4.0'
        }
      })
    );
  });

  it('rejects cross-origin continuation URLs', async () => {
    const transport = new SpHttpTransport(
      createClient(createResponse(200, 'application/json', {})),
      'https://example.sharepoint.com/sites/team'
    );

    await expect(transport.get('https://attacker.example/page-2')).rejects.toThrow(
      'configured HTTPS origin'
    );
  });

  it('uses OData 4 media types for SharePoint JSON writes', async () => {
    const client = createClient(
      createResponse(200, 'application/json;odata.metadata=none', { value: {} })
    );
    const transport = new SpHttpTransport(client, 'https://example.sharepoint.com/sites/team');

    await transport.post('_api/web/lists', {
      BaseTemplate: 101,
      Title: 'PlanningPokerAppData'
    });

    expect(client.post).toHaveBeenCalledWith(
      'https://example.sharepoint.com/sites/team/_api/web/lists',
      expect.anything(),
      expect.objectContaining({
        headers: {
          Accept: 'application/json;odata.metadata=none',
          'Content-Type': 'application/json;charset=utf-8',
          'OData-Version': '4.0'
        }
      })
    );
  });

  it('uses OData PATCH semantics when updating an existing SharePoint entity', async () => {
    const client = createClient(createResponse(204, '', undefined));
    const transport = new SpHttpTransport(client, 'https://example.sharepoint.com/sites/team');

    await expect(
      transport.patch("_api/web/lists('list-id')", { Hidden: true, OnQuickLaunch: false })
    ).resolves.toBeUndefined();

    expect(client.fetch).toHaveBeenCalledWith(
      "https://example.sharepoint.com/sites/team/_api/web/lists('list-id')",
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'If-Match': '*',
          'OData-Version': '4.0'
        })
      })
    );
  });

  it('rejects failed and non-JSON responses and supports empty success responses', async () => {
    const webAbsoluteUrl = 'https://example.sharepoint.com/sites/team';
    await expect(
      new SpHttpTransport(
        createClient(createResponse(500, 'application/json', {})),
        webAbsoluteUrl
      ).get('_api/web')
    ).rejects.toThrow('status 500');
    await expect(
      new SpHttpTransport(
        createClient(createResponse(200, 'text/html', '<html>')),
        webAbsoluteUrl
      ).get('_api/web')
    ).rejects.toThrow('unexpected response type');
    await expect(
      new SpHttpTransport(createClient(createResponse(204, '', undefined)), webAbsoluteUrl).post(
        '_api/web'
      )
    ).resolves.toBeUndefined();
  });
});
