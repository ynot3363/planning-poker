import type { MSGraphClientV3 } from '@microsoft/sp-http';
import { GraphDriveService } from './graphDriveService';

describe('GraphDriveService', () => {
  it('renames the configured drive item through Graph v1.0', async () => {
    const patch = jest.fn(async () => ({ id: 'item-id', name: 'Renamed Team.fluid' }));
    const version = jest.fn(() => ({ patch }));
    const api = jest.fn(() => ({ version }));
    const service = new GraphDriveService({ api } as unknown as MSGraphClientV3);

    await service.rename('drive-id', 'item-id', 'Renamed Team.fluid');

    expect(api).toHaveBeenCalledWith('/drives/drive-id/items/item-id');
    expect(version).toHaveBeenCalledWith('v1.0');
    expect(patch).toHaveBeenCalledWith({ name: 'Renamed Team.fluid' });
  });

  it('uses Graph for site drives and drive-item reads', async () => {
    const get = jest
      .fn()
      .mockResolvedValueOnce({
        value: [{ id: 'drive-id', sharepointIds: { listId: 'list-id' } }]
      })
      .mockResolvedValueOnce({ id: 'known-drive' })
      .mockResolvedValueOnce({ id: 'path-item' })
      .mockResolvedValueOnce({ id: 'id-item', sharepointIds: { listItemId: '12' } });
    const select = jest.fn(() => ({ get }));
    const version = jest.fn(() => ({ get, select }));
    const api = jest.fn(() => ({ version }));
    const service = new GraphDriveService({ api } as unknown as MSGraphClientV3);

    await expect(
      service.listSiteDrives('https://example.sharepoint.com/sites/team/')
    ).resolves.toEqual([{ id: 'drive-id', sharepointIds: { listId: 'list-id' } }]);
    await expect(service.getDrive('known-drive')).resolves.toEqual({ id: 'known-drive' });
    await expect(service.getByPath('drive-id', 'Example Team.fluid')).resolves.toEqual({
      id: 'path-item'
    });
    await expect(service.get('drive-id', 'item-id')).resolves.toEqual({
      id: 'id-item',
      sharepointIds: { listItemId: '12' }
    });

    expect(api).toHaveBeenNthCalledWith(1, '/sites/example.sharepoint.com:/sites/team:/drives');
    expect(api).toHaveBeenNthCalledWith(3, '/drives/drive-id/root:/Example%20Team.fluid');
    expect(api).toHaveBeenNthCalledWith(2, '/drives/known-drive');
    expect(api).toHaveBeenNthCalledWith(4, '/drives/drive-id/items/item-id');
    expect(select).toHaveBeenCalledWith('id,sharepointIds');
    expect(select).toHaveBeenCalledWith('id,name,webUrl,sharepointIds,system');
  });

  it('uses the hostname form when the SharePoint web is the tenant root site', async () => {
    const get = jest.fn(async () => ({ value: [] }));
    const select = jest.fn(() => ({ get }));
    const version = jest.fn(() => ({ get, select }));
    const api = jest.fn(() => ({ version }));
    const service = new GraphDriveService({ api } as unknown as MSGraphClientV3);

    await service.listSiteDrives('https://example.sharepoint.com/');

    expect(api).toHaveBeenCalledWith('/sites/example.sharepoint.com/drives');
  });
});
