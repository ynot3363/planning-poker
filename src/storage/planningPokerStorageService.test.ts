import { SHAREPOINT_METADATA_FIELDS } from '../domain/planningPokerDomain';
import { PlanningPokerStorageService } from './planningPokerStorageService';
import type { ISharePointTransport } from './storageTypes';

function createTransport(
  getImplementation: (path: string) => Promise<unknown>,
  postImplementation: (path: string, body?: unknown) => Promise<unknown> = async () => undefined
): ISharePointTransport {
  return {
    get: getImplementation as ISharePointTransport['get'],
    post: jest.fn(postImplementation) as ISharePointTransport['post'],
    patch: jest.fn(postImplementation) as ISharePointTransport['patch']
  };
}

describe('PlanningPokerStorageService', () => {
  it('requires the exact Manage Lists permission bit', async () => {
    const allowedService = new PlanningPokerStorageService(
      createTransport(async () => ({ High: 0, Low: 0x00000800 })),
      {
        webAbsoluteUrl: 'https://example.sharepoint.com/sites/team',
        metadataFields: SHAREPOINT_METADATA_FIELDS
      }
    );
    const unrelatedPermissionService = new PlanningPokerStorageService(
      createTransport(async () => ({ High: 16, Low: 1 })),
      {
        webAbsoluteUrl: 'https://example.sharepoint.com/sites/team',
        metadataFields: SHAREPOINT_METADATA_FIELDS
      }
    );

    await expect(allowedService.canProvision()).resolves.toBe(true);
    await expect(unrelatedPermissionService.canProvision()).resolves.toBe(false);
  });

  it('follows paged list discovery before building configuration', async () => {
    const getImplementation = jest.fn(async (path: string): Promise<unknown> => {
      if (path.includes('lists?$select')) {
        return { value: [], '@odata.nextLink': 'https://example.sharepoint.com/page-2' };
      }
      if (path.endsWith('/page-2')) {
        return {
          value: [
            {
              Id: 'list-id',
              Title: 'PlanningPokerAppData',
              RootFolder: { ServerRelativeUrl: '/sites/team/PlanningPokerAppData' }
            }
          ]
        };
      }
      if (path.includes('/fields?')) {
        return {
          value: SHAREPOINT_METADATA_FIELDS.map((field, index) => ({
            Title: field.displayName,
            InternalName: `Field${index}`
          }))
        };
      }
      if (path.includes('_api/v2.1/drives')) {
        return { value: [{ id: 'drive-id', sharepointIds: { listId: 'list-id' } }] };
      }
      throw new Error(`Unexpected test path: ${path}`);
    });
    const service = new PlanningPokerStorageService(createTransport(getImplementation), {
      webAbsoluteUrl: 'https://example.sharepoint.com/sites/team',
      metadataFields: SHAREPOINT_METADATA_FIELDS,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
      retryDelay: async () => undefined
    });

    await expect(service.findConfiguration()).resolves.toMatchObject({
      listId: 'list-id',
      driveId: 'drive-id',
      lastValidatedAt: '2026-07-10T00:00:00.000Z'
    });
    expect(
      getImplementation.mock.calls.find(([path]) => path.includes('_api/v2.1/drives'))?.[0]
    ).toContain('system');
  });

  it('revalidates persisted configuration against a hidden system drive', async () => {
    const getImplementation = jest.fn(async (path: string): Promise<unknown> => {
      if (path.includes("lists('list-id')?$select")) {
        return {
          Id: 'list-id',
          Title: 'PlanningPokerAppData',
          RootFolder: { ServerRelativeUrl: '/sites/team/PlanningPokerAppData' }
        };
      }
      if (path.includes('/fields?')) {
        return {
          value: SHAREPOINT_METADATA_FIELDS.map((field, index) => ({
            Title: field.displayName,
            InternalName: `Field${index}`
          }))
        };
      }
      if (path.includes('_api/v2.1/drives')) {
        expect(path).toContain('system');
        return {
          value: [
            {
              id: 'drive-id',
              sharepointIds: { listId: 'list-id' },
              system: {}
            }
          ]
        };
      }
      throw new Error(`Unexpected test path: ${path}`);
    });
    const service = new PlanningPokerStorageService(createTransport(getImplementation), {
      webAbsoluteUrl: 'https://example.sharepoint.com/sites/team',
      metadataFields: SHAREPOINT_METADATA_FIELDS,
      now: () => new Date('2026-07-10T00:00:00.000Z')
    });

    await expect(
      service.validateConfiguration({
        libraryTitle: 'PlanningPokerAppData',
        listId: 'list-id',
        driveId: 'drive-id',
        serverRelativeUrl: '/sites/team/PlanningPokerAppData',
        webAbsoluteUrl: 'https://example.sharepoint.com/sites/team',
        provisioningVersion: '1.0.0',
        schemaVersion: '1.0.0',
        fieldMap: {},
        lastValidatedAt: '2026-07-09T00:00:00.000Z'
      })
    ).resolves.toMatchObject({
      isValid: true,
      configuration: { driveId: 'drive-id' }
    });
  });

  it('repairs fields, resolves the drive, and then hides the library', async () => {
    let fieldReadCount = 0;
    let driveReadCount = 0;
    const provisioningOrder: string[] = [];
    const getImplementation = jest.fn(async (path: string): Promise<unknown> => {
      if (path.includes('effectiveBasePermissions')) {
        return { d: { EffectiveBasePermissions: { High: '0', Low: '2048' } } };
      }
      if (path.includes('lists?$select')) {
        return {
          value: [
            {
              Id: 'list-id',
              Title: 'PlanningPokerAppData',
              RootFolder: { ServerRelativeUrl: '/sites/team/PlanningPokerAppData' }
            }
          ]
        };
      }
      if (path.includes('/fields')) {
        fieldReadCount += 1;
        return fieldReadCount === 1
          ? { value: [] }
          : {
              value: SHAREPOINT_METADATA_FIELDS.map((field, index) => ({
                Title: field.displayName,
                InternalName: `Field${index}`
              }))
            };
      }
      if (path.includes('_api/v2.1/drives')) {
        provisioningOrder.push('resolve-drive');
        driveReadCount += 1;
        return driveReadCount === 1
          ? { value: [] }
          : { value: [{ id: 'drive-id', sharepointIds: { listId: 'list-id' } }] };
      }
      throw new Error(`Unexpected test path: ${path}`);
    });
    const postImplementation = jest.fn(async (_path: string, body?: unknown): Promise<unknown> => {
      if (typeof body === 'object' && body !== null && 'Hidden' in body && body.Hidden === true) {
        provisioningOrder.push('hide-library');
      }
      return undefined;
    });
    const retryDelay = jest.fn(async (): Promise<void> => undefined);
    const service = new PlanningPokerStorageService(
      createTransport(getImplementation, postImplementation),
      {
        webAbsoluteUrl: 'https://example.sharepoint.com/sites/team',
        metadataFields: SHAREPOINT_METADATA_FIELDS,
        retryDelay
      }
    );

    await expect(service.provision()).resolves.toMatchObject({ driveId: 'drive-id' });
    expect(postImplementation).toHaveBeenCalledTimes(SHAREPOINT_METADATA_FIELDS.length + 1);
    for (const [path, body] of postImplementation.mock.calls) {
      expect(path).not.toContain("(guid'");
      expect(body).not.toHaveProperty('__metadata');
    }
    expect(postImplementation).toHaveBeenCalledWith(
      "_api/web/lists('list-id')",
      expect.objectContaining({ Hidden: true, OnQuickLaunch: false })
    );
    expect(provisioningOrder[provisioningOrder.length - 1]).toBe('hide-library');
    const fieldBodies = postImplementation.mock.calls
      .map(([, body]) => body)
      .filter((body): body is Record<string, unknown> => typeof body === 'object' && body !== null);
    const userFieldBodies = fieldBodies.filter((body) => body.AllowMultipleValues === true);
    expect(userFieldBodies).toHaveLength(2);
    expect(userFieldBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          '@odata.type': '#SP.FieldUser',
          FieldTypeKind: 20,
          AllowMultipleValues: true
        })
      ])
    );
    expect(fieldBodies.filter((body) => body['@odata.type'] === undefined)).not.toContainEqual(
      expect.objectContaining({ AllowMultipleValues: true })
    );
    expect(retryDelay).toHaveBeenCalledWith(0);
  });

  it('hydrates a newly created library before resolving its drive and hiding it', async () => {
    const provisioningOrder: string[] = [];
    const getImplementation = jest.fn(async (path: string): Promise<unknown> => {
      if (path.includes('effectiveBasePermissions')) {
        return { High: 0, Low: 0x00000800 };
      }
      if (path.includes('lists?$select')) {
        return { value: [] };
      }
      if (path.includes("lists('new-list')?$select")) {
        provisioningOrder.push('hydrate-root');
        return {
          Id: 'new-list',
          Title: 'PlanningPokerAppData',
          RootFolder: { ServerRelativeUrl: '/sites/team/PlanningPokerAppData' }
        };
      }
      if (path.includes('/fields')) {
        return {
          value: SHAREPOINT_METADATA_FIELDS.map((field, index) => ({
            Title: field.displayName,
            InternalName: `Field${index}`
          }))
        };
      }
      if (path.includes('_api/v2.1/drives')) {
        provisioningOrder.push('resolve-drive');
        return { value: [{ id: 'drive-id', sharepointIds: { listId: 'new-list' } }] };
      }
      throw new Error(`Unexpected test path: ${path}`);
    });
    const postImplementation = jest.fn(async (path: string, body?: unknown): Promise<unknown> => {
      if (path === '_api/web/lists') {
        provisioningOrder.push('create-library');
        return { Id: 'new-list', Title: 'PlanningPokerAppData' };
      }
      if (typeof body === 'object' && body !== null && 'Hidden' in body && body.Hidden === true) {
        provisioningOrder.push('hide-library');
      }
      return undefined;
    });
    const service = new PlanningPokerStorageService(
      createTransport(getImplementation, postImplementation),
      {
        webAbsoluteUrl: 'https://example.sharepoint.com/sites/team',
        metadataFields: SHAREPOINT_METADATA_FIELDS,
        retryDelay: async () => undefined
      }
    );

    await expect(service.provision()).resolves.toMatchObject({
      driveId: 'drive-id',
      serverRelativeUrl: '/sites/team/PlanningPokerAppData'
    });
    expect(provisioningOrder).toEqual([
      'create-library',
      'hydrate-root',
      'resolve-drive',
      'hide-library'
    ]);
  });

  it('blocks provisioning when Manage Lists permission is absent', async () => {
    const service = new PlanningPokerStorageService(
      createTransport(async () => ({ High: 0, Low: 1 })),
      {
        webAbsoluteUrl: 'https://example.sharepoint.com/sites/team',
        metadataFields: SHAREPOINT_METADATA_FIELDS
      }
    );

    await expect(service.provision()).rejects.toThrow('site list-management permission');
  });
});
